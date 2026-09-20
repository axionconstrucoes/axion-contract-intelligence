-- ============================================================
-- 20260920120000_weekly_schedule_email_ingestion_foundation.sql
-- Registro documental por e-mail + ingestão automática do cronograma
-- semanal (.mpp) + planilha Excel do relatório semanal (Curva S, Linha de
-- Base, Financeiro, Histograma, SSMA) + comparação/risco + baseline
-- oficial + revisão humana auditada.
--
-- FONTE OFICIAL DO ESCALÃO: a "Matriz de responsabilidades e prazos"
-- (aba Usuários e permissões) = public.sla_area_responsibles:
--   Nível 1 · Responsável     = responsible_direct_user_id
--   Nível 1 · Corresponsável  = secondary_responsible_user_id
--   Nível 2 · Gerência        = escalation_1_user_id
--   Nível 3 · Diretoria       = board_user_id
--   (escalation_2_user_id é legado, não exposto na interface)
-- Nenhuma tabela desta migration guarda escalão: a configuração por
-- projeto só HABILITA/BLOQUEIA quais escalões podem enviar
-- (authorized_tiers), nunca redefine quem está em qual escalão. Ver
-- apps/web/lib/sla/resolve-user-responsibility-tier.ts.
--
-- Reaproveita (nunca duplica):
--   - emails / email_attachments (proveniência Gmail, SHA-256, Storage);
--   - documents / document_versions (dedup real por índice único
--     (project_id, sha256_hash) — 20260825130000);
--   - schedule_versions / schedule_activities / schedule_task_relations
--     (worker MPXJ — 20260917130000);
--   - project_memberships (status/area), sla_area_responsibles;
--   - audit_log_entries (actor_type='SYSTEM' com actor nulos — 20260822060313);
--   - is_project_member / has_project_permission.
--
-- Escritas operacionais (intakes, comparações, alertas, leitura da
-- planilha do relatório semanal, classificação automática) são sempre
-- service role. Ações
-- humanas (revisão, classificação confirmada, baseline) passam por RPCs
-- SECURITY DEFINER que validam permissão e gravam evento de revisão com
-- valor anterior/novo — nenhum GRANT UPDATE amplo para "authenticated".
-- ============================================================


-- ============================================================
-- 0. FUNÇÃO utilitária de updated_at (compartilhada pelas tabelas novas)
-- ============================================================

create or replace function public.set_weekly_schedule_row_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ============================================================
-- 1. REGISTRO DOCUMENTAL POR E-MAIL — classificação em emails/email_attachments
-- ============================================================
-- Classificação determinística (assunto/arquivo/MIME/remetente) com
-- confiança; baixa confiança => PENDING_HUMAN_REVIEW/UNCLASSIFIED.
-- Nomes reutilizam documents.kind onde já existe categoria equivalente
-- (ATA_REUNIAO, DIARIO_OBRA, ESG_SSMA, RELATORIO_SEMANAL);
-- ALTERACAO_PROJETO é a única categoria realmente ausente. Em ANEXOS,
-- RELATORIO_SEMANAL_PLANEJAMENTO identifica a PLANILHA EXCEL do relatório
-- semanal (unidade documental inteira — as abas Curva S / Linha de Base /
-- Financeiro / Histograma / SSMA são componentes, nunca documentos).
-- "E-mails enviados ao cliente" NÃO é classificação: é o filtro
-- transversal direction='OUTBOUND' + sent_to_client=true.

alter table public.emails
  add column document_classification text
    check (document_classification is null or document_classification in (
      'ATA_REUNIAO', 'DIARIO_OBRA', 'ALTERACAO_PROJETO', 'ESG_SSMA',
      'RELATORIO_SEMANAL', 'UNCLASSIFIED'
    )),
  add column classification_status text not null default 'UNCLASSIFIED'
    check (classification_status in ('AUTO', 'CONFIRMED', 'PENDING_HUMAN_REVIEW', 'UNCLASSIFIED')),
  add column classification_confidence numeric
    check (classification_confidence is null or (classification_confidence >= 0 and classification_confidence <= 1)),
  add column classification_reasons jsonb not null default '[]'::jsonb,
  add column classified_at timestamptz,
  -- Semana da OBRA (ex.: "(W37) <cliente> - Relatório Semanal") — nunca
  -- convertida para semana civil/ISO. NOT_IDENTIFIED => revisão humana.
  add column work_week_number integer
    check (work_week_number is null or (work_week_number >= 1 and work_week_number <= 260)),
  add column work_week_label text,
  add column work_week_status text not null default 'NOT_IDENTIFIED'
    check (work_week_status in ('IDENTIFIED', 'NOT_IDENTIFIED', 'HUMAN_SET')),
  -- Filtro transversal "E-mails enviados ao cliente" (OUTBOUND com pelo
  -- menos um destinatário no domínio do cliente do projeto).
  add column sent_to_client boolean,
  -- Labels/pasta do Gmail quando disponíveis (ex.: SENT, INBOX).
  add column provider_labels text[] not null default '{}';

create index emails_project_classification_idx
  on public.emails (project_id, document_classification, sent_at desc);
create index emails_project_work_week_idx
  on public.emails (project_id, work_week_number)
  where work_week_number is not null;
create index emails_project_sent_to_client_idx
  on public.emails (project_id, sent_at desc)
  where sent_to_client;

alter table public.email_attachments
  add column suggested_classification text
    check (suggested_classification is null or suggested_classification in (
      'ATA_REUNIAO', 'DIARIO_OBRA', 'ALTERACAO_PROJETO', 'ESG_SSMA',
      'RELATORIO_SEMANAL', 'RELATORIO_SEMANAL_PLANEJAMENTO', 'CRONOGRAMA_MPP', 'UNCLASSIFIED'
    )),
  add column confirmed_classification text
    check (confirmed_classification is null or confirmed_classification in (
      'ATA_REUNIAO', 'DIARIO_OBRA', 'ALTERACAO_PROJETO', 'ESG_SSMA',
      'RELATORIO_SEMANAL', 'RELATORIO_SEMANAL_PLANEJAMENTO', 'CRONOGRAMA_MPP', 'UNCLASSIFIED'
    )),
  add column classification_confidence numeric
    check (classification_confidence is null or (classification_confidence >= 0 and classification_confidence <= 1)),
  add column classification_reasons jsonb not null default '[]'::jsonb;


-- ============================================================
-- 2. CONFIGURAÇÃO POR PROJETO DA INGESTÃO SEMANAL
-- ============================================================

create table public.project_weekly_schedule_ingestion_configs (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null unique
    references public.projects (id) on delete cascade,

  enabled boolean not null default false,

  -- Área da membership autorizada (mesmos valores de project_memberships.area).
  authorized_area text not null default 'PLANEJAMENTO'
    check (authorized_area in (
      'DIRETORIA', 'ADMINISTRATIVO', 'COMERCIAL', 'FINANCEIRO',
      'ENGENHARIA', 'ORÇAMENTO', 'JURÍDICO', 'PLANEJAMENTO',
      'COMPRAS', 'SSMA/ESG'
    )),

  -- Quais escalões da Matriz podem enviar. HABILITA/BLOQUEIA, nunca
  -- redefine o escalão (que vem exclusivamente de sla_area_responsibles).
  authorized_tiers text[] not null default '{FIRST_TIER,SECOND_TIER}'
    check (
      cardinality(authorized_tiers) > 0
      and authorized_tiers <@ '{FIRST_TIER,SECOND_TIER}'::text[]
    ),

  -- Domínio corporativo exigido do remetente (config, nunca hardcoded).
  sender_domain text not null default 'axion.com.br'
    check (
      sender_domain = lower(sender_domain)
      and sender_domain not like '@%'
      and btrim(sender_domain) <> ''
    ),

  -- Pelo menos UM To/Cc precisa casar com domínio OU endereço do cliente.
  client_recipient_domains text[] not null default '{}',
  client_recipient_addresses text[] not null default '{}',
  require_client_recipient boolean not null default true,

  cadence text not null default 'WEEKLY'
    check (cadence in ('WEEKLY')),
  deadline_weekday smallint not null default 5
    check (deadline_weekday between 1 and 7),
  deadline_time time not null default '18:00',
  timezone text not null default 'America/Sao_Paulo'
    check (btrim(timezone) <> ''),

  -- null = herda project_email_ingestion_configs / projects.start_date.
  monitoring_start_at timestamptz,
  monitoring_end_at timestamptz,
  check (
    monitoring_end_at is null
    or monitoring_start_at is null
    or monitoring_end_at >= monitoring_start_at
  ),

  -- Documento CRONOGRAMA_REVISAO que recebe as versões semanais
  -- (técnico: preenchido pelo worker, nunca pelo navegador).
  target_document_id uuid
    references public.documents (id) on delete set null,

  -- Regex opcional para identificar o .mpp quando há mais de um.
  attachment_name_pattern text,

  -- Destinatários internos dos alertas.
  alert_recipient_user_ids uuid[] not null default '{}',

  -- Cursor técnico da varredura (worker).
  last_scanned_sent_at timestamptz,

  updated_by_user_id uuid
    references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.project_weekly_schedule_ingestion_configs is
  'Regra por projeto da ingestão automática do cronograma semanal por e-mail. authorized_tiers habilita/bloqueia escalões; o escalão em si vem SEMPRE da Matriz de responsabilidades (sla_area_responsibles).';

create index project_weekly_schedule_ingestion_configs_enabled_idx
  on public.project_weekly_schedule_ingestion_configs (enabled)
  where enabled;

create trigger project_weekly_schedule_ingestion_configs_set_updated_at
before update on public.project_weekly_schedule_ingestion_configs
for each row
execute function public.set_weekly_schedule_row_updated_at();


-- ============================================================
-- 3. LIMITES DE RISCO POR PROJETO E DIMENSÃO (MPP e Curva S)
-- ============================================================
-- Sem linha para uma dimensão adversa => REVIEW_REQUIRED (nunca LOW).

create table public.project_schedule_risk_thresholds (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete cascade,

  dimension text not null
    check (dimension in (
      'FINAL_DATE_SLIP_DAYS',
      'CONTRACT_MILESTONE_SLIP_DAYS',
      'CRITICAL_PATH_CHANGED_COUNT',
      'MIN_TOTAL_FLOAT_DAYS',
      'OVERDUE_ACTIVITIES_COUNT',
      'ADDED_REMOVED_ACTIVITIES_COUNT',
      'DURATION_CHANGE_PERCENT',
      'RELATION_CHANGES_COUNT',
      'PHYSICAL_PROGRESS_SHORTFALL_PERCENT',
      'DELAY_AGGRAVATION_DAYS',
      -- Curva S
      'S_CURVE_DEVIATION_PP',
      'S_CURVE_FULFILLMENT_PERCENT',
      'S_CURVE_AGGRAVATION_PP',
      'S_CURVE_MPP_DIVERGENCE_PP',
      -- Relatório semanal (Excel): Financeiro / Histograma / Linha de Base
      'FINANCIAL_DEVIATION_PERCENT',
      'HISTOGRAM_SHORTFALL_PERCENT',
      'BASELINE_SHEET_DIVERGENCE_DAYS'
    )),

  medium_threshold numeric not null,
  high_threshold numeric not null,
  critical_threshold numeric not null,

  notes text,

  updated_by_user_id uuid
    references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (project_id, dimension)
);

comment on table public.project_schedule_risk_thresholds is
  'Limites de risco de cronograma/Curva S por projeto e dimensão — sem linha => REVIEW_REQUIRED, nunca LOW por ausência de configuração.';

create index project_schedule_risk_thresholds_project_idx
  on public.project_schedule_risk_thresholds (project_id);

create trigger project_schedule_risk_thresholds_set_updated_at
before update on public.project_schedule_risk_thresholds
for each row
execute function public.set_weekly_schedule_row_updated_at();


-- ============================================================
-- 4. BASELINE OFICIAL (histórico, nunca sobrescrito)
-- ============================================================

create table public.project_schedule_baselines (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete cascade,
  schedule_version_id uuid not null
    references public.schedule_versions (id) on delete restrict,

  justification text not null check (btrim(justification) <> ''),
  set_by_user_id uuid not null
    references public.profiles (id) on delete restrict,
  effective_from timestamptz not null default now(),

  -- Preenchidos quando outra baseline a substitui (histórico preservado).
  superseded_at timestamptz,
  superseded_by_user_id uuid
    references public.profiles (id) on delete set null,

  created_at timestamptz not null default now(),

  check (
    (superseded_at is null and superseded_by_user_id is null)
    or (superseded_at is not null and superseded_by_user_id is not null)
  )
);

comment on table public.project_schedule_baselines is
  'Baseline oficial do cronograma por projeto — histórico completo; a ativa é a linha com superseded_at IS NULL.';

-- Exatamente UMA baseline ativa por projeto.
create unique index project_schedule_baselines_one_active_idx
  on public.project_schedule_baselines (project_id)
  where superseded_at is null;
create index project_schedule_baselines_project_idx
  on public.project_schedule_baselines (project_id, effective_from desc);


-- ============================================================
-- 5. EVIDÊNCIA DE CADA MENSAGEM AVALIADA PELA INGESTÃO SEMANAL
-- ============================================================

create table public.weekly_schedule_email_intakes (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete cascade,
  config_id uuid not null
    references public.project_weekly_schedule_ingestion_configs (id) on delete cascade,

  -- Proveniência (sempre preservada, mesmo quando rejeitada/duplicada).
  email_id uuid
    references public.emails (id) on delete set null,
  mailbox_address text,
  direction text
    check (direction is null or direction in ('INBOUND', 'OUTBOUND')),
  sync_source text not null default 'GMAIL_INBOUND_SYNC',
  gmail_message_id text not null,
  gmail_thread_id text,
  message_id_header text,
  from_address text not null,
  to_addresses text[] not null default '{}',
  cc_addresses text[] not null default '{}',
  subject text not null,
  sent_at timestamptz not null,
  provider_labels text[] not null default '{}',

  -- Semana civil (segunda-feira, no fuso do projeto) — só para o prazo
  -- de ausência. A semana da OBRA (WNN) fica em work_week_*.
  week_start date not null,
  work_week_number integer
    check (work_week_number is null or (work_week_number >= 1 and work_week_number <= 260)),
  work_week_label text,
  work_week_status text not null default 'NOT_IDENTIFIED'
    check (work_week_status in ('IDENTIFIED', 'NOT_IDENTIFIED', 'HUMAN_SET')),

  -- Todos os anexos vistos (nome, MIME, tamanho, sha256 quando baixado).
  attachments jsonb not null default '[]'::jsonb,

  -- Remetente resolvido e escalão SEGUNDO A MATRIZ (fato registrado, não fonte).
  sender_user_id uuid
    references public.profiles (id) on delete set null,
  sender_tier text
    check (sender_tier is null or sender_tier in ('FIRST_TIER', 'SECOND_TIER', 'NOT_AUTHORIZED', 'AMBIGUOUS', 'NOT_CONFIGURED')),

  status text not null
    check (status in (
      'AUTHORIZED_AUTO',
      'PENDING_HUMAN_REVIEW',
      'APPROVED_HUMAN_REVIEW',
      'REJECTED_HUMAN_REVIEW',
      'REJECTED_UNAUTHORIZED_SENDER',
      'REJECTED_RECIPIENT_MISMATCH',
      'IGNORED_NO_MPP',
      'IGNORED_OUTSIDE_WINDOW',
      -- Envio válido com .mpp já conhecido (SHA-256): conta como
      -- recebimento semanal, não cria versão nova.
      'RECEIVED_DUPLICATE',
      'FAILED'
    )),
  decision_rule text not null,
  decision_reasons jsonb not null default '[]'::jsonb,
  failure_error text,

  selected_email_attachment_id uuid
    references public.email_attachments (id) on delete set null,
  selected_sha256_hash text
    check (selected_sha256_hash is null or selected_sha256_hash ~ '^[0-9a-f]{64}$'),
  document_version_id uuid
    references public.document_versions (id) on delete set null,
  duplicate_of_document_version_id uuid
    references public.document_versions (id) on delete set null,

  -- Resumo da última revisão humana (detalhe em email_document_review_events).
  reviewed_by_user_id uuid
    references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_note text,

  comparisons_prepared_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (project_id, gmail_message_id),

  check (
    (status = 'FAILED' and failure_error is not null)
    or (status <> 'FAILED' and failure_error is null)
  )
);

comment on table public.weekly_schedule_email_intakes is
  'Evidência de cada e-mail avaliado pela ingestão do cronograma semanal: proveniência completa, anexos (nome/MIME/tamanho/SHA-256), escalão segundo a Matriz, regra aplicada, versão criada, revisão humana.';

create index weekly_schedule_email_intakes_project_week_idx
  on public.weekly_schedule_email_intakes (project_id, week_start, status);
create index weekly_schedule_email_intakes_email_idx
  on public.weekly_schedule_email_intakes (email_id)
  where email_id is not null;
create index weekly_schedule_email_intakes_document_version_idx
  on public.weekly_schedule_email_intakes (document_version_id)
  where document_version_id is not null;
create index weekly_schedule_email_intakes_pending_comparisons_idx
  on public.weekly_schedule_email_intakes (project_id)
  where document_version_id is not null and comparisons_prepared_at is null;

create trigger weekly_schedule_email_intakes_set_updated_at
before update on public.weekly_schedule_email_intakes
for each row
execute function public.set_weekly_schedule_row_updated_at();


-- ============================================================
-- 6. COMPARAÇÕES ENTRE VERSÕES (gatilho idempotente)
-- ============================================================

create table public.schedule_version_comparisons (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete cascade,

  current_schedule_version_id uuid not null
    references public.schedule_versions (id) on delete cascade,
  reference_schedule_version_id uuid
    references public.schedule_versions (id) on delete set null,

  comparison_type text not null
    check (comparison_type in ('PREVIOUS_WEEKLY', 'OFFICIAL_BASELINE')),

  status text not null default 'PENDING'
    check (status in ('PENDING', 'COMPUTED', 'FAILED')),

  metrics jsonb,

  risk_classification text
    check (
      risk_classification is null
      or risk_classification in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'REVIEW_REQUIRED')
    ),
  risk_reasons jsonb not null default '[]'::jsonb,
  -- Limites ausentes que impediram classificação automática.
  missing_thresholds text[] not null default '{}',

  computed_at timestamptz,
  error_message text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (current_schedule_version_id, comparison_type),

  check (
    (status = 'COMPUTED' and computed_at is not null and risk_classification is not null)
    or (status = 'FAILED' and error_message is not null)
    or (status = 'PENDING')
  )
);

comment on table public.schedule_version_comparisons is
  'Comparação idempotente de uma versão extraída com a semanal anterior e com a baseline oficial, com classificação de risco por limites do projeto.';

create index schedule_version_comparisons_project_idx
  on public.schedule_version_comparisons (project_id, created_at desc);
create index schedule_version_comparisons_pending_idx
  on public.schedule_version_comparisons (status)
  where status = 'PENDING';

create trigger schedule_version_comparisons_set_updated_at
before update on public.schedule_version_comparisons
for each row
execute function public.set_weekly_schedule_row_updated_at();


-- ============================================================
-- 7. RELATÓRIO SEMANAL (EXCEL) — planilha inteira + abas extraídas
-- ============================================================
-- A planilha Excel do relatório semanal é UMA unidade documental
-- (anexo classificado RELATORIO_SEMANAL_PLANEJAMENTO). Suas abas
-- (Curva S, Linha de Base, Financeiro, Histograma, SSMA) são componentes
-- extraídos com valores ARMAZENADOS no arquivo (nunca macros, fórmulas
-- externas, links ou conexões). A Curva S vem exclusivamente desta
-- planilha — PDF/imagem nunca são fonte.

create table public.weekly_report_workbooks (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete cascade,
  email_id uuid
    references public.emails (id) on delete set null,
  email_attachment_id uuid not null
    references public.email_attachments (id) on delete cascade,
  intake_id uuid
    references public.weekly_schedule_email_intakes (id) on delete set null,
  schedule_version_id uuid
    references public.schedule_versions (id) on delete set null,

  work_week_number integer,
  work_week_label text,

  -- Evidência do arquivo: hash, formato real (assinatura), tamanho.
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  file_name text not null,
  mime_type text not null,
  file_size_bytes bigint not null,
  detected_format text not null
    check (detected_format in ('XLSX', 'XLS_LEGACY', 'UNKNOWN')),

  extraction_method text not null,
  extracted_at timestamptz,
  -- Todas as abas do arquivo (índice + nome original), mesmo as não mapeadas.
  sheet_index jsonb not null default '[]'::jsonb,
  -- Segurança: contagens do que foi detectado e IGNORADO (macros, links
  -- externos, conexões, fórmulas sem valor armazenado).
  safety_report jsonb not null default '{}'::jsonb,

  status text not null
    check (status in (
      'EXTRACTED',
      'PARTIAL',
      'PENDING_HUMAN_REVIEW',
      'LEGACY_FORMAT_REVIEW_REQUIRED',
      'INVALID_FILE',
      'FAILED'
    )),
  error_message text,
  summary jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Uma leitura por anexo (reexecução atualiza, nunca duplica).
  unique (email_attachment_id),

  check (
    (status = 'FAILED' and error_message is not null)
    or (status <> 'FAILED')
  )
);

comment on table public.weekly_report_workbooks is
  'Planilha Excel do relatório semanal (unidade documental RELATORIO_SEMANAL_PLANEJAMENTO): hash, formato real, índice de abas, relatório de segurança e status da extração.';

create index weekly_report_workbooks_project_idx
  on public.weekly_report_workbooks (project_id, created_at desc);
create index weekly_report_workbooks_email_idx
  on public.weekly_report_workbooks (email_id)
  where email_id is not null;
create index weekly_report_workbooks_intake_idx
  on public.weekly_report_workbooks (intake_id)
  where intake_id is not null;

create trigger weekly_report_workbooks_set_updated_at
before update on public.weekly_report_workbooks
for each row
execute function public.set_weekly_schedule_row_updated_at();

create table public.weekly_report_sheets (
  id uuid primary key default gen_random_uuid(),

  workbook_id uuid not null
    references public.weekly_report_workbooks (id) on delete cascade,
  project_id uuid not null
    references public.projects (id) on delete cascade,

  -- Categoria lógica da aba.
  category text not null
    check (category in ('CURVA_S', 'LINHA_BASE', 'FINANCEIRO', 'HISTOGRAMA', 'SSMA')),

  status text not null
    check (status in (
      'EXTRACTED',
      'MISSING_SHEET',
      'AMBIGUOUS_SHEET',
      'PENDING_HUMAN_REVIEW',
      'HUMAN_MAPPED',
      'HUMAN_VALIDATED',
      'FAILED'
    )),

  -- Proveniência: nome ORIGINAL e índice da aba, candidatos (ambiguidade),
  -- células/faixas lidas, método e confiança.
  original_sheet_name text,
  sheet_index integer,
  candidate_sheet_names text[] not null default '{}',
  source_locator jsonb not null default '{}'::jsonb,
  extraction_method text not null,
  confidence numeric
    check (confidence is null or (confidence >= 0 and confidence <= 1)),

  -- Dados extraídos (formato por categoria — ver weekly-report/types.ts),
  -- data de corte, métricas, cruzamentos, risco.
  data jsonb not null default '{}'::jsonb,
  cutoff_date date,
  metrics jsonb,
  cross_check jsonb,
  risk_classification text
    check (
      risk_classification is null
      or risk_classification in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'REVIEW_REQUIRED')
    ),
  risk_reasons jsonb not null default '[]'::jsonb,
  alerts jsonb not null default '[]'::jsonb,

  -- Expert existente responsável pela seção (nunca um Expert novo).
  expert_id text not null
    check (expert_id in ('planning-director', 'commercial-director', 'esg-director', 'ceo')),

  error_message text,

  -- Mapeamento/validação humana (detalhe em email_document_review_events).
  mapped_by_user_id uuid
    references public.profiles (id) on delete set null,
  mapped_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workbook_id, category)
);

comment on table public.weekly_report_sheets is
  'Abas do relatório semanal (Curva S, Linha de Base, Financeiro, Histograma, SSMA) extraídas da planilha: nome original, índice, faixas, dados, métricas, cruzamentos, risco e Expert responsável. LINHA_BASE é WEEKLY_REPORT_BASELINE_SHEET — nunca a baseline oficial do MPP.';

create index weekly_report_sheets_workbook_idx
  on public.weekly_report_sheets (workbook_id);
create index weekly_report_sheets_project_category_idx
  on public.weekly_report_sheets (project_id, category, created_at desc);

create trigger weekly_report_sheets_set_updated_at
before update on public.weekly_report_sheets
for each row
execute function public.set_weekly_schedule_row_updated_at();


-- ============================================================
-- 8. ALERTAS DE AUSÊNCIA (único por semana)
-- ============================================================

create table public.weekly_schedule_ingestion_alerts (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete cascade,
  config_id uuid not null
    references public.project_weekly_schedule_ingestion_configs (id) on delete cascade,

  kind text not null
    check (kind in ('MISSING_WEEKLY_SCHEDULE', 'MISSING_WEEKLY_REPORT_WORKBOOK', 'MISSING_S_CURVE', 'S_CURVE_MPP_DIVERGENCE', 'BASELINE_SHEET_DIVERGENCE')),
  week_start date not null,
  deadline_at timestamptz not null,

  recipient_user_ids uuid[] not null default '{}',
  detail text not null,

  notified_at timestamptz,
  resolved_at timestamptz,

  created_at timestamptz not null default now(),

  unique (project_id, week_start, kind)
);

comment on table public.weekly_schedule_ingestion_alerts is
  'Alertas únicos e idempotentes por (projeto, semana, tipo): ausência do cronograma, ausência da planilha do relatório semanal / da aba Curva S, divergência Curva S x MPP, divergência Linha de Base (Excel) x baseline oficial.';

create index weekly_schedule_ingestion_alerts_project_idx
  on public.weekly_schedule_ingestion_alerts (project_id, week_start desc);


-- ============================================================
-- 9. EVENTOS DE REVISÃO HUMANA (decisão, antes/depois, justificativa)
-- ============================================================

create table public.email_document_review_events (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects (id) on delete cascade,

  entity_type text not null
    check (entity_type in ('WEEKLY_SCHEDULE_EMAIL_INTAKE', 'EMAIL', 'EMAIL_ATTACHMENT', 'WEEKLY_REPORT_SHEET', 'SCHEDULE_BASELINE')),
  entity_id uuid not null,

  action text not null,
  field text,
  previous_value jsonb,
  new_value jsonb,
  justification text not null check (btrim(justification) <> ''),

  decided_by_user_id uuid not null
    references public.profiles (id) on delete restrict,
  decided_at timestamptz not null default now(),

  -- Preenchido pelo servidor após reprocessamento (nunca pelo navegador).
  reprocess_result jsonb,
  reprocessed_at timestamptz
);

comment on table public.email_document_review_events is
  'Trilha das decisões humanas sobre e-mails/anexos/intakes/Curva S/baseline: decisão, usuário, data, justificativa, valor anterior, valor novo e resultado do reprocessamento.';

create index email_document_review_events_entity_idx
  on public.email_document_review_events (entity_type, entity_id, decided_at desc);
create index email_document_review_events_project_idx
  on public.email_document_review_events (project_id, decided_at desc);


-- ============================================================
-- 10. AUDITORIA DE CONFIGURAÇÃO (trigger)
-- ============================================================

create or replace function public.audit_weekly_schedule_config_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_entity_id text;
begin
  v_project_id := coalesce(new.project_id, old.project_id);
  v_entity_id := coalesce(new.id, old.id)::text;

  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, actor_label, action, entity_type, entity_id, detail
  )
  values (
    v_project_id,
    case when auth.uid() is null then 'SYSTEM' else 'USER' end,
    auth.uid(),
    null,
    'WEEKLY_SCHEDULE_CONFIG_' || tg_op,
    tg_table_name,
    v_entity_id,
    format('Configuração da ingestão semanal de cronograma alterada (%s em %s).', tg_op, tg_table_name)
  );

  return coalesce(new, old);
end;
$$;

create trigger project_weekly_schedule_ingestion_configs_audit
after insert or update or delete on public.project_weekly_schedule_ingestion_configs
for each row execute function public.audit_weekly_schedule_config_change();

create trigger project_schedule_risk_thresholds_audit
after insert or update or delete on public.project_schedule_risk_thresholds
for each row execute function public.audit_weekly_schedule_config_change();


-- ============================================================
-- 11. RPCs DE AÇÃO HUMANA (SECURITY DEFINER, permissão validada)
-- ============================================================

-- 11.1 Baseline oficial — ADMINISTRADOR; nunca apaga a anterior.
create or replace function public.set_project_schedule_baseline(
  p_project_id uuid,
  p_schedule_version_id uuid,
  p_justification text
)
returns public.project_schedule_baselines
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous public.project_schedule_baselines;
  v_row public.project_schedule_baselines;
begin
  if auth.uid() is null then
    raise exception 'Sessão não autenticada.';
  end if;
  if not public.has_project_permission(p_project_id, 'ADMINISTRADOR') then
    raise exception 'Apenas administradores do projeto podem definir a baseline oficial.';
  end if;
  if btrim(coalesce(p_justification, '')) = '' then
    raise exception 'Justificativa é obrigatória.';
  end if;
  -- A schedule_version precisa pertencer ao projeto e estar extraída.
  if not exists (
    select 1
    from public.schedule_versions sv
    join public.document_versions dv on dv.id = sv.document_version_id
    where sv.id = p_schedule_version_id
      and dv.project_id = p_project_id
      and sv.extraction_status = 'EXTRACTED'
  ) then
    raise exception 'schedule_version inválida para este projeto ou ainda não extraída.';
  end if;

  select * into v_previous
  from public.project_schedule_baselines
  where project_id = p_project_id and superseded_at is null
  for update;

  if v_previous.id is not null then
    if v_previous.schedule_version_id = p_schedule_version_id then
      raise exception 'Esta versão já é a baseline oficial ativa.';
    end if;
    update public.project_schedule_baselines
    set superseded_at = now(), superseded_by_user_id = auth.uid()
    where id = v_previous.id;
  end if;

  insert into public.project_schedule_baselines (project_id, schedule_version_id, justification, set_by_user_id)
  values (p_project_id, p_schedule_version_id, btrim(p_justification), auth.uid())
  returning * into v_row;

  insert into public.email_document_review_events (
    project_id, entity_type, entity_id, action, field, previous_value, new_value, justification, decided_by_user_id
  )
  values (
    p_project_id, 'SCHEDULE_BASELINE', v_row.id, 'SET_BASELINE', 'schedule_version_id',
    to_jsonb(v_previous.schedule_version_id), to_jsonb(p_schedule_version_id), btrim(p_justification), auth.uid()
  );

  insert into public.audit_log_entries (project_id, actor_type, actor_user_id, action, entity_type, entity_id, detail)
  values (
    p_project_id, 'USER', auth.uid(), 'SCHEDULE_BASELINE_SET', 'project_schedule_baselines', v_row.id::text,
    format('Baseline oficial definida: schedule_version %s (anterior: %s).', p_schedule_version_id, coalesce(v_previous.schedule_version_id::text, 'nenhuma'))
  );

  return v_row;
end;
$$;

revoke all on function public.set_project_schedule_baseline(uuid, uuid, text) from public, anon;
grant execute on function public.set_project_schedule_baseline(uuid, uuid, text) to authenticated, service_role;


-- 11.2 Revisão humana de intake — ADMINISTRADOR. Só grava a DECISÃO e os
-- campos de revisão; o reprocessamento técnico (criar versão a partir
-- do anexo já ingerido) é feito pelo servidor (service role) e o
-- resultado volta em email_document_review_events.reprocess_result.
create or replace function public.review_weekly_schedule_intake(
  p_intake_id uuid,
  p_action text,
  p_justification text,
  p_payload jsonb default '{}'::jsonb
)
returns public.email_document_review_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intake public.weekly_schedule_email_intakes;
  v_event public.email_document_review_events;
  v_previous jsonb;
  v_new jsonb;
  v_field text;
begin
  if auth.uid() is null then
    raise exception 'Sessão não autenticada.';
  end if;

  select * into v_intake from public.weekly_schedule_email_intakes where id = p_intake_id for update;
  if v_intake.id is null then
    raise exception 'Intake não encontrado.';
  end if;
  if not public.has_project_permission(v_intake.project_id, 'ADMINISTRADOR') then
    raise exception 'Apenas administradores do projeto podem revisar intakes.';
  end if;
  if btrim(coalesce(p_justification, '')) = '' then
    raise exception 'Justificativa é obrigatória.';
  end if;
  if p_action not in ('APPROVE', 'REJECT', 'SET_WORK_WEEK', 'SELECT_ATTACHMENT', 'LINK_PROJECT', 'SET_CLASSIFICATION', 'REPROCESS') then
    raise exception 'Ação de revisão inválida: %', p_action;
  end if;

  if p_action in ('APPROVE', 'REJECT', 'REPROCESS') and v_intake.status not in ('PENDING_HUMAN_REVIEW', 'FAILED', 'APPROVED_HUMAN_REVIEW') then
    raise exception 'Intake com status % não admite %.', v_intake.status, p_action;
  end if;

  case p_action
    when 'APPROVE' then
      v_field := 'status';
      v_previous := to_jsonb(v_intake.status);
      v_new := to_jsonb('APPROVED_HUMAN_REVIEW'::text);
      update public.weekly_schedule_email_intakes
      set status = 'APPROVED_HUMAN_REVIEW', failure_error = null,
          reviewed_by_user_id = auth.uid(), reviewed_at = now(), review_note = btrim(p_justification)
      where id = p_intake_id;
    when 'REJECT' then
      v_field := 'status';
      v_previous := to_jsonb(v_intake.status);
      v_new := to_jsonb('REJECTED_HUMAN_REVIEW'::text);
      update public.weekly_schedule_email_intakes
      set status = 'REJECTED_HUMAN_REVIEW', failure_error = null,
          reviewed_by_user_id = auth.uid(), reviewed_at = now(), review_note = btrim(p_justification)
      where id = p_intake_id;
    when 'SET_WORK_WEEK' then
      v_field := 'work_week_number';
      v_previous := jsonb_build_object('work_week_number', v_intake.work_week_number, 'work_week_label', v_intake.work_week_label);
      v_new := jsonb_build_object(
        'work_week_number', (p_payload ->> 'work_week_number')::integer,
        'work_week_label', p_payload ->> 'work_week_label'
      );
      update public.weekly_schedule_email_intakes
      set work_week_number = (p_payload ->> 'work_week_number')::integer,
          work_week_label = p_payload ->> 'work_week_label',
          work_week_status = 'HUMAN_SET',
          reviewed_by_user_id = auth.uid(), reviewed_at = now(), review_note = btrim(p_justification)
      where id = p_intake_id;
      if v_intake.email_id is not null then
        update public.emails
        set work_week_number = (p_payload ->> 'work_week_number')::integer,
            work_week_label = p_payload ->> 'work_week_label',
            work_week_status = 'HUMAN_SET'
        where id = v_intake.email_id;
      end if;
    when 'SELECT_ATTACHMENT' then
      v_field := 'selected_email_attachment_id';
      v_previous := to_jsonb(v_intake.selected_email_attachment_id);
      v_new := to_jsonb((p_payload ->> 'email_attachment_id')::uuid);
      if not exists (
        select 1 from public.email_attachments ea
        where ea.id = (p_payload ->> 'email_attachment_id')::uuid
          and ea.email_id = v_intake.email_id
      ) then
        raise exception 'Anexo não pertence a este e-mail.';
      end if;
      update public.weekly_schedule_email_intakes
      set selected_email_attachment_id = (p_payload ->> 'email_attachment_id')::uuid,
          reviewed_by_user_id = auth.uid(), reviewed_at = now(), review_note = btrim(p_justification)
      where id = p_intake_id;
    when 'LINK_PROJECT' then
      -- Só ADMINISTRADOR do projeto de DESTINO também pode mover o intake.
      if not public.has_project_permission((p_payload ->> 'project_id')::uuid, 'ADMINISTRADOR') then
        raise exception 'Sem permissão no projeto de destino.';
      end if;
      if not exists (select 1 from public.project_weekly_schedule_ingestion_configs c where c.project_id = (p_payload ->> 'project_id')::uuid) then
        raise exception 'Projeto de destino não possui configuração de ingestão semanal.';
      end if;
      v_field := 'project_id';
      v_previous := to_jsonb(v_intake.project_id);
      v_new := to_jsonb((p_payload ->> 'project_id')::uuid);
      update public.weekly_schedule_email_intakes
      set project_id = (p_payload ->> 'project_id')::uuid,
          config_id = (select c.id from public.project_weekly_schedule_ingestion_configs c where c.project_id = (p_payload ->> 'project_id')::uuid),
          reviewed_by_user_id = auth.uid(), reviewed_at = now(), review_note = btrim(p_justification)
      where id = p_intake_id;
    when 'SET_CLASSIFICATION' then
      v_field := 'document_classification';
      if v_intake.email_id is null then
        raise exception 'Intake sem e-mail vinculado.';
      end if;
      select to_jsonb(e.document_classification) into v_previous from public.emails e where e.id = v_intake.email_id;
      v_new := to_jsonb(p_payload ->> 'classification');
      update public.emails
      set document_classification = p_payload ->> 'classification',
          classification_status = 'CONFIRMED', classified_at = now()
      where id = v_intake.email_id;
      update public.weekly_schedule_email_intakes
      set reviewed_by_user_id = auth.uid(), reviewed_at = now(), review_note = btrim(p_justification)
      where id = p_intake_id;
    when 'REPROCESS' then
      v_field := 'status';
      v_previous := to_jsonb(v_intake.status);
      v_new := to_jsonb(v_intake.status);
      update public.weekly_schedule_email_intakes
      set reviewed_by_user_id = auth.uid(), reviewed_at = now(), review_note = btrim(p_justification)
      where id = p_intake_id;
  end case;

  insert into public.email_document_review_events (
    project_id, entity_type, entity_id, action, field, previous_value, new_value, justification, decided_by_user_id
  )
  values (
    v_intake.project_id, 'WEEKLY_SCHEDULE_EMAIL_INTAKE', p_intake_id, p_action, v_field, v_previous, v_new, btrim(p_justification), auth.uid()
  )
  returning * into v_event;

  insert into public.audit_log_entries (project_id, actor_type, actor_user_id, action, entity_type, entity_id, detail)
  values (
    v_intake.project_id, 'USER', auth.uid(), 'WEEKLY_SCHEDULE_INTAKE_' || p_action, 'weekly_schedule_email_intakes', p_intake_id::text,
    format('Revisão humana %s: %s -> %s. Justificativa: %s', p_action, coalesce(v_previous::text, 'null'), coalesce(v_new::text, 'null'), btrim(p_justification))
  );

  return v_event;
end;
$$;

revoke all on function public.review_weekly_schedule_intake(uuid, text, text, jsonb) from public, anon;
grant execute on function public.review_weekly_schedule_intake(uuid, text, text, jsonb) to authenticated, service_role;


-- 11.3 Confirmar/corrigir classificação de e-mail ou anexo — membros
-- com papel de edição (GESTOR/GERENTE/COLABORADOR/ADMINISTRADOR).
create or replace function public.confirm_email_document_classification(
  p_email_id uuid,
  p_email_attachment_id uuid,
  p_classification text,
  p_justification text
)
returns public.email_document_review_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_previous jsonb;
  v_event public.email_document_review_events;
begin
  if auth.uid() is null then
    raise exception 'Sessão não autenticada.';
  end if;
  if btrim(coalesce(p_justification, '')) = '' then
    raise exception 'Justificativa é obrigatória.';
  end if;

  select project_id into v_project_id from public.emails where id = p_email_id;
  if v_project_id is null then
    raise exception 'E-mail não encontrado.';
  end if;
  if not public.can_manage_project_documents(v_project_id) then
    raise exception 'Sem permissão para classificar documentos neste projeto.';
  end if;

  if p_email_attachment_id is null then
    if p_classification not in ('ATA_REUNIAO', 'DIARIO_OBRA', 'ALTERACAO_PROJETO', 'ESG_SSMA', 'RELATORIO_SEMANAL', 'UNCLASSIFIED') then
      raise exception 'Classificação inválida: %', p_classification;
    end if;
    select to_jsonb(document_classification) into v_previous from public.emails where id = p_email_id;
    update public.emails
    set document_classification = p_classification,
        classification_status = case when p_classification = 'UNCLASSIFIED' then 'UNCLASSIFIED' else 'CONFIRMED' end,
        classified_at = now()
    where id = p_email_id;

    insert into public.email_document_review_events (project_id, entity_type, entity_id, action, field, previous_value, new_value, justification, decided_by_user_id)
    values (v_project_id, 'EMAIL', p_email_id, 'SET_CLASSIFICATION', 'document_classification', v_previous, to_jsonb(p_classification), btrim(p_justification), auth.uid())
    returning * into v_event;
  else
    if p_classification not in ('ATA_REUNIAO', 'DIARIO_OBRA', 'ALTERACAO_PROJETO', 'ESG_SSMA', 'RELATORIO_SEMANAL', 'RELATORIO_SEMANAL_PLANEJAMENTO', 'CRONOGRAMA_MPP', 'UNCLASSIFIED') then
      raise exception 'Classificação inválida: %', p_classification;
    end if;
    select to_jsonb(coalesce(confirmed_classification, suggested_classification)) into v_previous
    from public.email_attachments where id = p_email_attachment_id and email_id = p_email_id;
    if not found then
      raise exception 'Anexo não pertence a este e-mail.';
    end if;
    update public.email_attachments
    set confirmed_classification = p_classification
    where id = p_email_attachment_id;

    insert into public.email_document_review_events (project_id, entity_type, entity_id, action, field, previous_value, new_value, justification, decided_by_user_id)
    values (v_project_id, 'EMAIL_ATTACHMENT', p_email_attachment_id, 'SET_CLASSIFICATION', 'confirmed_classification', v_previous, to_jsonb(p_classification), btrim(p_justification), auth.uid())
    returning * into v_event;
  end if;

  insert into public.audit_log_entries (project_id, actor_type, actor_user_id, action, entity_type, entity_id, detail)
  values (
    v_project_id, 'USER', auth.uid(), 'EMAIL_DOCUMENT_CLASSIFICATION_CONFIRMED',
    case when p_email_attachment_id is null then 'emails' else 'email_attachments' end,
    coalesce(p_email_attachment_id, p_email_id)::text,
    format('Classificação %s -> %s. Justificativa: %s', coalesce(v_previous::text, 'null'), p_classification, btrim(p_justification))
  );

  return v_event;
end;
$$;

revoke all on function public.confirm_email_document_classification(uuid, uuid, text, text) from public, anon;
grant execute on function public.confirm_email_document_classification(uuid, uuid, text, text) to authenticated, service_role;


-- 11.4 Mapeamento humano de aba do relatório semanal (aba não localizada
-- ou ambígua) — permissão de edição (can_manage_project_documents). Só grava a decisão (nome da aba escolhida); a
-- extração dos dados é reexecutada pelo worker (idempotente).
create or replace function public.map_weekly_report_sheet(
  p_sheet_id uuid,
  p_sheet_name text,
  p_justification text
)
returns public.email_document_review_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.weekly_report_sheets;
  v_workbook public.weekly_report_workbooks;
  v_event public.email_document_review_events;
begin
  if auth.uid() is null then
    raise exception 'Sessão não autenticada.';
  end if;
  select * into v_row from public.weekly_report_sheets where id = p_sheet_id for update;
  if v_row.id is null then
    raise exception 'Aba do relatório semanal não encontrada.';
  end if;
  if not public.can_manage_project_documents(v_row.project_id) then
    raise exception 'Sem permissão para mapear abas neste projeto.';
  end if;
  if btrim(coalesce(p_justification, '')) = '' then
    raise exception 'Justificativa é obrigatória.';
  end if;
  select * into v_workbook from public.weekly_report_workbooks where id = v_row.workbook_id;
  -- A aba escolhida precisa existir no arquivo (índice de abas gravado na leitura).
  if not exists (
    select 1 from jsonb_array_elements(v_workbook.sheet_index) as item
    where item ->> 'name' = p_sheet_name
  ) then
    raise exception 'Aba "%" não existe no arquivo.', p_sheet_name;
  end if;

  update public.weekly_report_sheets
  set original_sheet_name = p_sheet_name,
      sheet_index = (
        select (item ->> 'index')::integer from jsonb_array_elements(v_workbook.sheet_index) as item
        where item ->> 'name' = p_sheet_name limit 1
      ),
      status = 'HUMAN_MAPPED',
      mapped_by_user_id = auth.uid(), mapped_at = now(),
      -- Dados/métricas serão reextraídos pelo worker a partir da aba mapeada.
      data = '{}'::jsonb, metrics = null, cross_check = null, risk_classification = null, risk_reasons = '[]'::jsonb
  where id = p_sheet_id;

  insert into public.email_document_review_events (project_id, entity_type, entity_id, action, field, previous_value, new_value, justification, decided_by_user_id)
  values (
    v_row.project_id, 'WEEKLY_REPORT_SHEET', p_sheet_id, 'MAP_SHEET', 'original_sheet_name',
    jsonb_build_object('original_sheet_name', v_row.original_sheet_name, 'status', v_row.status, 'candidates', to_jsonb(v_row.candidate_sheet_names)),
    jsonb_build_object('original_sheet_name', p_sheet_name, 'status', 'HUMAN_MAPPED'),
    btrim(p_justification), auth.uid()
  )
  returning * into v_event;

  insert into public.audit_log_entries (project_id, actor_type, actor_user_id, action, entity_type, entity_id, detail)
  values (v_row.project_id, 'USER', auth.uid(), 'WEEKLY_REPORT_SHEET_MAPPED', 'weekly_report_sheets', p_sheet_id::text,
          format('Aba %s mapeada manualmente para "%s". Justificativa: %s', v_row.category, p_sheet_name, btrim(p_justification)));

  return v_event;
end;
$$;

revoke all on function public.map_weekly_report_sheet(uuid, text, text) from public, anon;
grant execute on function public.map_weekly_report_sheet(uuid, text, text) to authenticated, service_role;


-- 11.5 Validação humana de valores de uma aba (ex.: Curva S lida com
-- baixa confiança) — permissão de edição (can_manage_project_documents). Métricas/risco são recalculados pelo worker.
create or replace function public.validate_weekly_report_sheet_values(
  p_sheet_id uuid,
  p_data jsonb,
  p_cutoff_date date,
  p_justification text
)
returns public.email_document_review_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.weekly_report_sheets;
  v_event public.email_document_review_events;
begin
  if auth.uid() is null then
    raise exception 'Sessão não autenticada.';
  end if;
  select * into v_row from public.weekly_report_sheets where id = p_sheet_id for update;
  if v_row.id is null then
    raise exception 'Aba do relatório semanal não encontrada.';
  end if;
  if not public.can_manage_project_documents(v_row.project_id) then
    raise exception 'Sem permissão para validar dados neste projeto.';
  end if;
  -- FINANCEIRO: regra única de correção (visualizar + editar), seção 12b.
  if v_row.category = 'FINANCEIRO' and not public.can_edit_project_financial_data(v_row.project_id) then
    raise exception 'Sem permissão para corrigir dados financeiros neste projeto.';
  end if;
  if btrim(coalesce(p_justification, '')) = '' then
    raise exception 'Justificativa é obrigatória.';
  end if;

  -- O valor ORIGINAL extraído nunca é substituído silenciosamente: fica no
  -- evento de revisão (previous_value) e é preservado dentro de data.original
  -- quando ainda não houver uma cópia (primeira correção).
  if (v_row.data ? 'original') is false and v_row.data <> '{}'::jsonb then
    p_data := p_data || jsonb_build_object('original', v_row.data, 'humanCorrected', true);
  elsif v_row.data ? 'original' then
    p_data := p_data || jsonb_build_object('original', v_row.data -> 'original', 'humanCorrected', true);
  else
    p_data := p_data || jsonb_build_object('humanCorrected', true);
  end if;

  update public.weekly_report_sheets
  set data = p_data, cutoff_date = p_cutoff_date, status = 'HUMAN_VALIDATED',
      mapped_by_user_id = auth.uid(), mapped_at = now(),
      metrics = null, cross_check = null, risk_classification = null, risk_reasons = '[]'::jsonb
  where id = p_sheet_id;

  insert into public.email_document_review_events (project_id, entity_type, entity_id, action, field, previous_value, new_value, justification, decided_by_user_id)
  values (
    v_row.project_id, 'WEEKLY_REPORT_SHEET', p_sheet_id, 'VALIDATE_VALUES', 'data',
    jsonb_build_object('data', v_row.data, 'cutoff_date', v_row.cutoff_date),
    jsonb_build_object('data', p_data, 'cutoff_date', p_cutoff_date),
    btrim(p_justification), auth.uid()
  )
  returning * into v_event;

  insert into public.audit_log_entries (project_id, actor_type, actor_user_id, action, entity_type, entity_id, detail)
  values (v_row.project_id, 'USER', auth.uid(), 'WEEKLY_REPORT_SHEET_VALIDATED', 'weekly_report_sheets', p_sheet_id::text,
          format('Valores da aba %s validados manualmente. Justificativa: %s', v_row.category, btrim(p_justification)));

  return v_event;
end;
$$;

revoke all on function public.validate_weekly_report_sheet_values(uuid, jsonb, date, text) from public, anon;
grant execute on function public.validate_weekly_report_sheet_values(uuid, jsonb, date, text) to authenticated, service_role;


-- ============================================================
-- 12. BUSCA SERVER-SIDE DO REGISTRO DOCUMENTAL (SECURITY INVOKER => RLS)
-- ============================================================
-- Paginada, parametrizada, ordenada por data recente. Busca em título/
-- assunto, arquivo, remetente, destinatários, WNN, texto extraído
-- (document_extractions), atividades MPP e Curva S. Roda com os
-- privilégios do chamador: a RLS de emails/email_attachments/etc.
-- garante que usuário sem acesso ao projeto não vê nada.

create or replace function public.search_email_document_registry(
  p_project_id uuid,
  p_query text default null,
  p_classification text default null,
  p_sent_to_client boolean default null,
  p_direction text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_sender text default null,
  p_recipient text default null,
  p_work_week integer default null,
  p_classification_status text default null,
  p_intake_status text default null,
  p_risk text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  email_id uuid,
  subject text,
  from_address text,
  to_address text,
  sent_at timestamptz,
  direction text,
  mailbox_address text,
  document_classification text,
  classification_status text,
  classification_confidence numeric,
  work_week_number integer,
  work_week_label text,
  work_week_status text,
  sent_to_client boolean,
  attachment_count bigint,
  intake_id uuid,
  intake_status text,
  risk_classification text,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select e.*
    from public.emails e
    where e.project_id = p_project_id
      and (p_classification is null
           or (p_classification = 'UNCLASSIFIED' and (e.document_classification is null or e.document_classification = 'UNCLASSIFIED'))
           or e.document_classification = p_classification)
      and (p_sent_to_client is null or coalesce(e.sent_to_client, false) = p_sent_to_client)
      and (p_direction is null or e.direction = p_direction)
      and (p_from is null or e.sent_at >= p_from)
      and (p_to is null or e.sent_at <= p_to)
      and (p_sender is null or e.from_address ilike '%' || p_sender || '%')
      and (p_recipient is null or e.to_address ilike '%' || p_recipient || '%')
      and (p_work_week is null or e.work_week_number = p_work_week)
      and (p_classification_status is null or e.classification_status = p_classification_status)
      and (
        p_query is null or btrim(p_query) = ''
        or e.subject ilike '%' || p_query || '%'
        or e.from_address ilike '%' || p_query || '%'
        or e.to_address ilike '%' || p_query || '%'
        or coalesce(e.work_week_label, '') ilike '%' || p_query || '%'
        or exists (
          select 1 from public.email_attachments ea
          where ea.email_id = e.id and ea.original_file_name ilike '%' || p_query || '%'
        )
        or exists (
          select 1
          from public.email_attachments ea
          join public.document_extractions de on de.document_version_id = ea.document_version_id
          where ea.email_id = e.id and de.text_content ilike '%' || p_query || '%'
        )
        or exists (
          select 1
          from public.email_attachments ea
          join public.schedule_versions sv on sv.document_version_id = ea.document_version_id
          join public.schedule_activities sa on sa.schedule_version_id = sv.id
          where ea.email_id = e.id and sa.name ilike '%' || p_query || '%'
        )
        or exists (
          select 1
          from public.weekly_report_workbooks wb
          join public.weekly_report_sheets ws on ws.workbook_id = wb.id
          where wb.email_id = e.id
            and (ws.data::text ilike '%' || p_query || '%' or coalesce(ws.original_sheet_name, '') ilike '%' || p_query || '%')
        )
      )
  ),
  enriched as (
    select
      b.id as email_id,
      b.subject,
      b.from_address,
      b.to_address,
      b.sent_at,
      b.direction,
      b.mailbox_address,
      b.document_classification,
      b.classification_status,
      b.classification_confidence,
      b.work_week_number,
      b.work_week_label,
      b.work_week_status,
      b.sent_to_client,
      (select count(*) from public.email_attachments ea where ea.email_id = b.id) as attachment_count,
      i.id as intake_id,
      i.status as intake_status,
      (
        select c.risk_classification
        from public.schedule_version_comparisons c
        join public.schedule_versions sv on sv.id = c.current_schedule_version_id
        where sv.document_version_id = i.document_version_id
        order by case c.risk_classification
          when 'CRITICAL' then 0 when 'HIGH' then 1 when 'REVIEW_REQUIRED' then 2 when 'MEDIUM' then 3 else 4 end
        limit 1
      ) as risk_classification
    from base b
    left join lateral (
      select w.id, w.status, w.document_version_id
      from public.weekly_schedule_email_intakes w
      where w.email_id = b.id
      order by w.created_at desc
      limit 1
    ) i on true
  )
  select
    en.*,
    count(*) over () as total_count
  from enriched en
  where (p_intake_status is null or en.intake_status = p_intake_status)
    and (p_risk is null or en.risk_classification = p_risk)
  order by en.sent_at desc
  limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.search_email_document_registry(uuid, text, text, boolean, text, timestamptz, timestamptz, text, text, integer, text, text, text, integer, integer) from public, anon;
grant execute on function public.search_email_document_registry(uuid, text, text, boolean, text, timestamptz, timestamptz, text, text, integer, text, text, text, integer, integer) to authenticated, service_role;


-- ============================================================
-- 12b. ACESSO AO DASHBOARD FINANCEIRO (regra única, server-side + RLS)
-- ============================================================
-- Dados financeiros são sensíveis. Regra centralizada, espelhada em
-- apps/web/lib/financial/access.ts (evaluateFinancialDashboardAccess /
-- evaluateFinancialEditAccess) e coberta por testes de paridade TS × SQL.
--
-- VISUALIZAR:
--   membership ACTIVE no projeto E (
--     papel ADMINISTRADOR ou GERENTE (qualquer área)
--     OU área DIRETORIA ou FINANCEIRO (qualquer papel)
--   ).
-- CORRIGIR/VALIDAR valores financeiros:
--   visualizar E permissão de edição do modelo existente
--   (can_manage_project_documents: ADMINISTRADOR ou GERENTE) —
--   LEITURA e COLABORADOR nunca corrigem.
--
-- LEGADO: 'GESTOR' é o valor antigo de GERENTE (mantido no CHECK apenas
-- por compatibilidade — migration 20260829200000) e é tratado como
-- GERENTE aqui, exatamente como em can_manage_project_documents.
-- Nenhum papel inventado fora do modelo (ADMINISTRADOR, GERENTE, COLABORADOR, LEITURA).
-- Nada baseado em nome/e-mail. Usada pela policy de weekly_report_sheets
-- para a categoria FINANCEIRO: sem acesso, a linha não é retornada nem
-- por chamada direta à API.

create or replace function public.can_view_project_financial_dashboard(p_project_id uuid)
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
      and (
        pm.permission in ('ADMINISTRADOR', 'GERENTE', 'GESTOR')
        or pm.area in ('DIRETORIA', 'FINANCEIRO')
      )
  );
$$;

revoke all on function public.can_view_project_financial_dashboard(uuid) from public, anon;
grant execute on function public.can_view_project_financial_dashboard(uuid) to authenticated, service_role;

create or replace function public.can_edit_project_financial_data(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_view_project_financial_dashboard(p_project_id)
     and public.can_manage_project_documents(p_project_id);
$$;

revoke all on function public.can_edit_project_financial_data(uuid) from public, anon;
grant execute on function public.can_edit_project_financial_data(uuid) to authenticated, service_role;


-- ============================================================
-- 13. RLS
-- ============================================================

alter table public.project_weekly_schedule_ingestion_configs enable row level security;
alter table public.project_schedule_risk_thresholds enable row level security;
alter table public.project_schedule_baselines enable row level security;
alter table public.weekly_schedule_email_intakes enable row level security;
alter table public.schedule_version_comparisons enable row level security;
alter table public.weekly_report_workbooks enable row level security;
alter table public.weekly_report_sheets enable row level security;
alter table public.weekly_schedule_ingestion_alerts enable row level security;
alter table public.email_document_review_events enable row level security;

-- Leitura: membros ativos do projeto (usuário sem acesso ao projeto não vê nada).
create policy "weekly_schedule_configs_select_project_members_only"
  on public.project_weekly_schedule_ingestion_configs for select
  using (public.is_project_member(project_id));

create policy "schedule_risk_thresholds_select_project_members_only"
  on public.project_schedule_risk_thresholds for select
  using (public.is_project_member(project_id));

create policy "project_schedule_baselines_select_project_members_only"
  on public.project_schedule_baselines for select
  using (public.is_project_member(project_id));

create policy "weekly_schedule_intakes_select_project_members_only"
  on public.weekly_schedule_email_intakes for select
  using (public.is_project_member(project_id));

create policy "schedule_version_comparisons_select_project_members_only"
  on public.schedule_version_comparisons for select
  using (public.is_project_member(project_id));

create policy "weekly_report_workbooks_select_project_members_only"
  on public.weekly_report_workbooks for select
  using (public.is_project_member(project_id));

-- Abas do relatório semanal: membros do projeto; a aba FINANCEIRO exige
-- adicionalmente a regra financeira (can_view_project_financial_dashboard).
create policy "weekly_report_sheets_select_project_members_only"
  on public.weekly_report_sheets for select
  using (
    public.is_project_member(project_id)
    and (category <> 'FINANCEIRO' or public.can_view_project_financial_dashboard(project_id))
  );

create policy "weekly_schedule_alerts_select_project_members_only"
  on public.weekly_schedule_ingestion_alerts for select
  using (public.is_project_member(project_id));

create policy "email_document_review_events_select_project_members_only"
  on public.email_document_review_events for select
  using (public.is_project_member(project_id));

-- Configuração de regras: ADMINISTRADOR (insert/update). Sem DELETE.
-- Colunas técnicas (target_document_id, last_scanned_sent_at) ficam
-- fora do GRANT por coluna: só o worker as altera.
create policy "weekly_schedule_configs_insert_admin_only"
  on public.project_weekly_schedule_ingestion_configs for insert
  with check (public.has_project_permission(project_id, 'ADMINISTRADOR'));

create policy "weekly_schedule_configs_update_admin_only"
  on public.project_weekly_schedule_ingestion_configs for update
  using (public.has_project_permission(project_id, 'ADMINISTRADOR'))
  with check (public.has_project_permission(project_id, 'ADMINISTRADOR'));

revoke update on public.project_weekly_schedule_ingestion_configs from authenticated;
grant update (
  enabled, authorized_area, authorized_tiers, sender_domain,
  client_recipient_domains, client_recipient_addresses, require_client_recipient,
  cadence, deadline_weekday, deadline_time, timezone,
  monitoring_start_at, monitoring_end_at, attachment_name_pattern,
  alert_recipient_user_ids, updated_by_user_id
) on public.project_weekly_schedule_ingestion_configs to authenticated;

create policy "schedule_risk_thresholds_insert_admin_only"
  on public.project_schedule_risk_thresholds for insert
  with check (public.has_project_permission(project_id, 'ADMINISTRADOR'));

create policy "schedule_risk_thresholds_update_admin_only"
  on public.project_schedule_risk_thresholds for update
  using (public.has_project_permission(project_id, 'ADMINISTRADOR'))
  with check (public.has_project_permission(project_id, 'ADMINISTRADOR'));

-- Sem policy de INSERT/UPDATE/DELETE para "authenticated" em: intakes,
-- comparisons, weekly_report_workbooks/sheets, alerts, baselines, review_events e
-- nas colunas novas de emails/email_attachments — toda escrita vem do
-- service role (worker) ou das RPCs SECURITY DEFINER acima, que validam
-- permissão e registram valor anterior/novo. Hash, message_id,
-- remetente, destinatários e resultados automáticos nunca são editáveis
-- pelo navegador.
