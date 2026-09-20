-- EMAIL as a first-class project document kind.
-- Distinct from CLARIFICACAO_CLIENTE (Resposta/Aprovação do cliente)
-- and from source_type EMAIL (origin/channel of a document version).
--
-- Lista de kinds = TODOS os valores aceitos pela constraint vigente
-- (20260829180000_document_relation_hierarchy: 24 valores, incluindo
-- QUESTIONARIO_BID e COMPLEMENTO_CIRCULAR da hierarquia do BID) + EMAIL
-- = 25 valores. Nenhum valor é removido. A allowlist da RPC
-- register_project_document_upload abaixo usa exatamente o mesmo
-- conjunto (paridade coberta por scripts/test-email-document-kind-migration.mjs).

alter table public.documents
  drop constraint documents_kind_check;

alter table public.documents
  add constraint documents_kind_check
  check (kind in (
    'CONTRATO_BASE', 'ADITIVO', 'EDITAL', 'RFI', 'RFP', 'ESPECIFICACAO',
    'DESENHO', 'PLANILHA', 'CRONOGRAMA_BASELINE', 'CRONOGRAMA_REVISAO',
    'RELATORIO_SEMANAL', 'PROPOSTA_AXION', 'CLARIFICACAO_CLIENTE', 'EMAIL',
    'ATA_REUNIAO', 'PROPOSTA_COMERCIAL', 'PROPOSTA_TECNICA',
    'PLANILHA_CONTRATUAL', 'RELATORIO', 'NOTIFICACAO', 'ESG_SSMA',
    'DIARIO_OBRA', 'QUESTIONARIO_BID', 'COMPLEMENTO_CIRCULAR', 'OUTRO'
  ));

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
  p_notes text default null,
  p_sha256_hash text default null
)
returns uuid
language plpgsql
security definer
-- search_path vazio (estado vigente em produção): toda referência a
-- objetos é qualificada (public.*, storage.*, auth.*); built-ins vêm de
-- pg_catalog, sempre implícito.
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_existing_project_id uuid;
  v_existing_kind text;
  v_existing_title text;
  v_version_index integer;
  v_is_new_document boolean := false;
  v_storage_object_exists boolean;
  v_requires_human_review boolean;
  v_conflicting_constraint text;
begin

  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;


  -- ----------------------------------------------------------
  -- Authorization
  --
  -- Decisão de negócio (não a hierarquia global de
  -- has_project_permission, que continua intocada): upload de
  -- documentos é permitido para membership ACTIVE com permission
  -- ADMINISTRADOR ou GESTOR — ver can_manage_project_documents acima.
  -- COLABORADOR, LEITURA, qualquer membership INACTIVE e usuário sem
  -- membership continuam bloqueados incondicionalmente.
  -- ----------------------------------------------------------

  if not public.can_manage_project_documents(p_project_id) then
    raise exception
      'ADMINISTRADOR or GESTOR permission required';
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
    'CONTRATO_BASE', 'ADITIVO', 'EDITAL', 'RFI', 'RFP', 'ESPECIFICACAO',
    'DESENHO', 'PLANILHA', 'CRONOGRAMA_BASELINE', 'CRONOGRAMA_REVISAO',
    'RELATORIO_SEMANAL', 'PROPOSTA_AXION', 'CLARIFICACAO_CLIENTE', 'EMAIL',
    'ATA_REUNIAO', 'PROPOSTA_COMERCIAL', 'PROPOSTA_TECNICA',
    'PLANILHA_CONTRATUAL', 'RELATORIO', 'NOTIFICACAO', 'ESG_SSMA',
    'DIARIO_OBRA', 'QUESTIONARIO_BID', 'COMPLEMENTO_CIRCULAR', 'OUTRO'
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
    'ORCAMENTO',
    'UPLOAD_MANUAL'
  ) then
    raise exception 'Invalid source type';
  end if;

  if p_file_size_bytes is null
     or p_file_size_bytes <= 0
     or p_file_size_bytes > 52428800 then
    raise exception
      'File size must be between 1 byte and 50 MiB';
  end if;

  if p_sha256_hash is not null
     and p_sha256_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid file hash';
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
  -- Deduplicação por conteúdo — ATALHO, não a garantia.
  --
  -- Este SELECT antecipado só existe para dar um erro rápido e
  -- amigável no caso comum (não-concorrente): evita gastar o
  -- advisory lock e a numeração de versão para um upload que já sabe
  -- que vai falhar. Sob concorrência real (dois uploads simultâneos
  -- do mesmo hash), as duas transações podem passar por este SELECT
  -- sem ver a outra (nenhuma commitou ainda) — a garantia de verdade
  -- é o índice único document_versions_project_hash_unique_idx,
  -- checado no INSERT mais abaixo, que é onde o Postgres de fato
  -- serializa e rejeita a segunda transação.
  -- ----------------------------------------------------------

  if p_sha256_hash is not null and exists (
    select 1
    from public.document_versions dv
    join public.documents d on d.id = dv.document_id
    where d.project_id = p_project_id
      and dv.sha256_hash = p_sha256_hash
  ) then
    raise exception
      'DUPLICATE_FILE_HASH: identical file content already exists in this project';
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

  v_requires_human_review := (p_kind = 'ATA_REUNIAO');

  -- A GARANTIA REAL de deduplicação sob concorrência: o índice único
  -- document_versions_project_hash_unique_idx (project_id não é
  -- passado aqui — é sempre calculado pelo trigger
  -- set_document_version_project_id, nunca confiado ao chamador).
  -- Se duas transações concorrentes chegarem aqui com o mesmo hash no
  -- mesmo projeto, o Postgres deixa exatamente uma committar; a outra
  -- recebe unique_violation, convertido abaixo na mesma mensagem
  -- DUPLICATE_FILE_HASH do atalho não-concorrente acima.
  begin
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
      processing_error,
      sha256_hash,
      requires_human_review
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
      null,
      p_sha256_hash,
      v_requires_human_review
    );
  exception
    when unique_violation then
      get stacked diagnostics v_conflicting_constraint = constraint_name;

      if v_conflicting_constraint = 'document_versions_project_hash_unique_idx' then
        raise exception
          'DUPLICATE_FILE_HASH: identical file content already exists in this project';
      end if;

      -- Qualquer outra violação de unicidade (ex.: version_label
      -- duplicado, checado acima mas ainda sujeito à mesma janela de
      -- corrida) mantém sua mensagem original — não mascarada como
      -- duplicidade de conteúdo.
      raise;
  end;


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


-- ============================================================
-- Privilégios: restaura exatamente o estado hoje em produção,
-- confirmado por consulta read-only a pg_proc antes desta migration
-- ser escrita:
--
--   owner:            postgres
--   security definer: true
--   acl:              postgres=X/postgres, authenticated=X/postgres,
--                      service_role=X/postgres
--                      (sem anon, sem PUBLIC)
--
-- O DROP FUNCTION acima apaga essa ACL inteira — Postgres cria toda
-- function nova com EXECUTE aberto para PUBLIC por padrão. Os REVOKE
-- abaixo fecham isso na mesma transação da migration (nunca existe
-- uma janela em que a function fica mais aberta do que deveria), e os
-- GRANT restauram authenticated + service_role explicitamente — nada
-- a mais do que já existia, nada a menos.
-- ============================================================

alter function public.register_project_document_upload(
  uuid, uuid, uuid, text, text, text, date, text, text, text,
  text, text, text, bigint, text, text
) owner to postgres;

revoke all
on function public.register_project_document_upload(
  uuid, uuid, uuid, text, text, text, date, text, text, text,
  text, text, text, bigint, text, text
)
from public;

revoke all
on function public.register_project_document_upload(
  uuid, uuid, uuid, text, text, text, date, text, text, text,
  text, text, text, bigint, text, text
)
from anon;

grant execute
on function public.register_project_document_upload(
  uuid, uuid, uuid, text, text, text, date, text, text, text,
  text, text, text, bigint, text, text
)
to authenticated;

grant execute
on function public.register_project_document_upload(
  uuid, uuid, uuid, text, text, text, date, text, text, text,
  text, text, text, bigint, text, text
)
to service_role;

notify pgrst, 'reload schema';
