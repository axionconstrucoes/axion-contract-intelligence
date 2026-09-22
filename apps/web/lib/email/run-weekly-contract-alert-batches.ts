import "server-only";

import { createSupabaseAdminClient } from "@axion/db/admin";
import type { AlertSeverity } from "@axion/types";

import { resolveContractAlertBatchWeeklyWindow, DEFAULT_PROJECT_TIMEZONE } from "./contract-alert-batch-weekly-window";
import {
  planWeeklyContractAlertBatches,
  resolveWeeklyAutoBatchRecipientsFromConfig,
  type ActiveProjectMemberForResponsible,
  type ConfiguredContractAlertResponsible,
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
  /** Projetos com evento(s) elegível(is) mas SEM responsável configurado (ou configurado porém não mais ACTIVE) — pendência visível também na página /lote-alertas, nunca um destinatário escolhido silenciosamente. */
  skippedNoResponsible: number;
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
// "Responsável pelos alertas contratuais" — decisão aprovada, destrava
// o gap documentado na rodada anterior (investigação exaustiva não
// encontrou nenhuma fonte inequívoca de responsável para
// contract_events: nem ADMINISTRADOR, nem criador do evento, nem último
// responsável, nem o mecanismo institucional do piloto — esse último
// decide só ONDE o e-mail é entregue, nunca QUEM é o destinatário
// lógico). A fonte agora é EXPLÍCITA e configurada pelo usuário:
// contract_alert_responsibles (1 linha por projeto, ver migration
// 20260922100000 e a página /lote-alertas, que também mostra a mesma
// pendência descrita abaixo).
//
// Sem responsável configurado para um projeto — ou configurado mas o
// membership não é mais ACTIVE (removido/suspenso depois do cadastro,
// nunca confiar apenas no que era válido na hora de configurar) — esse
// projeto simplesmente não entra no Map: nenhum lote é criado/enviado,
// nunca um destinatário escolhido silenciosamente. `skippedNoResponsible`
// no resultado do job é o sinal operacional dessa pendência.
async function resolveWeeklyContractAlertBatchRecipients(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  projectIds: readonly string[]
): Promise<Map<string, WeeklyAutoBatchRecipient[]>> {
  if (projectIds.length === 0) return new Map();

  const { data: configuredRows, error: configuredError } = await admin
    .from("contract_alert_responsibles")
    .select("project_id,responsible_user_id")
    .in("project_id", projectIds);
  if (configuredError) throw new Error(`Falha ao carregar responsáveis pelos alertas contratuais: ${configuredError.message}`);
  const configured: ConfiguredContractAlertResponsible[] = ((configuredRows ?? []) as Array<{
    project_id: string;
    responsible_user_id: string;
  }>).map((row) => ({ projectId: row.project_id, responsibleUserId: row.responsible_user_id }));
  if (configured.length === 0) return new Map();

  // Revalida ACTIVE agora — nunca confia em que era válido quando o
  // responsável foi configurado (o membro pode ter sido suspenso ou
  // removido do projeto depois). A decisão em si (configurado × ativo →
  // destinatário real, ou rejeitado) é pura — ver
  // resolveWeeklyAutoBatchRecipientsFromConfig.
  const { data: membershipRows, error: membershipError } = await admin
    .from("project_memberships")
    .select("project_id,user_id,status,profiles(name,email)")
    .in("project_id", projectIds)
    .eq("status", "ACTIVE");
  if (membershipError) throw new Error(`Falha ao validar membership dos responsáveis: ${membershipError.message}`);
  const activeMembers: ActiveProjectMemberForResponsible[] = [];
  for (const row of (membershipRows ?? []) as Array<{
    project_id: string;
    user_id: string;
    profiles: { name: string; email: string } | { name: string; email: string }[] | null;
  }>) {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    if (!profile?.email) continue;
    activeMembers.push({ projectId: row.project_id, userId: row.user_id, email: profile.email, name: profile.name ?? "Responsável" });
  }

  return resolveWeeklyAutoBatchRecipientsFromConfig(configured, activeMembers);
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
    skippedNoResponsible: 0,
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

  // 3. Destinatário automático — "Responsável pelos alertas contratuais"
  // configurado explicitamente por projeto (contract_alert_responsibles).
  // Projeto sem responsável ativo configurado simplesmente não entra no
  // Map (ver resolveWeeklyContractAlertBatchRecipients acima) —
  // contabilizado em skippedNoResponsible, nunca um destinatário
  // inventado.
  const candidateProjectIds = Array.from(new Set(eligibleEventInputs.filter((e) => e.severity !== null).map((e) => e.projectId)));
  const recipientsByProject = await resolveWeeklyContractAlertBatchRecipients(admin, candidateProjectIds);
  result.skippedNoResponsible = candidateProjectIds.filter((id) => !recipientsByProject.has(id)).length;

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
