-- ============================================================
-- 20260818224157_event_ledger_foundation.sql
-- Fundacao forense do Event Ledger: contract_events, event_categories,
-- event_evidence (1:N), event_ai_assessments (1:1), event_cross_references
-- (FKs tipadas, nunca ref_type/ref_id generico). ON DELETE RESTRICT nas
-- FKs para entidades de negocio (evidencia/cross-reference nao pode
-- desaparecer silenciosamente); ON DELETE CASCADE apenas de
-- contract_events para suas tabelas filhas. Sem project_id redundante
-- nas filhas — derivado via contract_events. Sem ContractChange,
-- Claims/Dossie, Alerts, notificationSeverity, Gmail, INMET,
-- weather_observations, ingestao, cadeia de custodia, DecisionItems,
-- ActionRequests (tudo isso fica para lotes futuros — ver diagnostico
-- 2.5G4A/2.5G4D).
-- ============================================================

create table public.contract_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null
    references public.projects (id) on delete cascade,
  occurred_at timestamptz not null,
  title text not null,
  description text not null,
  source_type text not null
    check (source_type in (
      'EMAIL', 'DIARIO_OBRA', 'CONSTRUMANAGER', 'CONTRATO', 'GOOGLE_DRIVE',
      'RECEBIDOS_CLIENTE', 'EDITAL_RFI_RFP', 'CRONOGRAMA',
      'RELATORIO_SEMANAL', 'ERP', 'ORCAMENTO'
    )),
  status text not null
    check (status in ('NOVO', 'EM_ANALISE', 'CONFRONTADO', 'RESOLVIDO')),
  created_by_type text not null
    check (created_by_type in ('SYSTEM', 'USER', 'LEGACY')),
  created_by_user_id uuid
    references public.profiles (id) on delete restrict,
  created_by_label text,
  created_at timestamptz not null default now(),
  check (
    (created_by_type = 'SYSTEM' and created_by_user_id is null and created_by_label is null)
    or (created_by_type = 'USER' and created_by_user_id is not null and created_by_label is null)
    or (created_by_type = 'LEGACY' and created_by_user_id is null and created_by_label is not null)
  )
);

create index contract_events_project_id_idx
  on public.contract_events (project_id);

create index contract_events_project_id_occurred_at_idx
  on public.contract_events (project_id, occurred_at desc);

create table public.event_categories (
  event_id uuid not null
    references public.contract_events (id) on delete cascade,
  category text not null
    check (category in (
      'PRAZO', 'CUSTO', 'ESCOPO', 'MULTAS', 'PENALIDADES', 'MEDICOES',
      'PAGAMENTOS', 'RESPONSABILIDADES', 'ALTERACOES_PROJETO',
      'NOTIFICACOES', 'CLAIMS_CHANGE_ORDERS'
    )),
  primary key (event_id, category)
);

create table public.event_evidence (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null
    references public.contract_events (id) on delete cascade,
  source_type text not null
    check (source_type in (
      'EMAIL', 'DIARIO_OBRA', 'CONSTRUMANAGER', 'CONTRATO', 'GOOGLE_DRIVE',
      'RECEBIDOS_CLIENTE', 'EDITAL_RFI_RFP', 'CRONOGRAMA',
      'RELATORIO_SEMANAL', 'ERP', 'ORCAMENTO'
    )),
  label text not null,
  locator text not null,
  document_version_id uuid
    references public.document_versions (id) on delete restrict,
  email_id uuid
    references public.emails (id) on delete restrict,
  created_at timestamptz not null default now(),
  check (num_nonnulls(document_version_id, email_id) <= 1),
  check (email_id is null or source_type = 'EMAIL')
);

create index event_evidence_event_id_idx
  on public.event_evidence (event_id);

create index event_evidence_document_version_id_idx
  on public.event_evidence (document_version_id);

create index event_evidence_email_id_idx
  on public.event_evidence (email_id);

create table public.event_ai_assessments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique
    references public.contract_events (id) on delete cascade,
  finding_type text not null
    check (finding_type in ('DESVIO', 'CONFLITO', 'INFORMACAO_NOVA', 'IMPACTO_POTENCIAL')),
  severity text not null
    check (severity in ('BAIXA', 'MEDIA', 'ALTA', 'CRITICA')),
  summary text not null,
  confidence numeric not null
    check (confidence >= 0 and confidence <= 1),
  requires_human_review boolean not null default true
    check (requires_human_review = true),
  created_at timestamptz not null default now()
);

create table public.event_cross_references (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null
    references public.contract_events (id) on delete cascade,
  kind text not null
    check (kind in (
      'CONTRATO_ADITIVO', 'EDITAL_RFI_RFP', 'PROPOSTA_AXION', 'CRONOGRAMA',
      'PROJETO_TECNICO', 'COMUNICACAO'
    )),
  document_id uuid
    references public.documents (id) on delete restrict,
  clause_id uuid
    references public.clauses (id) on delete restrict,
  schedule_activity_id uuid
    references public.schedule_activities (id) on delete restrict,
  email_id uuid
    references public.emails (id) on delete restrict,
  note text not null,
  created_at timestamptz not null default now(),
  check (
    num_nonnulls(document_id, clause_id, schedule_activity_id, email_id) = 1
  )
);

create index event_cross_references_event_id_idx
  on public.event_cross_references (event_id);

create index event_cross_references_document_id_idx
  on public.event_cross_references (document_id);

create index event_cross_references_clause_id_idx
  on public.event_cross_references (clause_id);

create index event_cross_references_schedule_activity_id_idx
  on public.event_cross_references (schedule_activity_id);

create index event_cross_references_email_id_idx
  on public.event_cross_references (email_id);

-- ---------- RLS ----------

alter table public.contract_events enable row level security;
alter table public.event_categories enable row level security;
alter table public.event_evidence enable row level security;
alter table public.event_ai_assessments enable row level security;
alter table public.event_cross_references enable row level security;

create policy "contract_events_select_project_members_only"
  on public.contract_events
  for select
  using (public.is_project_member(project_id));

create policy "event_categories_select_project_members_only"
  on public.event_categories
  for select
  using (
    exists (
      select 1
      from public.contract_events ce
      where ce.id = event_categories.event_id
        and public.is_project_member(ce.project_id)
    )
  );

create policy "event_evidence_select_project_members_only"
  on public.event_evidence
  for select
  using (
    exists (
      select 1
      from public.contract_events ce
      where ce.id = event_evidence.event_id
        and public.is_project_member(ce.project_id)
    )
  );

create policy "event_ai_assessments_select_project_members_only"
  on public.event_ai_assessments
  for select
  using (
    exists (
      select 1
      from public.contract_events ce
      where ce.id = event_ai_assessments.event_id
        and public.is_project_member(ce.project_id)
    )
  );

create policy "event_cross_references_select_project_members_only"
  on public.event_cross_references
  for select
  using (
    exists (
      select 1
      from public.contract_events ce
      where ce.id = event_cross_references.event_id
        and public.is_project_member(ce.project_id)
    )
  );
