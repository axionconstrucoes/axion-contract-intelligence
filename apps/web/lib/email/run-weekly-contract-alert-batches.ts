import "server-only";

import { createSupabaseAdminClient } from "@axion/db/admin";
import type { AlertSeverity } from "@axion/types";

import { resolveContractAlertBatchWeeklyWindow, DEFAULT_PROJECT_TIMEZONE } from "./contract-alert-batch-weekly-window";
import {
  planWeeklyContractAlertBatches,
  type WeeklyAutoBatchRecipient,
  type WeeklyAutoEligibleEventInput,
} from "./contract-alert-batch-weekly-eligibility";
import { sendContractAlertBatchEmail } from "./send-contract-alert-batch-email";
import { getAppBaseUrl } from "../app-base-url";

// Job semanal automático — MÉDIO/BAIXO, sem seleção manual (requisito
// principal desta rodada). CRÍTICO/ALTO nunca passam por aqui: o fluxo
// imediato existente (SendContractAlertForm) continua sendo o único
// caminho para eles, intocado por esta feature.
//
// Fechamento: toda quarta-feira às 08:00 no timezone do projeto (regra
// definitiva aprovada). resolveContractAlertBatchWeeklyWindow
// reaproveita o mesmo mecanismo ICU (Intl) já usado pelo resumo semanal
// existente (risk-alerts/digest-window.ts) — nunca offset fixo, nunca um
// scheduler paralelo.
//
// Idempotência real: a unicidade (project_id, recipient_user_id,
// cutoff_date) é uma CONSTRAINT DE BANCO (contract_alert_batches_
// weekly_auto_idempotency_idx, migration 20260922090000) — o job tenta
// inserir e trata violação de unicidade (23505) como "já existe,
// ignorar", nunca "verifica-depois-insere" (que teria uma janela de
// corrida entre duas execuções concorrentes). Mesmo padrão de defesa em
// profundidade já usado pela RPC submit_contract_alert_batch_response.
export interface WeeklyContractAlertBatchRunResult {
  cutoffDate: string;
  eligibleEvents: number;
  plansConsidered: number;
  created: number;
  skippedAlreadyExists: number;
  sent: number;
  failed: number;
}

interface ContractEventRow {
  id: string;
  project_id: string;
  occurred_at: string;
  title: string;
  status: "NOVO" | "EM_ANALISE" | "CONFRONTADO" | "RESOLVIDO";
}

interface AiAssessmentRow {
  event_id: string;
  severity: AlertSeverity;
  summary: string;
}

// ============================================================
// GAP CONHECIDO — NÃO PREENCHIDO DE PROPÓSITO (ver relatório enviado ao
// usuário). Investigação exaustiva na arquitetura atual do ACC não
// encontrou uma fonte inequívoca de "responsável do alerta/projeto"
// para contract_events:
//
//   1. send-alert-actions.ts (fluxo imediato CRÍTICO/ALTO, já existente
//      e inalterado por esta feature) usa `responsibleName: null` — o
//      destinatário é escolhido livremente por um humano entre TODOS os
//      membros ACTIVE do projeto (qualquer permissão), sem nenhuma
//      pré-seleção ou default. Nunca ADMINISTRADOR-only — essa foi uma
//      suposição da rodada anterior, não aprovada e removida aqui.
//   2. contract_alert_batches.recipient_user_id é a COLUNA DE DESTINO
//      (preenchida quando um lote é criado), nunca uma fonte de
//      configuração de destinatário — não existe hoje um "destinatário
//      padrão do projeto" configurado em nenhuma tabela.
//   3. sla_actions.responsible_user_id + related_event_id existem no
//      schema (origin = 'EVENT' é um valor aceito) e SERIAM a ponte
//      natural — mas nenhum caminho de código atual (AssessScheduleDelay
//      Button, curadoria multiagente, ou qualquer outro) cria de fato um
//      sla_action a partir de um contract_event: related_event_id nunca
//      é escrito. A coluna existe, mas está desconectada deste domínio.
//   4. O mecanismo institucional/pilot delivery (ACC_PILOT_INSTITUTIONAL_
//      MAILBOXES / pilot-delivery-override.ts) decide APENAS para ONDE o
//      e-mail efetivamente é entregue durante o piloto (effective_
//      recipient_email) — nunca QUEM é o destinatário lógico
//      (recipient_user_id precisa ser um membro real do projeto, pela FK
//      composta para project_memberships).
//
// Por isso esta função NUNCA inventa uma regra (nem ADMINISTRADOR, nem
// "todos os ativos", nem qualquer outra) — devolve um Map vazio para
// todo projeto até que o usuário aprove explicitamente uma fonte real.
// Efeito prático: o job continua seguro de rodar (calcula elegibilidade,
// nunca envia nada, nunca inventa destinatário) — só não compõe nenhum
// lote de fato até esta função ser preenchida com a regra aprovada.
// ============================================================
async function resolveWeeklyContractAlertBatchRecipients(
  _admin: ReturnType<typeof createSupabaseAdminClient>,
  _projectIds: readonly string[]
): Promise<Map<string, WeeklyAutoBatchRecipient[]>> {
  return new Map();
}

export async function runWeeklyContractAlertBatches(
  now: Date = new Date()
): Promise<WeeklyContractAlertBatchRunResult> {
  const admin = createSupabaseAdminClient();
  const { cutoffDate } = resolveContractAlertBatchWeeklyWindow(now.toISOString(), DEFAULT_PROJECT_TIMEZONE);
  const baseUrl = getAppBaseUrl();

  const result: WeeklyContractAlertBatchRunResult = {
    cutoffDate,
    eligibleEvents: 0,
    plansConsidered: 0,
    created: 0,
    skippedAlreadyExists: 0,
    sent: 0,
    failed: 0,
  };

  // 1. Eventos candidatos: ATIVOS (status != RESOLVIDO) com achado de IA
  // BAIXA/MEDIA. A junção é feita em duas consultas (nunca um `!inner`
  // implícito que esconderia eventos sem achado — esses simplesmente não
  // aparecem no segundo mapa e ficam de fora, corretamente).
  const { data: eventRows, error: eventsError } = await admin
    .from("contract_events")
    .select("id,project_id,occurred_at,title,status")
    .neq("status", "RESOLVIDO");
  if (eventsError) throw new Error(`Falha ao carregar eventos elegíveis: ${eventsError.message}`);
  const events = (eventRows ?? []) as ContractEventRow[];
  if (events.length === 0) return result;

  const eventIds = events.map((e) => e.id);
  const { data: assessmentRows, error: assessmentsError } = await admin
    .from("event_ai_assessments")
    .select("event_id,severity,summary")
    .in("event_id", eventIds)
    .in("severity", ["BAIXA", "MEDIA"]);
  if (assessmentsError) throw new Error(`Falha ao carregar achados de IA: ${assessmentsError.message}`);
  const assessmentByEventId = new Map<string, AiAssessmentRow>(
    ((assessmentRows ?? []) as AiAssessmentRow[]).map((row) => [row.event_id, row])
  );

  const eligibleEventInputs: WeeklyAutoEligibleEventInput[] = events.map((event) => ({
    eventId: event.id,
    projectId: event.project_id,
    occurredAt: event.occurred_at,
    title: event.title,
    status: event.status,
    severity: assessmentByEventId.get(event.id)?.severity ?? null,
  }));
  result.eligibleEvents = eligibleEventInputs.filter((e) => e.severity !== null).length;

  // 2. Eventos já tratados em QUALQUER lote (qualquer fechamento,
  // qualquer status) nunca reentram — requisito 4 (deduplicação/nunca
  // reenviar).
  const { data: alreadyBatchedRows, error: alreadyBatchedError } = await admin
    .from("contract_alert_batch_items")
    .select("event_id");
  if (alreadyBatchedError) throw new Error(`Falha ao carregar itens de lote existentes: ${alreadyBatchedError.message}`);
  const alreadyBatchedEventIds = new Set<string>(((alreadyBatchedRows ?? []) as Array<{ event_id: string }>).map((r) => r.event_id));

  // 3. Destinatário automático — ver GAP CONHECIDO acima. Sem fonte
  // aprovada, devolve vazio para todo projeto (nenhum lote inventado).
  const candidateProjectIds = Array.from(new Set(eligibleEventInputs.filter((e) => e.severity !== null).map((e) => e.projectId)));
  const recipientsByProject = await resolveWeeklyContractAlertBatchRecipients(admin, candidateProjectIds);

  const plans = planWeeklyContractAlertBatches({
    events: eligibleEventInputs,
    alreadyBatchedEventIds,
    recipientsByProject,
    cutoffDate,
  });
  result.plansConsidered = plans.length;

  const planProjectIds = Array.from(new Set(plans.map((p) => p.projectId)));
  const projectNameById = new Map<string, string>();
  if (planProjectIds.length > 0) {
    const { data: projectRows } = await admin.from("projects").select("id,name").in("id", planProjectIds);
    for (const row of (projectRows ?? []) as Array<{ id: string; name: string }>) {
      projectNameById.set(row.id, row.name);
    }
  }

  for (const plan of plans) {
    const { data: createdBatch, error: createError } = await admin
      .from("contract_alert_batches")
      .insert({
        project_id: plan.projectId,
        recipient_user_id: plan.recipientUserId,
        intended_recipient_email: plan.recipientEmail,
        batch_kind: "WEEKLY_AUTO",
        cutoff_date: plan.cutoffDate,
      })
      .select("id")
      .single();

    if (createError) {
      // 23505 = violação de unicidade (project_id, recipient_user_id,
      // cutoff_date) — já existe um lote automático deste fechamento
      // para este destinatário: idempotente, nunca duplica, nunca é uma
      // falha real (requisito 4/10-C).
      if (createError.code === "23505") {
        result.skippedAlreadyExists += 1;
        continue;
      }
      result.failed += 1;
      continue;
    }

    result.created += 1;
    const batchId = createdBatch.id as string;

    const { error: itemsError } = await admin.from("contract_alert_batch_items").insert(
      plan.items.map((item) => ({
        batch_id: batchId,
        event_id: item.eventId,
        position: item.position,
        severity: item.severity,
        title_snapshot: item.title,
      }))
    );
    if (itemsError) {
      await admin
        .from("contract_alert_batches")
        .update({ status: "FAILED", failure_reason: "Falha ao gravar os itens do lote semanal." })
        .eq("id", batchId);
      result.failed += 1;
      continue;
    }

    try {
      await sendContractAlertBatchEmail({
        batchId,
        projectId: plan.projectId,
        intendedRecipientEmail: plan.recipientEmail,
        email: {
          recipientName: plan.recipientName,
          projectName: projectNameById.get(plan.projectId) ?? "Projeto",
          batchUrl: `${baseUrl}/${plan.projectId}/ledger/lote-alertas/${batchId}`,
          hasInlineLogo: false,
          items: plan.items.map((item) => ({
            eventId: item.eventId,
            title: item.title,
            severity: item.severity,
            riskDescription: assessmentByEventId.get(item.eventId)?.summary ?? item.title,
            clauseLabel: null,
            clauseText: null,
            // Evidências/origens continuam acessíveis pela tela real do
            // evento via "VER EVENTO" — nunca duplicadas no e-mail do
            // lote automático (requisito explícito desta rodada).
            evidence: [],
            eventUrl: `${baseUrl}/${plan.projectId}/ledger/${item.eventId}`,
            respondItemUrl: `${baseUrl}/${plan.projectId}/ledger/lote-alertas/${batchId}#evento-${item.eventId}`,
          })),
        },
      });
      result.sent += 1;
    } catch {
      result.failed += 1;
    }
  }

  return result;
}
