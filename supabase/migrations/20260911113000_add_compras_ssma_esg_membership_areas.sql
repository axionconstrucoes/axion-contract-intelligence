-- Amplia as áreas disponíveis no cadastro de usuários.
-- Os valores são específicos da membership de cada projeto.

do $$
declare
  v_area_attnum smallint;
  v_constraint record;
begin
  select attnum into v_area_attnum
  from pg_attribute
  where attrelid = 'public.project_memberships'::regclass
    and attname = 'area'
    and not attisdropped;

  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.project_memberships'::regclass
      and contype = 'c'
      and v_area_attnum = any (conkey)
  loop
    execute format('alter table public.project_memberships drop constraint %I', v_constraint.conname);
  end loop;
end;
$$;

alter table public.project_memberships
  add constraint project_memberships_area_check
  check (
    area is null
    or area in (
      'DIRETORIA', 'ADMINISTRATIVO', 'COMERCIAL', 'FINANCEIRO',
      'ENGENHARIA', 'ORÇAMENTO', 'JURÍDICO', 'PLANEJAMENTO',
      'COMPRAS', 'SSMA/ESG'
    )
  );

do $$
declare
  v_area_attnum smallint;
  v_constraint record;
begin
  select attnum into v_area_attnum
  from pg_attribute
  where attrelid = 'public.project_member_invitations'::regclass
    and attname = 'area'
    and not attisdropped;

  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.project_member_invitations'::regclass
      and contype = 'c'
      and v_area_attnum = any (conkey)
  loop
    execute format('alter table public.project_member_invitations drop constraint %I', v_constraint.conname);
  end loop;
end;
$$;

alter table public.project_member_invitations
  add constraint project_member_invitations_area_check
  check (
    area is null
    or area in (
      'DIRETORIA', 'ADMINISTRATIVO', 'COMERCIAL', 'FINANCEIRO',
      'ENGENHARIA', 'ORÇAMENTO', 'JURÍDICO', 'PLANEJAMENTO',
      'COMPRAS', 'SSMA/ESG'
    )
  );

create or replace function public.pre_register_project_member(
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

  if p_permission not in ('ADMINISTRADOR', 'GESTOR', 'GERENTE', 'COLABORADOR', 'LEITURA') then
    raise exception 'Papel inválido: %', p_permission;
  end if;

  if p_area is not null and p_area not in (
    'DIRETORIA', 'ADMINISTRATIVO', 'COMERCIAL', 'FINANCEIRO',
    'ENGENHARIA', 'ORÇAMENTO', 'JURÍDICO', 'PLANEJAMENTO',
    'COMPRAS', 'SSMA/ESG'
  ) then
    raise exception 'Área inválida: %', p_area;
  end if;

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
    p_project_id, v_email, btrim(p_name),
    nullif(btrim(coalesce(p_job_title, '')), ''),
    p_area, p_permission, 'PENDING', auth.uid()
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
    p_project_id, 'USER', auth.uid(), 'MEMBER_PRE_REGISTERED',
    'project_member_invitations', v_row.id::text,
    format('Pré-cadastro criado para %s (papel %s).', v_email, p_permission)
  );

  return v_row;
end;
$$;

alter function public.pre_register_project_member(uuid, text, text, text, text, text) owner to postgres;
revoke all on function public.pre_register_project_member(uuid, text, text, text, text, text) from public;
revoke all on function public.pre_register_project_member(uuid, text, text, text, text, text) from anon;
grant execute on function public.pre_register_project_member(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.pre_register_project_member(uuid, text, text, text, text, text) to service_role;

comment on function public.pre_register_project_member(uuid, text, text, text, text, text) is
  'Pré-cadastra usuário corporativo em um projeto, incluindo as áreas Compras e SSMA/ESG.';
