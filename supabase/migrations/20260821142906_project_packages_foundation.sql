-- ============================================================
-- 20260821142906_project_packages_foundation.sql
-- Fundacao minima de ProjectPackage: um projeto principal pode ter
-- varios pacotes/CPs (ex.: CP631, CP638), cada um com seus proprios
-- documentos/propostas/escopo. Dados de um pacote alimentam a
-- inteligencia consolidada do projeto, mas documentos de um pacote
-- NAO sao automaticamente aplicaveis a outro.
--
-- Escopo deste lote: SOMENTE a tabela e RLS de leitura. Sem
-- integracao Google Drive, sem vinculo documents->package (fica para
-- lote futuro, quando o fluxo de upload for revisado), sem RPC de
-- escrita (writes tecnicos via admin client, como o resto do projeto
-- nesta fase).
--
-- package_type e text livre (sem check) deliberadamente: a taxonomia
-- real de tipos de pacote ainda nao foi definida pelo usuario — nao
-- inventamos enum aqui.
-- ============================================================

create table public.project_packages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null
    references public.projects (id) on delete cascade,
  code text not null,
  title text not null,
  description text,
  package_type text not null,
  status text not null
    check (status in ('ATIVO', 'SUSPENSO', 'ENCERRADO')),
  created_at timestamptz not null default now(),
  check (btrim(code) <> ''),
  check (btrim(title) <> ''),
  check (btrim(package_type) <> ''),
  unique (project_id, code)
);

create index project_packages_project_id_idx
  on public.project_packages (project_id);

-- ---------- RLS ----------

alter table public.project_packages enable row level security;

create policy "project_packages_select_project_members_only"
  on public.project_packages
  for select
  using (public.is_project_member(project_id));
