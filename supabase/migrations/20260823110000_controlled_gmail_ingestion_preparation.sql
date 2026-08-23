-- ============================================================
-- 20260823110000_controlled_gmail_ingestion_preparation.sql
-- Prepara o ACC para conectar contas Google Workspace @axion.com.br e
-- executar a primeira ingestão real controlada por projeto. Reaproveita
-- 100% da infraestrutura existente (project_email_ingestion_configs/
-- _mailboxes/_domains, emails, email_attachments) — só COMPLETA o que
-- faltava: registro de contas conhecidas, participantes relevantes,
-- opção de anexos e rastreamento real de progresso de sincronização.
--
-- Nenhuma credencial OAuth, secret, access token ou refresh token é
-- armazenado em nenhuma tabela nova — mesmo princípio já documentado em
-- 20260820125550_email_ingestion_config_foundation.sql e
-- 20260823060000_email_attachment_ingestion_foundation.sql. Tokens
-- continuam exclusivamente em variáveis de ambiente (mesmo padrão de
-- apps/web/lib/email/inbound/gmail-inbound-auth.ts).
--
-- "Conectada" aqui significa "conta registrada como AXION autorizada e
-- pronta para o pipeline existente" — a autorização OAuth real
-- continua sendo o procedimento manual já documentado em
-- docs/email-branding.md (scripts/gmail-inbound-oauth.mjs), executado
-- por um administrador. Esta migration NUNCA implementa nem simula um
-- fluxo de OAuth em si.
-- ============================================================

-- ---------- helper: é ADMIN de pelo menos um projeto ----------
-- email_accounts é um registro organizacional (não por projeto) — não
-- há como usar has_project_permission(project_id, ...) diretamente.
-- Reaproveita o mesmo vocabulário de permissão já existente
-- (project_memberships.permission) em vez de criar um papel novo.

create function public.is_any_project_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_memberships pm
    where pm.user_id = auth.uid()
      and pm.permission = 'ADMIN'
  );
$$;

revoke all on function public.is_any_project_admin() from public;
grant execute on function public.is_any_project_admin() to authenticated;

-- ---------- email_accounts ----------
-- Registro organizacional das contas @axion.com.br conhecidas pelo ACC.
-- NUNCA um token, NUNCA uma senha.

create table public.email_accounts (
  id uuid primary key default gen_random_uuid(),

  email_address text not null unique,

  display_name text,

  status text not null default 'NOT_CONNECTED'
    check (status in ('NOT_CONNECTED', 'CONNECTED', 'SYNCING', 'AUTH_EXPIRED', 'ERROR')),

  last_sync_at timestamptz,
  last_sync_error text,

  connected_at timestamptz,
  connected_by_user_id uuid references public.profiles (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (btrim(email_address) <> ''),
  check (email_address = lower(email_address)),
  check (email_address like '%@axion.com.br')
);

comment on table public.email_accounts is
  'Registro organizacional de contas Google Workspace @axion.com.br conhecidas pelo ACC. Nunca armazena token/secret/senha — a credencial OAuth real continua em variáveis de ambiente (ver docs/email-branding.md).';

create index email_accounts_status_idx on public.email_accounts (status);

alter table public.email_accounts enable row level security;

-- Visibilidade organizacional (não há segredo aqui) — qualquer usuário
-- autenticado do ACC pode ver quais contas existem, mesmo padrão de
-- "quem já está monitorando o quê" ser informação não sensível.
create policy "email_accounts_select_authenticated"
  on public.email_accounts
  for select
  to authenticated
  using (true);

-- Nenhuma policy de INSERT/UPDATE/DELETE — escrita só via as duas RPCs
-- abaixo (SECURITY DEFINER, exige is_any_project_admin()).

create or replace function public.register_email_account(
  p_email_address text,
  p_display_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid;
  v_email text;
  v_account_id uuid;
begin
  v_actor_user_id := auth.uid();

  if v_actor_user_id is null then
    raise exception 'Sessão não autenticada.';
  end if;

  if not public.is_any_project_admin() then
    raise exception 'Permissão ADMIN (em pelo menos um projeto) é necessária para registrar uma conta de e-mail AXION.';
  end if;

  v_email := lower(btrim(p_email_address));

  if v_email !~ '^[a-z0-9._%+-]+@axion\.com\.br$' then
    raise exception 'Somente contas @axion.com.br podem ser registradas como conta AXION.';
  end if;

  insert into public.email_accounts (email_address, display_name, status, connected_at, connected_by_user_id)
  values (v_email, nullif(btrim(p_display_name), ''), 'CONNECTED', now(), v_actor_user_id)
  on conflict (email_address) do update
    set status = 'CONNECTED',
        display_name = coalesce(nullif(btrim(p_display_name), ''), public.email_accounts.display_name),
        connected_at = now(),
        connected_by_user_id = v_actor_user_id,
        last_sync_error = null,
        updated_at = now()
  returning id into v_account_id;

  insert into public.audit_log_entries (project_id, actor_type, actor_user_id, actor_label, action, entity_type, entity_id, detail)
  select p.id, 'USER', v_actor_user_id, null, 'EMAIL_ACCOUNT_CONNECTED', 'EMAIL_ACCOUNT', v_account_id::text,
    format('Conta %s registrada/reconectada como conta AXION autorizada.', v_email)
  from public.projects p
  where public.has_project_permission(p.id, 'ADMIN')
  limit 1;

  return v_account_id;
end;
$$;

revoke all on function public.register_email_account(text, text) from public;
revoke all on function public.register_email_account(text, text) from anon;
grant execute on function public.register_email_account(text, text) to authenticated;

create or replace function public.disconnect_email_account(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid;
  v_email text;
begin
  v_actor_user_id := auth.uid();

  if v_actor_user_id is null then
    raise exception 'Sessão não autenticada.';
  end if;

  if not public.is_any_project_admin() then
    raise exception 'Permissão ADMIN (em pelo menos um projeto) é necessária para desconectar uma conta de e-mail AXION.';
  end if;

  select email_address into v_email from public.email_accounts where id = p_account_id;
  if v_email is null then
    raise exception 'Conta (id=%) não encontrada.', p_account_id;
  end if;

  update public.email_accounts
    set status = 'NOT_CONNECTED', updated_at = now()
    where id = p_account_id;

  insert into public.audit_log_entries (project_id, actor_type, actor_user_id, actor_label, action, entity_type, entity_id, detail)
  select p.id, 'USER', v_actor_user_id, null, 'EMAIL_ACCOUNT_DISCONNECTED', 'EMAIL_ACCOUNT', p_account_id::text,
    format('Conta %s desconectada.', v_email)
  from public.projects p
  where public.has_project_permission(p.id, 'ADMIN')
  limit 1;
end;
$$;

revoke all on function public.disconnect_email_account(uuid) from public;
revoke all on function public.disconnect_email_account(uuid) from anon;
grant execute on function public.disconnect_email_account(uuid) to authenticated;

-- ---------- project_email_ingestion_configs: completar campos ----------

alter table public.project_email_ingestion_configs
  add column include_attachments boolean not null default true,
  add column email_account_id uuid references public.email_accounts (id) on delete set null;

-- ---------- project_email_ingestion_participants ----------
-- Participantes relevantes cadastrados (seção 5/9) — além do domínio,
-- permite autorizar endereços específicos fora do domínio do cliente
-- quando necessário (ex.: consultor externo do cliente).

create table public.project_email_ingestion_participants (
  id uuid primary key default gen_random_uuid(),

  config_id uuid not null
    references public.project_email_ingestion_configs (id)
    on delete cascade,

  email_address text not null,

  role_note text,

  enabled boolean not null default true,

  created_at timestamptz not null default now(),

  unique (config_id, email_address),

  check (btrim(email_address) <> ''),
  check (email_address = lower(email_address))
);

create index project_email_ingestion_participants_config_idx
  on public.project_email_ingestion_participants (config_id);

alter table public.project_email_ingestion_participants enable row level security;

create policy "project_email_ingestion_participants_select_members"
  on public.project_email_ingestion_participants
  for select
  using (
    exists (
      select 1
      from public.project_email_ingestion_configs c
      where c.id = project_email_ingestion_participants.config_id
        and public.is_project_member(c.project_id)
    )
  );

-- ---------- project_email_ingestion_sync_runs ----------
-- Execução de sincronização com contadores reais (seção 13/14/20) —
-- nunca timer/percentual fake. Escrito pela orquestração de sync (fora
-- desta migration); aqui só a fundação de dados + RLS.

create table public.project_email_ingestion_sync_runs (
  id uuid primary key default gen_random_uuid(),

  config_id uuid not null
    references public.project_email_ingestion_configs (id)
    on delete cascade,

  project_id uuid not null references public.projects (id) on delete cascade,

  status text not null default 'PREPARING'
    check (status in ('PREPARING', 'RUNNING', 'COMPLETED', 'FAILED')),

  emails_found integer,
  emails_imported integer not null default 0,
  attachments_found integer not null default 0,
  attachments_processed integer not null default 0,
  findings_generated integer not null default 0,
  failures_count integer not null default 0,

  error_message text,

  started_by_user_id uuid not null references public.profiles (id) on delete restrict,

  started_at timestamptz not null default now(),
  completed_at timestamptz,

  created_at timestamptz not null default now(),

  check (status = 'PREPARING' or status = 'RUNNING' or completed_at is not null or status = 'FAILED'),
  check (status <> 'FAILED' or error_message is not null)
);

comment on table public.project_email_ingestion_sync_runs is
  'Uma execução de sincronização Gmail confirmada por humano — contadores reais (nunca timer/percentual fake). started_by_user_id nunca nulo: sincronização é sempre iniciada por decisão humana explícita (seção 8/15 do requisito).';

create index project_email_ingestion_sync_runs_config_idx
  on public.project_email_ingestion_sync_runs (config_id);
create index project_email_ingestion_sync_runs_project_idx
  on public.project_email_ingestion_sync_runs (project_id, started_at desc);

alter table public.project_email_ingestion_sync_runs enable row level security;

create policy "project_email_ingestion_sync_runs_select_members"
  on public.project_email_ingestion_sync_runs
  for select
  using (public.is_project_member(project_id));

-- Nenhuma policy de INSERT/UPDATE para "authenticated": iniciar uma
-- sincronização (INSERT) passa pela RPC abaixo (exige ADMIN); atualizar
-- contadores durante a execução é sempre server-side (mesmo padrão de
-- email_attachments/ai_findings).

create or replace function public.start_email_sync_run(p_config_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid;
  v_project_id uuid;
  v_run_id uuid;
begin
  v_actor_user_id := auth.uid();

  if v_actor_user_id is null then
    raise exception 'Sessão não autenticada.';
  end if;

  select project_id into v_project_id
    from public.project_email_ingestion_configs
    where id = p_config_id;

  if v_project_id is null then
    raise exception 'Configuração de ingestão (id=%) não encontrada.', p_config_id;
  end if;

  if not public.has_project_permission(v_project_id, 'ADMIN') then
    raise exception 'Permissão ADMIN é necessária para confirmar uma sincronização de e-mails.';
  end if;

  insert into public.project_email_ingestion_sync_runs (config_id, project_id, status, started_by_user_id)
  values (p_config_id, v_project_id, 'PREPARING', v_actor_user_id)
  returning id into v_run_id;

  insert into public.audit_log_entries (project_id, actor_type, actor_user_id, actor_label, action, entity_type, entity_id, detail)
  values (
    v_project_id, 'USER', v_actor_user_id, null, 'EMAIL_SYNC_STARTED', 'PROJECT_EMAIL_INGESTION_SYNC_RUN', v_run_id::text,
    'Sincronização de e-mails confirmada por humano e enfileirada.'
  );

  return v_run_id;
end;
$$;

revoke all on function public.start_email_sync_run(uuid) from public;
revoke all on function public.start_email_sync_run(uuid) from anon;
grant execute on function public.start_email_sync_run(uuid) to authenticated;
