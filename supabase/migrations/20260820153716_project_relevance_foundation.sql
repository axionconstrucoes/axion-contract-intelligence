-- ============================================================
-- Project Relevance Foundation
--
-- Identificadores configuraveis usados para decidir se um email/thread
-- pertence realmente ao projeto.
--
-- CLIENT_DOMAIN e CLIENT_NAME podem ser apenas SUPPORTING,
-- pois um mesmo cliente pode possuir diversos projetos.
-- ============================================================

create table public.project_relevance_identifiers (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete cascade,

  kind text not null
    check (
      kind in (
        'CLIENT_DOMAIN',
        'CLIENT_NAME',
        'PROJECT_NAME',
        'PROJECT_CODE',
        'CONTRACT_NUMBER',
        'PURCHASE_ORDER',
        'ALIAS'
      )
    ),

  value text not null,

  strength text not null
    check (
      strength in (
        'STRONG',
        'SUPPORTING'
      )
    ),

  weight integer not null
    check (
      weight >= 1
      and weight <= 100
    ),

  active boolean not null default true,

  created_at timestamptz not null default now(),

  unique (
    project_id,
    kind,
    value
  )
);

create index project_relevance_identifiers_project_idx
  on public.project_relevance_identifiers (
    project_id,
    active
  );

alter table public.project_relevance_identifiers
  enable row level security;

create policy "project_relevance_identifiers_select_project_members"
  on public.project_relevance_identifiers
  for select
  using (
    public.is_project_member(project_id)
  );

comment on table public.project_relevance_identifiers is
  'Fingerprint configuravel do projeto usado antes da analise contratual.';
