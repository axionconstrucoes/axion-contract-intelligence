-- ============================================================
-- AXION Contract Intelligence
-- Event x Clause Confrontation Foundation
--
-- Sistema automatico gera CANDIDATOS.
-- Somente revisao humana cria event_cross_reference definitivo.
-- ============================================================


-- ============================================================
-- 1. EVITAR DUPLICIDADE EVENTO x CLAUSULA DEFINITIVA
-- ============================================================

create unique index if not exists
event_cross_references_event_clause_unique_idx
on public.event_cross_references (
  event_id,
  clause_id
)
where clause_id is not null;


-- ============================================================
-- 2. CANDIDATOS AO CONFRONTO
-- ============================================================

create table public.event_clause_confrontation_candidates (
  id uuid primary key default gen_random_uuid(),

  event_id uuid not null
    references public.contract_events (id)
    on delete cascade,

  clause_id uuid not null
    references public.clauses (id)
    on delete cascade,

  analyzer text not null,
  analyzer_version text not null,
  candidate_key text not null,

  status text not null
    default 'PENDING_REVIEW'
    check (
      status in (
        'PENDING_REVIEW',
        'APPROVED',
        'REJECTED'
      )
    ),

  finding_type text not null
    check (
      finding_type in (
        'DESVIO',
        'CONFLITO',
        'INFORMACAO_NOVA',
        'IMPACTO_POTENCIAL'
      )
    ),

  severity text not null
    check (
      severity in (
        'LOW',
        'MEDIUM',
        'HIGH',
        'CRITICAL'
      )
    ),

  confidence numeric(5,4) not null
    check (
      confidence >= 0
      and confidence <= 1
    ),

  summary text not null,
  event_basis text not null,
  clause_basis text not null,

  requires_human_review boolean not null
    default true
    check (
      requires_human_review = true
    ),

  cross_reference_id uuid
    references public.event_cross_references (id)
    on delete restrict,

  reviewed_by_user_id uuid
    references public.profiles (id)
    on delete restrict,

  reviewed_at timestamptz,
  review_note text,

  created_at timestamptz not null
    default now(),

  updated_at timestamptz not null
    default now(),

  unique (
    event_id,
    clause_id,
    analyzer,
    analyzer_version,
    candidate_key
  ),

  check (
    nullif(trim(analyzer), '') is not null
    and
    nullif(trim(analyzer_version), '') is not null
    and
    nullif(trim(candidate_key), '') is not null
    and
    nullif(trim(summary), '') is not null
    and
    nullif(trim(event_basis), '') is not null
    and
    nullif(trim(clause_basis), '') is not null
  ),

  check (
    (
      status = 'PENDING_REVIEW'
      and cross_reference_id is null
      and reviewed_by_user_id is null
      and reviewed_at is null
    )
    or
    (
      status = 'APPROVED'
      and cross_reference_id is not null
      and reviewed_by_user_id is not null
      and reviewed_at is not null
    )
    or
    (
      status = 'REJECTED'
      and cross_reference_id is null
      and reviewed_by_user_id is not null
      and reviewed_at is not null
      and nullif(trim(review_note), '') is not null
    )
  )
);


create index
event_clause_confrontation_candidates_event_idx
on public.event_clause_confrontation_candidates (
  event_id,
  status,
  created_at desc
);


create index
event_clause_confrontation_candidates_clause_idx
on public.event_clause_confrontation_candidates (
  clause_id
);


-- ============================================================
-- 3. UPDATED_AT
-- ============================================================

create or replace function
public.set_event_clause_confrontation_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


create trigger
event_clause_confrontation_candidates_set_updated_at
before update
on public.event_clause_confrontation_candidates
for each row
execute function
public.set_event_clause_confrontation_updated_at();


-- ============================================================
-- 4. GARANTIA ESTRUTURAL:
-- EVENTO E CLAUSULA DEVEM PERTENCER AO MESMO PROJETO
-- ============================================================

create or replace function
public.validate_event_clause_same_project()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_project_id uuid;
  v_clause_project_id uuid;
begin

  select ce.project_id
  into v_event_project_id
  from public.contract_events ce
  where ce.id = new.event_id;

  if v_event_project_id is null then
    raise exception 'Contract event not found';
  end if;


  select d.project_id
  into v_clause_project_id
  from public.clauses c
  join public.document_versions dv
    on dv.id = c.document_version_id
  join public.documents d
    on d.id = dv.document_id
  where c.id = new.clause_id;

  if v_clause_project_id is null then
    raise exception 'Clause not found';
  end if;


  if v_event_project_id <> v_clause_project_id then
    raise exception
      'Event and clause belong to different projects';
  end if;


  return new;

end;
$$;


create trigger
event_clause_confrontation_validate_project
before insert or update of event_id, clause_id
on public.event_clause_confrontation_candidates
for each row
execute function
public.validate_event_clause_same_project();


-- ============================================================
-- 5. RLS
-- ============================================================

alter table
public.event_clause_confrontation_candidates
enable row level security;


create policy
"event_clause_confrontation_candidates_select_members"
on public.event_clause_confrontation_candidates
for select
to authenticated
using (
  exists (
    select 1
    from public.contract_events ce
    where
      ce.id =
        event_clause_confrontation_candidates.event_id
      and public.is_project_member(
        ce.project_id
      )
  )
);


-- Nenhuma policy INSERT/UPDATE/DELETE para usuario comum.


-- ============================================================
-- 6. REGISTRAR CANDIDATO
-- SOMENTE SERVICE ROLE
-- ============================================================

create or replace function
public.register_event_clause_confrontation_candidate(
  p_event_id uuid,
  p_clause_id uuid,
  p_analyzer text,
  p_analyzer_version text,
  p_candidate_key text,
  p_finding_type text,
  p_severity text,
  p_confidence numeric,
  p_summary text,
  p_event_basis text,
  p_clause_basis text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate_id uuid;
begin

  if nullif(trim(p_analyzer), '') is null
     or nullif(trim(p_analyzer_version), '') is null
     or nullif(trim(p_candidate_key), '') is null then
    raise exception 'Analyzer metadata is required';
  end if;


  if p_finding_type not in (
    'DESVIO',
    'CONFLITO',
    'INFORMACAO_NOVA',
    'IMPACTO_POTENCIAL'
  ) then
    raise exception 'Invalid finding type';
  end if;


  if p_severity not in (
    'LOW',
    'MEDIUM',
    'HIGH',
    'CRITICAL'
  ) then
    raise exception 'Invalid severity';
  end if;


  if p_confidence < 0
     or p_confidence > 1 then
    raise exception
      'Confidence must be between 0 and 1';
  end if;


  if nullif(trim(p_summary), '') is null
     or nullif(trim(p_event_basis), '') is null
     or nullif(trim(p_clause_basis), '') is null then
    raise exception
      'Summary and evidence basis are required';
  end if;


  insert into
  public.event_clause_confrontation_candidates (
    event_id,
    clause_id,
    analyzer,
    analyzer_version,
    candidate_key,
    finding_type,
    severity,
    confidence,
    summary,
    event_basis,
    clause_basis
  )
  values (
    p_event_id,
    p_clause_id,
    trim(p_analyzer),
    trim(p_analyzer_version),
    trim(p_candidate_key),
    p_finding_type,
    p_severity,
    p_confidence,
    trim(p_summary),
    trim(p_event_basis),
    trim(p_clause_basis)
  )

  on conflict (
    event_id,
    clause_id,
    analyzer,
    analyzer_version,
    candidate_key
  )
  do update set
    finding_type =
      excluded.finding_type,
    severity =
      excluded.severity,
    confidence =
      excluded.confidence,
    summary =
      excluded.summary,
    event_basis =
      excluded.event_basis,
    clause_basis =
      excluded.clause_basis

  where
    event_clause_confrontation_candidates.status =
      'PENDING_REVIEW'

  returning id
  into v_candidate_id;


  if v_candidate_id is null then

    select id
    into v_candidate_id
    from public.event_clause_confrontation_candidates
    where
      event_id = p_event_id
      and clause_id = p_clause_id
      and analyzer = trim(p_analyzer)
      and analyzer_version =
        trim(p_analyzer_version)
      and candidate_key =
        trim(p_candidate_key);

  end if;


  return v_candidate_id;

end;
$$;


revoke all
on function
public.register_event_clause_confrontation_candidate(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  numeric,
  text,
  text,
  text
)
from public;

revoke all
on function
public.register_event_clause_confrontation_candidate(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  numeric,
  text,
  text,
  text
)
from anon;

revoke all
on function
public.register_event_clause_confrontation_candidate(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  numeric,
  text,
  text,
  text
)
from authenticated;

grant execute
on function
public.register_event_clause_confrontation_candidate(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  numeric,
  text,
  text,
  text
)
to service_role;


-- ============================================================
-- 7. REVISAO HUMANA
-- APPROVE cria event_cross_reference
-- REJECT exige justificativa
-- ============================================================

create or replace function
public.review_event_clause_confrontation_candidate(
  p_candidate_id uuid,
  p_action text,
  p_review_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;

  v_candidate
    public.event_clause_confrontation_candidates%rowtype;

  v_project_id uuid;
  v_document_kind text;
  v_clause_number text;
  v_reference_kind text;
  v_cross_reference_id uuid;
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


  select ce.project_id
  into v_project_id
  from public.contract_events ce
  where ce.id = v_candidate.event_id;


  if not public.has_project_permission(
    v_project_id,
    'EDITOR'
  ) then
    raise exception
      'EDITOR or ADMIN permission required';
  end if;


  if v_candidate.status
     <> 'PENDING_REVIEW' then
    raise exception
      'Candidate has already been reviewed';
  end if;


  if upper(trim(p_action)) = 'REJECT' then

    if nullif(trim(p_review_note), '') is null then
      raise exception
        'Review note is required for rejection';
    end if;


    update
    public.event_clause_confrontation_candidates
    set
      status = 'REJECTED',
      reviewed_by_user_id =
        v_user_id,
      reviewed_at = now(),
      review_note =
        trim(p_review_note)
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
      'EVENT_CLAUSE_CONFRONTATION_REJECTED',
      'EVENT_CLAUSE_CONFRONTATION_CANDIDATE',
      p_candidate_id::text,
      format(
        'Confrontation candidate rejected. Reason: %s',
        trim(p_review_note)
      )
    );


    return null;


  elsif upper(trim(p_action)) = 'APPROVE' then

    select
      d.kind,
      c.clause_number
    into
      v_document_kind,
      v_clause_number
    from public.clauses c
    join public.document_versions dv
      on dv.id =
        c.document_version_id
    join public.documents d
      on d.id =
        dv.document_id
    where
      c.id =
        v_candidate.clause_id;


    v_reference_kind :=
      case

        when v_document_kind in (
          'CONTRATO_BASE',
          'ADITIVO'
        )
        then 'CONTRATO_ADITIVO'

        when v_document_kind in (
          'EDITAL',
          'RFI',
          'RFP'
        )
        then 'EDITAL_RFI_RFP'

        when v_document_kind =
          'PROPOSTA_AXION'
        then 'PROPOSTA_AXION'

        when v_document_kind in (
          'CRONOGRAMA_BASELINE',
          'CRONOGRAMA_REVISAO'
        )
        then 'CRONOGRAMA'

        when v_document_kind in (
          'ESPECIFICACAO',
          'DESENHO',
          'PLANILHA'
        )
        then 'PROJETO_TECNICO'

        else 'COMUNICACAO'

      end;


    insert into public.event_cross_references (
      event_id,
      kind,
      clause_id,
      note
    )
    values (
      v_candidate.event_id,
      v_reference_kind,
      v_candidate.clause_id,
      format(
        'Confronto humano aprovado. Clausula %s. %s',
        v_clause_number,
        v_candidate.summary
      )
    )

    on conflict (
      event_id,
      clause_id
    )
    where clause_id is not null
    do nothing

    returning id
    into v_cross_reference_id;


    if v_cross_reference_id is null then

      select id
      into v_cross_reference_id
      from public.event_cross_references
      where
        event_id =
          v_candidate.event_id
        and clause_id =
          v_candidate.clause_id;

    end if;


    update
    public.event_clause_confrontation_candidates
    set
      status = 'APPROVED',
      cross_reference_id =
        v_cross_reference_id,
      reviewed_by_user_id =
        v_user_id,
      reviewed_at = now(),
      review_note =
        nullif(
          trim(p_review_note),
          ''
        )
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
      'EVENT_CLAUSE_CONFRONTATION_APPROVED',
      'EVENT_CROSS_REFERENCE',
      v_cross_reference_id::text,
      format(
        'Confrontation candidate %s approved for clause %s.',
        p_candidate_id,
        v_clause_number
      )
    );


    return v_cross_reference_id;


  else

    raise exception
      'Action must be APPROVE or REJECT';

  end if;

end;
$$;


revoke all
on function
public.review_event_clause_confrontation_candidate(
  uuid,
  text,
  text
)
from public;

revoke all
on function
public.review_event_clause_confrontation_candidate(
  uuid,
  text,
  text
)
from anon;

grant execute
on function
public.review_event_clause_confrontation_candidate(
  uuid,
  text,
  text
)
to authenticated;
