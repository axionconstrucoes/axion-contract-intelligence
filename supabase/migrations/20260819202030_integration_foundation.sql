-- ============================================================
-- integration_foundation.sql
-- Configuracao operacional das fontes integradas por projeto.
--
-- Importante:
-- - nenhuma credencial, secret ou token e armazenado aqui;
-- - uma fonte pode ter status diferente em cada projeto;
-- - o catalogo SourceDefinition permanece no codigo da aplicacao;
-- - esta tabela armazena somente estado operacional.
-- ============================================================

create table public.project_integrations (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete cascade,

  source_type text not null
    check (source_type in (
      'EMAIL',
      'DIARIO_OBRA',
      'CONSTRUMANAGER',
      'CONTRATO',
      'GOOGLE_DRIVE',
      'RECEBIDOS_CLIENTE',
      'EDITAL_RFI_RFP',
      'CRONOGRAMA',
      'RELATORIO_SEMANAL',
      'ERP',
      'ORCAMENTO'
    )),

  status text not null
    check (status in (
      'CONECTADO',
      'PENDENTE',
      'ERRO'
    )),

  last_sync_at timestamptz,

  detail text not null default '',

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now(),

  unique (project_id, source_type)
);


-- ============================================================
-- Indices
-- ============================================================

create index project_integrations_project_id_idx
  on public.project_integrations (project_id);

create index project_integrations_project_status_idx
  on public.project_integrations (project_id, status);

create index project_integrations_source_type_idx
  on public.project_integrations (source_type);


-- ============================================================
-- RLS
-- ============================================================

alter table public.project_integrations enable row level security;

create policy "project_integrations_select_project_members_only"
  on public.project_integrations
  for select
  using (
    public.is_project_member(project_id)
  );

-- Nenhuma policy INSERT / UPDATE / DELETE para usuarios comuns.
-- Configuracoes e estados das integracoes devem ser alterados por
-- operacoes server-side autorizadas.
--
-- Secrets, refresh tokens, client secrets e demais credenciais
-- NUNCA devem ser armazenados em project_integrations.
