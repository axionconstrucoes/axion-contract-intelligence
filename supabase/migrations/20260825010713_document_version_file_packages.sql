-- ============================================================
-- ACC - PACOTES DOCUMENTAIS / MULTIPLOS ARQUIVOS POR VERSAO
-- ============================================================

create table public.document_version_files (
  id uuid primary key default gen_random_uuid(),

  document_version_id uuid not null
    references public.document_versions (id)
    on delete cascade,

  file_role text not null
    check (
      file_role in (
        'PRINCIPAL',
        'ANEXO_CONTRATUAL',
        'EVIDENCIA_APROVACAO',
        'DOCUMENTO_APOIO'
      )
    ),

  original_file_name text not null,
  mime_type text not null,

  file_size_bytes bigint not null
    check (
      file_size_bytes > 0
      and file_size_bytes <= 52428800
    ),

  sha256_hash text
    check (
      sha256_hash is null
      or sha256_hash ~ '^[0-9a-f]{64}$'
    ),

  storage_bucket text not null
    default 'project-documents',

  storage_path text not null,

  origin text not null
    default 'UPLOAD',

  description text,

  processing_status text not null
    default 'AWAITING_PROCESSING',

  processing_error text,

  replaces_file_id uuid
    references public.document_version_files (id)
    on delete set null,

  uploaded_by uuid
    references public.profiles (id)
    on delete set null,

  uploaded_at timestamptz not null
    default now(),

  unique (storage_bucket, storage_path)
);
create index
  document_version_files_document_version_idx
on public.document_version_files (
  document_version_id,
  uploaded_at
);
create index
  document_version_files_role_idx
on public.document_version_files (
  document_version_id,
  file_role
);
create unique index
  document_version_files_one_principal_idx
on public.document_version_files (
  document_version_id
)
where file_role = 'PRINCIPAL';
-- ============================================================
-- RLS
-- Leitura: qualquer membro do projeto.
-- Escrita: somente via RPC controlada abaixo.
-- ============================================================

alter table
  public.document_version_files
enable row level security;
create policy
  "document_version_files_select_project_members"
on public.document_version_files
for select
to authenticated
using (
  exists (
    select 1
    from public.document_versions dv
    join public.documents d
      on d.id = dv.document_id
    where
      dv.id =
        document_version_files.document_version_id
      and public.is_project_member(d.project_id)
  )
);
grant select
on public.document_version_files
to authenticated;
-- ============================================================
-- BACKFILL
-- Arquivos principais que ja existem em document_versions
-- passam a aparecer tambem no pacote documental.
-- Nao altera nem remove os dados antigos.
-- ============================================================

insert into public.document_version_files (
  document_version_id,
  file_role,
  original_file_name,
  mime_type,
  file_size_bytes,
  sha256_hash,
  storage_bucket,
  storage_path,
  origin,
  description,
  processing_status,
  processing_error,
  uploaded_by,
  uploaded_at
)
select
  dv.id,
  'PRINCIPAL',
  dv.original_file_name,
  dv.mime_type,
  dv.file_size_bytes,
  null,
  coalesce(
    dv.storage_bucket,
    'project-documents'
  ),
  dv.file_path,
  dv.source_type,
  'Arquivo principal da versão documental.',
  dv.processing_status,
  dv.processing_error,
  dv.uploaded_by,
  dv.uploaded_at
from public.document_versions dv
where
  dv.file_path is not null
  and dv.file_path <> ''
  and dv.original_file_name is not null
  and dv.original_file_name <> ''
  and dv.mime_type is not null
  and dv.mime_type <> ''
  and dv.file_size_bytes is not null
  and dv.file_size_bytes > 0
on conflict do nothing;
-- ============================================================
-- SINCRONIZACAO DO ARQUIVO PRINCIPAL
--
-- Mantem compatibilidade com o fluxo atual:
-- register_project_document_version continua funcionando.
-- Toda nova document_version com arquivo principal passa
-- automaticamente a ter seu registro PRINCIPAL no pacote.
-- ============================================================

create or replace function
public.sync_document_version_principal_file()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if
    new.file_path is null
    or new.file_path = ''
    or new.original_file_name is null
    or new.original_file_name = ''
    or new.mime_type is null
    or new.mime_type = ''
    or new.file_size_bytes is null
    or new.file_size_bytes <= 0
  then
    return new;
  end if;

  update public.document_version_files
  set
    original_file_name =
      new.original_file_name,
    mime_type =
      new.mime_type,
    file_size_bytes =
      new.file_size_bytes,
    storage_bucket =
      coalesce(
        new.storage_bucket,
        'project-documents'
      ),
    storage_path =
      new.file_path,
    origin =
      new.source_type,
    processing_status =
      new.processing_status,
    processing_error =
      new.processing_error
  where
    document_version_id = new.id
    and file_role = 'PRINCIPAL';

  if not found then
    insert into public.document_version_files (
      document_version_id,
      file_role,
      original_file_name,
      mime_type,
      file_size_bytes,
      storage_bucket,
      storage_path,
      origin,
      description,
      processing_status,
      processing_error,
      uploaded_by,
      uploaded_at
    )
    values (
      new.id,
      'PRINCIPAL',
      new.original_file_name,
      new.mime_type,
      new.file_size_bytes,
      coalesce(
        new.storage_bucket,
        'project-documents'
      ),
      new.file_path,
      new.source_type,
      'Arquivo principal da versão documental.',
      new.processing_status,
      new.processing_error,
      new.uploaded_by,
      new.uploaded_at
    );
  end if;

  return new;
end;
$$;
drop trigger if exists
  document_version_sync_principal_file
on public.document_versions;
create trigger
  document_version_sync_principal_file
after insert or update of
  file_path,
  storage_bucket,
  original_file_name,
  mime_type,
  file_size_bytes,
  processing_status,
  processing_error,
  source_type
on public.document_versions
for each row
execute function
  public.sync_document_version_principal_file();
-- ============================================================
-- RPC: ADICIONAR ARQUIVO COMPLEMENTAR
-- Apenas ADMINISTRADOR.
--
-- PRINCIPAL nao entra por esta RPC:
-- continua sendo criado pelo fluxo normal de document_versions.
-- ============================================================

create or replace function
public.register_document_version_file(
  p_document_version_id uuid,
  p_file_role text,
  p_storage_path text,
  p_original_file_name text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_sha256_hash text,
  p_origin text default 'UPLOAD',
  p_description text default null,
  p_replaces_file_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_project_id uuid;
  v_document_id uuid;
  v_file_id uuid;
  v_expected_prefix text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception
      'Authentication required';
  end if;

  select
    d.project_id,
    d.id
  into
    v_project_id,
    v_document_id
  from public.document_versions dv
  join public.documents d
    on d.id = dv.document_id
  where
    dv.id = p_document_version_id;

  if v_project_id is null then
    raise exception
      'Document version not found';
  end if;

  if not public.has_project_permission(
    v_project_id,
    'ADMINISTRADOR'
  ) then
    raise exception
      'ADMINISTRADOR permission required';
  end if;

  if p_file_role not in (
    'ANEXO_CONTRATUAL',
    'EVIDENCIA_APROVACAO',
    'DOCUMENTO_APOIO'
  ) then
    raise exception
      'Invalid supplemental file role';
  end if;

  if
    p_original_file_name is null
    or btrim(p_original_file_name) = ''
  then
    raise exception
      'Original file name is required';
  end if;

  if
    p_mime_type is null
    or btrim(p_mime_type) = ''
  then
    raise exception
      'MIME type is required';
  end if;

  if
    p_file_size_bytes is null
    or p_file_size_bytes <= 0
    or p_file_size_bytes > 52428800
  then
    raise exception
      'Invalid file size';
  end if;

  if
    p_sha256_hash is null
    or p_sha256_hash !~* '^[0-9a-f]{64}$'
  then
    raise exception
      'Valid SHA-256 hash is required';
  end if;

  v_expected_prefix :=
    v_project_id::text
    || '/'
    || v_document_id::text
    || '/'
    || p_document_version_id::text
    || '/';

  if
    p_storage_path is null
    or position(
      v_expected_prefix
      in p_storage_path
    ) <> 1
  then
    raise exception
      'Storage path does not belong to document version';
  end if;

  if
    p_origin is null
    or btrim(p_origin) = ''
  then
    raise exception
      'Origin is required';
  end if;

  if p_replaces_file_id is not null then
    if not exists (
      select 1
      from public.document_version_files f
      where
        f.id = p_replaces_file_id
        and f.document_version_id =
          p_document_version_id
    ) then
      raise exception
        'Replacement file does not belong to document version';
    end if;
  end if;

  insert into public.document_version_files (
    document_version_id,
    file_role,
    original_file_name,
    mime_type,
    file_size_bytes,
    sha256_hash,
    storage_bucket,
    storage_path,
    origin,
    description,
    processing_status,
    replaces_file_id,
    uploaded_by
  )
  values (
    p_document_version_id,
    p_file_role,
    btrim(p_original_file_name),
    btrim(p_mime_type),
    p_file_size_bytes,
    lower(p_sha256_hash),
    'project-documents',
    p_storage_path,
    btrim(p_origin),
    nullif(
      btrim(coalesce(p_description, '')),
      ''
    ),
    'AWAITING_PROCESSING',
    p_replaces_file_id,
    v_user_id
  )
  returning id
  into v_file_id;

  insert into public.audit_log_entries (
    project_id,
    actor_type,
    actor_user_id,
    actor_label,
    action,
    entity_type,
    entity_id,
    detail,
    occurred_at
  )
  values (
    v_project_id,
    'USER',
    v_user_id,
    null,
    'DOCUMENT_VERSION_FILE_ADDED',
    'DOCUMENT_VERSION_FILE',
    v_file_id::text,
    format(
      'Arquivo %s adicionado à versão %s. Papel: %s. Origem: %s. SHA-256: %s.',
      p_original_file_name,
      p_document_version_id,
      p_file_role,
      p_origin,
      lower(p_sha256_hash)
    ),
    now()
  );

  return v_file_id;
end;
$$;
revoke all
on function
public.register_document_version_file(
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  text,
  text,
  text,
  uuid
)
from public;
grant execute
on function
public.register_document_version_file(
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  text,
  text,
  text,
  uuid
)
to authenticated;
-- ============================================================
-- ORPHAN CLEANUP
--
-- Um arquivo complementar registrado também deixa de ser
-- considerado objeto órfão no Storage.
-- ============================================================

create or replace function
public.is_unregistered_project_document_object(
  p_object_name text
)
returns boolean
language sql
stable
security definer
set search_path = public, storage
as $$
  select
    not exists (
      select 1
      from public.document_versions dv
      where
        dv.storage_bucket =
          'project-documents'
        and dv.file_path =
          p_object_name
    )
    and
    not exists (
      select 1
      from public.document_version_files f
      where
        f.storage_bucket =
          'project-documents'
        and f.storage_path =
          p_object_name
    );
$$;
-- ============================================================
-- FIM
-- ============================================================;
