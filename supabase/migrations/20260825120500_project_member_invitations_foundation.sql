-- ============================================================
-- 20260825120500_project_member_invitations_foundation.sql
-- Pré-cadastro de usuários (seção "Pré-cadastro de usuários") — permite
-- a um ADMINISTRADOR incluir alguém no projeto ANTES do primeiro login.
-- Nenhum acesso é concedido até a ativação (ver
-- 20260825121000_activate_project_member_invitation_on_login.sql):
-- esta tabela NUNCA cria linha em project_memberships por si só.
-- ============================================================

-- ---------- project_member_invitations ----------

create table public.project_member_invitations (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete cascade,

  -- E-mail corporativo normalizado (lowercase, trim) — comparado
  -- EXATO (nunca aproximado) contra auth.users.email na ativação.
  email text not null
    check (btrim(email) <> '')
    check (email = lower(email))
    check (email like '%@axion.com.br'),

  name text not null
    check (btrim(name) <> ''),

  job_title text,

  area text
    check (
      area is null
      or area in (
        'DIRETORIA', 'ADMINISTRATIVO', 'COMERCIAL', 'FINANCEIRO',
        'ENGENHARIA', 'ORÇAMENTO', 'JURÍDICO', 'PLANEJAMENTO'
      )
    ),

  permission text not null
    check (permission in ('ADMINISTRADOR', 'GESTOR', 'COLABORADOR', 'LEITURA')),

  status text not null default 'PENDING'
    check (status in ('PENDING', 'ACTIVATED', 'CANCELLED')),

  created_by uuid not null
    references public.profiles (id) on delete restrict,

  created_at timestamptz not null default now(),
  activated_at timestamptz,
  cancelled_at timestamptz,

  -- Preenchido só na ativação (primeiro login que bate exatamente com
  -- "email"). Nunca preenchido manualmente, nunca antes da ativação.
  profile_id uuid
    references public.profiles (id) on delete set null,

  unique (project_id, email),

  check (
    (status = 'PENDING' and activated_at is null and cancelled_at is null and profile_id is null)
    or (status = 'ACTIVATED' and activated_at is not null and cancelled_at is null and profile_id is not null)
    or (status = 'CANCELLED' and cancelled_at is not null and activated_at is null)
  )
);

comment on table public.project_member_invitations is
  'Pré-cadastro de usuários por projeto — concede zero acesso até o primeiro login exato daquele e-mail (ver trigger handle_new_user).';

create index project_member_invitations_project_status_idx
  on public.project_member_invitations (project_id, status);

-- ---------- RLS ----------

alter table public.project_member_invitations enable row level security;

-- Visibilidade: qualquer membro do projeto pode ver os pré-cadastros
-- daquele projeto (mesmo padrão de project_memberships_select_members_only).
-- Nenhuma policy de INSERT/UPDATE/DELETE — escrita só via RPC
-- pre_register_project_member (abaixo) e via o trigger de ativação
-- (SECURITY DEFINER, ambos bypassa RLS por design).
create policy "project_member_invitations_select_members_only"
  on public.project_member_invitations
  for select
  using (public.is_project_member(project_id));

-- ---------- pre_register_project_member ----------

create function public.pre_register_project_member(
  p_project_id uuid,
  p_email text,
  p_name text,
  p_job_title text,
  p_area text,
  p_permission text
)
returns public.project_member_invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_row public.project_member_invitations;
begin
  if auth.uid() is null then
    raise exception 'Sessão não autenticada.';
  end if;

  if not public.has_project_permission(p_project_id, 'ADMINISTRADOR') then
    raise exception 'Apenas administradores do projeto podem pré-cadastrar usuários.';
  end if;

  v_email := lower(btrim(p_email));

  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'E-mail inválido: %', p_email;
  end if;

  if split_part(v_email, '@', 2) <> 'axion.com.br' then
    raise exception 'Pré-cadastro restrito a e-mails @axion.com.br.';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'Nome é obrigatório.';
  end if;

  if p_permission not in ('ADMINISTRADOR', 'GESTOR', 'COLABORADOR', 'LEITURA') then
    raise exception 'Papel inválido: %', p_permission;
  end if;

  if p_area is not null and p_area not in (
    'DIRETORIA', 'ADMINISTRATIVO', 'COMERCIAL', 'FINANCEIRO',
    'ENGENHARIA', 'ORÇAMENTO', 'JURÍDICO', 'PLANEJAMENTO'
  ) then
    raise exception 'Área inválida: %', p_area;
  end if;

  -- Já existe profile real (já logou alguma vez)? Pré-cadastro não é
  -- o caminho certo — o admin deveria usar a busca/adição direta
  -- (add_project_member), nunca duplicar o caminho de entrada.
  if exists (select 1 from public.profiles where lower(email) = v_email) then
    raise exception 'Este e-mail já tem um profile — use a busca por e-mail em vez do pré-cadastro.';
  end if;

  if exists (
    select 1
    from public.project_member_invitations
    where project_id = p_project_id
      and email = v_email
      and status <> 'CANCELLED'
  ) then
    raise exception 'Já existe um pré-cadastro pendente ou ativado para este e-mail neste projeto.';
  end if;

  insert into public.project_member_invitations (
    project_id, email, name, job_title, area, permission, status, created_by
  )
  values (
    p_project_id, v_email, btrim(p_name), nullif(btrim(coalesce(p_job_title, '')), ''), p_area, p_permission, 'PENDING', auth.uid()
  )
  on conflict (project_id, email) do update
  set
    name = excluded.name,
    job_title = excluded.job_title,
    area = excluded.area,
    permission = excluded.permission,
    status = 'PENDING',
    created_by = excluded.created_by,
    created_at = now(),
    activated_at = null,
    cancelled_at = null,
    profile_id = null
  returning * into v_row;

  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, action, entity_type, entity_id, detail
  )
  values (
    p_project_id, 'USER', auth.uid(), 'MEMBER_PRE_REGISTERED', 'project_member_invitations', v_row.id::text,
    format('Pré-cadastro criado para %s (papel %s).', v_email, p_permission)
  );

  return v_row;
end;
$$;

revoke all on function public.pre_register_project_member(uuid, text, text, text, text, text) from public;
grant execute on function public.pre_register_project_member(uuid, text, text, text, text, text) to authenticated;
