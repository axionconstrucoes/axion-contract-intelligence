-- ============================================================
-- email_contract_triage_foundation.sql
--
-- Triagem deterministica EMAIL -> Event Ledger.
--
-- Esta camada NAO e avaliacao por IA.
-- event_ai_assessments permanece reservado para analise posterior
-- com revisao humana obrigatoria.
-- ============================================================

create table public.email_triage_results (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete cascade,

  email_id uuid not null unique
    references public.emails (id) on delete restrict,

  event_id uuid unique
    references public.contract_events (id) on delete restrict,

  rule_version text not null,

  decision text not null
    check (decision in ('SKIPPED', 'EVENT_CREATED')),

  priority text not null
    check (priority in ('BAIXA', 'MEDIA', 'ALTA', 'CRITICA')),

  score integer not null
    check (score >= 0),

  matched_categories text[] not null default '{}',

  matched_terms jsonb not null default '[]'::jsonb,

  triaged_at timestamptz not null default now(),

  created_at timestamptz not null default now(),

  check (
    (decision = 'SKIPPED' and event_id is null)
    or
    (decision = 'EVENT_CREATED' and event_id is not null)
  )
);

create index email_triage_results_project_idx
  on public.email_triage_results (project_id, triaged_at desc);

create index email_triage_results_decision_idx
  on public.email_triage_results (project_id, decision);

create index email_triage_results_event_idx
  on public.email_triage_results (event_id)
  where event_id is not null;

alter table public.email_triage_results
  enable row level security;

create policy "email_triage_results_select_project_members"
  on public.email_triage_results
  for select
  using (public.is_project_member(project_id));


-- ============================================================
-- Registro atomico da triagem.
--
-- Garante:
--   email -> event -> categories -> evidence -> triage result
--
-- Nunca cria event_ai_assessment.
-- ============================================================

create or replace function public.register_email_triage_result(
  p_email_id uuid,
  p_rule_version text,
  p_is_candidate boolean,
  p_priority text,
  p_score integer,
  p_categories text[],
  p_matched_terms jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email public.emails%rowtype;
  v_existing public.email_triage_results%rowtype;
  v_event_id uuid;
  v_category text;
begin
  select *
    into v_existing
  from public.email_triage_results
  where email_id = p_email_id;

  if found then
    return v_existing.event_id;
  end if;

  select *
    into v_email
  from public.emails
  where id = p_email_id;

  if not found then
    raise exception 'Email not found';
  end if;

  if p_priority not in ('BAIXA', 'MEDIA', 'ALTA', 'CRITICA') then
    raise exception 'Invalid priority';
  end if;

  if not p_is_candidate then
    insert into public.email_triage_results (
      project_id,
      email_id,
      event_id,
      rule_version,
      decision,
      priority,
      score,
      matched_categories,
      matched_terms
    )
    values (
      v_email.project_id,
      v_email.id,
      null,
      p_rule_version,
      'SKIPPED',
      p_priority,
      p_score,
      coalesce(p_categories, '{}'),
      coalesce(p_matched_terms, '[]'::jsonb)
    );

    return null;
  end if;

  insert into public.contract_events (
    project_id,
    occurred_at,
    title,
    description,
    source_type,
    status,
    created_by_type
  )
  values (
    v_email.project_id,
    v_email.sent_at,
    left(coalesce(nullif(v_email.subject, ''), '(sem assunto)'), 500),
    left(
      concat(
        'Evento candidato identificado por triagem deterministica de e-mail. ',
        coalesce(v_email.snippet, '')
      ),
      4000
    ),
    'EMAIL',
    'NOVO',
    'SYSTEM'
  )
  returning id into v_event_id;

  foreach v_category in array coalesce(p_categories, '{}')
  loop
    insert into public.event_categories (
      event_id,
      category
    )
    values (
      v_event_id,
      v_category
    )
    on conflict do nothing;
  end loop;

  insert into public.event_evidence (
    event_id,
    source_type,
    label,
    locator,
    email_id
  )
  values (
    v_event_id,
    'EMAIL',
    left(
      concat(
        'Gmail - ',
        coalesce(nullif(v_email.subject, ''), '(sem assunto)')
      ),
      500
    ),
    concat(
      'gmail://',
      coalesce(v_email.mailbox_address, 'unknown'),
      '/',
      coalesce(v_email.provider_message_id, v_email.id::text)
    ),
    v_email.id
  );

  insert into public.email_triage_results (
    project_id,
    email_id,
    event_id,
    rule_version,
    decision,
    priority,
    score,
    matched_categories,
    matched_terms
  )
  values (
    v_email.project_id,
    v_email.id,
    v_event_id,
    p_rule_version,
    'EVENT_CREATED',
    p_priority,
    p_score,
    coalesce(p_categories, '{}'),
    coalesce(p_matched_terms, '[]'::jsonb)
  );

  return v_event_id;
end;
$$;

revoke all
  on function public.register_email_triage_result(
    uuid, text, boolean, text, integer, text[], jsonb
  )
  from public, anon, authenticated;

grant execute
  on function public.register_email_triage_result(
    uuid, text, boolean, text, integer, text[], jsonb
  )
  to service_role;

comment on table public.email_triage_results is
  'Resultado rastreavel da triagem deterministica de emails. Nao representa avaliacao por IA.';

comment on function public.register_email_triage_result(
  uuid, text, boolean, text, integer, text[], jsonb
) is
  'Registra atomicamente triagem de email e, quando candidato, cria Event Ledger + categorias + evidencia.';
