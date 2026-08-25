create or replace function public.delete_project_document(
  p_document_id uuid
)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_document_title text;
  v_storage_paths text[];
begin
  if v_user_id is null then
    raise exception 'Sessão não autenticada.';
  end if;

  select
    d.project_id,
    d.title
  into
    v_project_id,
    v_document_title
  from public.documents d
  where d.id = p_document_id;

  if not found then
    raise exception 'Documento não encontrado.';
  end if;

  if not exists (
    select 1
    from public.project_memberships pm
    where pm.project_id = v_project_id
      and pm.user_id = v_user_id
      and pm.permission = 'ADMINISTRADOR'
      and pm.status = 'ACTIVE'
  ) then
    raise exception
      'Somente Administrador ativo do projeto pode excluir documentos.';
  end if;

  -- Evidência forense vinculada a qualquer versão.
  if exists (
    select 1
    from public.event_evidence ee
    join public.document_versions dv
      on dv.id = ee.document_version_id
    where dv.document_id = p_document_id
  ) then
    raise exception
      'Documento não pode ser excluído: uma versão é evidência de evento.';
  end if;

  -- Referência direta ao documento.
  if exists (
    select 1
    from public.event_cross_references ecr
    where ecr.document_id = p_document_id
  ) then
    raise exception
      'Documento não pode ser excluído: existe referência no Event Ledger.';
  end if;

  -- Referência a cláusula pertencente ao documento.
  if exists (
    select 1
    from public.event_cross_references ecr
    join public.clauses c
      on c.id = ecr.clause_id
    join public.document_versions dv
      on dv.id = c.document_version_id
    where dv.document_id = p_document_id
  ) then
    raise exception
      'Documento não pode ser excluído: uma cláusula está referenciada no Event Ledger.';
  end if;

  -- Guardar os caminhos antes do DELETE para limpeza posterior do Storage.
  select coalesce(
    array_agg(distinct x.storage_path),
    array[]::text[]
  )
  into v_storage_paths
  from (
    select dv.file_path as storage_path
    from public.document_versions dv
    where dv.document_id = p_document_id
      and dv.file_path is not null

    union

    select dvf.storage_path
    from public.document_version_files dvf
    join public.document_versions dv
      on dv.id = dvf.document_version_id
    where dv.document_id = p_document_id
      and dvf.storage_path is not null
  ) x;

  -- Cascades eliminam versões, arquivos derivados e cláusulas
  -- que não possuam referência forense protegida.
  delete from public.documents
  where id = p_document_id;

  -- Audit Log permanece mesmo após o documento operacional desaparecer.
  insert into public.audit_log_entries (
    project_id,
    actor_type,
    actor_user_id,
    actor_label,
    action,
    entity_type,
    entity_id,
    detail
  )
  values (
    v_project_id,
    'USER',
    v_user_id,
    null,
    'DOCUMENT_DELETED',
    'DOCUMENT',
    p_document_id::text,
    format(
      'Documento excluído pelo Administrador. Título: %s',
      coalesce(v_document_title, '(sem título)')
    )
  );

  return v_storage_paths;

exception
  when foreign_key_violation then
    raise exception
      'Documento não pode ser excluído porque ainda possui vínculos protegidos.';
end;
$$;
revoke all
on function public.delete_project_document(uuid)
from public;
grant execute
on function public.delete_project_document(uuid)
to authenticated;
notify pgrst, 'reload schema';
