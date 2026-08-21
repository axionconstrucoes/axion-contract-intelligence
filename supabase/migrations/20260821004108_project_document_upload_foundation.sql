-- ============================================================
-- Project Document Upload Foundation
--
-- - private Supabase Storage bucket
-- - immutable object paths
-- - document version file metadata
-- - processing lifecycle
-- - authenticated project-member download
-- - EDITOR/ADMIN upload
-- - atomic metadata registration
-- - audit trail
-- ============================================================


-- ============================================================
-- 1. DOCUMENT VERSION FILE METADATA
-- ============================================================

alter table public.document_versions
  add column storage_bucket text,
  add column original_file_name text,
  add column mime_type text,
  add column file_size_bytes bigint,
  add column processing_status text not null
    default 'NOT_UPLOADED',
  add column processing_error text;

alter table public.document_versions
  add constraint document_versions_file_size_check
  check (
    file_size_bytes is null
    or (
      file_size_bytes > 0
      and file_size_bytes <= 52428800
    )
  );

alter table public.document_versions
  add constraint document_versions_processing_status_check
  check (
    processing_status in (
      'NOT_UPLOADED',
      'AWAITING_PROCESSING',
      'PROCESSING',
      'PROCESSED',
      'FAILED'
    )
  );


-- ============================================================
-- 2. PRIVATE STORAGE BUCKET
-- ============================================================

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'project-documents',
  'project-documents',
  false,
  52428800,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'text/plain',
    'application/xml',
    'text/xml',
    'application/vnd.ms-project',
    'image/jpeg',
    'image/png'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;


-- ============================================================
-- 3. STORAGE RLS
--
-- Object path:
--
-- projectId/documentId/documentVersionId/original-file
--
-- VIEWER: download
-- EDITOR/ADMIN: upload
--
-- No UPDATE policy:
-- files are immutable.
--
-- No DELETE policy:
-- historical evidence is preserved.
-- ============================================================

drop policy if exists
  "project_documents_storage_select_members"
  on storage.objects;

create policy
  "project_documents_storage_select_members"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'project-documents'
  and public.is_project_member(
    ((storage.foldername(name))[1])::uuid
  )
);


drop policy if exists
  "project_documents_storage_insert_editors"
  on storage.objects;

create policy
  "project_documents_storage_insert_editors"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'project-documents'
  and public.has_project_permission(
    ((storage.foldername(name))[1])::uuid,
    'EDITOR'
  )
);


-- ============================================================
-- 4. REGISTER UPLOADED DOCUMENT
--
-- Browser uploads only the binary object.
--
-- Database metadata is NEVER written directly from the browser.
-- This RPC:
--
-- - validates authenticated user
-- - validates project permission
-- - validates Storage object
-- - creates Document when necessary
-- - creates immutable DocumentVersion
-- - calculates next version_index
-- - registers uploader
-- - sets AWAITING_PROCESSING
-- - writes Audit Log
-- ============================================================

create or replace function public.register_project_document_upload(
  p_project_id uuid,
  p_document_id uuid,
  p_document_version_id uuid,
  p_kind text,
  p_title text,
  p_version_label text,
  p_document_date date,
  p_source_type text,
  p_author text,
  p_summary text,
  p_file_path text,
  p_original_file_name text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_user_id uuid;
  v_existing_project_id uuid;
  v_existing_kind text;
  v_existing_title text;
  v_version_index integer;
  v_is_new_document boolean := false;
  v_storage_object_exists boolean;
begin

  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;


  -- ----------------------------------------------------------
  -- Authorization
  -- ----------------------------------------------------------

  if not public.has_project_permission(
    p_project_id,
    'EDITOR'
  ) then
    raise exception
      'EDITOR or ADMIN permission required';
  end if;


  -- ----------------------------------------------------------
  -- Required values
  -- ----------------------------------------------------------

  if p_project_id is null
     or p_document_id is null
     or p_document_version_id is null then
    raise exception 'Invalid identifiers';
  end if;

  if nullif(trim(p_title), '') is null then
    raise exception 'Document title is required';
  end if;

  if nullif(trim(p_version_label), '') is null then
    raise exception 'Version label is required';
  end if;

  if p_document_date is null then
    raise exception 'Document date is required';
  end if;

  if nullif(trim(p_author), '') is null then
    raise exception 'Author is required';
  end if;

  if nullif(trim(p_summary), '') is null then
    raise exception 'Summary is required';
  end if;

  if nullif(trim(p_original_file_name), '') is null then
    raise exception 'Original file name is required';
  end if;

  if nullif(trim(p_mime_type), '') is null then
    raise exception 'MIME type is required';
  end if;


  -- ----------------------------------------------------------
  -- Domain validation
  -- ----------------------------------------------------------

  if p_kind not in (
    'CONTRATO_BASE',
    'ADITIVO',
    'EDITAL',
    'RFI',
    'RFP',
    'ESPECIFICACAO',
    'DESENHO',
    'PLANILHA',
    'CRONOGRAMA_BASELINE',
    'CRONOGRAMA_REVISAO',
    'RELATORIO_SEMANAL',
    'PROPOSTA_AXION',
    'CLARIFICACAO_CLIENTE'
  ) then
    raise exception 'Invalid document kind';
  end if;

  if p_source_type not in (
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
  ) then
    raise exception 'Invalid source type';
  end if;

  if p_file_size_bytes is null
     or p_file_size_bytes <= 0
     or p_file_size_bytes > 52428800 then
    raise exception
      'File size must be between 1 byte and 50 MiB';
  end if;


  -- ----------------------------------------------------------
  -- Immutable Storage path validation
  -- ----------------------------------------------------------

  if p_file_path not like (
    p_project_id::text
    || '/'
    || p_document_id::text
    || '/'
    || p_document_version_id::text
    || '/%'
  ) then
    raise exception
      'Invalid document Storage path';
  end if;


  select exists (
    select 1
    from storage.objects so
    where so.bucket_id = 'project-documents'
      and so.name = p_file_path
  )
  into v_storage_object_exists;

  if not v_storage_object_exists then
    raise exception
      'Uploaded Storage object was not found';
  end if;


  -- ----------------------------------------------------------
  -- Serialize version-number allocation per Document
  -- ----------------------------------------------------------

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_document_id::text,
      0
    )
  );


  -- ----------------------------------------------------------
  -- Existing or new Document
  -- ----------------------------------------------------------

  select
    d.project_id,
    d.kind,
    d.title
  into
    v_existing_project_id,
    v_existing_kind,
    v_existing_title
  from public.documents d
  where d.id = p_document_id
  for update;


  if found then

    if v_existing_project_id <> p_project_id then
      raise exception
        'Document belongs to another project';
    end if;

    if v_existing_kind <> p_kind then
      raise exception
        'Document kind does not match existing document';
    end if;

    if v_existing_title <> trim(p_title) then
      raise exception
        'Document title does not match existing document';
    end if;

  else

    insert into public.documents (
      id,
      project_id,
      kind,
      title
    )
    values (
      p_document_id,
      p_project_id,
      p_kind,
      trim(p_title)
    );

    v_is_new_document := true;

  end if;


  -- ----------------------------------------------------------
  -- Version index
  -- ----------------------------------------------------------

  select
    coalesce(max(dv.version_index), 0) + 1
  into v_version_index
  from public.document_versions dv
  where dv.document_id = p_document_id;


  if exists (
    select 1
    from public.document_versions dv
    where dv.document_id = p_document_id
      and dv.version_label = trim(p_version_label)
  ) then
    raise exception
      'Version label already exists for this document';
  end if;


  -- ----------------------------------------------------------
  -- Document Version
  -- ----------------------------------------------------------

  insert into public.document_versions (
    id,
    document_id,
    version_label,
    version_index,
    document_date,
    source_type,
    author,
    summary,
    file_path,
    uploaded_by,
    notes,
    storage_bucket,
    original_file_name,
    mime_type,
    file_size_bytes,
    processing_status,
    processing_error
  )
  values (
    p_document_version_id,
    p_document_id,
    trim(p_version_label),
    v_version_index,
    p_document_date,
    p_source_type,
    trim(p_author),
    trim(p_summary),
    p_file_path,
    v_user_id,
    nullif(trim(p_notes), ''),
    'project-documents',
    trim(p_original_file_name),
    trim(p_mime_type),
    p_file_size_bytes,
    'AWAITING_PROCESSING',
    null
  );


  -- ----------------------------------------------------------
  -- Audit
  -- ----------------------------------------------------------

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
    p_project_id,
    'USER',
    v_user_id,
    null,
    case
      when v_is_new_document
        then 'PROJECT_DOCUMENT_UPLOADED'
      else 'PROJECT_DOCUMENT_VERSION_UPLOADED'
    end,
    'DOCUMENT_VERSION',
    p_document_version_id::text,
    format(
      'Document "%s", version "%s", file "%s".',
      trim(p_title),
      trim(p_version_label),
      trim(p_original_file_name)
    )
  );


  return p_document_version_id;

end;
$$;


revoke all
on function public.register_project_document_upload(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  date,
  text,
  text,
  text,
  text,
  text,
  text,
  bigint,
  text
)
from public;

revoke all
on function public.register_project_document_upload(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  date,
  text,
  text,
  text,
  text,
  text,
  text,
  bigint,
  text
)
from anon;

grant execute
on function public.register_project_document_upload(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  date,
  text,
  text,
  text,
  text,
  text,
  text,
  bigint,
  text
)
to authenticated;
