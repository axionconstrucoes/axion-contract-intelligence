-- ============================================================
-- construmanager_document_metadata.sql
--
-- Metadados de documentos tecnicos do Construmanager (Pacote B).
--
-- Escrita a partir do CONTRATO REAL da API, validado contra a obra
-- piloto 34164 (WEG Linhares ES - Fabrica de Fios, empresa 1645):
--
--   Pasta/List          { empresaId, obraId }
--   Arquivo/List        { empresaId, obraId }
--   ListaMestra/List    { idEmpresa, idObra, idUsuario, idTipoUsuario,
--                         isMasterLider, idObjeto, isMostrarVersao,
--                         isJSON }   <- FONTE PRIMARIA
--
-- Fatos da API que este schema preserva:
--
-- 1. cad_objects_id e' identidade ESTAVEL do documento. Ele NAO muda
--    quando ha revisao: o cabeca retem o id de criacao e cada revisao
--    arquiva o conteudo anterior numa linha nova. Verificado em 11/11
--    versoes (id do cabeca < id de toda versao filha).
--
-- 2. cad_objects_super e' POLIMORFICO:
--       documento vigente -> id da PASTA
--       versao historica  -> id do DOCUMENTO-CABECA
--    As duas semanticas ficam em colunas separadas (nunca um
--    "parent_id" ambiguo).
--
-- 3. revisao: cad_objects_versoes e' o FATO da API (concorda 100% com
--    Arquivo/List.review em 192/192). O nome do arquivo NAO e' fonte
--    factual - divergiu em 20/171 casos. A revisao inferida do nome
--    fica isolada em revision_from_name e o desacordo em
--    revision_conflict (regra 12 do CLAUDE.md: fato != inferencia).
--
-- 4. revisao NAO e' sequencia continua: a obra real tem 00 -> 03 -> 04.
--    Nada aqui assume continuidade.
--
-- 5. datas da API sao naive (sem timezone). O valor original e'
--    preservado em *_raw; a coluna timestamptz e' derivada sob a
--    hipotese explicita America/Sao_Paulo, documentada por comentario.
--
-- Nenhum conteudo binario, hash, URL de download ou arquivo e'
-- armazenado. Somente metadados.
--
-- Aditiva: nao remove nem altera nenhuma tabela existente.
-- ============================================================


-- ============================================================
-- A. construmanager_folders
-- ============================================================

create table if not exists public.construmanager_folders (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete cascade,

  integration_id uuid not null
    references public.project_integrations (id) on delete cascade,

  construmanager_company_id bigint not null,
  construmanager_work_id bigint not null,

  construmanager_folder_id bigint not null,

  -- Pasta/List.parentId vem como STRING na API (em Arquivo/List o
  -- mesmo conceito vem como number). Normalizado para bigint aqui.
  -- Nulo na raiz: a raiz da obra aponta para um no da empresa que
  -- NAO e' retornado por Pasta/List.
  parent_folder_id bigint,

  name text not null,
  path text not null,
  level integer not null,

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint construmanager_folders_integration_folder_key
    unique (integration_id, construmanager_folder_id)
);

comment on table public.construmanager_folders is
  'Arvore de pastas de uma obra do Construmanager (Pasta/List). Somente metadados.';

comment on column public.construmanager_folders.parent_folder_id is
  'Pasta/List.parentId normalizado de string para bigint. Nulo quando o pai nao pertence a obra (no da empresa).';


-- ============================================================
-- B. construmanager_documents
--    SOMENTE o documento-cabeca/vigente (isVersao = 0).
-- ============================================================

create table if not exists public.construmanager_documents (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete cascade,

  integration_id uuid not null
    references public.project_integrations (id) on delete cascade,

  construmanager_company_id bigint not null,
  construmanager_work_id bigint not null,

  -- cad_objects_id do cabeca. Identidade estavel entre revisoes.
  construmanager_object_id bigint not null,

  -- cad_objects_super do vigente = id da PASTA (semantica explicita).
  construmanager_folder_id bigint not null,

  name text not null,
  extension text not null,
  extension_normalized text not null,

  -- FATO: cad_objects_versoes.
  revision text not null,

  -- INFERENCIA: extraida do nome do arquivo. Nunca substitui revision.
  revision_from_name text,
  revision_conflict boolean not null default false,

  -- isContemVersao / Arquivo.hasVersion.
  has_versions boolean not null default false,

  author_id bigint,
  author_name text,

  source_created_at_raw text,
  source_created_at timestamptz,
  source_approved_at_raw text,
  source_approved_at timestamptz,

  size_bytes bigint,
  folder_path text,
  status_label text,

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint construmanager_documents_integration_object_key
    unique (integration_id, construmanager_object_id)
);

comment on table public.construmanager_documents is
  'Documento vigente (cabeca de cadeia) do Construmanager. Fonte primaria: ListaMestra/List com isVersao = 0.';

comment on column public.construmanager_documents.construmanager_object_id is
  'cad_objects_id do cabeca. Estavel entre revisoes: nao muda quando o documento e revisado.';

comment on column public.construmanager_documents.construmanager_folder_id is
  'cad_objects_super do documento vigente, que na API representa a PASTA (campo polimorfico normalizado).';

comment on column public.construmanager_documents.revision is
  'FATO da API (cad_objects_versoes). Nao e sequencia continua: a obra piloto tem 00 -> 03 -> 04.';

comment on column public.construmanager_documents.revision_from_name is
  'INFERENCIA extraida do nome do arquivo. Diverge do fato em ~12 por cento dos casos reais. Nunca usar como revisao.';

comment on column public.construmanager_documents.source_created_at is
  'Derivada de source_created_at_raw sob a hipotese explicita de timezone America/Sao_Paulo (a API devolve data naive).';


-- ============================================================
-- C. construmanager_document_versions
--    SOMENTE isVersao = 1. Imutavel exceto last_seen_at.
-- ============================================================

create table if not exists public.construmanager_document_versions (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete cascade,

  integration_id uuid not null
    references public.project_integrations (id) on delete cascade,

  document_id uuid not null
    references public.construmanager_documents (id) on delete cascade,

  -- cad_objects_id da propria versao historica.
  construmanager_version_object_id bigint not null,

  -- cad_objects_super da versao = id do DOCUMENTO-CABECA.
  construmanager_head_object_id bigint not null,

  revision text not null,
  revision_from_name text,
  revision_conflict boolean not null default false,

  name text not null,
  extension text not null,
  extension_normalized text not null,

  author_id bigint,
  author_name text,

  source_created_at_raw text,
  source_created_at timestamptz,
  source_approved_at_raw text,
  source_approved_at timestamptz,

  size_bytes bigint,
  folder_path text,
  status_label text,

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint construmanager_document_versions_integration_object_key
    unique (integration_id, construmanager_version_object_id)
);

comment on table public.construmanager_document_versions is
  'Versao historica de um documento (ListaMestra/List com isMostrarVersao = true, isVersao = 1). Imutavel: so last_seen_at e atualizado.';

comment on column public.construmanager_document_versions.construmanager_head_object_id is
  'cad_objects_super da versao, que na API representa o DOCUMENTO-CABECA (campo polimorfico normalizado).';


-- ============================================================
-- D. construmanager_sync_runs
-- ============================================================

create table if not exists public.construmanager_sync_runs (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete cascade,

  integration_id uuid not null
    references public.project_integrations (id) on delete cascade,

  started_at timestamptz not null,
  completed_at timestamptz,

  status text not null
    check (status in ('SUCESSO', 'ERRO', 'PARCIAL')),

  folders_seen integer not null default 0,
  documents_seen integer not null default 0,
  historical_versions_seen integer not null default 0,

  folders_created integer not null default 0,
  documents_created integer not null default 0,
  versions_created integer not null default 0,

  -- Versoes cujo cabeca nao veio na mesma resposta. Nunca inventamos
  -- vinculo: sao contadas, diagnosticadas e descartadas.
  versions_orphaned integer not null default 0,

  -- Sempre sanitizado. A API devolve stack trace de SQL Server em
  -- request malformado; nada disso pode chegar aqui.
  error text,

  triggered_by_user_id uuid references auth.users (id) on delete set null,

  source text not null default 'MANUAL'
    check (source in ('MANUAL')),

  created_at timestamptz not null default now()
);

comment on table public.construmanager_sync_runs is
  'Execucoes de sincronizacao de metadados do Construmanager. Somente MANUAL nesta fase (sem scheduler).';

comment on column public.construmanager_sync_runs.error is
  'Erro ja sanitizado. Nunca armazenar Authorization, token, credencial ou stack trace de SQL Server.';


-- ============================================================
-- Indices
-- ============================================================

create index if not exists construmanager_folders_project_idx
  on public.construmanager_folders (project_id);

create index if not exists construmanager_folders_integration_idx
  on public.construmanager_folders (integration_id);

create index if not exists construmanager_folders_work_idx
  on public.construmanager_folders (integration_id, construmanager_work_id);

create index if not exists construmanager_documents_project_idx
  on public.construmanager_documents (project_id);

create index if not exists construmanager_documents_integration_idx
  on public.construmanager_documents (integration_id);

create index if not exists construmanager_documents_folder_idx
  on public.construmanager_documents (integration_id, construmanager_folder_id);

create index if not exists construmanager_documents_has_versions_idx
  on public.construmanager_documents (integration_id, has_versions)
  where has_versions;

create index if not exists construmanager_documents_conflict_idx
  on public.construmanager_documents (integration_id, revision_conflict)
  where revision_conflict;

create index if not exists construmanager_document_versions_project_idx
  on public.construmanager_document_versions (project_id);

create index if not exists construmanager_document_versions_document_idx
  on public.construmanager_document_versions (document_id);

create index if not exists construmanager_document_versions_head_idx
  on public.construmanager_document_versions (integration_id, construmanager_head_object_id);

create index if not exists construmanager_sync_runs_project_idx
  on public.construmanager_sync_runs (project_id, started_at desc);

create index if not exists construmanager_sync_runs_integration_idx
  on public.construmanager_sync_runs (integration_id, started_at desc);


-- ============================================================
-- RLS
--
-- Mesmo padrao de project_integrations: leitura para membros do
-- projeto; nenhuma policy de INSERT/UPDATE/DELETE para usuario comum.
-- Toda escrita passa pela RPC SECURITY DEFINER abaixo, que exige
-- ADMINISTRADOR.
-- ============================================================

alter table public.construmanager_folders enable row level security;
alter table public.construmanager_documents enable row level security;
alter table public.construmanager_document_versions enable row level security;
alter table public.construmanager_sync_runs enable row level security;

create policy "construmanager_folders_select_project_members_only"
  on public.construmanager_folders
  for select
  using (public.is_project_member(project_id));

create policy "construmanager_documents_select_project_members_only"
  on public.construmanager_documents
  for select
  using (public.is_project_member(project_id));

create policy "construmanager_document_versions_select_project_members_only"
  on public.construmanager_document_versions
  for select
  using (public.is_project_member(project_id));

create policy "construmanager_sync_runs_select_project_members_only"
  on public.construmanager_sync_runs
  for select
  using (public.is_project_member(project_id));


-- ============================================================
-- RPC de sincronizacao
--
-- Recebe os tres conjuntos ja normalizados pelo parser da aplicacao e
-- aplica tudo em UMA transacao. Idempotente por construcao: as chaves
-- (integration_id, construmanager_*_id) fazem ON CONFLICT virar
-- atualizacao de last_seen_at. Uma segunda execucao identica devolve
-- 0 em folders_created / documents_created / versions_created.
-- ============================================================

create or replace function public.sync_construmanager_metadata(
  p_project_id uuid,
  p_company_id bigint,
  p_work_id bigint,
  p_started_at timestamptz,
  p_folders jsonb,
  p_documents jsonb,
  p_versions jsonb
)
returns table (
  sync_run_id uuid,
  folders_seen integer,
  documents_seen integer,
  historical_versions_seen integer,
  folders_created integer,
  documents_created integer,
  versions_created integer,
  versions_orphaned integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_integration_id uuid;
  v_now timestamptz := now();

  v_folders_seen integer := 0;
  v_documents_seen integer := 0;
  v_versions_seen integer := 0;
  v_folders_created integer := 0;
  v_documents_created integer := 0;
  v_versions_created integer := 0;
  v_versions_orphaned integer := 0;
  v_sync_run_id uuid;
begin
  v_actor_user_id := auth.uid();

  if v_actor_user_id is null then
    raise exception 'Sessao nao autenticada.';
  end if;

  if not public.has_project_permission(p_project_id, 'ADMINISTRADOR') then
    raise exception 'Permissao ADMINISTRADOR e necessaria para sincronizar metadados do Construmanager.';
  end if;

  if p_company_id is null or p_company_id <= 0
     or p_work_id is null or p_work_id <= 0 then
    raise exception 'Empresa/obra do Construmanager invalidas.';
  end if;

  select pi.id
    into v_integration_id
    from public.project_integrations pi
   where pi.project_id = p_project_id
     and pi.source_type = 'CONSTRUMANAGER';

  if v_integration_id is null then
    raise exception 'Integracao Construmanager nao configurada para este projeto.';
  end if;

  -- ---------- Pastas ----------
  with incoming as (
    select *
      from jsonb_to_recordset(coalesce(p_folders, '[]'::jsonb)) as x(
        construmanager_folder_id bigint,
        parent_folder_id bigint,
        name text,
        path text,
        level integer
      )
  ),
  upserted as (
    insert into public.construmanager_folders (
      project_id, integration_id,
      construmanager_company_id, construmanager_work_id,
      construmanager_folder_id, parent_folder_id,
      name, path, level,
      first_seen_at, last_seen_at, created_at, updated_at
    )
    select
      p_project_id, v_integration_id,
      p_company_id, p_work_id,
      i.construmanager_folder_id, i.parent_folder_id,
      i.name, i.path, i.level,
      v_now, v_now, v_now, v_now
      from incoming i
    on conflict (integration_id, construmanager_folder_id) do update
      set parent_folder_id = excluded.parent_folder_id,
          name = excluded.name,
          path = excluded.path,
          level = excluded.level,
          last_seen_at = v_now,
          updated_at = v_now
    returning (xmax = 0) as inserted
  )
  select count(*)::integer, count(*) filter (where inserted)::integer
    into v_folders_seen, v_folders_created
    from upserted;

  -- ---------- Documentos vigentes ----------
  with incoming as (
    select *
      from jsonb_to_recordset(coalesce(p_documents, '[]'::jsonb)) as x(
        construmanager_object_id bigint,
        construmanager_folder_id bigint,
        name text,
        extension text,
        extension_normalized text,
        revision text,
        revision_from_name text,
        revision_conflict boolean,
        has_versions boolean,
        author_id bigint,
        author_name text,
        source_created_at_raw text,
        source_created_at timestamptz,
        source_approved_at_raw text,
        source_approved_at timestamptz,
        size_bytes bigint,
        folder_path text,
        status_label text
      )
  ),
  upserted as (
    insert into public.construmanager_documents (
      project_id, integration_id,
      construmanager_company_id, construmanager_work_id,
      construmanager_object_id, construmanager_folder_id,
      name, extension, extension_normalized,
      revision, revision_from_name, revision_conflict,
      has_versions, author_id, author_name,
      source_created_at_raw, source_created_at,
      source_approved_at_raw, source_approved_at,
      size_bytes, folder_path, status_label,
      first_seen_at, last_seen_at, created_at, updated_at
    )
    select
      p_project_id, v_integration_id,
      p_company_id, p_work_id,
      i.construmanager_object_id, i.construmanager_folder_id,
      i.name, i.extension, i.extension_normalized,
      i.revision, i.revision_from_name, coalesce(i.revision_conflict, false),
      coalesce(i.has_versions, false), i.author_id, i.author_name,
      i.source_created_at_raw, i.source_created_at,
      i.source_approved_at_raw, i.source_approved_at,
      i.size_bytes, i.folder_path, i.status_label,
      v_now, v_now, v_now, v_now
      from incoming i
    on conflict (integration_id, construmanager_object_id) do update
      set construmanager_folder_id = excluded.construmanager_folder_id,
          name = excluded.name,
          extension = excluded.extension,
          extension_normalized = excluded.extension_normalized,
          revision = excluded.revision,
          revision_from_name = excluded.revision_from_name,
          revision_conflict = excluded.revision_conflict,
          has_versions = excluded.has_versions,
          author_id = excluded.author_id,
          author_name = excluded.author_name,
          source_created_at_raw = excluded.source_created_at_raw,
          source_created_at = excluded.source_created_at,
          source_approved_at_raw = excluded.source_approved_at_raw,
          source_approved_at = excluded.source_approved_at,
          size_bytes = excluded.size_bytes,
          folder_path = excluded.folder_path,
          status_label = excluded.status_label,
          last_seen_at = v_now,
          updated_at = v_now
    returning (xmax = 0) as inserted
  )
  select count(*)::integer, count(*) filter (where inserted)::integer
    into v_documents_seen, v_documents_created
    from upserted;

  -- ---------- Versoes historicas ----------
  -- O vinculo e' resolvido por JOIN com o cabeca ja persistido. Versao
  -- cujo cabeca nao existe NAO e' inserida com vinculo inventado: fica
  -- de fora e e' contada em versions_orphaned.
  with incoming as (
    select *
      from jsonb_to_recordset(coalesce(p_versions, '[]'::jsonb)) as x(
        construmanager_version_object_id bigint,
        construmanager_head_object_id bigint,
        revision text,
        revision_from_name text,
        revision_conflict boolean,
        name text,
        extension text,
        extension_normalized text,
        author_id bigint,
        author_name text,
        source_created_at_raw text,
        source_created_at timestamptz,
        source_approved_at_raw text,
        source_approved_at timestamptz,
        size_bytes bigint,
        folder_path text,
        status_label text
      )
  ),
  resolved as (
    select i.*, d.id as document_id
      from incoming i
      left join public.construmanager_documents d
        on d.integration_id = v_integration_id
       and d.construmanager_object_id = i.construmanager_head_object_id
  ),
  upserted as (
    insert into public.construmanager_document_versions (
      project_id, integration_id, document_id,
      construmanager_version_object_id, construmanager_head_object_id,
      revision, revision_from_name, revision_conflict,
      name, extension, extension_normalized,
      author_id, author_name,
      source_created_at_raw, source_created_at,
      source_approved_at_raw, source_approved_at,
      size_bytes, folder_path, status_label,
      first_seen_at, last_seen_at, created_at
    )
    select
      p_project_id, v_integration_id, r.document_id,
      r.construmanager_version_object_id, r.construmanager_head_object_id,
      r.revision, r.revision_from_name, coalesce(r.revision_conflict, false),
      r.name, r.extension, r.extension_normalized,
      r.author_id, r.author_name,
      r.source_created_at_raw, r.source_created_at,
      r.source_approved_at_raw, r.source_approved_at,
      r.size_bytes, r.folder_path, r.status_label,
      v_now, v_now, v_now
      from resolved r
     where r.document_id is not null
    -- Versao historica e' IMUTAVEL: so a observacao muda.
    on conflict (integration_id, construmanager_version_object_id) do update
      set last_seen_at = v_now
    returning (xmax = 0) as inserted
  )
  select count(*)::integer, count(*) filter (where inserted)::integer
    into v_versions_seen, v_versions_created
    from upserted;

  select count(*)::integer
    into v_versions_orphaned
    from jsonb_to_recordset(coalesce(p_versions, '[]'::jsonb)) as x(
      construmanager_head_object_id bigint
    )
   where not exists (
     select 1
       from public.construmanager_documents d
      where d.integration_id = v_integration_id
        and d.construmanager_object_id = x.construmanager_head_object_id
   );

  -- ---------- Registro da execucao ----------
  insert into public.construmanager_sync_runs (
    project_id, integration_id,
    started_at, completed_at, status,
    folders_seen, documents_seen, historical_versions_seen,
    folders_created, documents_created, versions_created,
    versions_orphaned, error, triggered_by_user_id, source
  )
  values (
    p_project_id, v_integration_id,
    p_started_at, v_now,
    case when v_versions_orphaned > 0 then 'PARCIAL' else 'SUCESSO' end,
    v_folders_seen, v_documents_seen, v_versions_seen + v_versions_orphaned,
    v_folders_created, v_documents_created, v_versions_created,
    v_versions_orphaned,
    case
      when v_versions_orphaned > 0
      then v_versions_orphaned || ' versao(oes) historica(s) sem documento-cabeca correspondente foram ignoradas.'
      else null
    end,
    v_actor_user_id, 'MANUAL'
  )
  returning id into v_sync_run_id;

  update public.project_integrations
     set last_sync_at = v_now,
         updated_at = v_now
   where id = v_integration_id;

  return query
    select
      v_sync_run_id,
      v_folders_seen,
      v_documents_seen,
      v_versions_seen + v_versions_orphaned,
      v_folders_created,
      v_documents_created,
      v_versions_created,
      v_versions_orphaned;
end;
$$;

revoke all on function public.sync_construmanager_metadata(uuid, bigint, bigint, timestamptz, jsonb, jsonb, jsonb) from public;
revoke all on function public.sync_construmanager_metadata(uuid, bigint, bigint, timestamptz, jsonb, jsonb, jsonb) from anon;
grant execute on function public.sync_construmanager_metadata(uuid, bigint, bigint, timestamptz, jsonb, jsonb, jsonb) to authenticated;


-- ============================================================
-- RPC de registro de falha
--
-- Uma sincronizacao que falha ANTES de conseguir dados tambem precisa
-- deixar rastro. Erro sempre ja sanitizado pela aplicacao.
-- ============================================================

create or replace function public.record_construmanager_sync_failure(
  p_project_id uuid,
  p_started_at timestamptz,
  p_error text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_integration_id uuid;
  v_sync_run_id uuid;
begin
  v_actor_user_id := auth.uid();

  if v_actor_user_id is null then
    raise exception 'Sessao nao autenticada.';
  end if;

  if not public.has_project_permission(p_project_id, 'ADMINISTRADOR') then
    raise exception 'Permissao ADMINISTRADOR e necessaria para sincronizar metadados do Construmanager.';
  end if;

  select pi.id
    into v_integration_id
    from public.project_integrations pi
   where pi.project_id = p_project_id
     and pi.source_type = 'CONSTRUMANAGER';

  if v_integration_id is null then
    raise exception 'Integracao Construmanager nao configurada para este projeto.';
  end if;

  insert into public.construmanager_sync_runs (
    project_id, integration_id,
    started_at, completed_at, status,
    error, triggered_by_user_id, source
  )
  values (
    p_project_id, v_integration_id,
    p_started_at, now(), 'ERRO',
    nullif(left(btrim(coalesce(p_error, '')), 1000), ''),
    v_actor_user_id, 'MANUAL'
  )
  returning id into v_sync_run_id;

  return v_sync_run_id;
end;
$$;

revoke all on function public.record_construmanager_sync_failure(uuid, timestamptz, text) from public;
revoke all on function public.record_construmanager_sync_failure(uuid, timestamptz, text) from anon;
grant execute on function public.record_construmanager_sync_failure(uuid, timestamptz, text) to authenticated;
