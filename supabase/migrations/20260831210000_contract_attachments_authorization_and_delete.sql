-- ============================================================
-- 20260831210000_contract_attachments_authorization_and_delete.sql
-- "ANEXOS DO CONTRATO" — reaproveita integralmente a infraestrutura já
-- existente (document_version_files, migration 20260825010713) para o
-- file_role já previsto ali para exatamente este fim: ANEXO_CONTRATUAL.
-- Nenhuma tabela nova, nenhum pipeline paralelo de Storage.
--
-- Esta migration faz três coisas, todas escopadas estritamente a
-- file_role = 'ANEXO_CONTRATUAL' (EVIDENCIA_APROVACAO/DOCUMENTO_APOIO/
-- PRINCIPAL continuam com o comportamento anterior, intocado):
--
--   1. Nova função can_add_contract_attachment — decisão de negócio
--      isolada (mesmo padrão de can_manage_project_documents, migration
--      20260825130000): ADMINISTRADOR, GESTOR, GERENTE OU COLABORADOR
--      (qualquer membership ACTIVE exceto LEITURA) pode ADICIONAR um
--      anexo contratual. Excluir continua restrito a
--      can_manage_project_documents (ADMINISTRADOR/GESTOR/GERENTE) —
--      reaproveitada sem alteração.
--
--   2. register_document_version_file passa a ramificar a autorização
--      por p_file_role: ANEXO_CONTRATUAL usa can_add_contract_attachment
--      (novo, mais permissivo); EVIDENCIA_APROVACAO/DOCUMENTO_APOIO
--      continuam exigindo ADMINISTRADOR (comportamento herdado,
--      inalterado). Esta function tem agora um chamador legítimo real
--      pela primeira vez (a investigação de 2026-08-30 que revogou
--      authenticated encontrou zero chamador — ver migration
--      20260830100000) — o EXECUTE para authenticated é restaurado
--      aqui, com justificativa explícita. anon permanece revogado.
--
--   3. Nova RPC delete_contract_attachment — exclusão real (não
--      reversível/lixeira, diferente de trash_project_document: é
--      exatamente o que a decisão de negócio desta rodada pede),
--      escopada SOMENTE a file_role = 'ANEXO_CONTRATUAL' (nunca
--      PRINCIPAL, nunca EVIDENCIA_APROVACAO/DOCUMENTO_APOIO por este
--      caminho). Remove só a linha de metadado; o objeto de Storage é
--      deliberadamente PRESERVADO (nunca apagado) — mesma filosofia já
--      documentada no bucket project-documents ("No DELETE policy:
--      historical evidence is preserved", migration 20260821004108) e
--      em trash_project_document ("nada é apagado, nenhum arquivo de
--      Storage é tocado"). Bloqueia a exclusão quando a VERSÃO à qual o
--      anexo pertence está referenciada como evidência em
--      event_evidence — granularidade de versão, não de arquivo
--      individual (event_evidence não referencia document_version_files
--      diretamente; é a única proteção real disponível no schema hoje,
--      documentada explicitamente aqui em vez de fingida como
--      arquivo-a-arquivo).
--
-- Deduplicação por conteúdo dentro do mesmo anexo contratual: índice
-- único parcial (document_version_id, sha256_hash) WHERE file_role =
-- 'ANEXO_CONTRATUAL' — mesma garantia real (não só um SELECT prévio)
-- já usada em document_versions_project_hash_unique_idx (migration
-- 20260825130000), agora também aqui, para que uma reenvio/retentativa
-- do mesmo arquivo nunca crie uma segunda linha.
-- ============================================================


-- ---------- 1. can_add_contract_attachment ----------

create or replace function public.can_add_contract_attachment(
  p_project_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_memberships pm
    where pm.project_id = p_project_id
      and pm.user_id = auth.uid()
      and pm.status = 'ACTIVE'
      and pm.permission in ('ADMINISTRADOR', 'GESTOR', 'GERENTE', 'COLABORADOR')
  );
$$;

alter function public.can_add_contract_attachment(uuid) owner to postgres;
revoke all on function public.can_add_contract_attachment(uuid) from public;
revoke all on function public.can_add_contract_attachment(uuid) from anon;
grant execute on function public.can_add_contract_attachment(uuid) to authenticated;


-- ---------- 2. Índice único de deduplicação (só ANEXO_CONTRATUAL) ----------

create unique index document_version_files_contract_attachment_hash_idx
  on public.document_version_files (document_version_id, sha256_hash)
  where file_role = 'ANEXO_CONTRATUAL' and sha256_hash is not null;


-- ---------- 3. register_document_version_file — autorização ramificada por papel ----------
-- Corpo idêntico ao original (migration 20260825010713), exceto:
--   a) a checagem de autorização agora ramifica por p_file_role;
--   b) o INSERT final é envolto em BEGIN/EXCEPTION para traduzir a
--      violação do novo índice único acima numa mensagem clara,
--      seguindo o mesmo padrão já usado por
--      register_project_document_upload/DUPLICATE_FILE_HASH.

create or replace function public.register_document_version_file(
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
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_project_id uuid;
  v_document_id uuid;
  v_file_id uuid;
  v_expected_prefix text;
  v_authorized boolean;
  v_conflicting_constraint text;
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

  if p_file_role not in (
    'ANEXO_CONTRATUAL',
    'EVIDENCIA_APROVACAO',
    'DOCUMENTO_APOIO'
  ) then
    raise exception
      'Invalid supplemental file role';
  end if;

  -- Decisão de negócio desta rodada: ANEXO_CONTRATUAL aceita
  -- ADMINISTRADOR/GESTOR/GERENTE/COLABORADOR (can_add_contract_attachment).
  -- EVIDENCIA_APROVACAO/DOCUMENTO_APOIO continuam ADMINISTRADOR-only,
  -- comportamento herdado da migration original, inalterado.
  if p_file_role = 'ANEXO_CONTRATUAL' then
    v_authorized := public.can_add_contract_attachment(v_project_id);
  else
    v_authorized := public.has_project_permission(v_project_id, 'ADMINISTRADOR');
  end if;

  if not v_authorized then
    raise exception
      'Insufficient permission for this file role';
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

  begin
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
  exception
    when unique_violation then
      get stacked diagnostics v_conflicting_constraint = constraint_name;

      if v_conflicting_constraint = 'document_version_files_contract_attachment_hash_idx' then
        raise exception
          'DUPLICATE_ATTACHMENT_HASH: identical file content already exists as a contract attachment on this version';
      end if;

      -- (storage_bucket, storage_path) já é único desde a migration
      -- original — mantém a mensagem genérica do Postgres para
      -- qualquer outra violação de unicidade, nunca mascarada como
      -- duplicidade de conteúdo.
      raise;
  end;

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

alter function public.register_document_version_file(
  uuid, text, text, text, text, bigint, text, text, text, uuid
) owner to postgres;

-- Restaura EXECUTE para authenticated: esta function agora tem um
-- chamador legítimo real (o painel "Anexos do Contrato"). anon
-- permanece revogado; service_role mantido para uso server-side futuro.
revoke all
on function public.register_document_version_file(
  uuid, text, text, text, text, bigint, text, text, text, uuid
)
from public;

revoke all
on function public.register_document_version_file(
  uuid, text, text, text, text, bigint, text, text, text, uuid
)
from anon;

grant execute
on function public.register_document_version_file(
  uuid, text, text, text, text, bigint, text, text, text, uuid
)
to authenticated;

grant execute
on function public.register_document_version_file(
  uuid, text, text, text, text, bigint, text, text, text, uuid
)
to service_role;


-- ---------- 4. delete_contract_attachment ----------

create or replace function public.delete_contract_attachment(
  p_file_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_document_id uuid;
  v_document_version_id uuid;
  v_file_role text;
  v_original_file_name text;
  v_storage_bucket text;
  v_storage_path text;
begin
  if v_user_id is null then
    raise exception
      'Sessão não autenticada.';
  end if;

  select
    d.project_id,
    d.id,
    dv.id,
    f.file_role,
    f.original_file_name,
    f.storage_bucket,
    f.storage_path
  into
    v_project_id,
    v_document_id,
    v_document_version_id,
    v_file_role,
    v_original_file_name,
    v_storage_bucket,
    v_storage_path
  from public.document_version_files f
  join public.document_versions dv
    on dv.id = f.document_version_id
  join public.documents d
    on d.id = dv.document_id
  where f.id = p_file_id
  for update of f;

  if v_project_id is null then
    raise exception
      'Anexo não encontrado.';
  end if;

  -- Mesma decisão de negócio de can_manage_project_documents
  -- (ADMINISTRADOR/GERENTE — GESTOR é o mesmo papel sob o nome legado,
  -- membership antiga nunca convertida automaticamente: ver migration
  -- 20260829200000_project_permission_gerente_compat.sql) —
  -- COLABORADOR e LEITURA nunca excluem, mesmo podendo adicionar.
  if not public.can_manage_project_documents(v_project_id) then
    raise exception
      'ADMINISTRADOR or GERENTE permission required to remove a contract attachment.';
  end if;

  -- Nunca o arquivo principal do contrato, nunca outros papéis por este
  -- caminho — esta RPC é estritamente escopada a anexos contratuais.
  if v_file_role <> 'ANEXO_CONTRATUAL' then
    raise exception
      'This RPC only removes ANEXO_CONTRATUAL files.';
  end if;

  -- ------------------------------------------------------------
  -- Proteção de evidência/confronto/registro protegido — MESMAS
  -- QUATRO checagens já usadas por trash_project_document (migration
  -- 20260829150000), aplicadas aqui a um anexo individual em vez de ao
  -- documento inteiro. Granularidade real disponível no schema hoje:
  --   1) event_evidence — por VERSÃO (não existe vínculo por arquivo
  --      individual; qualquer anexo da versão referenciada como
  --      evidência fica protegido, por segurança);
  --   2) event_cross_references.document_id — por DOCUMENTO (a coluna
  --      não distingue versão; qualquer cross-reference ao documento
  --      bloqueia, mesma regra de trash_project_document);
  --   3) event_cross_references.clause_id -> clauses.document_version_id
  --      — por VERSÃO;
  --   4) project_additional_proposal_links.document_version_id — por
  --      VERSÃO (vínculo com Proposta de Adicional).
  -- Nunca finge granularidade de arquivo que o schema não tem —
  -- documentado aqui, não escondido.
  -- ------------------------------------------------------------

  if exists (
    select 1
    from public.event_evidence ee
    where ee.document_version_id = v_document_version_id
  ) then
    raise exception
      'Não é possível remover: a versão deste documento está referenciada como evidência de um evento do Event Ledger.';
  end if;

  if exists (
    select 1
    from public.event_cross_references ecr
    where ecr.document_id = v_document_id
  ) then
    raise exception
      'Não é possível remover: existe referência direta a este documento no Event Ledger.';
  end if;

  if exists (
    select 1
    from public.event_cross_references ecr
    join public.clauses c
      on c.id = ecr.clause_id
    where c.document_version_id = v_document_version_id
  ) then
    raise exception
      'Não é possível remover: uma cláusula desta versão está referenciada no Event Ledger (evento, finding ou confronto).';
  end if;

  if exists (
    select 1
    from public.project_additional_proposal_links papl
    where papl.document_version_id = v_document_version_id
  ) then
    raise exception
      'Não é possível remover: esta versão está vinculada a uma Proposta de Adicional.';
  end if;

  delete from public.document_version_files
  where id = p_file_id;

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
    'DOCUMENT_VERSION_FILE_DELETED',
    'DOCUMENT_VERSION_FILE',
    p_file_id::text,
    format(
      'Anexo contratual "%s" removido da visualização (documento %s). O arquivo histórico permanece preservado no Storage para auditoria (%s/%s) — só o vínculo/metadado foi removido, nunca o objeto físico.',
      v_original_file_name,
      v_document_id,
      v_storage_bucket,
      v_storage_path
    ),
    now()
  );
end;
$$;

alter function public.delete_contract_attachment(uuid) owner to postgres;
revoke all on function public.delete_contract_attachment(uuid) from public;
revoke all on function public.delete_contract_attachment(uuid) from anon;
grant execute on function public.delete_contract_attachment(uuid) to authenticated;

notify pgrst, 'reload schema';
