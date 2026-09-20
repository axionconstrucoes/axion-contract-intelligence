-- ============================================================
-- 20260921090000_pilot_risk_alert_delivery.sql
-- Entrega auditável dos alertas de risco do módulo de relatórios
-- semanais, respeitando a Matriz de responsabilidades e prazos.
--
-- O que já existe e é REUTILIZADO (nenhum segundo sistema de notificação):
--   - sla_matrix_rules / sla_area_responsibles / sla_project_settings
--     (fonte ÚNICA de prazos, unidades, níveis 1/2/3, e-mail, confirmação
--     e justificativa — nada disso é duplicado aqui);
--   - sla_actions / sla_action_escalations (ciclo assumir → tratar →
--     concluir, escalonamento, botões de e-mail acionável SLA_ACTION);
--   - emails + audit_log_entries (registro de todo envio);
--   - provider de e-mail (Gmail/Fake) com o guard global do piloto.
--
-- O que faltava (estrutura indispensável, tudo ADITIVO):
--   1. registro dos CASOS de risco (fonte → estado atual → ação SLA
--      vinculada), para detectar novo / alterado / subiu de nível /
--      encerrado sem repetir;
--   2. OUTBOX idempotente por evento × estado × nível × destinatário ×
--      janela, com destinatários suprimidos pelo piloto auditados;
--   3. allowlist do piloto POR user_id (configuração exclusiva do projeto,
--      removível após o piloto) + liga/desliga dos alertas por projeto;
--   4. RPC de escalonamento executável pelo worker (service_role): a
--      escalate_sla_action existente exige auth.uid() e ADMINISTRADOR.
--
-- Nenhuma tabela/coluna existente é apagada ou alterada de tipo; nenhum
-- dado é escrito. A feature continua atrás de ACC_WEEKLY_REPORTS_ENABLED
-- (server-side) e de risk_alerts_enabled por projeto (default false).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Configuração por projeto: alertas e allowlist do piloto
-- ------------------------------------------------------------
alter table public.project_weekly_schedule_ingestion_configs
  add column risk_alerts_enabled boolean not null default false,
  -- NULL/vazio = allowlist não configurada => NENHUM envio (fail-closed).
  -- Após o piloto, esta coluna pode ser removida junto com a checagem em
  -- apps/web/lib/risk-alerts/plan-risk-alerts.ts.
  add column pilot_recipient_allowlist_user_ids uuid[],
  -- Severidade dos alertas de ausência/divergência do módulo semanal, POR
  -- PROJETO (ex.: {"MISSING_WEEKLY_SCHEDULE":"HIGH",...}). NULL = não
  -- configurado => CONFIGURATION_REVIEW_REQUIRED (nunca um default ativo).
  add column risk_alert_severity_map jsonb,
  -- Confirmação HUMANA inequívoca de que este é o projeto piloto real.
  -- Sem ela, nenhum envio real (candidatos [DEV]/PRE nunca são escolhidos
  -- automaticamente).
  add column pilot_project_confirmed_at timestamptz,
  add column pilot_project_confirmed_by_user_id uuid
    references public.profiles (id) on delete set null;

-- Sem GRANT de escrita a authenticated: a tabela só tem policy de SELECT
-- (20260920120000) e o hardening 20260920170000 revogou toda escrita —
-- estas colunas são gravadas apenas pelo worker/script (service_role).

comment on column public.project_weekly_schedule_ingestion_configs.pilot_recipient_allowlist_user_ids is
  'Piloto: somente estes user_ids podem receber e-mails de alerta de risco deste projeto. NULL/vazio = nenhum envio. Remover após o piloto.';

-- ------------------------------------------------------------
-- 2. Casos de risco (fonte única por origem)
-- ------------------------------------------------------------
create table public.risk_alert_cases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null
    references public.projects (id) on delete cascade,
  source_type text not null
    check (source_type in ('SCHEDULE_COMPARISON', 'WEEKLY_REPORT_SHEET', 'INGESTION_ALERT')),
  source_id uuid not null,
  area text not null
    check (area in ('DIRETORIA', 'ADMINISTRATIVO', 'COMERCIAL', 'FINANCEIRO', 'ENGENHARIA', 'ORCAMENTO', 'JURIDICO', 'PLANEJAMENTO', 'ESG_SSMA')),
  risk_level text not null
    check (risk_level in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'REVIEW_REQUIRED')),
  previous_risk_level text
    check (previous_risk_level is null or previous_risk_level in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'REVIEW_REQUIRED')),
  title text not null check (btrim(title) <> ''),
  summary text not null default '',
  impact text not null default '',
  recommendation text,
  -- Hash determinístico do estado relevante (nível + motivos + métricas):
  -- muda => "risco alterado" => novo alerta válido.
  fingerprint text not null,
  status text not null default 'OPEN'
    check (status in ('OPEN', 'CLOSED')),
  -- Ação SLA criada para ALTO/CRÍTICO (assumir/tratar/concluir + escalonamento).
  sla_action_id uuid
    references public.sla_actions (id) on delete set null,
  -- Regra da Matriz usada na última avaliação (auditoria; nunca fonte de prazo).
  matrix_policy_status text not null default 'OK'
    check (matrix_policy_status in ('OK', 'CONFIGURATION_REVIEW_REQUIRED')),
  matrix_policy_missing text[] not null default '{}',
  -- Máquina de estados do alerta (apps/web/lib/risk-alerts/alert-state-machine.ts).
  state text not null default 'OPEN'
    check (state in (
      'OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'FORWARDED', 'AWAITING_RECIPIENT_ACTION',
      'RETURNED_TO_SENDER', 'EXPERT_CONSULTATION_PENDING', 'EXPERT_ANSWERED',
      'RESOLUTION_PROPOSED', 'RESOLVED', 'REVIEW_REQUIRED', 'TOP_LEVEL_REACHED'
    )),
  -- Nível hierárquico ATUAL do alerta (fonte para "próximo nível" — nunca o
  -- cargo da pessoa encaminhada). TOP_LEVEL_REACHED registrado em top_level_reached_at.
  current_level text not null default 'RESPONSAVEL'
    check (current_level in ('RESPONSAVEL', 'ESCALAO_1', 'ESCALAO_2', 'DIRETORIA')),
  top_level_reached_at timestamptz,
  current_responsible_user_id uuid references public.profiles (id) on delete set null,
  previous_responsible_user_id uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  resolved_by_user_id uuid references public.profiles (id) on delete set null,
  -- Código curto visível no e-mail (fallback de correlação da resposta).
  visible_code text not null default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  origin_path text not null default '',
  reference text not null default '',
  last_digest_window text,
  first_seen_at timestamptz not null default now(),
  last_changed_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, source_type, source_id),
  unique (project_id, visible_code),
  check ((status = 'CLOSED') = (closed_at is not null)),
  check ((state = 'RESOLVED') = (resolved_at is not null))
);

create index risk_alert_cases_project_status_idx
  on public.risk_alert_cases (project_id, status, risk_level);
create index risk_alert_cases_sla_action_idx
  on public.risk_alert_cases (sla_action_id)
  where sla_action_id is not null;

create trigger risk_alert_cases_set_updated_at
before update on public.risk_alert_cases
for each row execute function public.set_weekly_schedule_row_updated_at();

-- ------------------------------------------------------------
-- 3. Outbox de alertas (idempotente, auditável)
-- ------------------------------------------------------------
create table public.risk_alert_outbox (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null
    references public.projects (id) on delete cascade,
  -- NULL para o consolidado semanal (que agrega vários casos).
  case_id uuid
    references public.risk_alert_cases (id) on delete cascade,
  sla_action_id uuid
    references public.sla_actions (id) on delete set null,
  risk_level text not null
    check (risk_level in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'DIGEST')),
  notification_type text not null
    check (notification_type in ('IMMEDIATE', 'ESCALATION', 'DIGEST', 'FORWARD', 'RETURNED', 'EXPERT_ANSWER', 'ACTION_CONFIRMATION')),
  -- Quem originou a entrega: motor horário, botão manual, resposta por e-mail,
  -- ação humana na interface. Mesma idempotency_key para todas as origens.
  origin text not null default 'AUTOMATIC'
    check (origin in ('AUTOMATIC', 'MANUAL', 'EMAIL_REPLY', 'WEB_ACTION')),
  conversation_id uuid,
  message_id_header text,
  in_reply_to_header text,
  references_header text,
  escalation_level text
    check (escalation_level is null or escalation_level in ('RESPONSAVEL', 'ESCALAO_1', 'ESCALAO_2', 'DIRETORIA')),
  recipient_user_id uuid not null
    references public.profiles (id) on delete restrict,
  -- Resolvido no momento do envio (nunca antes); NULL enquanto pendente ou suprimido.
  recipient_email text,
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  provider text,
  provider_message_id text,
  email_id uuid
    references public.emails (id) on delete set null,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'SENT', 'FAILED', 'SUPPRESSED', 'SKIPPED')),
  suppression_reason text
    check (suppression_reason is null or suppression_reason in (
      'PILOT_RECIPIENT_SUPPRESSED', 'PILOT_ALLOWLIST_MISSING', 'USER_NOT_ACTIVE',
      'EMAIL_MISSING', 'EMAIL_NOT_CORPORATE', 'MATRIX_AMBIGUOUS',
      'CONFIGURATION_REVIEW_REQUIRED', 'NOTIFY_BY_EMAIL_DISABLED',
      'FEATURE_DISABLED', 'PROJECT_DISABLED', 'PROVIDER_NOT_CONFIGURED', 'DRY_RUN',
      'PILOT_PROJECT_NOT_CONFIRMED', 'MATRIX_RULES_NOT_EXPLICIT', 'SEVERITY_MAP_NOT_CONFIGURED',
      'REPLY_MAILBOX_NOT_CONFIGURED', 'RISK_CASE_REQUIRED', 'TOP_LEVEL_REACHED'
    )),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  digest_window text,
  -- Evento × estado (fingerprint) × nível × destinatário × janela.
  idempotency_key text not null unique,
  -- Regra da Matriz aplicada (unidade, prazos, níveis, flags) — auditoria.
  matrix_rule_snapshot jsonb not null default '{}'::jsonb,
  -- Resumo sanitizado do que foi/seria enviado (nunca tokens, nunca corpo completo).
  payload_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'SENT') = (sent_at is not null)),
  check (status <> 'SUPPRESSED' or suppression_reason is not null),
  check (notification_type <> 'DIGEST' or (case_id is null and digest_window is not null)),
  -- Fora do consolidado: risk_alert_case OBRIGATÓRIO. Ações SLA comuns (sem
  -- alerta de risco) nunca entram nesta outbox — continuam no fluxo antigo.
  check (notification_type = 'DIGEST' or case_id is not null),
  check (last_error is null or char_length(last_error) <= 2000)
);

create index risk_alert_outbox_project_status_idx
  on public.risk_alert_outbox (project_id, status, scheduled_for);
create index risk_alert_outbox_case_idx
  on public.risk_alert_outbox (case_id)
  where case_id is not null;
create index risk_alert_outbox_digest_idx
  on public.risk_alert_outbox (project_id, digest_window)
  where notification_type = 'DIGEST';

create trigger risk_alert_outbox_set_updated_at
before update on public.risk_alert_outbox
for each row execute function public.set_weekly_schedule_row_updated_at();

-- ------------------------------------------------------------
-- 3b. Conversa de e-mail por alerta (thread; Reply-To opaco só como hash)
-- ------------------------------------------------------------
create table public.alert_email_conversations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  case_id uuid not null references public.risk_alert_cases (id) on delete cascade,
  -- sha256 do token do Reply-To opaco (o token em si nunca é persistido).
  reply_token_hash text not null unique,
  -- Message-ID do primeiro e-mail da thread (References/In-Reply-To das respostas).
  root_message_id_header text,
  provider_thread_id text,
  status text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (case_id)
);
create trigger alert_email_conversations_set_updated_at
before update on public.alert_email_conversations
for each row execute function public.set_weekly_schedule_row_updated_at();

alter table public.risk_alert_outbox
  add constraint risk_alert_outbox_conversation_fk
  foreign key (conversation_id) references public.alert_email_conversations (id) on delete set null;

-- ------------------------------------------------------------
-- 3c. Mensagens da conversa (enviadas e recebidas). Corpo fica AQUI e só
--     aqui — nunca em logs/auditoria.
-- ------------------------------------------------------------
create table public.alert_email_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  conversation_id uuid references public.alert_email_conversations (id) on delete set null,
  case_id uuid references public.risk_alert_cases (id) on delete set null,
  outbox_id uuid references public.risk_alert_outbox (id) on delete set null,
  direction text not null check (direction in ('OUTBOUND', 'INBOUND')),
  provider text,
  provider_message_id text not null unique,
  provider_thread_id text,
  message_id_header text,
  in_reply_to_header text,
  references_header text,
  reply_to_header text,
  -- Hash do token do Reply-To opaco usado NESTE envio (token nunca persistido).
  reply_token_hash text unique,
  sender_user_id uuid references public.profiles (id) on delete set null,
  sender_email text,
  recipients text[] not null default '{}',
  subject text,
  body_original text,
  body_clean text,
  quoted_text text,
  signature_text text,
  auto_submitted boolean not null default false,
  authentication_results text,
  correlation_method text
    check (correlation_method is null or correlation_method in ('IN_REPLY_TO', 'REFERENCES', 'REPLY_TO_TOKEN', 'VISIBLE_CODE', 'NONE')),
  classification text
    check (classification is null or classification in (
      'ACKNOWLEDGEMENT', 'JUSTIFICATION', 'DECISION', 'QUESTION_TO_EXPERT', 'REQUEST_MORE_INFORMATION',
      'DISAGREEMENT', 'STATUS_UPDATE', 'UNCLASSIFIED'
    )),
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  expert_id text check (expert_id is null or expert_id in ('planning-director', 'commercial-director', 'esg-director', 'legal-consultant', 'ceo')),
  -- Decisão de roteamento do Expert (fonte, confiança, temas, sugerido × confirmado).
  expert_routing jsonb,
  requires_human_review boolean not null default false,
  status text not null default 'RECEIVED'
    check (status in ('SENT', 'RECEIVED', 'PROCESSED', 'IGNORED_AUTO_REPLY', 'IGNORED_BOUNCE', 'IGNORED_SELF', 'IGNORED_LOOP',
                      'PENDING_HUMAN_REVIEW', 'UNAUTHORIZED_REPLY', 'REVIEW_REQUIRED', 'EXPERT_SELECTION_REVIEW_REQUIRED')),
  status_reason text check (status_reason is null or char_length(status_reason) <= 500),
  sent_at timestamptz,
  received_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  -- Limites de tamanho (o worker já trunca; aqui é a última barreira).
  check (body_original is null or char_length(body_original) <= 200000),
  check (body_clean is null or char_length(body_clean) <= 200000),
  check (subject is null or char_length(subject) <= 1000)
);
create index alert_email_messages_case_idx on public.alert_email_messages (case_id, created_at);
create index alert_email_messages_conversation_idx on public.alert_email_messages (conversation_id, created_at);
create index alert_email_messages_pending_idx on public.alert_email_messages (project_id, status) where status = 'RECEIVED';

-- ------------------------------------------------------------
-- 3d. Eventos de ação (RESOLVIDO / TOMANDO PROVIDÊNCIAS / ENVIAR P/ /
--     ESPECIALISTA / OUTRO / escalonamento / devolução) — trilha completa.
-- ------------------------------------------------------------
create table public.risk_alert_action_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  case_id uuid not null references public.risk_alert_cases (id) on delete cascade,
  action_type text not null
    check (action_type in (
      'RESOLVED', 'RESOLUTION_PROPOSED', 'RESOLUTION_CONFIRMED', 'TAKING_ACTION', 'FORWARD', 'EXPERT_CONSULTATION',
      'EXPERT_ANSWERED', 'OTHER', 'IMMEDIATE_ESCALATION', 'SCHEDULED_ESCALATION', 'TOP_LEVEL_REACHED',
      'FORWARD_TIMEOUT', 'RETURNED_TO_SENDER', 'REPLY_RECEIVED', 'REPLY_REVIEW_REQUIRED', 'UNAUTHORIZED_REPLY'
    )),
  actor_type text not null check (actor_type in ('USER', 'SYSTEM')),
  actor_user_id uuid references public.profiles (id) on delete set null,
  origin text not null check (origin in ('WEB', 'EMAIL', 'SYSTEM')),
  from_state text,
  to_state text,
  from_level text,
  to_level text,
  text_content text,
  justification text,
  evidence text,
  forecast_at timestamptz,
  target_user_id uuid references public.profiles (id) on delete set null,
  expert_id text check (expert_id is null or expert_id in ('planning-director', 'commercial-director', 'esg-director', 'legal-consultant', 'ceo')),
  expert_routing jsonb,
  message_id uuid references public.alert_email_messages (id) on delete set null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  check ((actor_type = 'USER') = (actor_user_id is not null)),
  check (from_state is null or from_state in (
      'OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'FORWARDED', 'AWAITING_RECIPIENT_ACTION',
      'RETURNED_TO_SENDER', 'EXPERT_CONSULTATION_PENDING', 'EXPERT_ANSWERED',
      'RESOLUTION_PROPOSED', 'RESOLVED', 'REVIEW_REQUIRED', 'TOP_LEVEL_REACHED')),
  check (to_state is null or to_state in (
      'OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'FORWARDED', 'AWAITING_RECIPIENT_ACTION',
      'RETURNED_TO_SENDER', 'EXPERT_CONSULTATION_PENDING', 'EXPERT_ANSWERED',
      'RESOLUTION_PROPOSED', 'RESOLVED', 'REVIEW_REQUIRED', 'TOP_LEVEL_REACHED')),
  check (from_level is null or from_level in ('RESPONSAVEL', 'ESCALAO_1', 'ESCALAO_2', 'DIRETORIA')),
  check (to_level is null or to_level in ('RESPONSAVEL', 'ESCALAO_1', 'ESCALAO_2', 'DIRETORIA')),
  check (text_content is null or char_length(text_content) <= 8000),
  check (justification is null or char_length(justification) <= 8000),
  check (evidence is null or char_length(evidence) <= 8000),
  -- Texto obrigatório nas ações que o exigem (OUTRO, pergunta ao Expert, providência).
  check (action_type not in ('OTHER', 'EXPERT_CONSULTATION', 'TAKING_ACTION') or btrim(coalesce(text_content, '')) <> ''),
  check (action_type <> 'EXPERT_CONSULTATION' or expert_id is not null),
  check (action_type <> 'FORWARD' or target_user_id is not null)
);
create index risk_alert_action_events_case_idx on public.risk_alert_action_events (case_id, created_at);

-- ------------------------------------------------------------
-- 3e. Encaminhamentos (ENVIAR P/) — um único ativo por alerta
-- ------------------------------------------------------------
create table public.risk_alert_forward_assignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  case_id uuid not null references public.risk_alert_cases (id) on delete cascade,
  from_user_id uuid not null references public.profiles (id) on delete restrict,
  to_user_id uuid not null references public.profiles (id) on delete restrict,
  instruction text not null default '',
  -- Exceção do piloto: destinatário fora da allowlist recebe SÓ este alerta.
  pilot_exception boolean not null default false,
  assume_due_at timestamptz not null,
  timeout_at timestamptz not null,
  acted_at timestamptz,
  returned_at timestamptz,
  state text not null default 'ACTIVE' check (state in ('ACTIVE', 'ACTED', 'TIMED_OUT', 'RETURNED', 'CANCELLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_user_id <> to_user_id),
  check ((state = 'RETURNED') = (returned_at is not null)),
  check (char_length(instruction) <= 8000),
  check (timeout_at >= assume_due_at)
);
create unique index risk_alert_forward_assignments_one_active_idx
  on public.risk_alert_forward_assignments (case_id) where state = 'ACTIVE';
create trigger risk_alert_forward_assignments_set_updated_at
before update on public.risk_alert_forward_assignments
for each row execute function public.set_weekly_schedule_row_updated_at();

-- ------------------------------------------------------------
-- 3f. Links de ação do e-mail: token curto/expirável, só hash; GET nunca
--     altera estado — o link abre página autenticada de confirmação e a
--     ação é revalidada server-side (RPC abaixo).
-- ------------------------------------------------------------
create table public.risk_alert_action_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  case_id uuid not null references public.risk_alert_cases (id) on delete cascade,
  recipient_user_id uuid not null references public.profiles (id) on delete cascade,
  action_type text not null check (action_type in ('RESOLVED', 'TAKING_ACTION', 'FORWARD', 'EXPERT_CONSULTATION', 'OTHER')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index risk_alert_action_links_case_idx on public.risk_alert_action_links (case_id, recipient_user_id);

-- ------------------------------------------------------------
-- 4. RLS e privilégios (lição da 20260920170000: nada para anon/PUBLIC;
--    authenticated só SELECT via membership; escrita só pelo worker e
--    pelas RPCs SECURITY DEFINER abaixo)
-- ------------------------------------------------------------
alter table public.risk_alert_cases enable row level security;
alter table public.risk_alert_outbox enable row level security;
alter table public.alert_email_conversations enable row level security;
alter table public.alert_email_messages enable row level security;
alter table public.risk_alert_action_events enable row level security;
alter table public.risk_alert_forward_assignments enable row level security;
alter table public.risk_alert_action_links enable row level security;

create policy "risk_alert_cases_select_project_members_only"
  on public.risk_alert_cases for select
  using (public.is_project_member(project_id));
create policy "risk_alert_outbox_select_project_members_only"
  on public.risk_alert_outbox for select
  using (public.is_project_member(project_id));
create policy "alert_email_conversations_select_project_members_only"
  on public.alert_email_conversations for select
  using (public.is_project_member(project_id));
create policy "alert_email_messages_select_project_members_only"
  on public.alert_email_messages for select
  using (public.is_project_member(project_id));
create policy "risk_alert_action_events_select_project_members_only"
  on public.risk_alert_action_events for select
  using (public.is_project_member(project_id));
create policy "risk_alert_forward_assignments_select_project_members_only"
  on public.risk_alert_forward_assignments for select
  using (public.is_project_member(project_id));
-- Links: só o próprio destinatário enxerga o registro (nunca o hash de outro).
create policy "risk_alert_action_links_select_own_only"
  on public.risk_alert_action_links for select
  using (public.is_project_member(project_id) and recipient_user_id = auth.uid());

revoke all on table public.risk_alert_cases from public, anon;
revoke all on table public.risk_alert_outbox from public, anon;
revoke all on table public.alert_email_conversations from public, anon;
revoke all on table public.alert_email_messages from public, anon;
revoke all on table public.risk_alert_action_events from public, anon;
revoke all on table public.risk_alert_forward_assignments from public, anon;
revoke all on table public.risk_alert_action_links from public, anon;
revoke insert, update, delete, truncate, references, trigger, maintain on table public.risk_alert_cases from authenticated;
revoke insert, update, delete, truncate, references, trigger, maintain on table public.risk_alert_outbox from authenticated;
revoke insert, update, delete, truncate, references, trigger, maintain on table public.alert_email_conversations from authenticated;
revoke insert, update, delete, truncate, references, trigger, maintain on table public.alert_email_messages from authenticated;
revoke insert, update, delete, truncate, references, trigger, maintain on table public.risk_alert_action_events from authenticated;
revoke insert, update, delete, truncate, references, trigger, maintain on table public.risk_alert_forward_assignments from authenticated;
revoke insert, update, delete, truncate, references, trigger, maintain on table public.risk_alert_action_links from authenticated;
-- Corpo das mensagens: nem o SELECT por membership expõe body_original a
-- quem não é do projeto (RLS); colunas de corpo nunca vão para logs.

-- ------------------------------------------------------------
-- 5. Escalonamento pelo worker (service_role) — mesma lógica da
--    escalate_sla_action (concorrência otimista, Nível 2 ausente => Nível 3,
--    auditoria), sem exigir sessão de usuário. Só o worker pode chamar.
-- ------------------------------------------------------------
-- Lógica compartilhada (NÃO exposta): usada por escalate_sla_action_system
-- (worker) e por record_risk_alert_action (escalonamento imediato por ação
-- humana). Nunca concedida a nenhum papel.
create or replace function public.apply_sla_action_escalation_internal(
  p_action_id uuid,
  p_expected_current_level text,
  p_new_level text,
  p_reason text,
  p_detail_prefix text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.sla_actions%rowtype;
  v_effective_level text := p_new_level;
  v_level_2_user_id uuid;
  v_legacy_level_2_user_id uuid;
  v_level_3_user_id uuid;
  v_notified_user_id uuid;
  v_escalation_id uuid;
begin
  select * into v_action
  from public.sla_actions
  where id = p_action_id
  for update;

  if not found then
    raise exception 'SLA action not found';
  end if;

  if v_action.current_escalation_level <> p_expected_current_level then
    raise exception 'Escalation level changed concurrently — refresh and retry (expected %, found %)',
      p_expected_current_level, v_action.current_escalation_level;
  end if;

  if v_action.status in ('COMPLETED', 'CANCELLED') then
    raise exception 'Cannot escalate a completed/cancelled action';
  end if;

  if p_reason not in (
    'NO_ACKNOWLEDGMENT', 'NOT_RESPONDED', 'NOT_COMPLETED',
    'CONTRACTUAL_DEADLINE_NEAR', 'CONTRACTUAL_DEADLINE_MISSED',
    'NEW_EVIDENCE_INCREASED_RISK', 'RELEVANT_RECOMMENDATION_REJECTED'
  ) then
    raise exception 'Invalid escalation reason';
  end if;

  -- Sem Nível 4 e sem nível inventado: só os níveis da Matriz.
  if p_new_level not in ('ESCALAO_1', 'ESCALAO_2', 'DIRETORIA') then
    raise exception 'Invalid escalation level';
  end if;
  if p_expected_current_level not in ('RESPONSAVEL', 'ESCALAO_1', 'ESCALAO_2', 'DIRETORIA') then
    raise exception 'Invalid current escalation level';
  end if;

  select escalation_1_user_id, escalation_2_user_id, board_user_id
  into v_level_2_user_id, v_legacy_level_2_user_id, v_level_3_user_id
  from public.sla_area_responsibles
  where project_id = v_action.project_id and area = v_action.area;

  if p_new_level = 'ESCALAO_1' then
    if v_level_2_user_id is not null then
      v_notified_user_id := v_level_2_user_id;
    elsif v_level_3_user_id is not null then
      v_effective_level := 'DIRETORIA';
      v_notified_user_id := v_level_3_user_id;
    end if;
  elsif p_new_level = 'ESCALAO_2' then
    if v_legacy_level_2_user_id is not null then
      v_notified_user_id := v_legacy_level_2_user_id;
    elsif v_level_3_user_id is not null then
      v_effective_level := 'DIRETORIA';
      v_notified_user_id := v_level_3_user_id;
    end if;
  elsif p_new_level = 'DIRETORIA' then
    v_notified_user_id := v_level_3_user_id;
  end if;

  perform set_config('acc.allow_escalation_update', 'true', true);

  update public.sla_actions
  set current_escalation_level = v_effective_level, status = 'ESCALATED'
  where id = p_action_id;

  perform set_config('acc.allow_escalation_update', 'false', true);

  insert into public.sla_action_escalations (
    action_id, project_id, from_level, to_level, reason, notified_user_id
  )
  values (
    p_action_id, v_action.project_id, p_expected_current_level,
    v_effective_level, p_reason, v_notified_user_id
  )
  returning id into v_escalation_id;

  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, actor_label,
    action, entity_type, entity_id, detail
  )
  values (
    v_action.project_id, 'SYSTEM', null, null,
    'ACTION_ESCALATED', 'SLA_ACTION', p_action_id::text,
    format(
      '%s Ação "%s" escalada de %s para %s (motivo: %s).',
      p_detail_prefix, v_action.title, p_expected_current_level, v_effective_level, p_reason
    )
  );

  return v_escalation_id;
end;
$$;

alter function public.apply_sla_action_escalation_internal(uuid, text, text, text, text) owner to postgres;
revoke all on function public.apply_sla_action_escalation_internal(uuid, text, text, text, text) from public, anon, authenticated, service_role;

create or replace function public.escalate_sla_action_system(
  p_action_id uuid,
  p_expected_current_level text,
  p_new_level text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Somente o worker (service_role); nunca um usuário autenticado.
  if current_setting('request.jwt.claims', true) is not null
     and coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') not in ('service_role', '') then
    raise exception 'escalate_sla_action_system: service role required';
  end if;
  return public.apply_sla_action_escalation_internal(p_action_id, p_expected_current_level, p_new_level, p_reason, '[alerta de risco — prazo da Matriz]');
end;
$$;

alter function public.escalate_sla_action_system(uuid, text, text, text) owner to postgres;
revoke all on function public.escalate_sla_action_system(uuid, text, text, text) from public;
revoke all on function public.escalate_sla_action_system(uuid, text, text, text) from anon;
revoke all on function public.escalate_sla_action_system(uuid, text, text, text) from authenticated;
grant execute on function public.escalate_sla_action_system(uuid, text, text, text) to service_role;

comment on function public.escalate_sla_action_system(uuid, text, text, text) is
  'Escalonamento automático de ações de SLA pelo worker de alertas de risco (service_role). Mesma regra de escalate_sla_action, sem sessão de usuário.';

-- ------------------------------------------------------------
-- 6. Ações humanas sobre o alerta (RESOLVIDO / TOMANDO PROVIDÊNCIAS /
--    ENVIAR P/ / ESPECIALISTA / OUTRO) — fonte ÚNICA de escrita para
--    interface (WEB), resposta por e-mail (EMAIL, via worker) e sistema.
--    A transição é calculada pela máquina de estados TypeScript
--    (alert-state-machine.ts), mas NADA vindo do cliente é confiado:
--    aqui se revalidam autor (auth.uid()), membership ACTIVE, permissão
--    sobre o alerta, estado esperado (lock FOR UPDATE + concorrência
--    otimista), transição permitida por estado, um encaminhamento ativo,
--    destinatário do encaminhamento (ACTIVE, membro, não suspenso),
--    encaminhamento expirado, Expert cadastrado + pergunta, texto de
--    OUTRO, níveis válidos, idempotência (chaves únicas prefixadas pelo
--    próprio caso), token de link (hash, expiração, dono, uso único),
--    escalonamento imediato via lógica interna e outbox (PENDING) —
--    NENHUM e-mail é enviado aqui; o worker envia a partir da outbox.
-- ------------------------------------------------------------
-- Matriz de transições permitidas por estado (espelho de ACTIONS_BY_STATE
-- em alert-detail-data.ts). IMMUTABLE, sem acesso a tabelas.
create or replace function public.risk_alert_action_allowed(p_state text, p_action text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_state = 'RESOLVED' then false
    when p_action = 'RESOLUTION_CONFIRMED' then p_state = 'RESOLUTION_PROPOSED'
    when p_state = 'RESOLUTION_PROPOSED' then p_action in ('TAKING_ACTION', 'OTHER')
    when p_action = 'FORWARD' then p_state in ('OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RETURNED_TO_SENDER',
                                              'EXPERT_CONSULTATION_PENDING', 'EXPERT_ANSWERED', 'REVIEW_REQUIRED', 'TOP_LEVEL_REACHED')
    when p_action = 'EXPERT_CONSULTATION' then p_state in ('OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'FORWARDED', 'AWAITING_RECIPIENT_ACTION',
                                                          'RETURNED_TO_SENDER', 'EXPERT_ANSWERED', 'REVIEW_REQUIRED', 'TOP_LEVEL_REACHED')
    when p_action in ('RESOLVED', 'RESOLUTION_PROPOSED', 'TAKING_ACTION', 'OTHER') then p_state in (
      'OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'FORWARDED', 'AWAITING_RECIPIENT_ACTION', 'RETURNED_TO_SENDER',
      'EXPERT_CONSULTATION_PENDING', 'EXPERT_ANSWERED', 'REVIEW_REQUIRED', 'TOP_LEVEL_REACHED')
    else false
  end;
$$;
alter function public.risk_alert_action_allowed(text, text) owner to postgres;
revoke all on function public.risk_alert_action_allowed(text, text) from public, anon;
grant execute on function public.risk_alert_action_allowed(text, text) to authenticated, service_role;

create or replace function public.record_risk_alert_action(
  p_case_id uuid,
  p_expected_state text,
  p_transition jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.risk_alert_cases%rowtype;
  v_action public.sla_actions%rowtype;
  v_link public.risk_alert_action_links%rowtype;
  v_active_forward public.risk_alert_forward_assignments%rowtype;
  v_auth_uid uuid := auth.uid();
  v_is_service boolean := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role';
  v_actor uuid;
  v_actor_allowed boolean := false;
  v_primary_action text;
  v_requested_action text := p_transition ->> 'actionType';
  v_event jsonb;
  v_event_action text;
  v_event_actor uuid;
  v_outbox jsonb;
  v_forward jsonb := p_transition -> 'forward';
  v_escalation jsonb := p_transition -> 'escalation';
  v_case_update jsonb := coalesce(p_transition -> 'caseUpdate', '{}'::jsonb);
  v_new_state text;
  v_new_level text;
  v_target uuid;
  v_key text;
  v_event_ids uuid[] := '{}';
  v_event_id uuid;
  v_outbox_id uuid;
  v_escalation_id uuid;
  v_conversation_id uuid;
  v_states constant text[] := array['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'FORWARDED', 'AWAITING_RECIPIENT_ACTION',
    'RETURNED_TO_SENDER', 'EXPERT_CONSULTATION_PENDING', 'EXPERT_ANSWERED', 'RESOLUTION_PROPOSED', 'RESOLVED',
    'REVIEW_REQUIRED', 'TOP_LEVEL_REACHED'];
  v_levels constant text[] := array['RESPONSAVEL', 'ESCALAO_1', 'ESCALAO_2', 'DIRETORIA'];
  v_system_events constant text[] := array['IMMEDIATE_ESCALATION', 'SCHEDULED_ESCALATION', 'TOP_LEVEL_REACHED',
    'FORWARD_TIMEOUT', 'RETURNED_TO_SENDER', 'EXPERT_ANSWERED'];
  v_human_events constant text[] := array['RESOLVED', 'RESOLUTION_PROPOSED', 'RESOLUTION_CONFIRMED', 'TAKING_ACTION',
    'FORWARD', 'EXPERT_CONSULTATION', 'OTHER'];
begin
  -- ---- autenticação
  if v_auth_uid is null and not v_is_service then
    raise exception 'Sessão não autenticada.';
  end if;
  if jsonb_typeof(p_transition) is distinct from 'object' then
    raise exception 'Transição inválida.';
  end if;

  -- ---- autor efetivo: usuário autenticado; pelo worker (service_role), o
  --      usuário identificado na resposta por e-mail (ou SYSTEM = null).
  if v_auth_uid is not null then
    v_actor := v_auth_uid;
  elsif (p_transition ->> 'actorUserId') is not null then
    v_actor := (p_transition ->> 'actorUserId')::uuid;
  end if;

  -- ---- caso (lock) + projeto
  select * into v_case from public.risk_alert_cases where id = p_case_id for update;
  if not found then
    raise exception 'Alerta não encontrado.';
  end if;
  if v_auth_uid is not null and not public.is_project_member(v_case.project_id) then
    raise exception 'Sem acesso a este projeto.';
  end if;
  if v_actor is not null and not exists (
    select 1 from public.project_memberships pm
    join public.profiles pr on pr.id = pm.user_id
    where pm.project_id = v_case.project_id and pm.user_id = v_actor and pm.status = 'ACTIVE'
  ) then
    raise exception 'Usuário sem membership ACTIVE neste projeto.';
  end if;

  -- ---- estado esperado / terminal
  if p_expected_state is null or not (p_expected_state = any (v_states)) then
    raise exception 'Estado esperado inválido.';
  end if;
  if v_case.state <> p_expected_state then
    raise exception 'Estado do alerta mudou (esperado %, atual %) — recarregue e repita.', p_expected_state, v_case.state;
  end if;
  if v_case.state = 'RESOLVED' then
    raise exception 'Alerta já resolvido — nenhuma ação adicional é permitida.';
  end if;

  -- ---- ação principal (primeiro evento humano) e transição permitida
  select e ->> 'actionType' into v_primary_action
  from jsonb_array_elements(coalesce(p_transition -> 'events', '[]'::jsonb)) e
  where (e ->> 'actionType') = any (v_human_events)
  limit 1;
  if v_requested_action is not null and v_requested_action not in ('RESOLVED', 'RESOLUTION_CONFIRMED', 'TAKING_ACTION', 'FORWARD', 'EXPERT_CONSULTATION', 'OTHER') then
    raise exception 'Ação inválida.';
  end if;
  if coalesce(v_requested_action, v_primary_action) is not null
     and not public.risk_alert_action_allowed(v_case.state, coalesce(v_requested_action, v_primary_action)) then
    raise exception 'Ação % não permitida no estado %.', coalesce(v_requested_action, v_primary_action), v_case.state;
  end if;
  if v_primary_action is not null and not public.risk_alert_action_allowed(v_case.state, v_primary_action) then
    raise exception 'Ação % não permitida no estado %.', v_primary_action, v_case.state;
  end if;
  if v_primary_action is not null and v_actor is null then
    raise exception 'Ação humana exige usuário identificado.';
  end if;

  -- ---- permissão sobre o alerta: administrador, responsável atual/anterior,
  --      encaminhado ativo, destinatário de e-mail do alerta ou responsável
  --      da área na Matriz (níveis 1/2/3). Ninguém mais age sobre o alerta.
  select * into v_active_forward from public.risk_alert_forward_assignments where case_id = p_case_id and state = 'ACTIVE';
  if v_actor is not null then
    v_actor_allowed :=
      (v_auth_uid is not null and public.has_project_permission(v_case.project_id, 'ADMINISTRADOR'))
      or v_case.current_responsible_user_id = v_actor
      or v_case.previous_responsible_user_id = v_actor
      or (v_active_forward.id is not null and v_active_forward.to_user_id = v_actor)
      or exists (select 1 from public.risk_alert_outbox o where o.case_id = p_case_id and o.recipient_user_id = v_actor)
      or exists (
        select 1 from public.sla_area_responsibles r
        where r.project_id = v_case.project_id and r.area = v_case.area
          and v_actor in (r.responsible_direct_user_id, r.secondary_responsible_user_id, r.escalation_1_user_id, r.escalation_2_user_id, r.board_user_id)
      );
    if not v_actor_allowed then
      raise exception 'Usuário sem permissão para agir sobre este alerta.';
    end if;
  end if;

  -- ---- encaminhado com prazo expirado não age como responsável
  if v_active_forward.id is not null and v_actor = v_active_forward.to_user_id and now() > v_active_forward.timeout_at then
    raise exception 'O prazo para assumir este encaminhamento expirou; a responsabilidade voltou ao remetente.';
  end if;

  -- ---- token de link do e-mail (opcional): hash, dono, ação, validade, uso único.
  --      Nunca é a autorização — só é consumido quando presente.
  if (p_transition ->> 'actionLinkTokenHash') is not null then
    select * into v_link from public.risk_alert_action_links
      where token_hash = p_transition ->> 'actionLinkTokenHash' and case_id = p_case_id for update;
    if not found or v_link.recipient_user_id is distinct from v_actor or v_link.action_type is distinct from coalesce(v_requested_action, v_primary_action)
       or v_link.expires_at <= now() or v_link.used_at is not null then
      raise exception 'Link de ação expirado, inválido ou já utilizado.';
    end if;
    update public.risk_alert_action_links set used_at = now() where id = v_link.id;
  end if;

  -- ---- novo estado / nível
  v_new_state := coalesce(v_case_update ->> 'state', v_case.state);
  if not (v_new_state = any (v_states)) then
    raise exception 'Estado de destino inválido.';
  end if;
  v_new_level := v_case_update ->> 'currentLevel';
  if v_new_level is not null and not (v_new_level = any (v_levels)) then
    raise exception 'Nível inválido.';
  end if;
  if v_new_state = 'RESOLVED' and v_primary_action not in ('RESOLVED', 'RESOLUTION_CONFIRMED') then
    raise exception 'Só RESOLVIDO / CONFIRMAR RESOLUÇÃO encerram o alerta.';
  end if;

  -- ---- eventos (idempotência por chave única prefixada pelo caso)
  for v_event in select * from jsonb_array_elements(coalesce(p_transition -> 'events', '[]'::jsonb)) loop
    v_event_action := v_event ->> 'actionType';
    if not (v_event_action = any (v_human_events || v_system_events)) then
      raise exception 'Tipo de evento inválido.';
    end if;
    if position(p_case_id::text || ':' in coalesce(v_event ->> 'idempotencyKey', '')) <> 1 then
      raise exception 'Chave de idempotência inválida.';
    end if;
    if (v_event ->> 'fromState') is distinct from v_case.state then
      raise exception 'Evento fora do estado atual do alerta.';
    end if;
    if exists (select 1 from public.risk_alert_action_events where idempotency_key = v_event ->> 'idempotencyKey') then
      raise exception 'Ação já registrada (%).', v_event ->> 'idempotencyKey';
    end if;
    -- Autor do evento: humano => sempre o autor efetivo (o cliente não
    -- escolhe); eventos de sistema => sem autor.
    if v_event_action = any (v_human_events) then
      v_event_actor := v_actor;
    else
      v_event_actor := null;
    end if;
    if v_event_action = 'FORWARD' and (v_event ->> 'targetUserId') is null then
      raise exception 'Encaminhamento sem destinatário.';
    end if;
    insert into public.risk_alert_action_events (
      project_id, case_id, action_type, actor_type, actor_user_id, origin, from_state, to_state, from_level, to_level,
      text_content, justification, evidence, forecast_at, target_user_id, expert_id, expert_routing, message_id, idempotency_key
    ) values (
      v_case.project_id, p_case_id, v_event_action,
      case when v_event_actor is null then 'SYSTEM' else 'USER' end,
      v_event_actor,
      case when v_auth_uid is not null then 'WEB' else coalesce(v_event ->> 'origin', 'SYSTEM') end,
      v_event ->> 'fromState', v_event ->> 'toState',
      v_event ->> 'fromLevel', v_event ->> 'toLevel', left(v_event ->> 'text', 8000), left(v_event ->> 'justification', 8000), left(v_event ->> 'evidence', 8000),
      (v_event ->> 'forecastAt')::timestamptz, (v_event ->> 'targetUserId')::uuid, v_event ->> 'expertId', v_event -> 'expertRouting',
      (v_event ->> 'messageId')::uuid, v_event ->> 'idempotencyKey'
    ) returning id into v_event_id;
    v_event_ids := v_event_ids || v_event_id;
  end loop;

  -- ---- encaminhamento: um único ativo por alerta; destinatário membro
  --      ACTIVE (perfil existente), diferente do autor; só o encaminhado
  --      ativo pode re-encaminhar (cancelando o seu).
  if v_forward is not null and jsonb_typeof(v_forward) = 'object' then
    v_target := (v_forward ->> 'toUserId')::uuid;
    if v_target is null or v_target = v_actor then
      raise exception 'Destinatário do encaminhamento inválido.';
    end if;
    if not exists (
      select 1 from public.project_memberships pm
      join public.profiles pr on pr.id = pm.user_id
      where pm.project_id = v_case.project_id and pm.user_id = v_target and pm.status = 'ACTIVE'
    ) then
      raise exception 'Destinatário sem membership ACTIVE neste projeto (suspenso, removido ou inexistente).';
    end if;
    if v_active_forward.id is not null or v_case.state in ('FORWARDED', 'AWAITING_RECIPIENT_ACTION') then
      raise exception 'Já existe um encaminhamento ativo; aguarde a ação ou a devolução.';
    end if;
    if (v_forward ->> 'assumeDueAt')::timestamptz is null or (v_forward ->> 'assumeDueAt')::timestamptz <= now() then
      raise exception 'Prazo para assumir inválido.';
    end if;
    insert into public.risk_alert_forward_assignments (
      project_id, case_id, from_user_id, to_user_id, instruction, pilot_exception, assume_due_at, timeout_at
    ) values (
      v_case.project_id, p_case_id, v_actor, v_target,
      left(coalesce(v_forward ->> 'instruction', ''), 8000), coalesce((v_forward ->> 'pilotException')::boolean, false),
      (v_forward ->> 'assumeDueAt')::timestamptz, greatest((v_forward ->> 'timeoutAt')::timestamptz, (v_forward ->> 'assumeDueAt')::timestamptz)
    );
  end if;
  if (p_transition ->> 'closeActiveForwardAs') is not null then
    if (p_transition ->> 'closeActiveForwardAs') not in ('ACTED', 'RETURNED', 'CANCELLED') then
      raise exception 'Encerramento de encaminhamento inválido.';
    end if;
    update public.risk_alert_forward_assignments
      set state = p_transition ->> 'closeActiveForwardAs',
          acted_at = case when p_transition ->> 'closeActiveForwardAs' = 'ACTED' then now() else acted_at end,
          returned_at = case when p_transition ->> 'closeActiveForwardAs' = 'RETURNED' then now() else returned_at end
      where case_id = p_case_id and state = 'ACTIVE';
  end if;

  -- ---- escalonamento imediato (ação SLA vinculada) — lógica compartilhada.
  --      Pré-checagem explícita (nível atual e status) em vez de engolir
  --      qualquer erro: mudança concorrente => não duplica; outros erros sobem.
  if v_escalation is not null and jsonb_typeof(v_escalation) = 'object' and v_case.sla_action_id is not null then
    if (v_escalation ->> 'toLevel') not in ('ESCALAO_1', 'ESCALAO_2', 'DIRETORIA') then
      raise exception 'Nível de escalonamento inválido.';
    end if;
    select * into v_action from public.sla_actions where id = v_case.sla_action_id;
    if found and v_action.current_escalation_level = (v_escalation ->> 'fromLevel') and v_action.status not in ('COMPLETED', 'CANCELLED') then
      v_escalation_id := public.apply_sla_action_escalation_internal(
        v_case.sla_action_id, v_escalation ->> 'fromLevel', v_escalation ->> 'toLevel',
        coalesce(v_escalation ->> 'reason', 'NEW_EVIDENCE_INCREASED_RISK'), '[alerta de risco — escalonamento imediato por ação]'
      );
    end if;
  end if;

  -- ---- outbox (PENDING/SUPPRESSED) — chaves duplicadas são ignoradas;
  --      chaves só do próprio caso; origem nunca escolhida pelo cliente web.
  select id into v_conversation_id from public.alert_email_conversations where case_id = p_case_id;
  for v_outbox in select * from jsonb_array_elements(coalesce(p_transition -> 'outbox', '[]'::jsonb)) loop
    v_key := v_outbox ->> 'idempotencyKey';
    if v_key is null
       or (position(v_case.source_type || ':' || v_case.source_id::text || ':' in v_key) <> 1
           and position(p_case_id::text || ':' in v_key) <> 1) then
      raise exception 'Chave de outbox inválida.';
    end if;
    if not exists (select 1 from public.profiles where id = (v_outbox ->> 'recipientUserId')::uuid) then
      raise exception 'Destinatário da outbox inexistente.';
    end if;
    insert into public.risk_alert_outbox (
      project_id, case_id, sla_action_id, risk_level, notification_type, origin, escalation_level, recipient_user_id,
      scheduled_for, status, suppression_reason, idempotency_key, matrix_rule_snapshot, payload_summary, conversation_id
    ) values (
      v_case.project_id, p_case_id, v_case.sla_action_id, v_outbox ->> 'riskLevel', v_outbox ->> 'notificationType',
      case when v_auth_uid is not null then 'WEB_ACTION' else coalesce(v_outbox ->> 'origin', 'EMAIL_REPLY') end,
      v_outbox ->> 'escalationLevel', (v_outbox ->> 'recipientUserId')::uuid,
      now(), coalesce(v_outbox ->> 'status', 'PENDING'), v_outbox ->> 'suppressionReason', v_key,
      coalesce(v_outbox -> 'matrixRuleSnapshot', '{}'::jsonb), coalesce(v_outbox -> 'payloadSummary', '{}'::jsonb), v_conversation_id
    )
    on conflict (idempotency_key) do nothing
    returning id into v_outbox_id;
  end loop;

  -- ---- estado do caso
  update public.risk_alert_cases set
    state = v_new_state,
    current_level = coalesce(v_new_level, current_level),
    top_level_reached_at = case when (v_case_update ->> 'topLevelReached')::boolean is true then coalesce(top_level_reached_at, now()) else top_level_reached_at end,
    current_responsible_user_id = case when v_case_update ? 'currentResponsibleUserId' then (v_case_update ->> 'currentResponsibleUserId')::uuid else current_responsible_user_id end,
    previous_responsible_user_id = case when v_case_update ? 'previousResponsibleUserId' then (v_case_update ->> 'previousResponsibleUserId')::uuid else previous_responsible_user_id end,
    resolved_at = case when v_new_state = 'RESOLVED' then coalesce(resolved_at, now()) else resolved_at end,
    resolved_by_user_id = case when v_new_state = 'RESOLVED' then coalesce(resolved_by_user_id, v_actor) else resolved_by_user_id end
  where id = p_case_id;

  -- ---- ação SLA vinculada acompanha (assumir/concluir) — regra existente.
  if v_case.sla_action_id is not null then
    if v_case_update ->> 'slaActionStatus' = 'ACKNOWLEDGED' then
      update public.sla_actions set status = 'ACKNOWLEDGED', acknowledged_at = coalesce(acknowledged_at, now()),
        acknowledged_by_user_id = coalesce(acknowledged_by_user_id, v_actor)
        where id = v_case.sla_action_id and acknowledged_at is null and v_actor is not null;
    elsif v_case_update ->> 'slaActionStatus' = 'IN_PROGRESS' then
      update public.sla_actions set status = 'IN_PROGRESS', acknowledged_at = coalesce(acknowledged_at, now()),
        acknowledged_by_user_id = coalesce(acknowledged_by_user_id, v_actor)
        where id = v_case.sla_action_id and status not in ('COMPLETED', 'CANCELLED') and v_actor is not null;
    elsif v_case_update ->> 'slaActionStatus' = 'COMPLETED' then
      update public.sla_actions set status = 'COMPLETED', completed_at = coalesce(completed_at, now()),
        completed_by_user_id = coalesce(completed_by_user_id, v_actor),
        completion_note = coalesce(completion_note, left(coalesce(v_case_update ->> 'completionNote', 'Resolvido via alerta de risco.'), 8000)),
        acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by_user_id = coalesce(acknowledged_by_user_id, v_actor)
        where id = v_case.sla_action_id and completed_at is null and v_actor is not null;
    end if;
    if v_case_update ? 'responsibleUserId' and (v_case_update ->> 'responsibleUserId') is not null then
      if not exists (
        select 1 from public.project_memberships pm
        where pm.project_id = v_case.project_id and pm.user_id = (v_case_update ->> 'responsibleUserId')::uuid and pm.status = 'ACTIVE'
      ) then
        raise exception 'Responsável sem membership ACTIVE neste projeto.';
      end if;
      update public.sla_actions set responsible_user_id = (v_case_update ->> 'responsibleUserId')::uuid where id = v_case.sla_action_id;
    end if;
  end if;

  insert into public.audit_log_entries (project_id, actor_type, actor_user_id, actor_label, action, entity_type, entity_id, detail)
  values (
    v_case.project_id, case when v_actor is null then 'SYSTEM' else 'USER' end, v_actor, null,
    'RISK_ALERT_ACTION', 'RISK_ALERT_CASE', p_case_id::text,
    format('Ação sobre alerta: %s (estado %s -> %s).', left(coalesce(p_transition ->> 'summary', '-'), 500), p_expected_state, v_new_state)
  );

  return jsonb_build_object('caseId', p_case_id, 'eventIds', to_jsonb(v_event_ids), 'escalationId', v_escalation_id, 'state', v_new_state);
end;
$$;

alter function public.record_risk_alert_action(uuid, text, jsonb) owner to postgres;
revoke all on function public.record_risk_alert_action(uuid, text, jsonb) from public, anon;
grant execute on function public.record_risk_alert_action(uuid, text, jsonb) to authenticated, service_role;

-- ------------------------------------------------------------
-- 7. Botão manual "Processar escalonamentos": entrega pela MESMA outbox
--    e MESMA chave do motor (nunca segundo e-mail). ADMINISTRADOR.
-- ------------------------------------------------------------
create or replace function public.enqueue_manual_escalation_email(
  p_action_id uuid,
  p_level text,
  p_recipient_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action public.sla_actions%rowtype;
  v_case public.risk_alert_cases%rowtype;
  v_key text;
  v_id uuid;
  v_inserted boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Sessão não autenticada.';
  end if;
  if p_level not in ('RESPONSAVEL', 'ESCALAO_1', 'ESCALAO_2', 'DIRETORIA') then
    raise exception 'Nível inválido.';
  end if;
  select * into v_action from public.sla_actions where id = p_action_id;
  if not found then
    raise exception 'Ação não encontrada.';
  end if;
  if not public.has_project_permission(v_action.project_id, 'ADMINISTRADOR') then
    raise exception 'ADMINISTRADOR permission required';
  end if;
  -- Delimitação: SEM alerta de risco vinculado, nada entra nesta outbox —
  -- a ação SLA comum permanece no fluxo antigo (envio direto), sem erro.
  select * into v_case from public.risk_alert_cases where sla_action_id = p_action_id limit 1;
  if not found then
    return jsonb_build_object('outboxId', null, 'idempotencyKey', null, 'inserted', false, 'skipped', 'NO_RISK_ALERT_CASE');
  end if;
  if not exists (
    select 1 from public.project_memberships pm
    where pm.project_id = v_action.project_id and pm.user_id = p_recipient_user_id and pm.status = 'ACTIVE'
  ) then
    raise exception 'Destinatário sem membership ACTIVE neste projeto.';
  end if;
  -- MESMA chave do motor horário e do escalonamento imediato por ação.
  v_key := v_case.source_type || ':' || v_case.source_id::text || ':ESCALATION:' || p_level || ':' || p_recipient_user_id::text;
  insert into public.risk_alert_outbox (
    project_id, case_id, sla_action_id, risk_level, notification_type, origin, escalation_level, recipient_user_id,
    scheduled_for, status, idempotency_key, payload_summary
  ) values (
    v_action.project_id, v_case.id, p_action_id, v_action.risk_level, 'ESCALATION', 'MANUAL', p_level, p_recipient_user_id,
    now(), 'PENDING', v_key, jsonb_build_object('title', left(v_action.title, 200), 'manual', true)
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  v_inserted := v_id is not null;
  if v_id is null then
    select id into v_id from public.risk_alert_outbox where idempotency_key = v_key;
  end if;
  return jsonb_build_object('outboxId', v_id, 'idempotencyKey', v_key, 'inserted', v_inserted);
end;
$$;

alter function public.enqueue_manual_escalation_email(uuid, text, uuid) owner to postgres;
revoke all on function public.enqueue_manual_escalation_email(uuid, text, uuid) from public, anon;
grant execute on function public.enqueue_manual_escalation_email(uuid, text, uuid) to authenticated, service_role;

-- ------------------------------------------------------------
-- 8. Auto-verificação (mesma disciplina de 20260920170000): a migration
--    falha — e é revertida — se algum privilégio indevido sobreviver.
--    Tabelas: anon/PUBLIC sem nada; authenticated só SELECT.
--    Funções: PUBLIC/anon nunca; internas sem nenhum papel.
-- ------------------------------------------------------------
do $$
declare
  v_tbl text;
  v_fn text;
begin
  foreach v_tbl in array array[
    'risk_alert_cases', 'risk_alert_outbox', 'alert_email_conversations', 'alert_email_messages',
    'risk_alert_action_events', 'risk_alert_forward_assignments', 'risk_alert_action_links'
  ] loop
    if has_table_privilege('anon', 'public.' || v_tbl, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') then
      raise exception 'Hardening falhou: anon ainda tem privilégio em %', v_tbl;
    end if;
    if has_table_privilege('authenticated', 'public.' || v_tbl, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') then
      raise exception 'Hardening falhou: authenticated ainda tem escrita em %', v_tbl;
    end if;
    if not has_table_privilege('authenticated', 'public.' || v_tbl, 'SELECT') then
      raise exception 'Hardening falhou: authenticated perdeu SELECT em %', v_tbl;
    end if;
    if exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      where n.nspname = 'public' and c.relname = v_tbl and a.grantee = 0
    ) then
      raise exception 'Hardening falhou: PUBLIC ainda tem privilégio em %', v_tbl;
    end if;
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = v_tbl and c.relrowsecurity) then
      raise exception 'Hardening falhou: RLS desligada em %', v_tbl;
    end if;
  end loop;

  foreach v_fn in array array[
    'apply_sla_action_escalation_internal(uuid, text, text, text, text)',
    'escalate_sla_action_system(uuid, text, text, text)',
    'record_risk_alert_action(uuid, text, jsonb)',
    'enqueue_manual_escalation_email(uuid, text, uuid)',
    'risk_alert_action_allowed(text, text)'
  ] loop
    if has_function_privilege('anon', ('public.' || v_fn)::regprocedure, 'EXECUTE') then
      raise exception 'Hardening falhou: anon executa %', v_fn;
    end if;
    if exists (
      select 1 from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = ('public.' || v_fn)::regprocedure and a.grantee = 0
    ) then
      raise exception 'Hardening falhou: PUBLIC executa %', v_fn;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.apply_sla_action_escalation_internal(uuid, text, text, text, text)'::regprocedure, 'EXECUTE')
     or has_function_privilege('service_role', 'public.apply_sla_action_escalation_internal(uuid, text, text, text, text)'::regprocedure, 'EXECUTE')
     or has_function_privilege('authenticated', 'public.escalate_sla_action_system(uuid, text, text, text)'::regprocedure, 'EXECUTE') then
    raise exception 'Hardening falhou: função interna/de sistema exposta';
  end if;
  -- Trigger function reutilizada: continua sem EXECUTE para os papéis (hardening anterior).
  if has_function_privilege('anon', 'public.set_weekly_schedule_row_updated_at()'::regprocedure, 'EXECUTE')
     or has_function_privilege('authenticated', 'public.set_weekly_schedule_row_updated_at()'::regprocedure, 'EXECUTE') then
    raise exception 'Hardening falhou: trigger function set_weekly_schedule_row_updated_at exposta';
  end if;
end;
$$;

notify pgrst, 'reload schema';
