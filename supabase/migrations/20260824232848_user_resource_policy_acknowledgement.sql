-- ============================================================
-- ACC
-- Termo de Ciência da Política de Uso de Recursos Corporativos
--
-- Estrutura corporativa e independente de projeto:
-- uma aprovação da versão vigente vale para o usuário AXION,
-- sem exigir nova aprovação ao ser incluído em outro projeto.
--
-- O projeto de origem é preservado para rastreabilidade.
-- ============================================================


-- ============================================================
-- 1. Versões oficiais do Termo
-- ============================================================

create table public.corporate_policy_terms (
  id uuid primary key default gen_random_uuid(),

  code text not null,

  title text not null,

  version text not null,

  content_text text not null,

  content_sha256 text not null
    check (content_sha256 ~ '^[a-fA-F0-9]{64}$'),

  is_current boolean not null default false,

  effective_at timestamptz not null default now(),

  created_by_user_id uuid references public.profiles(id),

  created_at timestamptz not null default now(),

  unique (code, version)
);
create unique index corporate_policy_terms_one_current_idx
  on public.corporate_policy_terms (code)
  where is_current = true;
comment on table public.corporate_policy_terms is
  'Versões oficiais e imutáveis dos termos/políticas corporativas apresentados aos usuários do ACC.';
-- ============================================================
-- 2. Ciência/aprovação por usuário
-- ============================================================

create table public.user_policy_acknowledgements (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references public.profiles(id),

  term_id uuid not null
    references public.corporate_policy_terms(id),

  source_project_id uuid
    references public.projects(id),

  status text not null default 'AGUARDANDO_APROVACAO'
    check (
      status in (
        'AGUARDANDO_APROVACAO',
        'APROVADO'
      )
    ),

  first_sent_at timestamptz,

  last_sent_at timestamptz,

  resend_available_at timestamptz,

  reminder_count integer not null default 0
    check (reminder_count >= 0),

  viewed_at timestamptz,

  approved_at timestamptz,

  approved_by_user_id uuid
    references public.profiles(id),

  email_message_id text,

  approval_ip inet,

  approval_user_agent text,

  created_by_user_id uuid
    references public.profiles(id),

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now(),

  unique (user_id, term_id),

  check (
    (
      status = 'AGUARDANDO_APROVACAO'
      and approved_at is null
      and approved_by_user_id is null
    )
    or
    (
      status = 'APROVADO'
      and approved_at is not null
      and approved_by_user_id = user_id
    )
  )
);
create index user_policy_ack_user_idx
  on public.user_policy_acknowledgements (user_id);
create index user_policy_ack_status_idx
  on public.user_policy_acknowledgements (status);
create index user_policy_ack_resend_idx
  on public.user_policy_acknowledgements (
    status,
    resend_available_at
  );
comment on table public.user_policy_acknowledgements is
  'Registro da ciência/aprovação do usuário para uma versão oficial da política corporativa do ACC.';
-- ============================================================
-- 3. Helper:
-- ADMINISTRADOR pode consultar os termos dos usuários
-- que participem de pelo menos um mesmo projeto.
-- ============================================================

create or replace function public.is_shared_project_admin(
  p_target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_memberships admin_pm
    join public.project_memberships target_pm
      on target_pm.project_id = admin_pm.project_id
    where admin_pm.user_id = auth.uid()
      and admin_pm.status = 'ACTIVE'
      and admin_pm.permission = 'ADMINISTRADOR'
      and target_pm.user_id = p_target_user_id
      and target_pm.status = 'ACTIVE'
  );
$$;
revoke all
  on function public.is_shared_project_admin(uuid)
  from public;
grant execute
  on function public.is_shared_project_admin(uuid)
  to authenticated;
-- ============================================================
-- 4. RLS
-- ============================================================

alter table public.corporate_policy_terms
  enable row level security;
alter table public.user_policy_acknowledgements
  enable row level security;
-- Qualquer usuário autenticado pode ler a versão oficial
-- do Termo que lhe será apresentada.
create policy "corporate_policy_terms_select_authenticated"
  on public.corporate_policy_terms
  for select
  to authenticated
  using (true);
-- O próprio usuário pode consultar sua aprovação.
-- ADMINISTRADOR de projeto em comum também pode consultar,
-- permitindo exibição na aba Usuários.
create policy "user_policy_ack_select_self_or_shared_admin"
  on public.user_policy_acknowledgements
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_shared_project_admin(user_id)
  );
-- Nenhuma policy INSERT/UPDATE/DELETE é criada aqui.
-- As escritas serão realizadas exclusivamente pelas RPCs
-- auditadas que serão adicionadas na próxima etapa.
-- ============================================================;
