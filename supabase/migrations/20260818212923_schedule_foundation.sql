-- ============================================================
-- 20260818212923_schedule_foundation.sql
-- Fundacao de Cronograma: schedule_versions e schedule_activities.
-- Cada schedule_version e um snapshot historico completo, ligado a
-- uma document_version real (nunca sobrescrita por revisao futura).
-- Sem tabela "schedules" pai (decisao 2.5G3A.1/2.5G3A.3). Sem
-- project_id redundante: derivado por
-- schedule_activities -> schedule_versions -> document_versions ->
-- documents -> project_id. Sem ContractChange, Evidence, MS Project
-- import, actual_start/actual_end ou qualquer outro campo futuro
-- (ver matriz de decisoes 2.5G3A/2.5G3A.1/2.5G3A.3).
-- ============================================================

create table public.schedule_versions (
  id uuid primary key default gen_random_uuid(),
  document_version_id uuid not null
    references public.document_versions (id) on delete cascade,
  version_type text not null
    check (version_type in ('BASELINE', 'UPDATE', 'RECOVERY', 'REVISED_BASELINE')),
  lifecycle_status text not null default 'DRAFT'
    check (lifecycle_status in ('DRAFT', 'ISSUED', 'SUPERSEDED', 'ARCHIVED')),
  client_formalization_status text not null default 'NOT_SUBMITTED'
    check (client_formalization_status in (
      'NOT_SUBMITTED', 'PENDING', 'FORMALIZED', 'REJECTED', 'UNCLEAR'
    )),
  created_at timestamptz not null default now()
);

create index schedule_versions_document_version_id_idx
  on public.schedule_versions (document_version_id);

create table public.schedule_activities (
  id uuid primary key default gen_random_uuid(),
  schedule_version_id uuid not null
    references public.schedule_versions (id) on delete cascade,
  name text not null,
  baseline_start date not null,
  baseline_end date not null,
  planned_start date not null,
  planned_end date not null,
  status text not null
    check (status in ('NO_PRAZO', 'ATRASADA', 'CONCLUIDA')),
  created_at timestamptz not null default now()
);

create index schedule_activities_schedule_version_id_idx
  on public.schedule_activities (schedule_version_id);

-- ---------- RLS ----------

alter table public.schedule_versions enable row level security;
alter table public.schedule_activities enable row level security;

create policy "schedule_versions_select_project_members_only"
  on public.schedule_versions
  for select
  using (
    exists (
      select 1
      from public.document_versions dv
      join public.documents d on d.id = dv.document_id
      where dv.id = schedule_versions.document_version_id
        and public.is_project_member(d.project_id)
    )
  );

create policy "schedule_activities_select_project_members_only"
  on public.schedule_activities
  for select
  using (
    exists (
      select 1
      from public.schedule_versions sv
      join public.document_versions dv on dv.id = sv.document_version_id
      join public.documents d on d.id = dv.document_id
      where sv.id = schedule_activities.schedule_version_id
        and public.is_project_member(d.project_id)
    )
  );
