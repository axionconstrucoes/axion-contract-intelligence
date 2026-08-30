-- ============================================================
-- AXION Contract Intelligence
-- Emenda de review_note em candidatos JA revisados
--
-- Motivacao: candidatos aprovados ANTES da exigencia de justificativa
-- especifica (ex.: "Confronto humano aprovado", sem nome de revisor,
-- gravado pela migration 20260821021746) precisam poder ser
-- complementados sem reabrir a revisao — nunca trocando status,
-- aprovador original (reviewed_by_user_id) ou data original
-- (reviewed_at). A RPC existente review_event_clause_confrontation_candidate
-- recusa explicitamente qualquer candidato com status <> 'PENDING_REVIEW'
-- ("Candidate has already been reviewed") — por isso uma RPC nova,
-- separada, estritamente limitada a emendar review_note.
--
-- NAO APLICADA nesta etapa (sem supabase db push, sem banco local/
-- remoto tocado) — arquivo criado só para revisão humana.
-- ============================================================


-- ============================================================
-- 1. COLUNAS DE AUTORIA DA EMENDA
-- Nunca reaproveita reviewed_by_user_id/reviewed_at (autoria original) —
-- colunas novas e separadas, para nunca confundir quem aprovou/rejeitou
-- com quem só corrigiu o texto da justificativa depois.
-- ============================================================

alter table public.event_clause_confrontation_candidates
  add column review_note_amended_by_user_id uuid
    references public.profiles (id)
    on delete restrict,
  add column review_note_amended_at timestamptz;

alter table public.event_clause_confrontation_candidates
  add constraint event_clause_confrontation_candidates_amendment_consistency_check
  check (
    (
      review_note_amended_by_user_id is null
      and review_note_amended_at is null
    )
    or
    (
      review_note_amended_by_user_id is not null
      and review_note_amended_at is not null
      -- Só um candidato já revisado (APPROVED/REJECTED) pode ter sido
      -- emendado — nunca um PENDING_REVIEW, mesma regra que a RPC abaixo
      -- aplica em runtime, reforçada aqui como invariante estrutural.
      and status in ('APPROVED', 'REJECTED')
    )
  );


-- ============================================================
-- 2. RPC: amend_event_clause_confrontation_review_note
--
-- Altera EXCLUSIVAMENTE review_note (+ as duas colunas de autoria da
-- emenda acima). Nunca toca: status, reviewed_by_user_id, reviewed_at,
-- cross_reference_id, event_id, clause_id, finding_type, severity,
-- confidence, summary, event_basis, clause_basis, analyzer,
-- analyzer_version, candidate_key.
--
-- Permissão: has_project_permission(project_id, 'ADMINISTRADOR') — a
-- mesma função central já usada por review_event_clause_confrontation_candidate,
-- que já exige projeto/pm.status = 'ACTIVE' internamente (ver
-- 20260824232516_enforce_admin_only_write.sql) — nenhuma checagem de
-- "membro ACTIVE" duplicada aqui à parte. Escopo por projeto vem de
-- graça: has_project_permission só pode ser satisfeita para o projeto
-- REAL do evento do candidato — nunca para um projeto diferente do
-- usuário que chama.
--
-- Validação da nova justificativa: checagem mínima aqui (não-vazia,
-- >= 20 caracteres) como rede de segurança determinística — a
-- validação completa (frases genéricas tipo "aprovado"/"confronto
-- humano aprovado"/"não se aplica") vive em UM lugar só,
-- apps/web/lib/ledger/confrontation-justification-validation.ts,
-- chamada pelo Server Action ANTES desta RPC (nunca duplicada/
-- divergente aqui em SQL).
-- ============================================================

create or replace function
public.amend_event_clause_confrontation_review_note(
  p_candidate_id uuid,
  p_new_review_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;

  v_candidate
    public.event_clause_confrontation_candidates%rowtype;

  v_project_id uuid;
  v_clause_number text;
  v_previous_note text;
  v_new_note text;
begin

  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception
      'Authentication required';
  end if;


  select *
  into v_candidate
  from public.event_clause_confrontation_candidates
  where id = p_candidate_id
  for update;

  if not found then
    raise exception
      'Confrontation candidate not found';
  end if;


  if v_candidate.status = 'PENDING_REVIEW' then
    raise exception
      'Candidate must already be APPROVED or REJECTED to amend the review note';
  end if;


  select ce.project_id
  into v_project_id
  from public.contract_events ce
  where ce.id = v_candidate.event_id;

  if v_project_id is null then
    raise exception
      'Contract event not found';
  end if;


  -- Escrita continua exclusiva de ADMINISTRADOR (mesma regra corporativa
  -- de 20260824232516_enforce_admin_only_write.sql — GESTOR/COLABORADOR/
  -- LEITURA permanecem somente leitura). has_project_permission já exige
  -- pm.status = 'ACTIVE' e escopa ao projeto real do evento.
  if not public.has_project_permission(
    v_project_id,
    'ADMINISTRADOR'
  ) then
    raise exception
      'ADMINISTRADOR permission required';
  end if;


  v_new_note := nullif(trim(p_new_review_note), '');

  if v_new_note is null
     or length(v_new_note) < 20 then
    raise exception
      'Review note must be specific (non-empty, at least 20 characters)';
  end if;


  select c.clause_number
  into v_clause_number
  from public.clauses c
  where c.id = v_candidate.clause_id;

  v_previous_note := v_candidate.review_note;


  update
  public.event_clause_confrontation_candidates
  set
    review_note = v_new_note,
    review_note_amended_by_user_id = v_user_id,
    review_note_amended_at = now()
  where id = p_candidate_id;


  insert into public.audit_log_entries (
    project_id,
    actor_type,
    actor_user_id,
    actor_label,
    action,
    entity_type,
    entity_id,
    detail
  )
  values (
    v_project_id,
    'USER',
    v_user_id,
    null,
    'CONFRONTATION_REVIEW_NOTE_AMENDED',
    'EVENT_CLAUSE_CONFRONTATION_CANDIDATE',
    p_candidate_id::text,
    format(
      'Review note amended for clause %s. Previous: %s | New: %s',
      coalesce(v_clause_number, '?'),
      coalesce(v_previous_note, '(vazio)'),
      v_new_note
    )
  );


  return;

end;
$$;


revoke all
on function
public.amend_event_clause_confrontation_review_note(
  uuid,
  text
)
from public;

revoke all
on function
public.amend_event_clause_confrontation_review_note(
  uuid,
  text
)
from anon;

grant execute
on function
public.amend_event_clause_confrontation_review_note(
  uuid,
  text
)
to authenticated;
