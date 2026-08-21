-- ============================================================
-- Email Contract Triage Review Queue
--
-- A triagem deterministica NAO cria contract_events.
-- Ela apenas classifica:
--   SKIPPED
--   REVIEW_REQUIRED
--
-- Contract Event somente sera criado apos analise posterior.
-- ============================================================

drop function if exists public.register_email_triage_result(
  uuid, text, boolean, text, integer, text[], jsonb
);

alter table public.email_triage_results
  drop constraint if exists email_triage_results_decision_check;

alter table public.email_triage_results
  add constraint email_triage_results_decision_check
  check (
    decision in (
      'SKIPPED',
      'REVIEW_REQUIRED',
      'EVENT_CREATED'
    )
  );

alter table public.email_triage_results
  drop constraint if exists email_triage_results_email_id_key;

create unique index if not exists
  email_triage_results_email_rule_version_uidx
on public.email_triage_results (
  email_id,
  rule_version
);

create or replace function public.register_email_triage_screening(
  p_email_id uuid,
  p_rule_version text,
  p_requires_review boolean,
  p_priority text,
  p_score integer,
  p_categories text[],
  p_matched_terms jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email public.emails%rowtype;
  v_existing_decision text;
  v_decision text;
begin
  select decision
    into v_existing_decision
  from public.email_triage_results
  where email_id = p_email_id
    and rule_version = p_rule_version;

  if found then
    return v_existing_decision;
  end if;

  select *
    into v_email
  from public.emails
  where id = p_email_id;

  if not found then
    raise exception 'Email not found';
  end if;

  if p_priority not in (
    'BAIXA',
    'MEDIA',
    'ALTA',
    'CRITICA'
  ) then
    raise exception 'Invalid priority';
  end if;

  if p_requires_review then
    v_decision := 'REVIEW_REQUIRED';
  else
    v_decision := 'SKIPPED';
  end if;

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
    v_decision,
    p_priority,
    p_score,
    coalesce(p_categories, '{}'),
    coalesce(p_matched_terms, '[]'::jsonb)
  );

  return v_decision;
end;
$$;

revoke all
  on function public.register_email_triage_screening(
    uuid, text, boolean, text, integer, text[], jsonb
  )
  from public, anon, authenticated;

grant execute
  on function public.register_email_triage_screening(
    uuid, text, boolean, text, integer, text[], jsonb
  )
  to service_role;

comment on function public.register_email_triage_screening(
  uuid, text, boolean, text, integer, text[], jsonb
) is
  'Triagem deterministica fail-closed. Nunca cria Contract Event.';
