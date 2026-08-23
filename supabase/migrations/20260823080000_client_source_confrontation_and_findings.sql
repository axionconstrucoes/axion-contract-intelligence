-- ============================================================
-- 20260823080000_client_source_confrontation_and_findings.sql
-- Complemento do pacote de Adicionais: descoberta de subpastas do Drive
-- vinculado a uma proposta (nunca o Drive inteiro), classificação de
-- fontes, e fundação genérica de persistência de findings de curadoria
-- IA (ai_curation_runs/ai_findings) — reutilizável além de adicionais.
--
-- Governança: IA nunca escreve CONTRATADO/aprovação aqui — findings são
-- sempre sugestão (requires_human_review sempre true, travado por
-- CHECK). Sem policy de DELETE em nenhuma tabela nova — histórico nunca
-- é apagado (lifecycle_status = SUPERSEDED substitui, nunca remove).
-- ============================================================

-- ---------- additional_proposal_drive_sources ----------
-- Arquivo descoberto na pasta Drive de uma proposta (ou subpasta
-- reconhecida semanticamente) — nunca uma varredura do Drive inteiro
-- (sempre limitado à pasta vinculada + descendentes). Estágio "descoberto"
-- é distinto de "processado": ver processing_status.
create table public.additional_proposal_drive_sources (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.project_additional_proposals (id) on delete cascade,

  drive_file_id text not null,
  drive_folder_id text,
  drive_revision_id text,
  drive_modified_time timestamptz,

  file_name text not null,
  mime_type text not null,

  semantic_folder_category text
    check (semantic_folder_category in ('RECEBIDOS_CLIENTE', 'PLANILHA_AXION', 'PLANILHA_CLIENTE', 'PROPOSTA', 'CRONOGRAMA')),

  -- Seção 3 do requisito — nunca confundir documento do cliente com
  -- documento produzido pela AXION.
  source_classification text not null default 'OTHER_REFERENCE'
    check (source_classification in ('CLIENT_SOURCE', 'CLIENT_SPREADSHEET', 'AXION_ESTIMATE', 'AXION_PROPOSAL', 'SCHEDULE_SOURCE', 'OTHER_REFERENCE')),

  sha256_hash text,
  processing_status text not null default 'DISCOVERED'
    check (processing_status in ('DISCOVERED', 'SOURCE_REQUIRES_PROCESSING', 'PROCESSED', 'FAILED')),
  document_version_id uuid references public.document_versions (id) on delete set null,

  discovered_at timestamptz not null default now(),
  created_by_type text not null check (created_by_type in ('SYSTEM', 'USER', 'LEGACY')),
  created_by_user_id uuid references public.profiles (id) on delete restrict,
  created_by_label text,
  created_at timestamptz not null default now(),

  check (
    (created_by_type = 'SYSTEM' and created_by_user_id is null and created_by_label is null)
    or (created_by_type = 'USER' and created_by_user_id is not null and created_by_label is null)
    or (created_by_type = 'LEGACY' and created_by_user_id is null and created_by_label is not null)
  ),
  unique (proposal_id, drive_file_id)
);

comment on table public.additional_proposal_drive_sources is
  'Arquivos descobertos na(s) pasta(s) Drive de uma proposta de adicional — nunca uma varredura do Drive inteiro. sha256_hash/document_version_id só após processamento (ver ../email/attachments para o mesmo princípio de duas etapas).';

create index additional_proposal_drive_sources_proposal_id_idx
  on public.additional_proposal_drive_sources (proposal_id);
create index additional_proposal_drive_sources_classification_idx
  on public.additional_proposal_drive_sources (proposal_id, source_classification);

-- ---------- ai_curation_runs ----------
-- Uma execução de curadoria (manual ou automática) sobre uma fonte
-- específica. source_fingerprint permite dedup/incremental (seção 12):
-- mesmo fingerprint + mesma fonte ⇒ não reexecuta.
create table public.ai_curation_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,

  source_type text not null
    check (source_type in ('DOCUMENT_VERSION', 'EMAIL', 'EMAIL_ATTACHMENT', 'SCHEDULE', 'ADDITIONAL_PROPOSAL_DRIVE_SOURCE', 'EVIDENCE', 'MANUAL')),
  source_id text not null,
  source_fingerprint text not null,

  trigger_type text not null check (trigger_type in ('AUTOMATIC', 'MANUAL')),
  status text not null default 'RUNNING'
    check (status in ('RUNNING', 'COMPLETED', 'FAILED_PENDING_RETRY')),
  routed_expert_ids jsonb not null default '[]'::jsonb,
  error_message text,

  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by_type text not null check (created_by_type in ('SYSTEM', 'USER', 'LEGACY')),
  created_by_user_id uuid references public.profiles (id) on delete restrict,
  created_by_label text,
  created_at timestamptz not null default now(),

  check (
    (created_by_type = 'SYSTEM' and created_by_user_id is null and created_by_label is null)
    or (created_by_type = 'USER' and created_by_user_id is not null and created_by_label is null)
    or (created_by_type = 'LEGACY' and created_by_user_id is null and created_by_label is not null)
  ),
  check (status = 'RUNNING' or completed_at is not null),
  check (status <> 'FAILED_PENDING_RETRY' or error_message is not null)
);

comment on table public.ai_curation_runs is
  'Execução de curadoria IA (manual ou automática) sobre uma fonte específica. Falha de IA nunca desfaz a ingestão da fonte original — só marca esta linha FAILED_PENDING_RETRY (ver seção 11 do requisito).';

create index ai_curation_runs_project_id_idx on public.ai_curation_runs (project_id);
create index ai_curation_runs_source_idx on public.ai_curation_runs (source_type, source_id);
create index ai_curation_runs_fingerprint_idx on public.ai_curation_runs (source_type, source_id, source_fingerprint);

-- ---------- ai_findings ----------
-- Achado persistido de uma curadoria — nunca um fato do projeto por si
-- só (é sempre sugestão de IA, ver requires_human_review). fingerprint
-- evita duplicata do MESMO achado sobre a MESMA evidência (seção 12);
-- nova evidência material gera um novo finding, opcionalmente marcando o
-- anterior como SUPERSEDED (nunca apagado).
create table public.ai_findings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  curation_run_id uuid references public.ai_curation_runs (id) on delete set null,

  finding_type text not null,
  -- Preenchido só quando finding_type = 'CLIENT_SOURCE_CONFRONTATION' (seção 5).
  classification text
    check (classification in ('COMPATIBLE', 'ADDITIONAL_REQUIREMENT', 'CONTRACTUAL_CONFLICT', 'POSSIBLE_SCOPE_CHANGE', 'INCORPORATED_CONTRACT_DOCUMENT', 'INDETERMINATE')),

  expert_ids jsonb not null default '[]'::jsonb,
  severity text not null check (severity in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  confidence numeric(3, 2) not null check (confidence >= 0 and confidence <= 1),

  facts jsonb not null default '[]'::jsonb,
  interpretation text not null,
  recommendation text not null,
  grounding jsonb,

  source_refs jsonb not null default '[]'::jsonb,
  conflicting_source_refs jsonb not null default '[]'::jsonb,

  requires_human_review boolean not null default true check (requires_human_review = true),
  lifecycle_status text not null default 'NEW'
    check (lifecycle_status in ('NEW', 'PENDING_HUMAN_REVIEW', 'ACKNOWLEDGED', 'REJECTED', 'RESOLVED', 'SUPERSEDED')),
  superseded_by_finding_id uuid references public.ai_findings (id) on delete set null,

  fingerprint text not null,

  reviewer_note text,
  reviewed_by_user_id uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (lifecycle_status <> 'SUPERSEDED' or superseded_by_finding_id is not null),
  check (
    lifecycle_status not in ('ACKNOWLEDGED', 'REJECTED', 'RESOLVED')
    or (reviewed_by_user_id is not null and reviewed_at is not null)
  )
);

comment on table public.ai_findings is
  'Achado persistido de curadoria IA — sempre sugestão (requires_human_review trava true), nunca apagado (SUPERSEDED substitui). fingerprint evita duplicata do mesmo achado sobre a mesma evidência.';

create index ai_findings_project_id_idx on public.ai_findings (project_id);
create index ai_findings_project_id_status_idx on public.ai_findings (project_id, lifecycle_status);
create index ai_findings_fingerprint_idx on public.ai_findings (project_id, finding_type, fingerprint);
create index ai_findings_curation_run_id_idx on public.ai_findings (curation_run_id);

-- ---------- RLS ----------

alter table public.additional_proposal_drive_sources enable row level security;
alter table public.ai_curation_runs enable row level security;
alter table public.ai_findings enable row level security;

create policy "additional_proposal_drive_sources_select_project_members_only"
  on public.additional_proposal_drive_sources
  for select
  using (
    exists (
      select 1 from public.project_additional_proposals p
      where p.id = additional_proposal_drive_sources.proposal_id
        and public.is_project_member(p.project_id)
    )
  );

-- Descoberta/ingestão de fontes Drive é sempre server-side (script ou
-- Server Action) — mesmo padrão de email_attachments (INSERT
-- authenticated EDITOR para o fluxo interativo; service-role bypassa
-- para scripts de descoberta em lote).
create policy "additional_proposal_drive_sources_insert_editor"
  on public.additional_proposal_drive_sources
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.project_additional_proposals p
      where p.id = additional_proposal_drive_sources.proposal_id
        and public.has_project_permission(p.project_id, 'EDITOR')
    )
  );

create policy "ai_curation_runs_select_project_members_only"
  on public.ai_curation_runs
  for select
  using (public.is_project_member(project_id));

create policy "ai_curation_runs_insert_editor"
  on public.ai_curation_runs
  for insert
  to authenticated
  with check (public.has_project_permission(project_id, 'EDITOR'));

create policy "ai_curation_runs_update_editor"
  on public.ai_curation_runs
  for update
  to authenticated
  using (public.has_project_permission(project_id, 'EDITOR'))
  with check (public.has_project_permission(project_id, 'EDITOR'));

create policy "ai_findings_select_project_members_only"
  on public.ai_findings
  for select
  using (public.is_project_member(project_id));

create policy "ai_findings_insert_editor"
  on public.ai_findings
  for insert
  to authenticated
  with check (public.has_project_permission(project_id, 'EDITOR'));

-- UPDATE cobre só a transição de lifecycle (ACKNOWLEDGED/REJECTED/
-- RESOLVED/SUPERSEDED) — sempre humano, IA nunca chama update aqui (só
-- INSERT, ao persistir um novo finding).
create policy "ai_findings_update_editor"
  on public.ai_findings
  for update
  to authenticated
  using (public.has_project_permission(project_id, 'EDITOR'))
  with check (public.has_project_permission(project_id, 'EDITOR'));

-- ---------- Auditoria ----------

create or replace function public.audit_ai_finding_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, actor_label,
    action, entity_type, entity_id, detail, occurred_at
  )
  values (
    new.project_id,
    'SYSTEM',
    null,
    null,
    'AI_FINDING_CREATED',
    'AI_FINDING',
    new.id::text,
    format('Finding %s criado (severidade %s, classificação %s).', new.finding_type, new.severity, coalesce(new.classification, 'n/a')),
    new.created_at
  );
  return new;
end;
$$;

create trigger ai_findings_audit_created
  after insert on public.ai_findings
  for each row execute function public.audit_ai_finding_created();

create or replace function public.audit_ai_finding_status_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
begin
  if new.lifecycle_status is distinct from old.lifecycle_status then
    insert into public.audit_log_entries (
      project_id, actor_type, actor_user_id, actor_label,
      action, entity_type, entity_id, detail, occurred_at
    )
    values (
      new.project_id,
      case when v_actor_user_id is null then 'SYSTEM' else 'USER' end,
      v_actor_user_id,
      null,
      'AI_FINDING_STATUS_CHANGED',
      'AI_FINDING',
      new.id::text,
      format('Finding %s: status %s -> %s.', new.id, old.lifecycle_status, new.lifecycle_status),
      now()
    );
  end if;
  return new;
end;
$$;

create trigger ai_findings_audit_status_changed
  after update on public.ai_findings
  for each row execute function public.audit_ai_finding_status_changed();
