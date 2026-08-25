-- ============================================================
-- 20260825120000_admin_set_profile_job_title.sql
-- Permite a um ADMINISTRADOR de projeto definir o CARGO (profiles.title)
-- de um membro do mesmo projeto.
--
-- profiles.title já existe (identity_foundation, 20260817191336) —
-- nenhuma coluna nova aqui. O que falta é a capacidade de um
-- administrador definir o cargo de OUTRO usuário: hoje
-- profiles_update_self_limited_fields + o GRANT column-level
-- (name, title, avatar_initials) só permitem que o PRÓPRIO dono da
-- linha edite seu título — um administrador não consegue.
--
-- Mesmo padrão das demais RPCs de gestão de membros
-- (add_project_member etc., 20260824090000): SECURITY DEFINER,
-- checagem de ADMINISTRADOR no servidor, nunca UPDATE direto client-side.
-- ============================================================

create or replace function public.set_profile_job_title(
  p_project_id uuid,
  p_user_id uuid,
  p_job_title text
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Sessão não autenticada.';
  end if;

  if not public.has_project_permission(p_project_id, 'ADMINISTRADOR') then
    raise exception 'Apenas administradores do projeto podem definir o cargo de um membro.';
  end if;

  if not exists (
    select 1
    from public.project_memberships
    where project_id = p_project_id
      and user_id = p_user_id
  ) then
    raise exception 'Usuário não é membro deste projeto.';
  end if;

  update public.profiles
  set title = nullif(btrim(coalesce(p_job_title, '')), '')
  where id = p_user_id
  returning * into v_row;

  if not found then
    raise exception 'Usuário não encontrado.';
  end if;

  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, action, entity_type, entity_id, detail
  )
  values (
    p_project_id, 'USER', auth.uid(), 'MEMBER_JOB_TITLE_SET', 'profiles', p_user_id::text,
    format('Cargo do usuário definido como "%s".', coalesce(v_row.title, '(vazio)'))
  );

  return v_row;
end;
$$;

revoke all on function public.set_profile_job_title(uuid, uuid, text) from public;
grant execute on function public.set_profile_job_title(uuid, uuid, text) to authenticated;
