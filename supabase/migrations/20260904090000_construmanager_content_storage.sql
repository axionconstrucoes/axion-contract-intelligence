-- ============================================================
-- construmanager_content_storage.sql
--
-- Pacote C: conteudo real dos documentos tecnicos do Construmanager,
-- endereçado por conteudo (content-addressed), deduplicado e
-- rastreavel.
--
-- ESCOPO: obter e preservar bytes com hash confiavel. Nada aqui
-- compara revisoes, classifica mudanca ou gera evento -- isso e'
-- Pacote D/E.
--
-- ------------------------------------------------------------
-- Decisao 1: BLOB GLOBAL, SEM project_id.
--
-- A deduplicacao e' por conteudo (sha256). Carimbar project_id no
-- blob quebraria a deduplicacao no exato caso que ela existe para
-- resolver: o mesmo arquivo aparecendo em obras/projetos distintos.
-- O escopo por projeto vive no VINCULO, nunca no conteudo fisico.
--
-- ------------------------------------------------------------
-- Decisao 2: TABELA DE VINCULO em vez de colunas nas tabelas do
-- Pacote B.
--
-- Alternativa descartada: adicionar content_blob_id, download_status,
-- downloaded_at, download_error e download_attempts em
-- construmanager_documents E em construmanager_document_versions.
-- Motivos para nao fazer isso:
--
--   a) duplicaria cinco colunas e toda a maquina de estado de
--      download em duas tabelas, com dois caminhos de codigo para
--      manter em sincronia;
--   b) construmanager_document_versions e' declarada IMUTAVEL no
--      Pacote B ("so last_seen_at e atualizado"); enxertar estado
--      mutavel de download nela contradiz o contrato ja escrito;
--   c) exigiria ALTER TABLE nas tabelas do Pacote B, que estao
--      aplicadas e validadas em DEV -- esta migration nao toca
--      nenhuma delas;
--   d) o alvo do download e' sempre UM cad_objects_id, seja ele
--      cabeca ou versao. Uma tabela de vinculo expressa isso com uma
--      chave natural unica (integration_id, construmanager_object_id)
--      que atravessa os dois casos.
--
-- O vinculo NAO usa um "target_id" polimorfico ambiguo: sao duas
-- colunas FK explicitas com CHECK de exatamente uma preenchida --
-- mesmo principio que o Pacote B aplicou a cad_objects_super.
--
-- ------------------------------------------------------------
-- Decisao 3: sha256 NAO e' identidade documental.
--
-- Identidade documental continua sendo a do Pacote B (cad_objects_id
-- do cabeca; cad_objects_id da versao). sha256 e' identidade do
-- CONTEUDO. Dois documentos distintos PODEM apontar para o mesmo
-- blob quando os bytes sao iguais, e continuam sendo dois documentos.
--
-- Aditiva: nao remove nem altera nenhuma tabela existente.
-- ============================================================


-- ============================================================
-- A. construmanager_content_blobs
--    Conteudo fisico unico, endereçado por sha256.
-- ============================================================

create table if not exists public.construmanager_content_blobs (
  id uuid primary key default gen_random_uuid(),

  -- Hexadecimal minusculo de 64 caracteres. O CHECK impede que
  -- maiusculas ou prefixo "sha256:" criem duas linhas para o mesmo
  -- conteudo e furem a deduplicacao.
  sha256 text not null
    constraint construmanager_content_blobs_sha256_format
      check (sha256 ~ '^[0-9a-f]{64}$'),

  -- Tamanho REAL dos bytes extraidos, nunca o tamanho do ZIP nem o
  -- tamanho declarado pelo metadado do Pacote B.
  size_bytes bigint not null
    constraint construmanager_content_blobs_size_non_negative
      check (size_bytes >= 0),

  storage_bucket text not null,
  storage_path text not null,

  mime_type text,
  detected_extension text,

  first_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  -- O mesmo conteudo fisico existe uma unica vez.
  constraint construmanager_content_blobs_sha256_key unique (sha256),

  -- Path e' derivado do sha256, entao a unicidade fisica acompanha a
  -- logica. Guarda contra um path reaproveitado por engano.
  constraint construmanager_content_blobs_storage_key
    unique (storage_bucket, storage_path)
);

comment on table public.construmanager_content_blobs is
  'Conteudo fisico deduplicado por sha256. Sem project_id de proposito: o escopo por projeto vive em construmanager_content_links.';

comment on column public.construmanager_content_blobs.sha256 is
  'SHA-256 hex minusculo dos bytes REAIS do arquivo extraido do ZIP, nunca do ZIP. Identidade de CONTEUDO, jamais identidade documental.';

comment on column public.construmanager_content_blobs.storage_path is
  'Path content-addressed (sha256/aa/bb/<sha256>). Nunca derivado do nome do arquivo: nome externo nao vira caminho fisico.';


-- ============================================================
-- B. construmanager_content_links
--    Vinculo documento-cabeca OU versao historica -> blob,
--    mais o estado de download daquele alvo.
-- ============================================================

create table if not exists public.construmanager_content_links (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete cascade,

  integration_id uuid not null
    references public.project_integrations (id) on delete cascade,

  -- Exatamente uma das duas e' preenchida (CHECK abaixo). Nunca um
  -- "target_id" polimorfico: cada semantica tem sua propria coluna e
  -- sua propria FK real.
  document_id uuid
    references public.construmanager_documents (id) on delete cascade,
  version_id uuid
    references public.construmanager_document_versions (id) on delete cascade,

  -- cad_objects_id do alvo (cabeca ou versao). Identidade documental
  -- do Pacote B, repetida aqui para dar chave natural ao vinculo.
  construmanager_object_id bigint not null,

  -- Nulo enquanto o conteudo nao esta armazenado. RESTRICT: um blob
  -- referenciado nunca some por cascata.
  content_blob_id uuid
    references public.construmanager_content_blobs (id) on delete restrict,

  download_status text not null default 'PENDENTE'
    constraint construmanager_content_links_status_check
      check (download_status in ('PENDENTE', 'BAIXANDO', 'ARMAZENADO', 'ERRO')),

  download_attempts integer not null default 0
    constraint construmanager_content_links_attempts_non_negative
      check (download_attempts >= 0),

  downloaded_at timestamptz,
  last_checked_at timestamptz,

  -- Sempre sanitizado pela aplicacao. Nunca Authorization, token,
  -- credencial, path local ou stack trace de SQL Server.
  download_error text,

  -- Nome esperado, vindo do metadado do Pacote B. Serve para casar a
  -- entrada certa dentro do ZIP -- nunca para montar caminho fisico.
  source_name text not null,

  -- Entrada do ZIP efetivamente escolhida. Diagnostico de
  -- rastreabilidade: permite auditar DEPOIS qual item do pacote
  -- gerou aquele hash.
  zip_entry_path text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint construmanager_content_links_target_exactly_one
    check (num_nonnulls(document_id, version_id) = 1),

  -- Um vinculo por alvo.
  constraint construmanager_content_links_document_key unique (document_id),
  constraint construmanager_content_links_version_key unique (version_id),

  -- Chave natural que atravessa cabeca e versao: o cad_objects_id e'
  -- unico dentro da integracao nos dois casos (Pacote B).
  constraint construmanager_content_links_integration_object_key
    unique (integration_id, construmanager_object_id),

  -- ARMAZENADO sem blob seria mentira. O inverso (blob presente com
  -- status ERRO) e' permitido de proposito: uma nova tentativa que
  -- falha nao pode apagar o conteudo ja preservado.
  constraint construmanager_content_links_stored_requires_blob
    check (download_status <> 'ARMAZENADO' or content_blob_id is not null)
);

comment on table public.construmanager_content_links is
  'Vinculo entre um alvo documental do Pacote B (cabeca ou versao) e o conteudo fisico, mais o estado de download. Duas versoes distintas podem apontar para o mesmo blob.';

comment on column public.construmanager_content_links.construmanager_object_id is
  'cad_objects_id do alvo. Identidade DOCUMENTAL (Pacote B). Nao confundir com sha256, que e identidade de CONTEUDO.';

comment on column public.construmanager_content_links.download_error is
  'Erro ja sanitizado. Nunca armazenar Authorization, token, credencial, caminho de arquivo temporario ou stack trace.';

comment on column public.construmanager_content_links.zip_entry_path is
  'Entrada do ZIP escolhida, para auditoria posterior. O path do ZIP e entrada NAO CONFIAVEL: nunca foi usado para escrever em disco.';


-- ============================================================
-- Indices
-- ============================================================

create index if not exists construmanager_content_links_project_idx
  on public.construmanager_content_links (project_id);

create index if not exists construmanager_content_links_integration_idx
  on public.construmanager_content_links (integration_id);

create index if not exists construmanager_content_links_blob_idx
  on public.construmanager_content_links (content_blob_id);

create index if not exists construmanager_content_links_document_idx
  on public.construmanager_content_links (document_id);

create index if not exists construmanager_content_links_version_idx
  on public.construmanager_content_links (version_id);

-- Fila de pendentes: o caso quente da acao "baixar conteudos
-- pendentes".
create index if not exists construmanager_content_links_pending_idx
  on public.construmanager_content_links (project_id, download_status)
  where download_status in ('PENDENTE', 'ERRO');

create index if not exists construmanager_content_blobs_size_idx
  on public.construmanager_content_blobs (size_bytes);


-- ============================================================
-- C. Bucket PRIVADO content-addressed
--
-- Sem policy alguma de storage.objects para anon/authenticated: este
-- bucket e' inacessivel a partir do navegador, por construcao.
--
-- Isso e' DELIBERADO e diferente do bucket project-documents, cujo
-- path comeca por projectId e por isso permite RLS por projeto. Aqui
-- o path e' derivado do sha256 e o mesmo objeto fisico pode servir a
-- varios projetos -- nao existe "o projeto dono" para uma policy
-- escrever. O acesso e' mediado 100% server-side, que e' o unico
-- ponto onde a permissao do projeto pode ser avaliada de verdade.
--
-- allowed_mime_types nulo: a obra real tem dwg, ifc, rvt, nwd, bak,
-- alem de pdf/xlsx. Restringir MIME aqui rejeitaria arquivo tecnico
-- legitimo.
-- ============================================================

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'construmanager-content',
  'construmanager-content',
  false,
  -- 2 GiB. O maior arquivo observado na obra piloto tem ~263 MiB
  -- (356-WEG-MET-3D-001-R04.ifc). O limite de 50 MB do bucket de
  -- documentos NAO se aplica aqui.
  2147483648,
  null
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;


-- ============================================================
-- D. RLS
--
-- Leitura para membros do projeto; nenhuma policy de
-- INSERT/UPDATE/DELETE para usuario comum. Toda escrita passa pelas
-- RPCs SECURITY DEFINER abaixo, que exigem ADMINISTRADOR.
-- ============================================================

alter table public.construmanager_content_blobs enable row level security;
alter table public.construmanager_content_links enable row level security;

-- O blob e' global, mas so e' visivel para quem enxerga ao menos um
-- vinculo dele. Sem isso, um membro de um projeto conseguiria enumerar
-- hashes e tamanhos de conteudo de outro projeto.
create policy "construmanager_content_blobs_select_via_visible_link"
  on public.construmanager_content_blobs
  for select
  using (
    exists (
      select 1
        from public.construmanager_content_links l
       where l.content_blob_id = public.construmanager_content_blobs.id
         and public.is_project_member(l.project_id)
    )
  );

create policy "construmanager_content_links_select_project_members_only"
  on public.construmanager_content_links
  for select
  using (public.is_project_member(project_id));


-- ============================================================
-- E. RPC: criar os vinculos pendentes
--
-- Idempotente: roda depois de cada sync de metadados e so cria o que
-- falta. Nunca reabre um vinculo ja ARMAZENADO.
-- ============================================================

create or replace function public.ensure_construmanager_content_links(
  p_project_id uuid
)
returns table (
  links_created integer,
  documents_total integer,
  versions_total integer,
  pending_total integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_integration_id uuid;
  v_created integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Sessao nao autenticada.';
  end if;

  if not public.has_project_permission(p_project_id, 'ADMINISTRADOR') then
    raise exception 'Permissao ADMINISTRADOR e necessaria para preparar o download de conteudo do Construmanager.';
  end if;

  select pi.id
    into v_integration_id
    from public.project_integrations pi
   where pi.project_id = p_project_id
     and pi.source_type = 'CONSTRUMANAGER';

  if v_integration_id is null then
    raise exception 'Integracao Construmanager nao configurada para este projeto.';
  end if;

  with inserted as (
    insert into public.construmanager_content_links (
      project_id, integration_id, document_id, version_id,
      construmanager_object_id, source_name
    )
    select d.project_id, d.integration_id, d.id, null,
           d.construmanager_object_id, d.name
      from public.construmanager_documents d
     where d.project_id = p_project_id
       and d.integration_id = v_integration_id
    on conflict (document_id) do nothing
    returning 1
  )
  select count(*) into v_created from inserted;

  with inserted as (
    insert into public.construmanager_content_links (
      project_id, integration_id, document_id, version_id,
      construmanager_object_id, source_name
    )
    select v.project_id, v.integration_id, null, v.id,
           v.construmanager_version_object_id, v.name
      from public.construmanager_document_versions v
     where v.project_id = p_project_id
       and v.integration_id = v_integration_id
    on conflict (version_id) do nothing
    returning 1
  )
  select v_created + count(*) into v_created from inserted;

  return query
    select
      v_created,
      (select count(*)::integer from public.construmanager_content_links l
        where l.project_id = p_project_id and l.document_id is not null),
      (select count(*)::integer from public.construmanager_content_links l
        where l.project_id = p_project_id and l.version_id is not null),
      (select count(*)::integer from public.construmanager_content_links l
        where l.project_id = p_project_id
          and l.download_status in ('PENDENTE', 'ERRO'));
end;
$$;

revoke all on function public.ensure_construmanager_content_links(uuid) from public;
revoke all on function public.ensure_construmanager_content_links(uuid) from anon;
grant execute on function public.ensure_construmanager_content_links(uuid) to authenticated;


-- ============================================================
-- F. RPC: consultar blob por sha256
--
-- Chamada ANTES de qualquer upload. Se o conteudo ja existe, o
-- Storage nao e' tocado: a deduplicacao evita a escrita, nao a
-- desfaz depois.
-- ============================================================

create or replace function public.find_construmanager_content_blob(
  p_project_id uuid,
  p_sha256 text
)
returns table (
  blob_id uuid,
  storage_bucket text,
  storage_path text,
  size_bytes bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sessao nao autenticada.';
  end if;

  if not public.has_project_permission(p_project_id, 'ADMINISTRADOR') then
    raise exception 'Permissao ADMINISTRADOR e necessaria para consultar conteudo do Construmanager.';
  end if;

  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'SHA-256 invalido.';
  end if;

  return query
    select b.id, b.storage_bucket, b.storage_path, b.size_bytes
      from public.construmanager_content_blobs b
     where b.sha256 = p_sha256;
end;
$$;

revoke all on function public.find_construmanager_content_blob(uuid, text) from public;
revoke all on function public.find_construmanager_content_blob(uuid, text) from anon;
grant execute on function public.find_construmanager_content_blob(uuid, text) to authenticated;


-- ============================================================
-- G. RPC: marcar inicio de tentativa
-- ============================================================

create or replace function public.begin_construmanager_content_download(
  p_project_id uuid,
  p_link_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sessao nao autenticada.';
  end if;

  if not public.has_project_permission(p_project_id, 'ADMINISTRADOR') then
    raise exception 'Permissao ADMINISTRADOR e necessaria para baixar conteudo do Construmanager.';
  end if;

  update public.construmanager_content_links
     set download_status = 'BAIXANDO',
         download_attempts = download_attempts + 1,
         last_checked_at = now(),
         download_error = null,
         updated_at = now()
   where id = p_link_id
     and project_id = p_project_id;

  if not found then
    raise exception 'Vinculo de conteudo nao encontrado neste projeto.';
  end if;
end;
$$;

revoke all on function public.begin_construmanager_content_download(uuid, uuid) from public;
revoke all on function public.begin_construmanager_content_download(uuid, uuid) from anon;
grant execute on function public.begin_construmanager_content_download(uuid, uuid) to authenticated;


-- ============================================================
-- H. RPC: concluir com sucesso
--
-- Deduplicacao acontece AQUI, numa transacao: o insert do blob usa
-- ON CONFLICT (sha256) DO NOTHING e o vinculo aponta para a linha
-- vencedora. Duas execucoes concorrentes do mesmo conteudo produzem
-- um blob so -- e como o path e' derivado do sha256, ate um upload
-- concorrente escreve exatamente no mesmo lugar, com os mesmos bytes.
--
-- Idempotente: reexecutar com o mesmo sha256 nao cria blob novo e nao
-- quebra o vinculo; so atualiza os carimbos de tempo.
-- ============================================================

create or replace function public.complete_construmanager_content_download(
  p_project_id uuid,
  p_link_id uuid,
  p_sha256 text,
  p_size_bytes bigint,
  p_storage_bucket text,
  p_storage_path text,
  p_mime_type text,
  p_detected_extension text,
  p_zip_entry_path text
)
returns table (
  blob_id uuid,
  blob_reused boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blob_id uuid;
  v_reused boolean := true;
begin
  if auth.uid() is null then
    raise exception 'Sessao nao autenticada.';
  end if;

  if not public.has_project_permission(p_project_id, 'ADMINISTRADOR') then
    raise exception 'Permissao ADMINISTRADOR e necessaria para armazenar conteudo do Construmanager.';
  end if;

  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'SHA-256 invalido.';
  end if;

  if p_size_bytes is null or p_size_bytes < 0 then
    raise exception 'Tamanho de conteudo invalido.';
  end if;

  insert into public.construmanager_content_blobs (
    sha256, size_bytes, storage_bucket, storage_path,
    mime_type, detected_extension
  )
  values (
    p_sha256, p_size_bytes, p_storage_bucket, p_storage_path,
    nullif(btrim(coalesce(p_mime_type, '')), ''),
    nullif(btrim(coalesce(p_detected_extension, '')), '')
  )
  on conflict (sha256) do nothing
  returning id into v_blob_id;

  if v_blob_id is null then
    select b.id into v_blob_id
      from public.construmanager_content_blobs b
     where b.sha256 = p_sha256;
  else
    v_reused := false;
  end if;

  if v_blob_id is null then
    raise exception 'Falha ao resolver o conteudo armazenado.';
  end if;

  update public.construmanager_content_links
     set content_blob_id = v_blob_id,
         download_status = 'ARMAZENADO',
         downloaded_at = now(),
         last_checked_at = now(),
         download_error = null,
         zip_entry_path = nullif(left(btrim(coalesce(p_zip_entry_path, '')), 1000), ''),
         updated_at = now()
   where id = p_link_id
     and project_id = p_project_id;

  if not found then
    raise exception 'Vinculo de conteudo nao encontrado neste projeto.';
  end if;

  return query select v_blob_id, v_reused;
end;
$$;

revoke all on function public.complete_construmanager_content_download(uuid, uuid, text, bigint, text, text, text, text, text) from public;
revoke all on function public.complete_construmanager_content_download(uuid, uuid, text, bigint, text, text, text, text, text) from anon;
grant execute on function public.complete_construmanager_content_download(uuid, uuid, text, bigint, text, text, text, text, text) to authenticated;


-- ============================================================
-- I. RPC: registrar falha
--
-- Nunca apaga content_blob_id: conteudo ja preservado sobrevive a uma
-- tentativa posterior malsucedida (regras 9 e 10 do CLAUDE.md).
-- ============================================================

create or replace function public.fail_construmanager_content_download(
  p_project_id uuid,
  p_link_id uuid,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sessao nao autenticada.';
  end if;

  if not public.has_project_permission(p_project_id, 'ADMINISTRADOR') then
    raise exception 'Permissao ADMINISTRADOR e necessaria para baixar conteudo do Construmanager.';
  end if;

  update public.construmanager_content_links
     set download_status = 'ERRO',
         last_checked_at = now(),
         download_error = nullif(left(btrim(coalesce(p_error, '')), 1000), ''),
         updated_at = now()
   where id = p_link_id
     and project_id = p_project_id;

  if not found then
    raise exception 'Vinculo de conteudo nao encontrado neste projeto.';
  end if;
end;
$$;

revoke all on function public.fail_construmanager_content_download(uuid, uuid, text) from public;
revoke all on function public.fail_construmanager_content_download(uuid, uuid, text) from anon;
grant execute on function public.fail_construmanager_content_download(uuid, uuid, text) to authenticated;
