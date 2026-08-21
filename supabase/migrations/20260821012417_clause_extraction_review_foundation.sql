-- ============================================================
-- AXION Contract Intelligence
-- Clause Extraction Review Foundation
--
-- Detector estrutural produz CANDIDATOS.
-- Nenhuma clausula detectada automaticamente se torna
-- referencia contratual definitiva sem revisao humana.
-- ============================================================


-- ============================================================
-- 1. CANDIDATOS A CLAUSULA
-- ============================================================

create table public.clause_extraction_candidates (
  id uuid primary key default gen_random_uuid(),

  document_version_id uuid not null
    references public.document_versions (id)
    on delete cascade,

  source_segment_id uuid
    references public.document_text_segments (id)
    on delete set null,

  detector text not null,

  detector_version text not null,

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

  confidence numeric(5,4) not null
    check (
      confidence >= 0
      and confidence <= 1
    ),

  proposed_clause_number text not null,

  proposed_title text not null,

  proposed_text text not null,

  page_number integer
    check (
      page_number is null
      or page_number > 0
    ),

  locator text,

  clause_id uuid
    references public.clauses (id)
    on delete set null,

  reviewed_by_user_id uuid
    references public.profiles (id)
    on delete set null,

  reviewed_at timestamptz,

  review_note text,

  created_at timestamptz not null
    default now(),

  updated_at timestamptz not null
    default now(),

  unique (
    document_version_id,
    detector,
    detector_version,
    candidate_key
  ),

  check (
    (
      status = 'PENDING_REVIEW'
      and clause_id is null
      and reviewed_at is null
    )
    or
    (
      status = 'APPROVED'
      and clause_id is not null
      and reviewed_at is not null
      and reviewed_by_user_id is not null
    )
    or
    (
      status = 'REJECTED'
      and clause_id is null
      and reviewed_at is not null
      and reviewed_by_user_id is not null
      and nullif(trim(review_note), '') is not null
    )
  )
);


create index
  clause_extraction_candidates_document_version_idx
on public.clause_extraction_candidates (
  document_version_id,
  status,
  created_at desc
);


create index
  clause_extraction_candidates_source_segment_idx
on public.clause_extraction_candidates (
  source_segment_id
)
where source_segment_id is not null;


-- ============================================================
-- 2. UPDATED_AT
-- ============================================================

create or replace function
public.set_clause_extraction_candidate_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


create trigger
  clause_extraction_candidates_set_updated_at
before update
on public.clause_extraction_candidates
for each row
execute function
  public.set_clause_extraction_candidate_updated_at();


-- ============================================================
-- 3. RLS
-- ============================================================

alter table public.clause_extraction_candidates
  enable row level security;


create policy
  "clause_extraction_candidates_select_project_members"
on public.clause_extraction_candidates
for select
to authenticated
using (
  exists (
    select 1
    from public.document_versions dv
    join public.documents d
      on d.id = dv.document_id
    where
      dv.id =
        clause_extraction_candidates.document_version_id
      and public.is_project_member(
        d.project_id
      )
  )
);


-- ============================================================
-- 4. REGISTRO SERVER-SIDE DE CANDIDATO
-- ============================================================

create or replace function
public.register_clause_extraction_candidate(
  p_document_version_id uuid,
  p_source_segment_id uuid,
  p_detector text,
  p_detector_version text,
  p_candidate_key text,
  p_confidence numeric,
  p_proposed_clause_number text,
  p_proposed_title text,
  p_proposed_text text,
  p_page_number integer default null,
  p_locator text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate_id uuid;
  v_segment_document_version_id uuid;
begin

  if nullif(trim(p_detector), '') is null
     or nullif(trim(p_detector_version), '') is null
     or nullif(trim(p_candidate_key), '') is null then
    raise exception 'Detector metadata is required';
  end if;

  if p_confidence < 0
     or p_confidence > 1 then
    raise exception 'Confidence must be between 0 and 1';
  end if;

  if nullif(trim(p_proposed_clause_number), '') is null
     or nullif(trim(p_proposed_title), '') is null
     or nullif(trim(p_proposed_text), '') is null then
    raise exception 'Clause number, title and text are required';
  end if;

  if not exists (
    select 1
    from public.document_versions dv
    where dv.id = p_document_version_id
  ) then
    raise exception 'Document version not found';
  end if;

  if p_source_segment_id is not null then

    select
      de.document_version_id
    into
      v_segment_document_version_id
    from public.document_text_segments dts
    join public.document_extractions de
      on de.id = dts.extraction_id
    where
      dts.id = p_source_segment_id;

    if not found then
      raise exception 'Source segment not found';
    end if;

    if v_segment_document_version_id
       <> p_document_version_id then
      raise exception
        'Source segment belongs to another document version';
    end if;

  end if;


  insert into public.clause_extraction_candidates (
    document_version_id,
    source_segment_id,
    detector,
    detector_version,
    candidate_key,
    status,
    confidence,
    proposed_clause_number,
    proposed_title,
    proposed_text,
    page_number,
    locator
  )
  values (
    p_document_version_id,
    p_source_segment_id,
    trim(p_detector),
    trim(p_detector_version),
    trim(p_candidate_key),
    'PENDING_REVIEW',
    p_confidence,
    trim(p_proposed_clause_number),
    trim(p_proposed_title),
    trim(p_proposed_text),
    p_page_number,
    nullif(trim(p_locator), '')
  )

  on conflict (
    document_version_id,
    detector,
    detector_version,
    candidate_key
  )
  do update set
    source_segment_id =
      excluded.source_segment_id,
    confidence =
      excluded.confidence,
    proposed_clause_number =
      excluded.proposed_clause_number,
    proposed_title =
      excluded.proposed_title,
    proposed_text =
      excluded.proposed_text,
    page_number =
      excluded.page_number,
    locator =
      excluded.locator

  where
    clause_extraction_candidates.status =
      'PENDING_REVIEW'

  returning id
  into v_candidate_id;


  if v_candidate_id is null then

    select id
    into v_candidate_id
    from public.clause_extraction_candidates
    where
      document_version_id =
        p_document_version_id
      and detector =
        trim(p_detector)
      and detector_version =
        trim(p_detector_version)
      and candidate_key =
        trim(p_candidate_key);

  end if;


  return v_candidate_id;

end;
$$;


revoke all
on function
public.register_clause_extraction_candidate(
  uuid,
  uuid,
  text,
  text,
  text,
  numeric,
  text,
  text,
  text,
  integer,
  text
)
from public;

revoke all
on function
public.register_clause_extraction_candidate(
  uuid,
  uuid,
  text,
  text,
  text,
  numeric,
  text,
  text,
  text,
  integer,
  text
)
from anon;

revoke all
on function
public.register_clause_extraction_candidate(
  uuid,
  uuid,
  text,
  text,
  text,
  numeric,
  text,
  text,
  text,
  integer,
  text
)
from authenticated;

grant execute
on function
public.register_clause_extraction_candidate(
  uuid,
  uuid,
  text,
  text,
  text,
  numeric,
  text,
  text,
  text,
  integer,
  text
)
to service_role;


-- ============================================================
-- 5. REVISAO HUMANA
--
-- EDITOR / ADMIN
--
-- APPROVE:
--   cria public.clauses atomicamente.
--
-- REJECT:
--   exige justificativa.
-- ============================================================

create or replace function
public.review_clause_extraction_candidate(
  p_candidate_id uuid,
  p_action text,
  p_review_note text default null,
  p_clause_number text default null,
  p_clause_title text default null,
  p_clause_text text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;

  v_candidate
    public.clause_extraction_candidates%rowtype;

  v_project_id uuid;

  v_clause_id uuid;

  v_clause_number text;
  v_clause_title text;
  v_clause_text text;
begin

  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;


  select *
  into v_candidate
  from public.clause_extraction_candidates
  where id = p_candidate_id
  for update;


  if not found then
    raise exception 'Clause candidate not found';
  end if;


  select d.project_id
  into v_project_id
  from public.document_versions dv
  join public.documents d
    on d.id = dv.document_id
  where
    dv.id =
      v_candidate.document_version_id;


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


    update public.clause_extraction_candidates
    set
      status = 'REJECTED',
      reviewed_by_user_id = v_user_id,
      reviewed_at = now(),
      review_note = trim(p_review_note)
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
      'CLAUSE_EXTRACTION_CANDIDATE_REJECTED',
      'CLAUSE_EXTRACTION_CANDIDATE',
      p_candidate_id::text,
      format(
        'Candidato a clausula rejeitado. Motivo: %s',
        trim(p_review_note)
      )
    );


    return null;

  elsif upper(trim(p_action)) = 'APPROVE' then

    v_clause_number :=
      coalesce(
        nullif(trim(p_clause_number), ''),
        v_candidate.proposed_clause_number
      );

    v_clause_title :=
      coalesce(
        nullif(trim(p_clause_title), ''),
        v_candidate.proposed_title
      );

    v_clause_text :=
      coalesce(
        nullif(trim(p_clause_text), ''),
        v_candidate.proposed_text
      );


    if nullif(trim(v_clause_number), '') is null
       or nullif(trim(v_clause_title), '') is null
       or nullif(trim(v_clause_text), '') is null then
      raise exception
        'Clause number, title and text are required';
    end if;


    insert into public.clauses (
      document_version_id,
      clause_number,
      title,
      text
    )
    values (
      v_candidate.document_version_id,
      v_clause_number,
      v_clause_title,
      v_clause_text
    )
    returning id
    into v_clause_id;


    update public.clause_extraction_candidates
    set
      status = 'APPROVED',
      clause_id = v_clause_id,
      reviewed_by_user_id = v_user_id,
      reviewed_at = now(),
      review_note =
        nullif(trim(p_review_note), '')
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
      'CLAUSE_CREATED_FROM_EXTRACTION_CANDIDATE',
      'CLAUSE',
      v_clause_id::text,
      format(
        'Clausula %s criada apos revisao humana do candidato %s.',
        v_clause_number,
        p_candidate_id
      )
    );


    return v_clause_id;

  else

    raise exception
      'Action must be APPROVE or REJECT';

  end if;

end;
$$;


revoke all
on function
public.review_clause_extraction_candidate(
  uuid,
  text,
  text,
  text,
  text,
  text
)
from public;

revoke all
on function
public.review_clause_extraction_candidate(
  uuid,
  text,
  text,
  text,
  text,
  text
)
from anon;

grant execute
on function
public.review_clause_extraction_candidate(
  uuid,
  text,
  text,
  text,
  text,
  text
)
to authenticated;
