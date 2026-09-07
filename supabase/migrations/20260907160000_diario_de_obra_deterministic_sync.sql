-- ============================================================
-- Diario de Obra — fundacao da sincronizacao DETERMINISTICA
--
-- Fonte independente do Construmanager: outra plataforma, outro host,
-- outra credencial. Nenhuma tabela, funcao ou politica do Construmanager
-- e' tocada por esta migration.
--
-- O fluxo normal desta ingestao consome ZERO token de LLM: tudo aqui e'
-- upsert, comparacao de hash e contagem. Nenhuma chamada a IA existe
-- neste arquivo, e nenhuma funcao daqui abre caminho para uma.
--
-- CONTRATO REAL, MEDIDO — nao suposto
--
-- O run 34136744223 chamou a API oficial e devolveu, para a obra WEG:
-- 146 relatorios, lote de 30 com `_id`, `data`, `numero`, `status`,
-- `created` E `modified` (a documentacao publica nao mostrava `modified`;
-- a API real devolve). O detalhe traz 28 campos de topo e 8 colecoes.
-- As colunas abaixo saem desse contrato observado.
--
-- O QUE NUNCA ENTRA AQUI
--
-- Token, cookie, payload bruto, URL de foto, `linkPdf`, URL assinada,
-- arquivo de assinatura, logomarca, binario, o objeto `log` cru e campos
-- transitorios de cache. Foto, video e anexo existem apenas como
-- CONTAGEM — um numero nao e' midia.
-- ============================================================


-- ============================================================
-- A. Relatorios (RDOs)
--
-- Identidade: (project_id, provider_report_id). O `_id` da API e'
-- estavel entre edicoes — foi o que a validacao confirmou —, entao ele
-- e' a chave natural e a base da idempotencia.
-- ============================================================

create table if not exists public.diario_de_obra_reports (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete cascade,

  -- A integracao e' a mesma linha de project_integrations com
  -- source_type = 'DIARIO_OBRA', que o CHECK ja aceita hoje. RESTRICT:
  -- desconfigurar a integracao nao pode levar o historico junto.
  integration_id uuid not null
    references public.project_integrations (id) on delete restrict,

  -- `_id` da API (ObjectId de 24 hex nos exemplos e na obra real).
  provider_report_id text not null,
  provider_work_id text not null,

  report_number integer,
  reference_date date,
  reference_end_date date,
  weekday text,

  status_id integer,
  status_label text,

  -- `created` e `modified` da API, ja normalizados para timestamptz.
  source_created_at timestamptz,
  source_modified_at timestamptz,

  -- Hash canonico do conteudo semantico. E' a SEGUNDA confirmacao de
  -- mudanca: `modified` diz que algo foi salvo, o hash diz se algo de
  -- fato mudou. Salvar sem alterar nada nao deve virar alteracao.
  content_hash text not null,

  -- Conteudo operacional normalizado. JSONB porque a forma varia por
  -- modelo de relatorio — mas nunca o payload cru: o worker valida,
  -- normaliza e remove URL, log, logo e assinatura antes de chegar aqui.
  weather jsonb not null default '{}'::jsonb,
  work_hours jsonb not null default '{}'::jsonb,
  labor jsonb not null default '{}'::jsonb,
  equipment jsonb not null default '[]'::jsonb,
  materials jsonb not null default '{}'::jsonb,
  activities jsonb not null default '[]'::jsonb,
  occurrences jsonb not null default '[]'::jsonb,
  comments jsonb not null default '[]'::jsonb,
  checklist jsonb not null default '[]'::jsonb,

  -- Midia so como CONTAGEM. Nenhuma URL, nenhum byte.
  photo_count integer not null default 0,
  video_count integer not null default 0,
  attachment_count integer not null default 0,

  -- Sinaliza carga historica. Um registro trazido pelo baseline nao
  -- pode ser confundido com novidade observada em tempo real.
  baseline_imported boolean not null default false,

  first_seen_at timestamptz not null default now(),
  -- Ausencia numa janela NUNCA apaga: o registro apenas envelhece aqui,
  -- e a decisao sobre isso e' humana.
  last_seen_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint diario_de_obra_reports_provider_key
    unique (project_id, provider_report_id),

  constraint diario_de_obra_reports_hash_format
    check (content_hash ~ '^[0-9a-f]{64}$'),

  constraint diario_de_obra_reports_counts_non_negative
    check (photo_count >= 0 and video_count >= 0 and attachment_count >= 0)
);

create index if not exists diario_de_obra_reports_project_date_idx
  on public.diario_de_obra_reports (project_id, reference_date desc);

create index if not exists diario_de_obra_reports_modified_idx
  on public.diario_de_obra_reports (project_id, source_modified_at desc);

-- Serve a varredura de "conhecido mas nao retornado": last_seen_at
-- envelhecido e' o sinal, e ele precisa ser barato de consultar.
create index if not exists diario_de_obra_reports_last_seen_idx
  on public.diario_de_obra_reports (project_id, last_seen_at);


-- ============================================================
-- B. Execucoes de sincronizacao
--
-- `checkpoint` guarda onde a varredura parou. Ele so avanca DEPOIS de a
-- persistencia dos relatorios da janela ter sido confirmada — um
-- checkpoint a frente dos dados faria a proxima execucao pular RDOs que
-- nunca foram gravados.
-- ============================================================

create table if not exists public.diario_de_obra_sync_runs (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete cascade,

  integration_id uuid not null
    references public.project_integrations (id) on delete restrict,

  mode text not null
    check (mode in ('BASELINE', 'INCREMENTAL', 'RECONCILE')),

  status text not null default 'EM_ANDAMENTO'
    check (status in ('EM_ANDAMENTO', 'SUCESSO', 'PARCIAL', 'ERRO')),

  started_at timestamptz not null default now(),
  completed_at timestamptz,

  window_start date,
  window_end date,

  reports_listed integer not null default 0,
  details_requested integer not null default 0,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  unchanged_count integer not null default 0,
  error_count integer not null default 0,

  checkpoint jsonb not null default '{}'::jsonb,

  -- Sanitizado na origem. Mensagem de erro nunca e' canal de vazamento:
  -- ela diz QUAL invariante quebrou, nao com que valor.
  sanitized_error text,

  created_at timestamptz not null default now()
);

create index if not exists diario_de_obra_sync_runs_project_idx
  on public.diario_de_obra_sync_runs (project_id, started_at desc);


-- ============================================================
-- C. Alteracoes detectadas
--
-- Rastro minimo de mudanca REAL. Uma linha aqui significa: o mesmo RDO
-- voltou com conteudo semantico diferente. Carga baseline nao produz
-- nenhuma — importar historico nao e' o mesmo que observar mudanca.
-- ============================================================

create table if not exists public.diario_de_obra_report_changes (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete cascade,

  report_id uuid not null
    references public.diario_de_obra_reports (id) on delete cascade,

  previous_hash text,
  new_hash text not null,

  previous_source_modified_at timestamptz,
  new_source_modified_at timestamptz,

  detected_at timestamptz not null default now(),

  -- RESTRICT: uma alteracao sempre aponta para uma execucao que existiu
  -- de fato. Sem isso vira registro orfao, impossivel de auditar depois.
  sync_run_id uuid not null
    references public.diario_de_obra_sync_runs (id) on delete restrict,

  -- Uma alteracao por RDO por execucao. Reexecutar o mesmo lote nao
  -- duplica o rastro.
  constraint diario_de_obra_report_changes_unique
    unique (report_id, sync_run_id)
);

create index if not exists diario_de_obra_report_changes_project_idx
  on public.diario_de_obra_report_changes (project_id, detected_at desc);


-- ============================================================
-- D. RLS
--
-- Leitura para membros do projeto. NENHUMA politica de insert, update
-- ou delete: a escrita passa exclusivamente pelas funcoes abaixo, que
-- sao SECURITY DEFINER e so o service_role alcanca.
-- ============================================================

alter table public.diario_de_obra_reports enable row level security;
alter table public.diario_de_obra_sync_runs enable row level security;
alter table public.diario_de_obra_report_changes enable row level security;

drop policy if exists "diario_de_obra_reports_select_members"
  on public.diario_de_obra_reports;
create policy "diario_de_obra_reports_select_members"
  on public.diario_de_obra_reports
  for select
  using (public.is_project_member(project_id));

drop policy if exists "diario_de_obra_sync_runs_select_members"
  on public.diario_de_obra_sync_runs;
create policy "diario_de_obra_sync_runs_select_members"
  on public.diario_de_obra_sync_runs
  for select
  using (public.is_project_member(project_id));

drop policy if exists "diario_de_obra_report_changes_select_members"
  on public.diario_de_obra_report_changes;
create policy "diario_de_obra_report_changes_select_members"
  on public.diario_de_obra_report_changes
  for select
  using (public.is_project_member(project_id));


-- ============================================================
-- E. Abrir execucao
-- ============================================================

create or replace function public.start_diario_de_obra_sync_run(
  p_project_id uuid,
  p_mode text,
  p_window_start date default null,
  p_window_end date default null
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
  select pi.id
    into v_integration_id
    from public.project_integrations pi
   where pi.project_id = p_project_id
     and pi.source_type = 'DIARIO_OBRA';

  if v_integration_id is null then
    raise exception 'Integracao Diario de Obra nao configurada para este projeto.';
  end if;

  insert into public.diario_de_obra_sync_runs (
    project_id, integration_id, mode, status, window_start, window_end
  )
  values (
    p_project_id, v_integration_id, p_mode, 'EM_ANDAMENTO', p_window_start, p_window_end
  )
  returning id into v_run_id;

  return v_run_id;
end;
$$;


-- ============================================================
-- F. Gravar UM relatorio — atomico
--
-- Uma chamada = um RDO = uma transacao. O upsert e o registro da
-- alteracao acontecem juntos ou nao acontecem: um RDO com hash novo mas
-- sem rastro de alteracao seria uma mudanca silenciosa, exatamente o que
-- este modulo existe para evitar.
--
-- Devolve CRIADO | ALTERADO | INALTERADO.
-- ============================================================

create or replace function public.upsert_diario_de_obra_report(
  p_project_id uuid,
  p_sync_run_id uuid,
  p_mode text,
  p_provider_report_id text,
  p_provider_work_id text,
  p_report_number integer,
  p_reference_date date,
  p_reference_end_date date,
  p_weekday text,
  p_status_id integer,
  p_status_label text,
  p_source_created_at timestamptz,
  p_source_modified_at timestamptz,
  p_content_hash text,
  p_weather jsonb,
  p_work_hours jsonb,
  p_labor jsonb,
  p_equipment jsonb,
  p_materials jsonb,
  p_activities jsonb,
  p_occurrences jsonb,
  p_comments jsonb,
  p_checklist jsonb,
  p_photo_count integer,
  p_video_count integer,
  p_attachment_count integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_integration_id uuid;
  v_existente public.diario_de_obra_reports%rowtype;
  v_report_id uuid;
  v_now timestamptz := now();
  v_resultado text;
begin
  select pi.id
    into v_integration_id
    from public.project_integrations pi
   where pi.project_id = p_project_id
     and pi.source_type = 'DIARIO_OBRA';

  if v_integration_id is null then
    raise exception 'Integracao Diario de Obra nao configurada para este projeto.';
  end if;

  -- FOR UPDATE: duas execucoes concorrentes sobre o mesmo RDO nao podem
  -- ambas concluir que houve alteracao.
  select *
    into v_existente
    from public.diario_de_obra_reports
   where project_id = p_project_id
     and provider_report_id = p_provider_report_id
   for update;

  if not found then
    insert into public.diario_de_obra_reports (
      project_id, integration_id,
      provider_report_id, provider_work_id,
      report_number, reference_date, reference_end_date, weekday,
      status_id, status_label,
      source_created_at, source_modified_at, content_hash,
      weather, work_hours, labor, equipment, materials,
      activities, occurrences, comments, checklist,
      photo_count, video_count, attachment_count,
      baseline_imported,
      first_seen_at, last_seen_at, created_at, updated_at
    )
    values (
      p_project_id, v_integration_id,
      p_provider_report_id, p_provider_work_id,
      p_report_number, p_reference_date, p_reference_end_date, p_weekday,
      p_status_id, p_status_label,
      p_source_created_at, p_source_modified_at, p_content_hash,
      coalesce(p_weather, '{}'::jsonb), coalesce(p_work_hours, '{}'::jsonb),
      coalesce(p_labor, '{}'::jsonb), coalesce(p_equipment, '[]'::jsonb),
      coalesce(p_materials, '{}'::jsonb), coalesce(p_activities, '[]'::jsonb),
      coalesce(p_occurrences, '[]'::jsonb), coalesce(p_comments, '[]'::jsonb),
      coalesce(p_checklist, '[]'::jsonb),
      coalesce(p_photo_count, 0), coalesce(p_video_count, 0), coalesce(p_attachment_count, 0),
      (p_mode = 'BASELINE'),
      v_now, v_now, v_now, v_now
    )
    returning id into v_report_id;

    -- Primeira vez que vemos este RDO. Nao existe "anterior" para
    -- comparar, entao nao ha alteracao — nem no incremental.
    return 'CRIADO';
  end if;

  v_report_id := v_existente.id;

  -- Conteudo semanticamente identico: so o carimbo de presenca avanca.
  -- Um `modified` novo com hash igual significa que alguem salvou sem
  -- mudar nada, e isso nao e' alteracao.
  if v_existente.content_hash = p_content_hash then
    update public.diario_de_obra_reports
       set last_seen_at = v_now,
           source_modified_at = coalesce(p_source_modified_at, source_modified_at),
           updated_at = v_now
     where id = v_report_id;

    return 'INALTERADO';
  end if;

  update public.diario_de_obra_reports
     set provider_work_id = p_provider_work_id,
         report_number = p_report_number,
         reference_date = p_reference_date,
         reference_end_date = p_reference_end_date,
         weekday = p_weekday,
         status_id = p_status_id,
         status_label = p_status_label,
         source_created_at = p_source_created_at,
         source_modified_at = p_source_modified_at,
         content_hash = p_content_hash,
         weather = coalesce(p_weather, '{}'::jsonb),
         work_hours = coalesce(p_work_hours, '{}'::jsonb),
         labor = coalesce(p_labor, '{}'::jsonb),
         equipment = coalesce(p_equipment, '[]'::jsonb),
         materials = coalesce(p_materials, '{}'::jsonb),
         activities = coalesce(p_activities, '[]'::jsonb),
         occurrences = coalesce(p_occurrences, '[]'::jsonb),
         comments = coalesce(p_comments, '[]'::jsonb),
         checklist = coalesce(p_checklist, '[]'::jsonb),
         photo_count = coalesce(p_photo_count, 0),
         video_count = coalesce(p_video_count, 0),
         attachment_count = coalesce(p_attachment_count, 0),
         last_seen_at = v_now,
         updated_at = v_now
   where id = v_report_id;

  v_resultado := 'ALTERADO';

  -- BASELINE nao cria alteracao. Reimportar historico nao e' observar
  -- mudanca, e um alerta falso vindo da carga inicial ensinaria a equipe
  -- a ignorar alertas.
  if p_mode <> 'BASELINE' then
    insert into public.diario_de_obra_report_changes (
      project_id, report_id,
      previous_hash, new_hash,
      previous_source_modified_at, new_source_modified_at,
      detected_at, sync_run_id
    )
    values (
      p_project_id, v_report_id,
      v_existente.content_hash, p_content_hash,
      v_existente.source_modified_at, p_source_modified_at,
      v_now, p_sync_run_id
    )
    on conflict (report_id, sync_run_id) do nothing;
  end if;

  return v_resultado;
end;
$$;


-- ============================================================
-- G. Avancar o checkpoint
--
-- Chamado SO depois de a janela ter sido persistida. Separado do
-- fechamento da execucao de proposito: uma execucao longa avanca o
-- checkpoint varias vezes e pode ser retomada por outra.
-- ============================================================

create or replace function public.advance_diario_de_obra_checkpoint(
  p_sync_run_id uuid,
  p_checkpoint jsonb,
  p_reports_listed integer,
  p_details_requested integer,
  p_created_count integer,
  p_updated_count integer,
  p_unchanged_count integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.diario_de_obra_sync_runs
     set checkpoint = coalesce(p_checkpoint, '{}'::jsonb),
         reports_listed = coalesce(p_reports_listed, 0),
         details_requested = coalesce(p_details_requested, 0),
         created_count = coalesce(p_created_count, 0),
         updated_count = coalesce(p_updated_count, 0),
         unchanged_count = coalesce(p_unchanged_count, 0)
   where id = p_sync_run_id;
end;
$$;


-- ============================================================
-- H. Fechar execucao
-- ============================================================

create or replace function public.finish_diario_de_obra_sync_run(
  p_sync_run_id uuid,
  p_status text,
  p_error_count integer default 0,
  p_sanitized_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('SUCESSO', 'PARCIAL', 'ERRO') then
    raise exception 'Status de execucao invalido.';
  end if;

  update public.diario_de_obra_sync_runs
     set status = p_status,
         completed_at = now(),
         error_count = coalesce(p_error_count, 0),
         sanitized_error = p_sanitized_error
   where id = p_sync_run_id;
end;
$$;


-- ============================================================
-- I. Grants
--
-- Nenhuma destas funcoes e' alcancavel por sessao de usuario. A
-- ingestao e' headless e roda com service_role; abrir estas portas para
-- `authenticated` daria a um membro do projeto o poder de escrever
-- diretamente no historico.
-- ============================================================

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.start_diario_de_obra_sync_run(uuid, text, date, date)',
    'public.upsert_diario_de_obra_report(uuid, uuid, text, text, text, integer, date, date, text, integer, text, timestamptz, timestamptz, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, integer, integer, integer)',
    'public.advance_diario_de_obra_checkpoint(uuid, jsonb, integer, integer, integer, integer, integer)',
    'public.finish_diario_de_obra_sync_run(uuid, text, integer, text)'
  ]
  loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('revoke all on function %s from authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;
