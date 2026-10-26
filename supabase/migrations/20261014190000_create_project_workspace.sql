-- Criação de projetos contratados: somente administradores ACC ativos.
-- A RPC cria o projeto e a associação ADMINISTRADOR na mesma transação.

create or replace function public.create_project_workspace(
  p_code text,
  p_name text,
  p_client text,
  p_location text,
  p_start_date date,
  p_baseline_end_date date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid := gen_random_uuid();
  v_code text := nullif(btrim(p_code), '');
  v_name text := nullif(btrim(p_name), '');
  v_client text := nullif(btrim(p_client), '');
  v_location text := nullif(btrim(p_location), '');
begin
  if v_user_id is null then
    raise exception 'Autenticação obrigatória.';
  end if;

  if v_code is null or v_name is null or v_client is null or v_location is null
     or p_start_date is null or p_baseline_end_date is null then
    raise exception 'Preencha todos os campos obrigatórios.';
  end if;

  if char_length(v_code) > 40 or char_length(v_name) > 160
     or char_length(v_client) > 120 or char_length(v_location) > 160 then
    raise exception 'Revise os campos: algum texto excede o tamanho permitido.';
  end if;

  if p_baseline_end_date < p_start_date then
    raise exception 'A data de término deve ser igual ou posterior à data de início.';
  end if;

  if not exists (
    select 1
    from public.project_memberships pm
    where pm.user_id = v_user_id
      and pm.status = 'ACTIVE'
      and pm.permission = 'ADMINISTRADOR'
  ) then
    raise exception 'Somente administradores ativos podem criar projetos.';
  end if;

  insert into public.projects (
    id, code, name, client, status, location, start_date, baseline_end_date,
    project_start_date, acc_operational_start_date, workspace_type
  ) values (
    v_project_id, v_code, v_name, v_client, 'ATIVO', v_location,
    p_start_date, p_baseline_end_date, p_start_date, current_date, 'OBRA'
  );

  insert into public.project_memberships (
    project_id, user_id, permission, status, area
  ) values (
    v_project_id, v_user_id, 'ADMINISTRADOR', 'ACTIVE', 'DIRETORIA'
  );

  return v_project_id;
end;
$$;

revoke all on function public.create_project_workspace(text, text, text, text, date, date) from public;
grant execute on function public.create_project_workspace(text, text, text, text, date, date) to authenticated;
