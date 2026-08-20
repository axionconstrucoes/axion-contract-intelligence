-- ============================================================
-- email_ingestion_config_foundation.sql
--
-- Perimetro autorizado da ingestao Gmail por projeto.
--
-- Define:
-- - janela temporal;
-- - mailboxes corporativas monitoradas;
-- - dominios permitidos;
-- - estado da monitoracao.
--
-- Nenhuma credencial OAuth, secret ou refresh token e armazenado.
-- ============================================================


-- ============================================================
-- Configuracao principal
-- Uma configuracao por projeto.
-- ============================================================

create table public.project_email_ingestion_configs (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null unique
    references public.projects (id) on delete cascade,

  enabled boolean not null default false,

  window_mode text not null
    check (
      window_mode in (
        'FROM_PROJECT_START',
        'FROM_NOW',
        'CUSTOM'
      )
    ),

  custom_start_at timestamptz,

  custom_end_at timestamptz,

  monitoring_started_at timestamptz,

  last_sync_at timestamptz,

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now(),

  check (
    (
      window_mode = 'CUSTOM'
      and custom_start_at is not null
    )
    or
    (
      window_mode <> 'CUSTOM'
      and custom_start_at is null
      and custom_end_at is null
    )
  ),

  check (
    custom_end_at is null
    or custom_start_at is null
    or custom_end_at >= custom_start_at
  )
);


-- ============================================================
-- Mailboxes monitoradas
-- Permite mais de uma caixa AXION por projeto.
-- ============================================================

create table public.project_email_ingestion_mailboxes (
  id uuid primary key default gen_random_uuid(),

  config_id uuid not null
    references public.project_email_ingestion_configs (id)
    on delete cascade,

  mailbox_address text not null,

  enabled boolean not null default true,

  created_at timestamptz not null default now(),

  unique (config_id, mailbox_address),

  check (
    btrim(mailbox_address) <> ''
  )
);


-- ============================================================
-- Dominios autorizados
-- Ex.: axion.com.br + cliente.com.br
-- ============================================================

create table public.project_email_ingestion_domains (
  id uuid primary key default gen_random_uuid(),

  config_id uuid not null
    references public.project_email_ingestion_configs (id)
    on delete cascade,

  domain text not null,

  domain_role text not null
    check (
      domain_role in (
        'AXION',
        'CLIENT',
        'OTHER_AUTHORIZED'
      )
    ),

  enabled boolean not null default true,

  created_at timestamptz not null default now(),

  unique (config_id, domain),

  check (
    btrim(domain) <> ''
  ),

  check (
    domain = lower(domain)
  ),

  check (
    domain not like '@%'
  )
);


-- ============================================================
-- Indices
-- ============================================================

create index project_email_ingestion_mailboxes_config_idx
  on public.project_email_ingestion_mailboxes (config_id);

create index project_email_ingestion_domains_config_idx
  on public.project_email_ingestion_domains (config_id);

create index project_email_ingestion_configs_enabled_idx
  on public.project_email_ingestion_configs (enabled);


-- ============================================================
-- RLS
-- ============================================================

alter table public.project_email_ingestion_configs
  enable row level security;

alter table public.project_email_ingestion_mailboxes
  enable row level security;

alter table public.project_email_ingestion_domains
  enable row level security;


create policy "project_email_ingestion_configs_select_members"
  on public.project_email_ingestion_configs
  for select
  using (
    public.is_project_member(project_id)
  );


create policy "project_email_ingestion_mailboxes_select_members"
  on public.project_email_ingestion_mailboxes
  for select
  using (
    exists (
      select 1
      from public.project_email_ingestion_configs c
      where c.id = project_email_ingestion_mailboxes.config_id
        and public.is_project_member(c.project_id)
    )
  );


create policy "project_email_ingestion_domains_select_members"
  on public.project_email_ingestion_domains
  for select
  using (
    exists (
      select 1
      from public.project_email_ingestion_configs c
      where c.id = project_email_ingestion_domains.config_id
        and public.is_project_member(c.project_id)
    )
  );

-- Escrita destinada a operacoes server-side autorizadas.
--
-- Credenciais Gmail nunca devem ser gravadas nestas tabelas.
