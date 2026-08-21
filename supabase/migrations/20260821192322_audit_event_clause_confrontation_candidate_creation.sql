-- ============================================================
-- AUDITORIA DA CRIACAO DE CANDIDATOS DE CONFRONTO
-- ============================================================

create or replace function
public.audit_event_clause_confrontation_candidate_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
begin
  select ce.project_id
  into v_project_id
  from public.contract_events ce
  where ce.id = new.event_id;

  if v_project_id is null then
    raise exception
      'Project not found for confrontation candidate';
  end if;

  insert into public.audit_log_entries (
    project_id,
    actor_type,
    actor_user_id,
    actor_label,
    action,
    entity_type,
    entity_id,
    detail,
    occurred_at
  )
  values (
    v_project_id,
    'SYSTEM',
    null,
    null,
    'EVENT_CLAUSE_CONFRONTATION_CANDIDATE_CREATED',
    'EVENT_CLAUSE_CONFRONTATION_CANDIDATE',
    new.id::text,
    format(
      'Analyzer %s v%s created confrontation candidate for event %s and clause %s. Finding: %s; severity: %s; confidence: %s; status: %s.',
      new.analyzer,
      new.analyzer_version,
      new.event_id,
      new.clause_id,
      new.finding_type,
      new.severity,
      new.confidence,
      new.status
    ),
    new.created_at
  );

  return new;
end;
$$;


drop trigger if exists
event_clause_confrontation_candidate_audit_created
on public.event_clause_confrontation_candidates;


create trigger
event_clause_confrontation_candidate_audit_created
after insert
on public.event_clause_confrontation_candidates
for each row
execute function
public.audit_event_clause_confrontation_candidate_created();


-- ============================================================
-- BACKFILL DOS CANDIDATOS JA EXISTENTES
-- ============================================================

insert into public.audit_log_entries (
  project_id,
  actor_type,
  actor_user_id,
  actor_label,
  action,
  entity_type,
  entity_id,
  detail,
  occurred_at
)
select
  ce.project_id,
  'SYSTEM',
  null,
  null,
  'EVENT_CLAUSE_CONFRONTATION_CANDIDATE_CREATED',
  'EVENT_CLAUSE_CONFRONTATION_CANDIDATE',
  c.id::text,
  format(
    'Analyzer %s v%s created confrontation candidate for event %s and clause %s. Finding: %s; severity: %s; confidence: %s; status: %s. Audit record backfilled.',
    c.analyzer,
    c.analyzer_version,
    c.event_id,
    c.clause_id,
    c.finding_type,
    c.severity,
    c.confidence,
    c.status
  ),
  c.created_at
from
  public.event_clause_confrontation_candidates c
join
  public.contract_events ce
  on ce.id = c.event_id
where not exists (
  select 1
  from public.audit_log_entries a
  where
    a.action =
      'EVENT_CLAUSE_CONFRONTATION_CANDIDATE_CREATED'
    and a.entity_type =
      'EVENT_CLAUSE_CONFRONTATION_CANDIDATE'
    and a.entity_id =
      c.id::text
);
