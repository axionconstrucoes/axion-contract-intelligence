-- ============================================================
-- 20260818203331_clauses_foundation.sql
-- Fundacao de Clauses: clause pertence a uma document_version
-- especifica (nao a documents nem a projects diretamente).
-- project/document sao derivados por join:
-- clauses -> document_versions -> documents -> projects.
-- Nenhum campo especulativo (category/risk/obligation/locator/
-- precedence/lifecycle status/policy/evidence) foi adicionado.
-- ============================================================

create table public.clauses (
  id uuid primary key default gen_random_uuid(),
  document_version_id uuid not null
    references public.document_versions (id) on delete cascade,
  clause_number text not null,
  title text not null,
  text text not null,
  created_at timestamptz not null default now()
);

create index clauses_document_version_id_idx
  on public.clauses (document_version_id);

create index clauses_document_version_id_clause_number_idx
  on public.clauses (document_version_id, clause_number);

-- ---------- RLS ----------

alter table public.clauses enable row level security;

create policy "clauses_select_project_members_only"
  on public.clauses
  for select
  using (
    exists (
      select 1
      from public.document_versions dv
      join public.documents d on d.id = dv.document_id
      where dv.id = clauses.document_version_id
        and public.is_project_member(d.project_id)
    )
  );
