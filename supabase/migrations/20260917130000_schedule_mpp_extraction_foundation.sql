-- ============================================================
-- 20260917130000_schedule_mpp_extraction_foundation.sql
-- Structured Microsoft Project (.mpp) extraction foundation.
-- ============================================================

alter table public.schedule_versions
  add column extraction_status text not null default 'PENDING',
  add column extraction_error text,
  add column extracted_at timestamptz,
  add column status_date timestamptz;

alter table public.schedule_versions
  add constraint schedule_versions_extraction_status_check
  check (extraction_status in ('PENDING', 'EXTRACTED', 'FAILED'));

alter table public.schedule_versions
  add constraint schedule_versions_extraction_error_status_check
  check (
    (extraction_status = 'FAILED' and extraction_error is not null)
    or
    (extraction_status <> 'FAILED' and extraction_error is null)
  );

alter table public.schedule_versions
  add constraint schedule_versions_extracted_at_status_check
  check (
    (extraction_status = 'EXTRACTED' and extracted_at is not null)
    or
    (extraction_status <> 'EXTRACTED' and extracted_at is null)
  );

alter table public.schedule_activities
  add column external_task_id text,
  add column unique_id text,
  add column wbs text,
  add column outline_level integer,
  add column parent_task_id uuid,
  add column duration_value numeric,
  add column duration_unit text,
  add column is_milestone boolean,
  add column is_summary_task boolean,
  add column total_float_value numeric,
  add column total_float_unit text,
  add column is_critical boolean,
  add column percent_complete numeric,
  add column calendar_name text;

alter table public.schedule_activities
  add constraint schedule_activities_outline_level_check
  check (outline_level is null or outline_level >= 0);

alter table public.schedule_activities
  add constraint schedule_activities_percent_complete_check
  check (
    percent_complete is null
    or (percent_complete >= 0 and percent_complete <= 100)
  );

alter table public.schedule_activities
  add constraint schedule_activities_duration_pair_check
  check (
    (duration_value is null and duration_unit is null)
    or
    (duration_value is not null and duration_unit is not null)
  );

alter table public.schedule_activities
  add constraint schedule_activities_total_float_pair_check
  check (
    (total_float_value is null and total_float_unit is null)
    or
    (total_float_value is not null and total_float_unit is not null)
  );

alter table public.schedule_activities
  add constraint schedule_activities_schedule_version_unique_id_key
  unique (schedule_version_id, unique_id);

alter table public.schedule_activities
  add constraint schedule_activities_schedule_version_id_id_key
  unique (schedule_version_id, id);

alter table public.schedule_activities
  add constraint schedule_activities_parent_task_same_version_fk
  foreign key (schedule_version_id, parent_task_id)
  references public.schedule_activities (schedule_version_id, id)
  on delete restrict;

create index schedule_activities_parent_task_id_idx
  on public.schedule_activities (parent_task_id);

create table public.schedule_task_relations (
  id uuid primary key default gen_random_uuid(),

  schedule_version_id uuid not null
    references public.schedule_versions (id)
    on delete cascade,

  predecessor_task_id uuid not null,
  successor_task_id uuid not null,

  relation_type text not null
    check (relation_type in ('FS', 'SS', 'FF', 'SF')),

  lag_value numeric not null default 0,
  lag_unit text not null,

  created_at timestamptz not null default now(),

  constraint schedule_task_relations_distinct_tasks_check
    check (predecessor_task_id <> successor_task_id),

  constraint schedule_task_relations_predecessor_same_version_fk
    foreign key (schedule_version_id, predecessor_task_id)
    references public.schedule_activities (schedule_version_id, id)
    on delete cascade,

  constraint schedule_task_relations_successor_same_version_fk
    foreign key (schedule_version_id, successor_task_id)
    references public.schedule_activities (schedule_version_id, id)
    on delete cascade,

  constraint schedule_task_relations_unique_edge
    unique (
      schedule_version_id,
      predecessor_task_id,
      successor_task_id,
      relation_type
    )
);

create index schedule_task_relations_schedule_version_id_idx
  on public.schedule_task_relations (schedule_version_id);

create index schedule_task_relations_predecessor_task_id_idx
  on public.schedule_task_relations (predecessor_task_id);

create index schedule_task_relations_successor_task_id_idx
  on public.schedule_task_relations (successor_task_id);

alter table public.schedule_task_relations
  enable row level security;

create policy "schedule_task_relations_select_project_members_only"
  on public.schedule_task_relations
  for select
  using (
    exists (
      select 1
      from public.schedule_versions sv
      join public.document_versions dv
        on dv.id = sv.document_version_id
      join public.documents d
        on d.id = dv.document_id
      where sv.id = schedule_task_relations.schedule_version_id
        and public.is_project_member(d.project_id)
    )
  );
