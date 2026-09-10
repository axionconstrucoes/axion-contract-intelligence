-- Espaços jurídicos de pré-contrato reutilizam a infraestrutura segura de
-- projetos (membros, documentos, versões, Experts IA e auditoria), sem serem
-- confundidos com obras já contratadas na tela inicial.

alter table public.projects
  add column if not exists workspace_type text not null default 'OBRA'
  check (workspace_type in ('OBRA', 'PRE_CONTRATUAL'));

create index if not exists projects_workspace_type_idx
  on public.projects (workspace_type, name);

create or replace function public.create_precontract_workspace(
  p_name text,
  p_client text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid := gen_random_uuid();
  v_name text := nullif(btrim(p_name), '');
  v_client text := nullif(btrim(p_client), '');
begin
  if v_user_id is null then
    raise exception 'Autenticação obrigatória.';
  end if;

  if v_name is null or v_client is null then
    raise exception 'Informe o nome da oportunidade e o cliente.';
  end if;

  if not exists (
    select 1
    from public.project_memberships pm
    where pm.user_id = v_user_id
      and pm.status = 'ACTIVE'
      and pm.permission = 'ADMINISTRADOR'
  ) then
    raise exception 'Somente administradores podem criar análises pré-contratuais.';
  end if;

  insert into public.projects (
    id, code, name, client, status, location, contract_number,
    start_date, baseline_end_date, workspace_type
  ) values (
    v_project_id,
    'PRE-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS') || '-' || left(v_project_id::text, 8),
    v_name,
    v_client,
    'ATIVO',
    'Pré-contratual',
    null,
    current_date,
    current_date,
    'PRE_CONTRATUAL'
  );

  insert into public.project_memberships (
    project_id, user_id, permission, status, area
  ) values (
    v_project_id, v_user_id, 'ADMINISTRADOR', 'ACTIVE', 'JURÍDICO'
  );

  return v_project_id;
end;
$$;

revoke all on function public.create_precontract_workspace(text, text) from public;
grant execute on function public.create_precontract_workspace(text, text) to authenticated;

comment on column public.projects.workspace_type is
  'OBRA para contrato assinado; PRE_CONTRATUAL para análise jurídica anterior à contratação.';
