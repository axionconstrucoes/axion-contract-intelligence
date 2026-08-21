-- ============================================================
-- Contract Review Workflow
--
-- Aprovação/rejeição humana dos candidatos derivados de
-- threads de email.
--
-- Regras:
-- - usuário autenticado;
-- - mínimo EDITOR no projeto;
-- - candidato deve estar PENDING_REVIEW;
-- - aprovação cria 1 Contract Event;
-- - todos os emails do thread viram event_evidence;
-- - rejeição exige justificativa;
-- - auditoria append-only.
-- ============================================================

create or replace function public.review_email_thread_event_candidate(
  p_candidate_id uuid,
  p_action text,
  p_review_note text default null,
  p_event_title text default null,
  p_event_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate public.email_thread_event_candidates%rowtype;
  v_user_id uuid;
  v_event_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
    into v_candidate
  from public.email_thread_event_candidates
  where id = p_candidate_id
  for update;

  if not found then
    raise exception 'Candidate not found';
  end if;

  if not public.has_project_permission(
    v_candidate.project_id,
    'EDITOR'
  ) then
    raise exception 'Insufficient project permission';
  end if;

  if v_candidate.status <> 'PENDING_REVIEW' then
    raise exception
      'Candidate is not pending review';
  end if;


  -- ========================================================
  -- REJEICAO
  -- ========================================================

  if p_action = 'REJECT' then

    if nullif(
      btrim(coalesce(p_review_note, '')),
      ''
    ) is null then
      raise exception
        'Review note is required for rejection';
    end if;

    update public.email_thread_event_candidates
    set
      status = 'REJECTED',
      reviewed_by_user_id = v_user_id,
      reviewed_at = now(),
      review_note = btrim(p_review_note)
    where id = v_candidate.id;

    insert into public.audit_log_entries (
      project_id,
      actor_type,
      actor_user_id,
      action,
      entity_type,
      entity_id,
      detail
    )
    values (
      v_candidate.project_id,
      'USER',
      v_user_id,
      'CONTRACT_REVIEW_CANDIDATE_REJECTED',
      'EMAIL_THREAD_EVENT_CANDIDATE',
      v_candidate.id::text,
      concat(
        'Candidato rejeitado. Thread: ',
        v_candidate.provider_thread_id,
        '. Justificativa: ',
        btrim(p_review_note)
      )
    );

    return null;
  end if;


  -- ========================================================
  -- APROVACAO
  -- ========================================================

  if p_action <> 'APPROVE' then
    raise exception 'Invalid review action';
  end if;

  if nullif(
    btrim(coalesce(p_event_title, '')),
    ''
  ) is null then
    raise exception
      'Event title is required';
  end if;

  if nullif(
    btrim(coalesce(p_event_description, '')),
    ''
  ) is null then
    raise exception
      'Event description is required';
  end if;


  -- ========================================================
  -- CRIAR EVENTO
  -- ========================================================

  insert into public.contract_events (
    project_id,
    occurred_at,
    title,
    description,
    source_type,
    status,
    created_by_type,
    created_by_user_id
  )
  values (
    v_candidate.project_id,
    v_candidate.first_message_at,
    btrim(p_event_title),
    btrim(p_event_description),
    'EMAIL',
    'NOVO',
    'USER',
    v_user_id
  )
  returning id into v_event_id;


  -- ========================================================
  -- CATEGORIAS
  -- ========================================================

  insert into public.event_categories (
    event_id,
    category
  )
  select
    v_event_id,
    category
  from (
    select distinct
      unnest(v_candidate.categories) as category
  ) c
  on conflict do nothing;


  -- ========================================================
  -- TODAS AS MENSAGENS DO THREAD COMO EVIDENCIA
  -- ========================================================

  insert into public.event_evidence (
    event_id,
    source_type,
    label,
    locator,
    email_id
  )
  select
    v_event_id,
    'EMAIL',
    left(
      concat(
        'Gmail - ',
        coalesce(
          nullif(e.subject, ''),
          '(sem assunto)'
        )
      ),
      500
    ),
    concat(
      'gmail://',
      coalesce(
        e.mailbox_address,
        'unknown'
      ),
      '/',
      coalesce(
        e.provider_message_id,
        e.id::text
      )
    ),
    e.id
  from public.email_thread_event_candidate_emails ce
  join public.emails e
    on e.id = ce.email_id
  where ce.candidate_id = v_candidate.id
  order by e.sent_at;


  -- ========================================================
  -- FINALIZAR CANDIDATO
  -- ========================================================

  update public.email_thread_event_candidates
  set
    status = 'EVENT_CREATED',
    event_id = v_event_id,
    reviewed_by_user_id = v_user_id,
    reviewed_at = now(),
    review_note = coalesce(
      nullif(
        btrim(coalesce(p_review_note, '')),
        ''
      ),
      btrim(p_event_description)
    )
  where id = v_candidate.id;


  -- ========================================================
  -- AUDITORIA
  -- ========================================================

  insert into public.audit_log_entries (
    project_id,
    actor_type,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    detail
  )
  values (
    v_candidate.project_id,
    'USER',
    v_user_id,
    'CONTRACT_EVENT_CREATED_FROM_EMAIL_THREAD',
    'EMAIL_THREAD_EVENT_CANDIDATE',
    v_candidate.id::text,
    concat(
      'Candidato aprovado e convertido no Event Ledger. ',
      'Evento: ',
      v_event_id::text,
      '; thread: ',
      v_candidate.provider_thread_id,
      '; mensagens/evidencias: ',
      v_candidate.message_count,
      '.'
    )
  );

  return v_event_id;
end;
$$;


revoke all
  on function public.review_email_thread_event_candidate(
    uuid,
    text,
    text,
    text,
    text
  )
  from public, anon;

grant execute
  on function public.review_email_thread_event_candidate(
    uuid,
    text,
    text,
    text,
    text
  )
  to authenticated;


comment on function public.review_email_thread_event_candidate(
  uuid,
  text,
  text,
  text,
  text
) is
  'Revisao humana de candidato contratual. EDITOR ou ADMIN. Aprovacao cria Event Ledger e evidencias; rejeicao exige justificativa.';
