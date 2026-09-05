-- Pacote D — automacao da ingestao de conteudo do Construmanager.
--
-- O Pacote C provou o caminho manual: baixar, calcular SHA-256, armazenar
-- de forma deduplicada. Esta migration acrescenta SOMENTE o que a execucao
-- automatica exige e o caminho manual nao precisava:
--
--   1. LEASE  — impede dois workers no mesmo vinculo.
--   2. BACKOFF — impede reprocessamento imediato e infinito.
--   3. TETO DE TENTATIVAS — depois de 3 falhas automaticas o item para de
--      ser reagendado e passa a exigir decisao humana.
--   4. REFERENCIA_EXTERNA — arquivo acima do limite de armazenamento
--      fica no Construmanager. Nao e erro, nao e pendencia: e politica.
--   5. DECISAO HUMANA — reservada a ANOMALIA REAL (tamanho ausente,
--      metadados inconsistentes, tentativas esgotadas em item elegivel).
--      Tamanho grande, sozinho, NUNCA gera decisao humana.
--   6. METRICAS POR EXECUCAO — uma linha por rodada do worker.
--
-- O que esta migration NAO faz, de proposito:
--
--   - nao altera nenhuma coluna existente de construmanager_content_links
--     (download_status, download_attempts, downloaded_at, content_blob_id,
--     download_error, zip_entry_path continuam com o mesmo significado);
--   - nao toca nas tabelas do Pacote B nem nos blobs;
--   - nao altera as 5 RPCs do Pacote C — o caminho manual do ADMINISTRADOR
--     continua identico, byte a byte, ao que executou o piloto.
--
-- MODELO DE AUTORIZACAO — duas portas separadas
--
--   Caminho MANUAL (Pacote C): RPCs exigem auth.uid() nao nulo +
--   has_project_permission(..., 'ADMINISTRADOR'). Concedidas a
--   `authenticated`.
--
--   Caminho AUTOMATICO (Pacote D): o worker roda fora do navegador, sem
--   sessao — auth.uid() e SEMPRE nulo. Por isso as RPCs deste arquivo
--   NAO checam auth.uid(): elas sao concedidas EXCLUSIVAMENTE a
--   `service_role`, e revogadas de public/anon/authenticated. A seguranca
--   vem de quem consegue invoca-las (posse da secret key server-side),
--   exatamente como o precedente ja documentado em
--   apps/web/lib/email/send-action-request-notification-system.ts.
--
--   Um usuario logado NAO alcanca estas funcoes. Isso importa: sem o
--   grant restrito, qualquer `authenticated` poderia disparar downloads
--   ignorando a exigencia de ADMINISTRADOR do caminho manual.

-- ---------------------------------------------------------------------
-- 1. Estado de automacao nos vinculos
-- ---------------------------------------------------------------------

-- REFERENCIA_EXTERNA — arquivo que fica no Construmanager, por politica.
--
-- Nao e erro e nao e decisao humana. E uma decisao de ARMAZENAMENTO:
-- acima do limite configurado, o ACC preserva a referencia documental e
-- nao a copia binaria. O arquivo continua existindo e acessivel na
-- plataforma de origem.
--
-- Misturar isso com ERRO seria mentir sobre o estado do acervo e
-- encheria a fila de itens que nunca deveriam ser tentados; misturar com
-- requires_human_decision produziria uma caixa de entrada de "pendencias"
-- que ninguem consegue resolver, porque nao ha nada a decidir.
alter table public.construmanager_content_links
  drop constraint if exists construmanager_content_links_status_check;

alter table public.construmanager_content_links
  add constraint construmanager_content_links_status_check
  check (download_status in ('PENDENTE', 'BAIXANDO', 'ARMAZENADO', 'ERRO', 'REFERENCIA_EXTERNA'));

alter table public.construmanager_content_links
  -- Rastreabilidade da classificacao: por que, contra qual limite, com
  -- que tamanho e quando. Sem isso, mudar o limite depois viraria uma
  -- reclassificacao cega — nao daria para saber se um item e referencia
  -- externa por politica antiga ou atual.
  add column if not exists external_reference_reason text,
  add column if not exists external_reference_limit_bytes bigint,
  add column if not exists external_reference_size_bytes bigint,
  add column if not exists external_reference_at timestamptz;

alter table public.construmanager_content_links
  -- Identificador do worker que detem o lease. Texto livre e nao um FK:
  -- o worker nao e um usuario nem uma linha de tabela; e um processo
  -- efemero identificado por run id do agendador.
  add column if not exists lease_owner text,

  -- Ate quando o lease vale. Um worker morto (OOM, timeout do runner,
  -- cancelamento) nao devolve o lease; a expiracao e o que permite a
  -- retomada segura sem intervencao humana.
  add column if not exists lease_expires_at timestamptz,

  -- Antes deste instante o item nao volta para a fila. E o backoff.
  add column if not exists next_attempt_at timestamptz,

  -- Tentativas AUTOMATICAS. Contador proprio, separado de
  -- download_attempts (que conta todas, inclusive as manuais): o teto de
  -- 3 nao pode ser consumido por cliques de contingencia do
  -- administrador, nem o contrario.
  add column if not exists auto_attempts integer not null default 0,

  -- Item saiu da automacao e aguarda gente. Nunca e reagendado enquanto
  -- estiver true.
  add column if not exists requires_human_decision boolean not null default false,
  add column if not exists human_decision_reason text,
  add column if not exists human_decision_at timestamptz;

alter table public.construmanager_content_links
  drop constraint if exists construmanager_content_links_auto_attempts_check;

alter table public.construmanager_content_links
  add constraint construmanager_content_links_auto_attempts_check
  check (auto_attempts >= 0);

-- Coerencia: se exige decisao humana, o motivo e a data acompanham.
alter table public.construmanager_content_links
  drop constraint if exists construmanager_content_links_human_decision_check;

alter table public.construmanager_content_links
  add constraint construmanager_content_links_human_decision_check
  check (
    requires_human_decision = false
    or (human_decision_reason is not null and human_decision_at is not null)
  );

-- Lease so faz sentido com dono e prazo juntos.
alter table public.construmanager_content_links
  drop constraint if exists construmanager_content_links_lease_check;

alter table public.construmanager_content_links
  add constraint construmanager_content_links_lease_check
  check (num_nonnulls(lease_owner, lease_expires_at) <> 1);

-- Invariante da referencia externa, imposta pelo banco e nao por
-- convencao de codigo: quem esta em REFERENCIA_EXTERNA carrega os quatro
-- campos de rastreabilidade, NAO tem conteudo binario e NAO ocupa a fila.
alter table public.construmanager_content_links
  drop constraint if exists construmanager_content_links_external_reference_check;

alter table public.construmanager_content_links
  add constraint construmanager_content_links_external_reference_check
  check (
    download_status <> 'REFERENCIA_EXTERNA'
    or (
      external_reference_reason is not null
      and external_reference_limit_bytes is not null
      and external_reference_size_bytes is not null
      and external_reference_at is not null
      and content_blob_id is null
      and downloaded_at is null
      and download_error is null
      and requires_human_decision = false
      and lease_owner is null
      and next_attempt_at is null
    )
  );

-- Indice da fila: o worker pergunta sempre a mesma coisa — o que esta
-- elegivel agora, neste projeto. Parcial para nao indexar os 200+
-- ARMAZENADO que nunca mais voltam a fila.
-- BAIXANDO entra no indice porque um lease expirado devolve o item a
-- fila sem que o status mude antes da proxima aquisicao.
create index if not exists construmanager_content_links_queue_idx
  on public.construmanager_content_links (project_id, next_attempt_at)
  where download_status in ('PENDENTE', 'ERRO', 'BAIXANDO')
    and requires_human_decision = false;

-- Indice das pendencias humanas, para a UI e para alerta.
create index if not exists construmanager_content_links_human_decision_idx
  on public.construmanager_content_links (project_id, human_decision_at)
  where requires_human_decision = true;

comment on column public.construmanager_content_links.auto_attempts is
  'Tentativas automaticas (worker). Separado de download_attempts, que conta todas as tentativas incluindo as manuais.';

comment on column public.construmanager_content_links.requires_human_decision is
  'true = item saiu da fila automatica e aguarda decisao humana. Nunca e reagendado enquanto true.';

-- ---------------------------------------------------------------------
-- 2. Metricas por execucao do worker
-- ---------------------------------------------------------------------

create table if not exists public.construmanager_content_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  integration_id uuid not null references public.project_integrations(id) on delete cascade,

  started_at timestamptz not null default now(),
  completed_at timestamptz,

  -- DRY_RUN e um resultado legitimo, nao um erro: a rodada rodou, olhou
  -- a fila e nao gravou nada por decisao de configuracao.
  status text not null default 'EXECUTANDO'
    check (status in ('EXECUTANDO', 'SUCESSO', 'PARCIAL', 'ERRO', 'DRY_RUN')),

  -- AUTOMATICO = worker agendado. MANUAL = worker disparado a mao
  -- (workflow_dispatch) — util para o roteiro de ativacao gradual.
  trigger_type text not null default 'AUTOMATICO'
    check (trigger_type in ('AUTOMATICO', 'MANUAL')),

  dry_run boolean not null default false,
  worker_id text,

  selected integer not null default 0,
  stored integer not null default 0,
  reused integer not null default 0,
  failed integer not null default 0,
  human_decision_count integer not null default 0,
  -- Quantos itens do projeto estao como REFERENCIA_EXTERNA ao fim da
  -- rodada. Metrica de acervo, nao de falha.
  external_references integer not null default 0,

  -- Bytes que sairam do Construmanager vs. bytes que de fato ocuparam
  -- disco. A diferenca entre os dois E a deduplicacao, medida.
  bytes_downloaded bigint not null default 0,
  bytes_stored bigint not null default 0,

  duration_ms integer,

  -- Sempre sanitizado. Nunca credencial, token, Authorization ou caminho
  -- de arquivo temporario local.
  error text,

  created_at timestamptz not null default now(),

  constraint construmanager_content_runs_counters_check check (
    selected >= 0 and stored >= 0 and reused >= 0 and failed >= 0
    and human_decision_count >= 0 and external_references >= 0
    and bytes_downloaded >= 0 and bytes_stored >= 0
  ),

  -- bytes_stored nunca pode superar bytes_downloaded: armazenar mais do
  -- que se baixou nao tem significado fisico.
  constraint construmanager_content_runs_bytes_check
    check (bytes_stored <= bytes_downloaded)
);

create index if not exists construmanager_content_runs_project_idx
  on public.construmanager_content_runs (project_id, started_at desc);

alter table public.construmanager_content_runs enable row level security;

-- Leitura para membros do projeto. Escrita SOMENTE via as RPCs abaixo
-- (service_role), como em todo o resto do sistema.
drop policy if exists construmanager_content_runs_select_members
  on public.construmanager_content_runs;

create policy construmanager_content_runs_select_members
  on public.construmanager_content_runs
  for select
  to authenticated
  using (public.is_project_member(project_id));

-- ---------------------------------------------------------------------
-- 3. RPCs do worker — service_role apenas
-- ---------------------------------------------------------------------

-- Preparacao automatica dos vinculos apos sincronizacao de metadados.
-- Mesma semantica de ensure_construmanager_content_links (INSERT ... ON
-- CONFLICT DO NOTHING), sem a exigencia de sessao/ADMINISTRADOR, porque
-- quem chama e o worker.
create or replace function public.ensure_construmanager_content_links_system(
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
          and l.download_status in ('PENDENTE', 'ERRO')
          and l.requires_human_decision = false);
end;
$$;

-- Classificacao de referencia externa — roda ANTES de qualquer download.
--
-- Decide exclusivamente pelo size_bytes ja presente nos metadados do
-- Pacote B. Nenhum byte trafega para descobrir tamanho: o item grande e
-- separado antes de existir qualquer conexao com a API.
--
-- Idempotente e REVERSIVEL nos dois sentidos:
--
--   acima do limite  -> vira REFERENCIA_EXTERNA (se ainda nao for)
--   abaixo do limite -> volta para PENDENTE (se era referencia externa)
--
-- O segundo caso e o que torna o limite uma politica de verdade, e nao
-- uma porta de mao unica: aumentar CONSTRUMANAGER_AUTO_MAX_FILE_BYTES
-- devolve os itens a fila na proxima execucao, sem intervencao manual e
-- sem download imediato — eles voltam como PENDENTE e esperam a vez.
--
-- Itens ja ARMAZENADOS nunca sao tocados: conteudo preservado nao vira
-- referencia externa por mudanca de politica.
create or replace function public.classify_construmanager_external_references(
  p_project_id uuid,
  p_max_bytes bigint
)
returns table (
  classified integer,
  reverted integer,
  external_total integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_classified integer := 0;
  v_reverted integer := 0;
begin
  if p_max_bytes is null or p_max_bytes <= 0 then
    raise exception 'Limite de tamanho invalido para classificacao.';
  end if;

  -- 1. Acima do limite => referencia externa.
  with alvos as (
    select l.id, coalesce(d.size_bytes, v.size_bytes) as size_bytes
      from public.construmanager_content_links l
      left join public.construmanager_documents d on d.id = l.document_id
      left join public.construmanager_document_versions v on v.id = l.version_id
     where l.project_id = p_project_id
       and l.download_status in ('PENDENTE', 'ERRO')
       and coalesce(d.size_bytes, v.size_bytes) is not null
       and coalesce(d.size_bytes, v.size_bytes) > p_max_bytes
  ),
  atualizados as (
    update public.construmanager_content_links l
       set download_status = 'REFERENCIA_EXTERNA',
           external_reference_reason = 'ACIMA_DO_LIMITE_DE_ARMAZENAMENTO',
           external_reference_limit_bytes = p_max_bytes,
           external_reference_size_bytes = a.size_bytes,
           external_reference_at = now(),
           -- Limpa qualquer residuo de tentativa anterior: o item sai da
           -- fila por politica, nao por falha.
           download_error = null,
           next_attempt_at = null,
           lease_owner = null,
           lease_expires_at = null,
           auto_attempts = 0,
           requires_human_decision = false,
           human_decision_reason = null,
           human_decision_at = null,
           updated_at = now()
      from alvos a
     where l.id = a.id
    returning 1
  )
  select count(*) into v_classified from atualizados;

  -- 2. Abaixo do limite atual => volta para a fila.
  with devolvidos as (
    update public.construmanager_content_links l
       set download_status = 'PENDENTE',
           external_reference_reason = null,
           external_reference_limit_bytes = null,
           external_reference_size_bytes = null,
           external_reference_at = null,
           auto_attempts = 0,
           next_attempt_at = null,
           updated_at = now()
      from (
        select l2.id
          from public.construmanager_content_links l2
          left join public.construmanager_documents d on d.id = l2.document_id
          left join public.construmanager_document_versions v on v.id = l2.version_id
         where l2.project_id = p_project_id
           and l2.download_status = 'REFERENCIA_EXTERNA'
           and coalesce(d.size_bytes, v.size_bytes) is not null
           and coalesce(d.size_bytes, v.size_bytes) <= p_max_bytes
      ) a
     where l.id = a.id
    returning 1
  )
  select count(*) into v_reverted from devolvidos;

  return query
    select
      v_classified,
      v_reverted,
      (select count(*)::integer from public.construmanager_content_links l
        where l.project_id = p_project_id
          and l.download_status = 'REFERENCIA_EXTERNA');
end;
$$;

-- Aquisicao atomica de alvos.
--
-- FOR UPDATE SKIP LOCKED e o coracao da exclusao mutua: dois workers
-- concorrentes pegam conjuntos DISJUNTOS de linhas, sem bloquear um ao
-- outro e sem nunca sobrepor o mesmo vinculo. O lease cobre o caso
-- seguinte — o worker que morre segurando a linha depois do COMMIT.
--
-- O filtro de tamanho usa os metadados do Pacote B (size_bytes), NAO um
-- download exploratorio: arquivo grande e excluido da fila automatica
-- antes de qualquer byte trafegar.
create or replace function public.claim_construmanager_content_targets(
  p_project_id uuid,
  p_worker_id text,
  p_limit integer,
  p_max_bytes bigint,
  p_lease_seconds integer
)
returns table (
  link_id uuid,
  construmanager_object_id bigint,
  source_name text,
  size_bytes bigint,
  extension_normalized text,
  is_version boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'worker_id e obrigatorio para adquirir alvos.';
  end if;

  if p_limit is null or p_limit <= 0 or p_limit > 100 then
    raise exception 'limite invalido para aquisicao de alvos.';
  end if;

  if p_lease_seconds is null or p_lease_seconds <= 0 then
    raise exception 'lease_seconds invalido.';
  end if;

  return query
  with candidatos as (
    select l.id
      from public.construmanager_content_links l
      left join public.construmanager_documents d on d.id = l.document_id
      left join public.construmanager_document_versions v on v.id = l.version_id
     where l.project_id = p_project_id
       -- PENDENTE/ERRO sao a fila normal. BAIXANDO com lease EXPIRADO
       -- tambem entra: e o worker que morreu segurando a linha (OOM,
       -- timeout do runner, cancelamento). Sem esta clausula o item
       -- ficaria preso em BAIXANDO para sempre e a "retomada apos
       -- interrupcao" nao existiria de fato.
       and (
         l.download_status in ('PENDENTE', 'ERRO')
         or (
           l.download_status = 'BAIXANDO'
           and l.lease_expires_at is not null
           and l.lease_expires_at <= now()
         )
       )
       and l.requires_human_decision = false
       -- backoff respeitado
       and (l.next_attempt_at is null or l.next_attempt_at <= now())
       -- lease livre ou expirado
       and (l.lease_expires_at is null or l.lease_expires_at <= now())
       -- teto de tamanho, a partir dos metadados
       and coalesce(d.size_bytes, v.size_bytes) is not null
       and coalesce(d.size_bytes, v.size_bytes) <= p_max_bytes
     order by coalesce(l.next_attempt_at, l.created_at), l.id
     limit p_limit
     for update of l skip locked
  ),
  adquiridos as (
    update public.construmanager_content_links l
       set download_status = 'BAIXANDO',
           lease_owner = p_worker_id,
           lease_expires_at = now() + make_interval(secs => p_lease_seconds),
           download_attempts = l.download_attempts + 1,
           auto_attempts = l.auto_attempts + 1,
           last_checked_at = now(),
           download_error = null,
           updated_at = now()
     where l.id in (select id from candidatos)
    returning l.id, l.construmanager_object_id, l.source_name,
              l.document_id, l.version_id
  )
  select a.id,
         a.construmanager_object_id,
         a.source_name,
         coalesce(d.size_bytes, v.size_bytes)::bigint,
         coalesce(d.extension_normalized, v.extension_normalized),
         (a.version_id is not null)
    from adquiridos a
    left join public.construmanager_documents d on d.id = a.document_id
    left join public.construmanager_document_versions v on v.id = a.version_id;
end;
$$;

-- Conclusao de um alvo adquirido. Delega a deduplicacao a RPC do Pacote
-- C, que NAO e reimplementada aqui: manter duas maquinas de dedup em
-- sincronia seria a forma mais barata de corromper o acervo.
create or replace function public.complete_construmanager_content_download_system(
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
returns table (blob_id uuid, blob_reused boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blob_id uuid;
  v_reused boolean;
begin
  select c.blob_id, c.blob_reused
    into v_blob_id, v_reused
    from public.complete_construmanager_content_download(
      p_project_id, p_link_id, p_sha256, p_size_bytes,
      p_storage_bucket, p_storage_path, p_mime_type,
      p_detected_extension, p_zip_entry_path
    ) c;

  -- Sucesso encerra o lease e zera o backoff: o item saiu da fila.
  update public.construmanager_content_links
     set lease_owner = null,
         lease_expires_at = null,
         next_attempt_at = null,
         updated_at = now()
   where id = p_link_id
     and project_id = p_project_id;

  return query select v_blob_id, v_reused;
end;
$$;

-- Falha automatica: registra, aplica backoff e, no teto, entrega para
-- decisao humana em vez de continuar tentando para sempre.
create or replace function public.fail_construmanager_content_download_system(
  p_project_id uuid,
  p_link_id uuid,
  p_error text,
  p_backoff_seconds integer,
  p_max_auto_attempts integer
)
returns table (auto_attempts integer, requires_human_decision boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
  v_exhausted boolean;
  v_name text;
begin
  select l.auto_attempts, l.source_name
    into v_attempts, v_name
    from public.construmanager_content_links l
   where l.id = p_link_id and l.project_id = p_project_id;

  if v_attempts is null then
    raise exception 'Vinculo de conteudo nao encontrado neste projeto.';
  end if;

  v_exhausted := v_attempts >= p_max_auto_attempts;

  update public.construmanager_content_links l
     set download_status = 'ERRO',
         download_error = p_error,
         -- content_blob_id NUNCA e limpo aqui: se um conteudo ja foi
         -- preservado, uma falha posterior nao pode apaga-lo.
         lease_owner = null,
         lease_expires_at = null,
         next_attempt_at = case
           when v_exhausted then null
           else now() + make_interval(secs => greatest(p_backoff_seconds, 1))
         end,
         requires_human_decision = v_exhausted,
         human_decision_reason = case
           when v_exhausted then 'TENTATIVAS_AUTOMATICAS_ESGOTADAS'
           else l.human_decision_reason
         end,
         human_decision_at = case
           when v_exhausted then now()
           else l.human_decision_at
         end,
         updated_at = now()
   where l.id = p_link_id and l.project_id = p_project_id;

  if v_exhausted then
    insert into public.audit_log_entries (
      project_id, actor_type, actor_user_id, actor_label,
      action, entity_type, entity_id, detail
    ) values (
      p_project_id, 'SYSTEM', null, null,
      'CONSTRUMANAGER_CONTENT_REQUIRES_HUMAN_DECISION',
      'CONSTRUMANAGER_CONTENT_LINK', p_link_id::text,
      format(
        'Download automatico de "%s" esgotou %s tentativas e aguarda decisao humana. Ultimo erro: %s',
        coalesce(v_name, '(sem nome)'), p_max_auto_attempts, coalesce(p_error, '(sem detalhe)')
      )
    );
  end if;

  return query select v_attempts, v_exhausted;
end;
$$;

-- Sinalizacao explicita de decisao humana sem consumir tentativa.
-- Usada para arquivo acima do teto automatico e para tamanho
-- desconhecido — casos em que tentar seria previsivelmente inutil.
create or replace function public.flag_construmanager_content_human_decision(
  p_project_id uuid,
  p_link_id uuid,
  p_reason text,
  p_detail text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_ja boolean;
begin
  select l.source_name, l.requires_human_decision
    into v_name, v_ja
    from public.construmanager_content_links l
   where l.id = p_link_id and l.project_id = p_project_id;

  if v_name is null then
    raise exception 'Vinculo de conteudo nao encontrado neste projeto.';
  end if;

  -- Idempotente: sinalizar duas vezes nao gera dois alertas.
  if v_ja then
    return;
  end if;

  update public.construmanager_content_links
     set requires_human_decision = true,
         human_decision_reason = p_reason,
         human_decision_at = now(),
         lease_owner = null,
         lease_expires_at = null,
         next_attempt_at = null,
         updated_at = now()
   where id = p_link_id and project_id = p_project_id;

  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, actor_label,
    action, entity_type, entity_id, detail
  ) values (
    p_project_id, 'SYSTEM', null, null,
    'CONSTRUMANAGER_CONTENT_REQUIRES_HUMAN_DECISION',
    'CONSTRUMANAGER_CONTENT_LINK', p_link_id::text,
    format('"%s": %s. %s', coalesce(v_name, '(sem nome)'), p_reason, coalesce(p_detail, ''))
  );
end;
$$;

-- Devolve leases de itens que a rodada adquiriu mas nao processou
-- (estouro do orcamento de tempo). Sem isso o item so voltaria a fila
-- quando o lease expirasse.
create or replace function public.release_construmanager_content_lease(
  p_project_id uuid,
  p_link_id uuid,
  p_worker_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.construmanager_content_links
     set download_status = 'PENDENTE',
         lease_owner = null,
         lease_expires_at = null,
         -- A tentativa consumida na aquisicao e devolvida: o item nunca
         -- chegou a ser baixado, entao nao pode contar contra o teto.
         auto_attempts = greatest(auto_attempts - 1, 0),
         download_attempts = greatest(download_attempts - 1, 0),
         updated_at = now()
   where id = p_link_id
     and project_id = p_project_id
     and lease_owner = p_worker_id
     and download_status = 'BAIXANDO';
end;
$$;

-- Metricas: abertura e fechamento da rodada.
create or replace function public.start_construmanager_content_run(
  p_project_id uuid,
  p_worker_id text,
  p_trigger_type text,
  p_dry_run boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_integration_id uuid;
  v_run_id uuid;
begin
  select pi.id into v_integration_id
    from public.project_integrations pi
   where pi.project_id = p_project_id
     and pi.source_type = 'CONSTRUMANAGER';

  if v_integration_id is null then
    raise exception 'Integracao Construmanager nao configurada para este projeto.';
  end if;

  insert into public.construmanager_content_runs (
    project_id, integration_id, worker_id, trigger_type, dry_run, status
  ) values (
    p_project_id, v_integration_id, p_worker_id,
    coalesce(p_trigger_type, 'AUTOMATICO'), coalesce(p_dry_run, false), 'EXECUTANDO'
  )
  returning id into v_run_id;

  return v_run_id;
end;
$$;

create or replace function public.finish_construmanager_content_run(
  p_run_id uuid,
  p_status text,
  p_selected integer,
  p_stored integer,
  p_reused integer,
  p_failed integer,
  p_human_decision_count integer,
  p_external_references integer,
  p_bytes_downloaded bigint,
  p_bytes_stored bigint,
  p_duration_ms integer,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.construmanager_content_runs
     set status = p_status,
         completed_at = now(),
         selected = coalesce(p_selected, 0),
         stored = coalesce(p_stored, 0),
         reused = coalesce(p_reused, 0),
         failed = coalesce(p_failed, 0),
         human_decision_count = coalesce(p_human_decision_count, 0),
         external_references = coalesce(p_external_references, 0),
         bytes_downloaded = coalesce(p_bytes_downloaded, 0),
         bytes_stored = coalesce(p_bytes_stored, 0),
         duration_ms = p_duration_ms,
         error = p_error
   where id = p_run_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Grants — a porta do worker e SOMENTE service_role
-- ---------------------------------------------------------------------

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.ensure_construmanager_content_links_system(uuid)',
    'public.classify_construmanager_external_references(uuid, bigint)',
    'public.claim_construmanager_content_targets(uuid, text, integer, bigint, integer)',
    'public.complete_construmanager_content_download_system(uuid, uuid, text, bigint, text, text, text, text, text)',
    'public.fail_construmanager_content_download_system(uuid, uuid, text, integer, integer)',
    'public.flag_construmanager_content_human_decision(uuid, uuid, text, text)',
    'public.release_construmanager_content_lease(uuid, uuid, text)',
    'public.start_construmanager_content_run(uuid, text, text, boolean)',
    'public.finish_construmanager_content_run(uuid, text, integer, integer, integer, integer, integer, integer, bigint, bigint, integer, text)'
  ]
  loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('revoke all on function %s from authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$;

-- ---------------------------------------------------------------------
-- 5. NOVA VERSAO VIGENTE — deteccao por metadados, sem download
-- ---------------------------------------------------------------------
--
-- A REGRA (derivada do payload real; ver version-vigency.ts):
--
--   vigente    = linha com isVersao = 0 (nossa tabela de documentos)
--   revisao    = cad_objects_versoes    (coluna `revision`)
--   identidade = cad_objects_id         (`construmanager_object_id`),
--                ESTAVEL entre revisoes
--   historico  = isVersao = 1, apontando a cabeca por cad_objects_super
--
-- Logo, "nova versao vigente" e' MUDANCA DE `revision` no MESMO
-- `construmanager_object_id`. Nao e' id novo, nao e' nome, nao e' data.
--
-- Por que uma tabela de vigencia separada: construmanager_documents e'
-- atualizada por upsert a cada sincronizacao, entao a revisao anterior
-- seria sobrescrita antes de qualquer comparacao. O ponteiro de vigencia
-- guarda o ultimo estado OBSERVADO — e e' o unico jeito de saber o que
-- mudou sem alterar as tabelas do Pacote B.
--
-- INDEPENDENCIA TOTAL DE CONTEUDO: nada aqui le blob, SHA-256, Storage
-- ou hiperlink. Um arquivo grande, que nunca sera baixado, tem sua troca
-- de revisao detectada e alertada exatamente como os pequenos.

create table if not exists public.construmanager_document_vigency (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  integration_id uuid not null references public.project_integrations(id) on delete cascade,

  -- Identidade documental estavel. E a chave do monitoramento.
  construmanager_object_id bigint not null,

  current_revision text,
  current_name text,
  current_source_created_at timestamptz,
  current_author_name text,
  current_size_bytes bigint,
  current_folder_path text,

  -- Quando a vigencia ATUAL passou a valer, segundo o ACC.
  vigency_detected_at timestamptz not null default now(),
  -- Ultima vez que este documento foi visto numa sincronizacao.
  last_seen_at timestamptz not null default now(),

  first_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint construmanager_document_vigency_object_key
    unique (integration_id, construmanager_object_id)
);

create index if not exists construmanager_document_vigency_project_idx
  on public.construmanager_document_vigency (project_id, vigency_detected_at desc);

alter table public.construmanager_document_vigency enable row level security;

drop policy if exists construmanager_document_vigency_select_members
  on public.construmanager_document_vigency;

create policy construmanager_document_vigency_select_members
  on public.construmanager_document_vigency
  for select
  to authenticated
  using (public.is_project_member(project_id));

-- Ledger IMUTAVEL das transicoes. Nenhuma linha e' sobrescrita ou
-- apagada: o historico de vigencia e' evidencia contratual.
create table if not exists public.construmanager_version_transitions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  integration_id uuid not null references public.project_integrations(id) on delete cascade,

  construmanager_object_id bigint not null,
  document_name text,

  previous_revision text,
  new_revision text not null,
  previous_object_id bigint,
  new_object_id bigint not null,

  source_created_at timestamptz,
  author_name text,
  size_bytes bigint,
  folder_path text,

  -- ARMAZENADO_NO_ACC | SOMENTE_NO_CONSTRUMANAGER no momento da deteccao.
  content_availability text not null
    check (content_availability in ('ARMAZENADO_NO_ACC', 'SOMENTE_NO_CONSTRUMANAGER')),

  -- Identificador IMUTAVEL da observacao que produziu esta transicao.
  -- Vem de construmanager_sync_runs.id quando a deteccao roda logo apos
  -- uma sincronizacao; caso contrario a propria deteccao gera um.
  sync_run_id uuid not null,

  detected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  -- Identidade da transicao.
  --
  -- NAO e (documento, revisao nova): isso proibiria PERMANENTEMENTE que
  -- uma revisao voltasse a ser vigente. O ciclo real R04 -> R05 -> R04
  -- -> R05 tem QUATRO transicoes operacionais legitimas, e a quarta
  -- seria silenciosamente suprimida — justamente a que mais importa,
  -- porque significa que alguem reverteu e depois reaplicou.
  --
  -- A identidade correta e a OBSERVACAO: dentro de uma mesma execucao um
  -- documento produz no maximo uma transicao. Execucoes diferentes sem
  -- mudanca nao geram evento porque o ponteiro de vigencia ja coincide —
  -- a idempotencia vem do ponteiro, nao de proibir a revisao.
  constraint construmanager_version_transitions_unique
    unique (integration_id, construmanager_object_id, sync_run_id)
);

create index if not exists construmanager_version_transitions_project_idx
  on public.construmanager_version_transitions (project_id, detected_at desc);

alter table public.construmanager_version_transitions enable row level security;

drop policy if exists construmanager_version_transitions_select_members
  on public.construmanager_version_transitions;

create policy construmanager_version_transitions_select_members
  on public.construmanager_version_transitions
  for select
  to authenticated
  using (public.is_project_member(project_id));

-- Normalizacao da revisao para COMPARACAO (nunca para exibicao).
-- "01", "1" e " 01 " sao a mesma revisao: sem isso, uma mudanca de
-- formatacao viraria alerta falso a cada sincronizacao.
create or replace function public.normalize_construmanager_revision(
  p_revision text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    upper(regexp_replace(btrim(coalesce(p_revision, '')), '^0+([0-9])', '\1')),
    ''
  );
$$;

-- Deteccao. Idempotente por construcao:
--   documento novo -> registra vigencia, NAO alerta (e a carga inicial)
--   revisao igual  -> so atualiza last_seen_at
--   revisao mudou  -> grava transicao + auditoria e move o ponteiro
--
-- Rodar duas vezes seguidas produz zero alertas na segunda.
create or replace function public.detect_construmanager_version_transitions(
  p_project_id uuid,
  p_sync_run_id uuid default null
)
returns table (
  first_observations integer,
  transitions integer,
  unchanged integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_integration_id uuid;
  v_first integer := 0;
  v_trans integer := 0;
  v_same integer := 0;
  r record;
  v_previous public.construmanager_document_vigency%rowtype;
  v_availability text;
  v_transition_id uuid;
  -- Uma execucao = um identificador de observacao. Quando a deteccao roda
  -- logo apos uma sincronizacao, recebe o sync_run_id dela; senao gera o
  -- proprio. Nunca depende de timestamp local como protecao.
  v_run_id uuid := coalesce(p_sync_run_id, gen_random_uuid());
begin
  -- Sessao presente => exige ADMINISTRADOR. Sessao ausente => so
  -- service_role chega aqui (ver grants). As duas portas, uma checagem.
  if auth.uid() is not null
     and not public.has_project_permission(p_project_id, 'ADMINISTRADOR') then
    raise exception 'Permissao ADMINISTRADOR e necessaria para detectar transicoes de versao.';
  end if;
  select pi.id into v_integration_id
    from public.project_integrations pi
   where pi.project_id = p_project_id
     and pi.source_type = 'CONSTRUMANAGER';

  if v_integration_id is null then
    raise exception 'Integracao Construmanager nao configurada para este projeto.';
  end if;

  for r in
    select d.construmanager_object_id, d.revision, d.name,
           d.source_created_at, d.author_name, d.size_bytes, d.folder_path
      from public.construmanager_documents d
     where d.project_id = p_project_id
       and d.integration_id = v_integration_id
  loop
    -- FOR UPDATE: serializa detectores concorrentes POR DOCUMENTO.
    -- Em READ COMMITTED, quem espera o bloqueio RELE a linha ja
    -- atualizada pelo vencedor — entao o segundo detector encontra o
    -- ponteiro ja em R05 e conclui SEM_MUDANCA, em vez de gravar uma
    -- segunda transicao. O ponteiro, a transicao e a auditoria vivem na
    -- mesma transacao da funcao: ou tudo acontece, ou nada.
    select * into v_previous
      from public.construmanager_document_vigency v
     where v.integration_id = v_integration_id
       and v.construmanager_object_id = r.construmanager_object_id
     for update;

    -- Primeira observacao: linha de base, sem alerta. Alertar aqui
    -- encheria a caixa de entrada com 192 "novidades" que sao apenas o
    -- acervo que ja existia.
    if not found then
      insert into public.construmanager_document_vigency (
        project_id, integration_id, construmanager_object_id,
        current_revision, current_name, current_source_created_at,
        current_author_name, current_size_bytes, current_folder_path
      ) values (
        p_project_id, v_integration_id, r.construmanager_object_id,
        r.revision, r.name, r.source_created_at,
        r.author_name, r.size_bytes, r.folder_path
      )
      on conflict (integration_id, construmanager_object_id) do nothing;

      v_first := v_first + 1;
      continue;
    end if;

    if public.normalize_construmanager_revision(v_previous.current_revision)
       = public.normalize_construmanager_revision(r.revision) then
      update public.construmanager_document_vigency
         set last_seen_at = now(), updated_at = now()
       where id = v_previous.id;

      v_same := v_same + 1;
      continue;
    end if;

    -- Revisao ausente nos dados novos nao sustenta afirmar transicao:
    -- ausencia nao e evidencia de mudanca.
    if public.normalize_construmanager_revision(r.revision) = '' then
      update public.construmanager_document_vigency
         set last_seen_at = now(), updated_at = now()
       where id = v_previous.id;

      v_same := v_same + 1;
      continue;
    end if;

    -- O conteudo esta no ACC ou so no Construmanager? A resposta entra
    -- no alerta e vem do vinculo de conteudo, nunca de um download.
    select case
             when exists (
               select 1 from public.construmanager_content_links l
                where l.integration_id = v_integration_id
                  and l.construmanager_object_id = r.construmanager_object_id
                  and l.download_status = 'ARMAZENADO'
             ) then 'ARMAZENADO_NO_ACC'
             else 'SOMENTE_NO_CONSTRUMANAGER'
           end
      into v_availability;

    v_transition_id := null;

    insert into public.construmanager_version_transitions (
      project_id, integration_id, construmanager_object_id, document_name,
      previous_revision, new_revision, previous_object_id, new_object_id,
      source_created_at, author_name, size_bytes, folder_path,
      content_availability, sync_run_id
    ) values (
      p_project_id, v_integration_id, r.construmanager_object_id, r.name,
      v_previous.current_revision, r.revision,
      v_previous.construmanager_object_id, r.construmanager_object_id,
      r.source_created_at, r.author_name, r.size_bytes, r.folder_path,
      v_availability, v_run_id
    )
    on conflict (integration_id, construmanager_object_id, sync_run_id) do nothing
    returning id into v_transition_id;

    update public.construmanager_document_vigency
       set current_revision = r.revision,
           current_name = r.name,
           current_source_created_at = r.source_created_at,
           current_author_name = r.author_name,
           current_size_bytes = r.size_bytes,
           current_folder_path = r.folder_path,
           vigency_detected_at = now(),
           last_seen_at = now(),
           updated_at = now()
     where id = v_previous.id;

    -- Auditoria SOMENTE quando a transicao e nova. Reprocessar a mesma
    -- sincronizacao nao gera um segundo registro.
    if v_transition_id is not null then
      insert into public.audit_log_entries (
        project_id, actor_type, actor_user_id, actor_label,
        action, entity_type, entity_id, detail
      ) values (
        p_project_id, 'SYSTEM', null, null,
        'CONSTRUMANAGER_NOVA_VERSAO_VIGENTE',
        'CONSTRUMANAGER_DOCUMENT', r.construmanager_object_id::text,
        format(
          'Nova versao vigente | Documento: %s | Revisao: %s -> %s | Identificador: %s | Pasta: %s | %s | Mudanca de VERSAO DOCUMENTAL segundo os metadados oficiais do Construmanager; sem download nao e possivel afirmar se o conteudo binario difere. Requer analise humana de impacto.',
          coalesce(r.name, '(sem nome)'),
          coalesce(v_previous.current_revision, '(sem revisao anterior)'),
          r.revision,
          r.construmanager_object_id,
          coalesce(r.folder_path, '(sem pasta)'),
          case when v_availability = 'ARMAZENADO_NO_ACC'
               then 'Conteudo armazenado no ACC.'
               else 'Conteudo somente no Construmanager.' end
        )
      );

      v_trans := v_trans + 1;
    end if;
  end loop;

  return query select v_first, v_trans, v_same;
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.detect_construmanager_version_transitions(uuid, uuid)',
    'public.normalize_construmanager_revision(text)'
  ]
  loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('grant execute on function %s to service_role', fn);
    -- Excecao deliberada ao padrao das demais RPCs deste arquivo: a
    -- deteccao de vigencia tem DUAS portas legitimas —
    --   1. logo apos a sincronizacao de metadados feita pelo
    --      ADMINISTRADOR na UI (sessao presente);
    --   2. o monitor agendado, sem sessao (service_role).
    -- A funcao exige ADMINISTRADOR quando ha sessao, entao conceder a
    -- `authenticated` nao afrouxa nada: um LEITURA que a chamasse
    -- receberia excecao. Ela tambem nao baixa nada — so le metadados e
    -- grava transicao/auditoria.
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;
