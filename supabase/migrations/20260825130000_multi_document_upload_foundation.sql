-- ============================================================
-- 20260825130000_multi_document_upload_foundation.sql
-- Fundação para upload múltiplo de documentos (fila com dedup,
-- classificação NOVO/NOVA_VERSAO/DUPLICADO/CONFLITO e Ata de Reunião).
--
-- Aditivo puro nos dados: nenhum valor existente de kind/source_type
-- é removido ou renomeado, nenhuma coluna existente é alterada. O
-- upload individual existente (document-upload-form.tsx) continua
-- chamando a mesma RPC sem nenhuma alteração de código — mas a
-- ASSINATURA da RPC no banco é substituída (DROP explícito da versão
-- de 15 parâmetros + CREATE de uma versão de 16, nunca duas
-- coexistindo): ver seção 4 para o motivo exato.
-- ============================================================


-- ============================================================
-- 1. NOVOS TIPOS DOCUMENTAIS (documents.kind) — aditivo
-- ============================================================

alter table public.documents
  drop constraint documents_kind_check;

alter table public.documents
  add constraint documents_kind_check
  check (kind in (
    -- valores históricos, inalterados
    'CONTRATO_BASE', 'ADITIVO', 'EDITAL', 'RFI', 'RFP', 'ESPECIFICACAO',
    'DESENHO', 'PLANILHA', 'CRONOGRAMA_BASELINE', 'CRONOGRAMA_REVISAO',
    'RELATORIO_SEMANAL', 'PROPOSTA_AXION', 'CLARIFICACAO_CLIENTE',
    -- novos, para o seletor de tipo documental do upload múltiplo
    'ATA_REUNIAO', 'PROPOSTA_COMERCIAL', 'PROPOSTA_TECNICA',
    'PLANILHA_CONTRATUAL', 'RELATORIO', 'NOTIFICACAO', 'ESG_SSMA',
    'DIARIO_OBRA', 'OUTRO'
  ));


-- ============================================================
-- 2. NOVA ORIGEM (document_versions.source_type) — aditivo
--
-- Nenhum dos valores existentes descreve "enviado manualmente pelo
-- próprio usuário, sem canal de origem específico" — que é
-- exatamente o caso do upload múltiplo por arrastar-e-soltar.
-- ============================================================

alter table public.document_versions
  drop constraint document_versions_source_type_check;

alter table public.document_versions
  add constraint document_versions_source_type_check
  check (source_type in (
    'EMAIL', 'DIARIO_OBRA', 'CONSTRUMANAGER', 'CONTRATO', 'GOOGLE_DRIVE',
    'RECEBIDOS_CLIENTE', 'EDITAL_RFI_RFP', 'CRONOGRAMA',
    'RELATORIO_SEMANAL', 'ERP', 'ORCAMENTO',
    'UPLOAD_MANUAL'
  ));


-- ============================================================
-- 3. HASH DE CONTEÚDO, REVISÃO HUMANA E PROJECT_ID DESNORMALIZADO
--
-- document_versions não tem project_id direto (só via join com
-- documents). Deduplicação por hash precisa ser escopada por projeto
-- e garantida por um ÍNDICE ÚNICO real do Postgres — um SELECT antes
-- do INSERT não é suficiente sob concorrência (duas transações
-- simultâneas podem passar pelo mesmo SELECT antes de qualquer uma
-- commitar). Por isso: desnormaliza project_id aqui, sempre populado
-- por trigger (nunca por parâmetro do cliente, nunca esquecido por um
-- futuro caminho de escrita) e cria índice único parcial
-- (project_id, sha256_hash) — essa é a garantia real, não a checagem
-- antecipada abaixo (que continua existindo só como atalho para uma
-- mensagem de erro mais rápida no caso comum, não-concorrente).
-- ============================================================

alter table public.document_versions
  add column project_id uuid references public.projects (id) on delete cascade,
  add column sha256_hash text,
  add column requires_human_review boolean not null default false;

update public.document_versions dv
set project_id = d.project_id
from public.documents d
where d.id = dv.document_id
  and dv.project_id is null;

alter table public.document_versions
  alter column project_id set not null;

alter table public.document_versions
  add constraint document_versions_sha256_hash_format_check
  check (sha256_hash is null or sha256_hash ~ '^[0-9a-f]{64}$');

-- Garante que project_id NUNCA diverge do documento pai, não importa
-- qual caminho de escrita insere a linha (hoje: esta RPC e
-- promote_email_attachment_to_document, migration 20260823100000 —
-- nenhuma delas precisa ser tocada, o trigger cobre as duas e
-- qualquer caminho futuro automaticamente).
create or replace function public.set_document_version_project_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select d.project_id into new.project_id
  from public.documents d
  where d.id = new.document_id;

  if new.project_id is null then
    raise exception
      'Cannot resolve project for document_version: document % not found',
      new.document_id;
  end if;

  return new;
end;
$$;

-- BEFORE INSERT cobre toda escrita nova; BEFORE UPDATE OF document_id
-- cobre o caso (hoje sem nenhum caminho de código, mas nunca confiado
-- por construção) de um document_version ser re-vinculado a outro
-- documento — o trigger recalcula project_id do zero em qualquer dos
-- dois casos, nunca aceitando o valor que já estava na linha.
create trigger document_versions_set_project_id
before insert or update of document_id on public.document_versions
for each row
execute function public.set_document_version_project_id();

-- A GARANTIA REAL de deduplicação: índice único parcial por
-- (projeto, hash). Sob duas transações concorrentes inserindo o
-- mesmo hash no mesmo projeto, o Postgres deixa exatamente uma
-- committar e rejeita a outra com unique_violation — a RPC abaixo
-- traduz isso para o mesmo erro DUPLICATE_FILE_HASH que o caminho
-- não-concorrente já usava.
create unique index document_versions_project_hash_unique_idx
  on public.document_versions (project_id, sha256_hash)
  where sha256_hash is not null;


-- ============================================================
-- 3b. can_manage_project_documents — decisão de negócio
--
-- Regra específica de escrita em Documentos (upload individual,
-- upload múltiplo, promoção de anexo de e-mail): membership ACTIVE
-- com permission em (ADMINISTRADOR, GESTOR). NÃO é a hierarquia
-- global de has_project_permission (que continua intocada — GESTOR
-- segue nível 1/somente-leitura para TODAS as outras operações
-- administrativas do sistema, ex.: gestão de usuários, edição de
-- cláusulas etc.). Esta função é uma decisão de negócio isolada,
-- só para os três fluxos de escrita em Documentos — nunca amplia
-- nenhuma outra operação. IN-list explícita, sem ambiguidade.
--
-- Nunca exposta a authenticated/anon/PUBLIC: só é chamada de dentro
-- de outras functions SECURITY DEFINER (register_project_document_upload,
-- promote_email_attachment_to_document), que já executam com os
-- privilégios do owner — não precisa de GRANT EXECUTE para isso.
-- ============================================================

create or replace function public.can_manage_project_documents(
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
      and pm.permission in ('ADMINISTRADOR', 'GESTOR')
  );
$$;

revoke all on function public.can_manage_project_documents(uuid) from public;
revoke all on function public.can_manage_project_documents(uuid) from anon;
revoke all on function public.can_manage_project_documents(uuid) from authenticated;


-- ============================================================
-- 4. register_project_document_upload
--
-- A assinatura anterior (15 parâmetros, sem p_sha256_hash) é
-- explicitamente DROPADA antes de recriar a function. Isso é
-- OBRIGATÓRIO: adicionar um parâmetro novo via CREATE OR REPLACE não
-- substitui a function existente quando a lista de parâmetros muda
-- de tamanho — o Postgres identifica functions por (nome + tipos dos
-- parâmetros, em ordem), então uma lista de 16 tipos é uma
-- IDENTIDADE DIFERENTE de uma lista de 15. Sem o DROP abaixo, esta
-- migration criaria uma SEGUNDA function sobrecarregada coexistindo
-- com a antiga — e como todo argumento novo tem DEFAULT, uma chamada
-- com os 15 parâmetros antigos passaria a ser ambígua entre as duas
-- (erro típico do PostgREST: "Could not choose the best candidate
-- function", PGRST203). Com o DROP, sobra exatamente uma function —
-- a chamada antiga (upload individual, sem p_sha256_hash) resolve
-- sem ambiguidade contra ela, usando o default para o parâmetro novo.
-- ============================================================

drop function if exists public.register_project_document_upload(
  uuid, uuid, uuid, text, text, text, date, text, text, text,
  text, text, text, bigint, text
);

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
    'RELATORIO_SEMANAL', 'PROPOSTA_AXION', 'CLARIFICACAO_CLIENTE',
    'ATA_REUNIAO', 'PROPOSTA_COMERCIAL', 'PROPOSTA_TECNICA',
    'PLANILHA_CONTRATUAL', 'RELATORIO', 'NOTIFICACAO', 'ESG_SSMA',
    'DIARIO_OBRA', 'OUTRO'
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

-- Autorização de negócio (quem PODE chamar) é distinta de quem
-- CONSEGUE ter sucesso: a checagem de membership/permissão continua
-- inteiramente dentro do corpo da function
-- (can_manage_project_documents(p_project_id), seção acima) — um
-- usuário authenticated sem vínculo ativo com o projeto, ou vinculado
-- como COLABORADOR/LEITURA, ou com membership INACTIVE, continua
-- bloqueado ali, incondicionalmente, mesmo tendo EXECUTE na function.


-- ============================================================
-- 5. promote_email_attachment_to_document — alinhamento de papel
--
-- Também cria document/document_version (promoção de anexo de
-- e-mail) — mesma decisão de negócio do upload de documentos: agora
-- ADMINISTRADOR ou GESTOR, não mais só o literal legado 'EDITOR'
-- (que hoje só ADMINISTRADOR satisfazia, via has_project_permission).
--
-- CREATE OR REPLACE com a MESMA assinatura da migration histórica
-- 20260823100000 (uuid, text, text, date, text, text) — não é DROP+
-- CREATE porque a lista de parâmetros não muda, então não existe
-- risco de sobrecarga ambígua aqui (regra de identidade de function
-- do Postgres: mesmo nome + mesmos tipos de parâmetro = mesma
-- function, CREATE OR REPLACE simplesmente atualiza o corpo).
-- Owner e ACL (revoke public/anon, grant authenticated) são
-- preservados automaticamente pelo Postgres quando a assinatura não
-- muda — por isso não há bloco de grants repetido aqui, ao contrário
-- da seção 4 acima, que precisou de um DROP explícito e por isso
-- perdeu e teve que restaurar a ACL manualmente.
--
-- Todo o resto do corpo é idêntico ao da migration histórica (nunca
-- editada) — só a linha de autorização e sua mensagem de erro mudam.
-- ============================================================

create or replace function public.promote_email_attachment_to_document(
  p_attachment_id uuid,
  p_kind text,
  p_document_title text,
  p_document_date date,
  p_author text,
  p_summary text
)
returns table (document_id uuid, document_version_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid;
  v_attachment record;
  v_document_id uuid;
  v_document_version_id uuid;
begin
  v_actor_user_id := auth.uid();

  if v_actor_user_id is null then
    raise exception 'Sessão não autenticada.';
  end if;

  if nullif(trim(p_document_title), '') is null then
    raise exception 'Título do documento é obrigatório.';
  end if;

  if nullif(trim(p_author), '') is null then
    raise exception 'Autor/emissor é obrigatório.';
  end if;

  if nullif(trim(p_summary), '') is null then
    raise exception 'Resumo é obrigatório.';
  end if;

  select ea.id, ea.project_id, ea.storage_bucket, ea.storage_path, ea.original_file_name,
         ea.mime_type, ea.file_size_bytes, ea.source_language, ea.document_version_id
    into v_attachment
    from public.email_attachments ea
    where ea.id = p_attachment_id;

  if v_attachment.id is null then
    raise exception 'Anexo (id=%) não encontrado.', p_attachment_id;
  end if;

  if not public.can_manage_project_documents(v_attachment.project_id) then
    raise exception 'Permissão ADMINISTRADOR ou GESTOR necessária para incorporar este anexo aos Documentos.';
  end if;

  -- Idempotente: já promovido? nunca cria um segundo document_version para o mesmo anexo.
  if v_attachment.document_version_id is not null then
    select dv.id, dv.document_id
      into v_document_version_id, v_document_id
      from public.document_versions dv
      where dv.id = v_attachment.document_version_id;

    if v_document_version_id is not null then
      return query select v_document_id, v_document_version_id;
      return;
    end if;
  end if;

  insert into public.documents (project_id, kind, title)
  values (v_attachment.project_id, p_kind, p_document_title)
  returning id into v_document_id;

  insert into public.document_versions (
    document_id, version_label, version_index, document_date, source_type,
    author, summary, file_path, storage_bucket, original_file_name, mime_type,
    file_size_bytes, processing_status, source_language
  ) values (
    v_document_id, 'v1', 1, p_document_date, 'EMAIL',
    p_author, p_summary,
    -- Reaproveita o MESMO objeto de Storage já salvo na ingestão — nunca re-upload.
    v_attachment.storage_path, v_attachment.storage_bucket,
    v_attachment.original_file_name, v_attachment.mime_type, v_attachment.file_size_bytes,
    -- Entra na mesma fila de extração de texto já existente — nenhum pipeline novo.
    'AWAITING_PROCESSING', v_attachment.source_language
  )
  returning id into v_document_version_id;

  update public.email_attachments
    set document_version_id = v_document_version_id,
        processing_status = 'PROCESSED',
        processing_error = null
    where id = p_attachment_id;

  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, actor_label,
    action, entity_type, entity_id, detail
  ) values (
    v_attachment.project_id, 'USER', v_actor_user_id, null,
    'EMAIL_ATTACHMENT_PROCESSED', 'EMAIL_ATTACHMENT', p_attachment_id::text,
    format('Anexo "%s" promovido a documento (kind=%s, document_version_id=%s).', v_attachment.original_file_name, p_kind, v_document_version_id)
  );

  return query select v_document_id, v_document_version_id;
end;
$$;
