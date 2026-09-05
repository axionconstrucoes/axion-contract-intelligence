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
--   4. DECISAO HUMANA — sinalizacao explicita e auditavel, usada tambem
--      para arquivos acima do limite automatico.
--   5. METRICAS POR EXECUCAO — uma linha por rodada do worker.
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
    and human_decision_count >= 0
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
    'public.claim_construmanager_content_targets(uuid, text, integer, bigint, integer)',
    'public.complete_construmanager_content_download_system(uuid, uuid, text, bigint, text, text, text, text, text)',
    'public.fail_construmanager_content_download_system(uuid, uuid, text, integer, integer)',
    'public.flag_construmanager_content_human_decision(uuid, uuid, text, text)',
    'public.release_construmanager_content_lease(uuid, uuid, text)',
    'public.start_construmanager_content_run(uuid, text, text, boolean)',
    'public.finish_construmanager_content_run(uuid, text, integer, integer, integer, integer, integer, bigint, bigint, integer, text)'
  ]
  loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('revoke all on function %s from authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;
