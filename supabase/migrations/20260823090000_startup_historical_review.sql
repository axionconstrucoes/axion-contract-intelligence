-- ============================================================
-- 20260823090000_startup_historical_review.sql
-- Start-up ACC: permite implantar o ACC em obra já em andamento sem
-- tratar o passado pacificado como alerta novo. REUTILIZA
-- ai_curation_runs/ai_findings (pacote anterior) e sla_actions
-- (pacote de SLA) — nunca um segundo sistema de findings/tarefas.
--
-- project_start_date / acc_operational_start_date NUNCA cortam
-- Timeline, e-mails, documentos ou contexto de IA — servem só para
-- classificar um finding como histórico (seção 2/19 do requisito).
-- acc_operational_start_date é configurável por projeto — 2026-08-24 é
-- só o default atual, nunca uma regra eterna hardcoded.
-- ============================================================

alter table public.projects
  add column project_start_date date,
  add column acc_operational_start_date date not null default '2026-08-24',
  add column startup_completed_at timestamptz,
  add column startup_completed_by_user_id uuid references public.profiles (id) on delete set null,
  add column historical_review_through date;

comment on column public.projects.project_start_date is
  'Data real de início da obra/projeto — nunca usada para cortar Timeline/e-mails/documentos/contexto de IA.';
comment on column public.projects.acc_operational_start_date is
  'Data a partir da qual o ACC opera prospectivamente (alertas normais, escalonamento). Configurável por projeto na aba Start-up — 2026-08-24 é só o default.';
comment on column public.projects.historical_review_through is
  'Gravado ao concluir o Start-up: até que data o histórico foi revisado (dia anterior a acc_operational_start_date no momento da conclusão).';

alter table public.projects
  add constraint projects_startup_completed_consistency_check
  check (
    (startup_completed_at is null and startup_completed_by_user_id is null and historical_review_through is null)
    or (startup_completed_at is not null and startup_completed_by_user_id is not null and historical_review_through is not null)
  );

-- Nenhuma policy de UPDATE existia para public.projects — necessária
-- para a aba Start-up (configurar datas, concluir revisão). Mesmo nível
-- de EDITOR já usado para decidir finding/criar ação (seção 21).
create policy "projects_update_editor"
  on public.projects
  for update
  to authenticated
  using (public.has_project_permission(id, 'EDITOR'))
  with check (public.has_project_permission(id, 'EDITOR'));

-- ---------- ai_findings: campos e estados do Start-up ----------

alter table public.ai_findings
  add column effective_date date,
  add column resolution_description text,
  add column resolution_approximate_date date,
  add column resolution_evidence_note text;

comment on column public.ai_findings.effective_date is
  'Data documental/de evento da fonte (quando disponível) — nunca created_at como única referência para decidir se um finding é histórico.';

-- Nome autogerado confirmado (constraint de coluna): ai_findings_lifecycle_status_check.
alter table public.ai_findings drop constraint if exists ai_findings_lifecycle_status_check;
alter table public.ai_findings
  add constraint ai_findings_lifecycle_status_check
  check (lifecycle_status in (
    'NEW', 'PENDING_HUMAN_REVIEW', 'ACKNOWLEDGED', 'REJECTED', 'RESOLVED', 'SUPERSEDED',
    'HISTORICAL_PENDING_STARTUP_REVIEW', 'DISMISSED_AT_STARTUP', 'RESOLVED_BEFORE_GO_LIVE', 'ACTION_CREATED'
  ));

alter table public.ai_findings
  add constraint ai_findings_resolution_fields_check
  check (
    lifecycle_status = 'RESOLVED_BEFORE_GO_LIVE'
    or (resolution_description is null and resolution_approximate_date is null and resolution_evidence_note is null)
  );

-- Seção 9/10: DESCONSIDERAR e JÁ TRATADO/PACIFICADO reaproveitam
-- reviewer_note/reviewed_by_user_id/reviewed_at já existentes — a
-- checagem de "lifecycle_status not in (ACKNOWLEDGED/REJECTED/RESOLVED)
-- exige reviewed_by_user_id/reviewed_at" já criada na migration anterior
-- só cobre esses três valores; estende-se aqui para os três novos. É um
-- constraint de TABELA (não de coluna) sem nome explícito na migration
-- original — localiza pelo conteúdo em vez de adivinhar o nome
-- autogerado (ai_findings_check/_check1/...), nunca lança se não achar.
do $$
declare
  v_conname text;
begin
  select conname into v_conname
  from pg_constraint
  where conrelid = 'public.ai_findings'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%reviewed_by_user_id%';

  if v_conname is not null then
    execute format('alter table public.ai_findings drop constraint %I', v_conname);
  end if;
end
$$;

alter table public.ai_findings
  add constraint ai_findings_reviewed_fields_check
  check (
    lifecycle_status not in ('ACKNOWLEDGED', 'REJECTED', 'RESOLVED', 'DISMISSED_AT_STARTUP', 'RESOLVED_BEFORE_GO_LIVE', 'ACTION_CREATED')
    or (reviewed_by_user_id is not null and reviewed_at is not null)
  );

-- ---------- sla_actions: origem AI_FINDING (seção 11) ----------
-- "Cuidar deste assunto" reaproveita sla_actions — nunca uma tabela
-- paralela de tarefas. Nome autogerado confirmado (constraint de
-- coluna): sla_actions_origin_check.

alter table public.sla_actions drop constraint if exists sla_actions_origin_check;
alter table public.sla_actions
  add constraint sla_actions_origin_check
  check (origin in ('MANUAL', 'EXPERT_RECOMMENDATION', 'ESG_OBLIGATION', 'EVENT', 'ACTION_REQUEST', 'AI_FINDING', 'OTHER'));

alter table public.sla_actions
  add column related_ai_finding_id uuid references public.ai_findings (id) on delete set null;

create index sla_actions_related_ai_finding_id_idx
  on public.sla_actions (related_ai_finding_id) where related_ai_finding_id is not null;

-- ---------- Auditoria (seção 20) ----------
-- Sem trigger automático aqui: as ações de Start-up (dismiss/resolve/
-- action/complete) são sempre decisões humanas explícitas via Server
-- Action, que grava audit_log_entries diretamente (mesmo padrão de
-- apps/web/app/[projectId]/adicionais/actions.ts) — nunca um segundo
-- mecanismo de auditoria paralelo ao trigger já existente de
-- AI_FINDING_STATUS_CHANGED (que já cobre a transição de status em si).
