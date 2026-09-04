-- ============================================================
-- 20260904120000_rejection_escalation_governance.sql
-- Governança de rejeição de recomendações/findings relevantes.
--
-- Princípio: a IA recomenda, o humano decide — mas rejeitar uma
-- recomendação de severidade ALTO/CRÍTICO nunca pode ser um
-- descarte silencioso. Reaproveita integralmente o que já existe:
-- ai_findings (achado/recomendação, já tem lifecycle_status REJECTED
-- e severity), sla_actions/sla_action_escalations/escalate_sla_action
-- (motor de escalonamento já existente, ver
-- 20260822054900_sla_escalation_foundation.sql) e o vínculo
-- sla_actions.related_ai_finding_id + origin = 'AI_FINDING' já criados
-- em 20260823090000_startup_historical_review.sql. Nenhuma tabela nova,
-- nenhum motor paralelo de escalonamento, nenhum novo enum de risco.
--
-- Mapeamento contra o schema existente ANTES de alterar qualquer coisa:
--   * ai_findings.severity e sla_actions.risk_level usam EXATAMENTE o
--     mesmo enum (LOW/MEDIUM/HIGH/CRITICAL) — reaproveitado sem
--     tradução.
--   * project_additional_proposals (Propostas de Adicionais) NÃO possui
--     nenhuma coluna de severidade/risco compatível com esse enum
--     (reservation_risk é texto livre, não um enum controlado) — a
--     política ALTO/CRÍTICO não pode ser objetivamente aplicada a ela
--     sem inventar uma classificação de risco inexistente. Nenhuma
--     mudança de comportamento é feita em
--     project_additional_proposals/AdditionalProposalApprovalsForm
--     nesta migration — ver relatório da implementação para o registro
--     explícito dessa lacuna.
--   * sla_actions.origin = 'EXPERT_RECOMMENDATION' não é uma entidade
--     rejeitável hoje — é só uma etiqueta manual escolhida ao criar uma
--     ação de SLA (apps/web/app/[projectId]/acoes/actions.ts), sem
--     lifecycle de aceite/rejeição próprio. A única entidade real com
--     "recomendação que pode ser rejeitada" + severidade é ai_findings.
--
-- Escalonamento imediato (nunca "esperar o SLA vencer depois"): a
-- própria rejeição ALTO/CRÍTICO cria a sla_action E a escala de
-- RESPONSAVEL -> ESCALAO_1 na mesma operação, via escalate_sla_action()
-- já existente (concorrência otimista, nunca duplica). Um motivo novo
-- ('RELEVANT_RECOMMENDATION_REJECTED') é adicionado ao enum fechado de
-- sla_action_escalations.reason — extensão aditiva do mesmo mecanismo,
-- nunca um segundo mecanismo.
--
-- Idempotência: nova UNIQUE index parcial em
-- sla_actions.related_ai_finding_id (a não-única já existente, criada
-- em 20260823090000, vira única) + a função reject_relevant_finding()
-- trava a linha do finding (SELECT ... FOR UPDATE) antes de decidir,
-- então uma segunda chamada concorrente/repetida sobre o MESMO finding
-- serializa atrás da primeira e, ao ver lifecycle_status já REJECTED,
-- retorna a sla_action já vinculada em vez de criar uma segunda.
--
-- Aditiva: nenhuma tabela/coluna existente é removida ou tem seu
-- comportamento anterior alterado para os casos já cobertos (severidade
-- LOW/MEDIUM, ACKNOWLEDGED/RESOLVED, dismissHistoricalFinding).
-- ============================================================

-- ============================================================
-- 1. ai_findings — justificativa obrigatória para REJECTED ALTO/CRÍTICO
-- ============================================================
-- Confirmado antes de criar a constraint: lifecycle_status, severity e
-- reviewer_note coexistem na MESMA tabela (public.ai_findings) — uma
-- CHECK simples de tabela é o mecanismo correto aqui, sem necessidade de
-- nenhum gatilho entre tabelas para esta parte.
--
-- Bloqueia NULL, string vazia e string só com espaços/tabs/quebras de
-- linha: reviewer_note precisa conter ao menos um caractere não-espaço
-- (~ '\S', regex POSIX suportada pelo Postgres) quando o achado está
-- sendo (ou já está) REJECTED com severity HIGH/CRITICAL. Severidades
-- LOW/MEDIUM e qualquer outro lifecycle_status continuam exatamente
-- como antes (reviewer_note continua opcional).

alter table public.ai_findings
  add constraint ai_findings_high_risk_rejection_requires_justification
  check (
    not (lifecycle_status = 'REJECTED' and severity in ('HIGH', 'CRITICAL'))
    or (reviewer_note is not null and reviewer_note ~ '\S')
  );

comment on constraint ai_findings_high_risk_rejection_requires_justification on public.ai_findings is
  'Rejeitar um finding ALTO/CRÍTICO exige reviewer_note com conteúdo real (nunca NULL, vazio ou só espaços) — governança de rejeição de recomendações relevantes.';

-- ============================================================
-- 2. sla_action_escalations — novo motivo aditivo de escalonamento
-- ============================================================
-- Nome autogerado confirmado (constraint de coluna, mesma técnica já
-- usada em 20260823090000 para ai_findings_lifecycle_status_check /
-- sla_actions_origin_check): sla_action_escalations_reason_check.

alter table public.sla_action_escalations drop constraint if exists sla_action_escalations_reason_check;
alter table public.sla_action_escalations
  add constraint sla_action_escalations_reason_check
  check (reason in (
    'NO_ACKNOWLEDGMENT', 'NOT_RESPONDED', 'NOT_COMPLETED',
    'CONTRACTUAL_DEADLINE_NEAR', 'CONTRACTUAL_DEADLINE_MISSED',
    'NEW_EVIDENCE_INCREASED_RISK', 'RELEVANT_RECOMMENDATION_REJECTED'
  ));

-- ============================================================
-- 3. escalate_sla_action — mesma função, motivo novo aceito
-- ============================================================
-- CREATE OR REPLACE idêntico ao original (20260822054900), só a lista
-- de motivos válidos foi estendida. Nenhuma outra linha desta função
-- foi alterada — a lógica de concorrência otimista, resolução de
-- notified_user_id e auditoria permanece exatamente a mesma.

create or replace function public.escalate_sla_action(
  p_action_id uuid,
  p_expected_current_level text,
  p_new_level text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action public.sla_actions%rowtype;
  v_notified_user_id uuid;
  v_escalation_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_action
  from public.sla_actions
  where id = p_action_id
  for update;

  if not found then
    raise exception 'SLA action not found';
  end if;

  if not public.is_project_member(v_action.project_id) then
    raise exception 'Not a project member';
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

  v_notified_user_id := case p_new_level
    when 'ESCALAO_1' then (
      select escalation_1_user_id from public.sla_area_responsibles
      where project_id = v_action.project_id and area = v_action.area
    )
    when 'ESCALAO_2' then (
      select escalation_2_user_id from public.sla_area_responsibles
      where project_id = v_action.project_id and area = v_action.area
    )
    when 'DIRETORIA' then (
      select board_user_id from public.sla_area_responsibles
      where project_id = v_action.project_id and area = v_action.area
    )
    else null
  end;

  perform set_config('acc.allow_escalation_update', 'true', true);

  update public.sla_actions
  set
    current_escalation_level = p_new_level,
    status = 'ESCALATED'
  where id = p_action_id;

  perform set_config('acc.allow_escalation_update', 'false', true);

  insert into public.sla_action_escalations (
    action_id, project_id, from_level, to_level, reason, notified_user_id
  )
  values (
    p_action_id, v_action.project_id, p_expected_current_level, p_new_level, p_reason, v_notified_user_id
  )
  returning id into v_escalation_id;

  insert into public.audit_log_entries (
    project_id, actor_type, actor_user_id, actor_label,
    action, entity_type, entity_id, detail
  )
  values (
    v_action.project_id, 'SYSTEM', null, 'sla-engine',
    'ACTION_ESCALATED', 'SLA_ACTION', p_action_id::text,
    format('Ação "%s" escalada de %s para %s (motivo: %s).', v_action.title, p_expected_current_level, p_new_level, p_reason)
  );

  return v_escalation_id;
end;
$$;

revoke all on function public.escalate_sla_action(uuid, text, text, text) from public;
revoke all on function public.escalate_sla_action(uuid, text, text, text) from anon;
grant execute on function public.escalate_sla_action(uuid, text, text, text) to authenticated;

-- ============================================================
-- 4. sla_actions.related_ai_finding_id — de índice a UNIQUE parcial
-- ============================================================
-- Idempotência objetiva (não só "SELECT antes de INSERT"): um finding
-- nunca pode ficar vinculado a duas sla_actions. O índice não-único
-- criado em 20260823090000 vira único — mesma coluna, mesmo predicado
-- (WHERE related_ai_finding_id IS NOT NULL), sem perda de dado (é
-- reindexação, não remoção de linha). Continua servindo ao mesmo
-- propósito de lookup já usado por create-action-for-historical-finding.

drop index if exists public.sla_actions_related_ai_finding_id_idx;
create unique index sla_actions_related_ai_finding_id_key
  on public.sla_actions (related_ai_finding_id)
  where related_ai_finding_id is not null;

-- ============================================================
-- 5. reject_relevant_finding — transição única e atômica
-- ============================================================
-- Único caminho de domínio para "rejeitar um finding". Reúne, numa só
-- transação de função (SECURITY DEFINER, portanto uma única transação
-- implícita no Postgres): validação de justificativa, UPDATE do
-- finding, criação da sla_action vinculada e escalonamento imediato
-- RESPONSAVEL -> ESCALAO_1 — nunca uma sequência frágil de chamadas
-- independentes client-side.
--
-- Cálculo dos prazos do Relógio B (assume/respond/complete_due_at) NÃO
-- é reimplementado aqui: a matriz de SLA (resolveMatrixRule) e o motor
-- de horário útil/timezone (compute-deadlines.ts/time-units.ts) só
-- existem em TypeScript hoje (apps/web/lib/sla/**) — duplicar essa
-- lógica de negócio em PL/pgSQL seria exatamente o tipo de "motor
-- paralelo" que este trabalho deve evitar. Por isso o caller (TS,
-- apps/web/lib/governance/reject-relevant-recommendation.ts) resolve a
-- matriz e computa os três prazos ANTES de chamar esta função, e os
-- passa já prontos — a função só persiste, atomicamente, o que o motor
-- de SLA já existente calculou. A ATOMICIDADE da escrita (o que
-- realmente importa para nunca deixar REJECTED sem escalonamento) fica
-- inteiramente garantida aqui, no banco.
--
-- p_area só é exigido quando o finding é HIGH/CRITICAL (é quando uma
-- sla_action precisa ser criada). Para LOW/MEDIUM, a função só atualiza
-- o finding — comportamento idêntico ao já existente em
-- updateFindingLifecycle antes desta migration.

create or replace function public.reject_relevant_finding(
  p_finding_id uuid,
  p_reviewer_note text,
  p_area text default null,
  p_assume_due_at timestamptz default null,
  p_respond_due_at timestamptz default null,
  p_complete_due_at timestamptz default null
)
returns table (sla_action_id uuid, escalation_id uuid, already_existed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_finding public.ai_findings%rowtype;
  v_reviewer uuid := auth.uid();
  v_needs_escalation boolean;
  v_existing_action_id uuid;
  v_action_id uuid;
  v_escalation_id uuid;
begin
  if v_reviewer is null then
    raise exception 'Authentication required';
  end if;

  select * into v_finding
  from public.ai_findings
  where id = p_finding_id
  for update;

  if not found then
    raise exception 'Finding not found';
  end if;

  if not public.has_project_permission(v_finding.project_id, 'EDITOR') then
    raise exception 'Insufficient permission';
  end if;

  -- Idempotência: já rejeitado (chamada repetida — double-click, retry,
  -- refresh, reenvio da Server Action) -> retorna o vínculo já existente,
  -- nunca cria uma segunda sla_action nem reprocessa a justificativa.
  if v_finding.lifecycle_status = 'REJECTED' then
    select id into v_existing_action_id
    from public.sla_actions
    where related_ai_finding_id = p_finding_id;

    return query select v_existing_action_id, null::uuid, true;
    return;
  end if;

  v_needs_escalation := v_finding.severity in ('HIGH', 'CRITICAL');

  -- coalesce ANTES do regex é essencial: "NULL !~ '\S'" avalia para NULL
  -- (não TRUE) em SQL, e "IF ... THEN" trata NULL como falso — sem o
  -- coalesce, uma justificativa NULL passaria pela checagem sem erro.
  -- Com coalesce(..., ''), NULL/''/'   ' avaliam todos para TRUE aqui.
  if v_needs_escalation and coalesce(p_reviewer_note, '') !~ '\S' then
    raise exception 'Justificativa obrigatória para rejeitar recomendação de severidade %.', v_finding.severity;
  end if;

  update public.ai_findings
  set
    lifecycle_status = 'REJECTED',
    reviewer_note = p_reviewer_note,
    reviewed_by_user_id = v_reviewer,
    reviewed_at = now(),
    updated_at = now()
  where id = p_finding_id;

  if not v_needs_escalation then
    return query select null::uuid, null::uuid, false;
    return;
  end if;

  if p_area is null or p_area not in (
    'DIRETORIA', 'ADMINISTRATIVO', 'COMERCIAL', 'FINANCEIRO',
    'ENGENHARIA', 'ORCAMENTO', 'JURIDICO', 'PLANEJAMENTO', 'ESG_SSMA'
  ) then
    raise exception 'Área válida é obrigatória para escalonar a rejeição de uma recomendação ALTO/CRÍTICO.';
  end if;

  if p_assume_due_at is null then
    raise exception 'assume_due_at é obrigatório para criar a ação de escalonamento.';
  end if;

  insert into public.sla_actions (
    project_id, origin, related_ai_finding_id, title, description,
    risk_level, area, status, assume_due_at, respond_due_at, complete_due_at,
    created_by_type, created_by_user_id
  )
  values (
    v_finding.project_id, 'AI_FINDING', p_finding_id,
    format('Recomendação rejeitada: %s', v_finding.finding_type),
    format('Finding %s rejeitado (severidade %s). Justificativa: %s', v_finding.id, v_finding.severity, p_reviewer_note),
    v_finding.severity, p_area, 'PENDING',
    p_assume_due_at, p_respond_due_at, p_complete_due_at,
    'USER', v_reviewer
  )
  returning id into v_action_id;

  -- Escalonamento imediato — a rejeição em si é o evento que exige
  -- escalonamento, nunca "esperar o SLA vencer depois" (reutiliza
  -- integralmente escalate_sla_action(), nenhuma lógica de nível/
  -- notificação duplicada aqui).
  v_escalation_id := public.escalate_sla_action(
    v_action_id, 'RESPONSAVEL', 'ESCALAO_1', 'RELEVANT_RECOMMENDATION_REJECTED'
  );

  return query select v_action_id, v_escalation_id, false;
end;
$$;

comment on function public.reject_relevant_finding(uuid, text, text, timestamptz, timestamptz, timestamptz) is
  'Único caminho de domínio para rejeitar um ai_finding. HIGH/CRITICAL exige justificativa não vazia, cria a sla_action vinculada (origin=AI_FINDING) e escalona imediatamente RESPONSAVEL->ESCALAO_1 via escalate_sla_action(). Idempotente: chamada repetida sobre finding já REJECTED retorna o vínculo existente, nunca duplica.';

revoke all on function public.reject_relevant_finding(uuid, text, text, timestamptz, timestamptz, timestamptz) from public;
revoke all on function public.reject_relevant_finding(uuid, text, text, timestamptz, timestamptz, timestamptz) from anon;
grant execute on function public.reject_relevant_finding(uuid, text, text, timestamptz, timestamptz, timestamptz) to authenticated;
