// Processamento das respostas recebidas (alert_email_messages INBOUND,
// status RECEIVED) — orquestração sobre o pipeline puro + store. Usado
// pela fase `replies` do worker GitHub (service role); sem "server-only".
//   filtro -> correlação -> autorização -> limpeza -> classificação ->
//   ação formal (só quando inequívoca) via máquina de estados/RPC,
//   senão registro (REPLY_RECEIVED) ou revisão humana.
// O corpo nunca vai para logs/auditoria; só ids e classificação.

import { resolveMatrixPolicy } from "@/lib/sla/resolve-matrix-policy";
import type { SlaRiskLevel } from "@/lib/sla/types";

import { applyAlertAction } from "../alert-state-machine";
import { routeExpert } from "../experts/route-alert-expert";
import { DEFAULT_CORPORATE_EMAIL_DOMAIN } from "../plan-risk-alerts";
import type { RiskAlertStore } from "../store";
import { authorizeReply, classifyReply, correlateReply, filterInboundMessage, parseReplyBody, replyToFormalAction } from "./reply-pipeline";

export interface ProcessRepliesResult {
  projectId: string;
  received: number;
  ignored: number;
  unauthorized: number;
  pendingHumanReview: number;
  reviewRequired: number;
  applied: number;
  recorded: number;
}

export async function processAlertReplies(store: RiskAlertStore, projectId: string, nowIso: string, accMailboxes: string[]): Promise<ProcessRepliesResult> {
  const result: ProcessRepliesResult = { projectId, received: 0, ignored: 0, unauthorized: 0, pendingHumanReview: 0, reviewRequired: 0, applied: 0, recorded: 0 };
  const inbound = await store.listInboundToProcess(projectId);
  if (inbound.length === 0) return result;
  const snapshot = await store.loadProjectSnapshot(projectId);
  const index = await store.loadCorrelationIndex(projectId);
  const config = snapshot.config;
  const corporateDomain = (config?.senderDomain ?? DEFAULT_CORPORATE_EMAIL_DOMAIN).toLowerCase();
  const profileByEmail = new Map<string, { userId: string; email: string; membershipStatus: string | null }>();
  for (const profile of snapshot.recipients.values()) {
    if (profile.email) profileByEmail.set(profile.email.toLowerCase(), { userId: profile.userId, email: profile.email, membershipStatus: profile.membershipStatus });
  }

  for (const message of inbound) {
    result.received += 1;
    const verdict = filterInboundMessage(message.headers, { accMailboxes, seenMessageIds: index.seenMessageIds });
    if (verdict !== "OK") {
      await store.updateInboundMessage(message.id, { status: verdict, statusReason: verdict });
      result.ignored += 1;
      continue;
    }
    const parsed = parseReplyBody(message.bodyOriginal);
    const correlation = correlateReply(message.headers, `${message.headers.subject ?? ""}\n${parsed.clean}`, index);
    if (!correlation.caseId) {
      await store.updateInboundMessage(message.id, { bodyClean: parsed.clean, quotedText: parsed.quoted, signatureText: parsed.signature, correlationMethod: correlation.method, status: "PENDING_HUMAN_REVIEW", statusReason: correlation.ambiguous ? "Correlação ambígua (mais de um alerta)" : "Sem identificação inequívoca do alerta", requiresHumanReview: true });
      result.pendingHumanReview += 1;
      continue;
    }
    const loaded = await store.loadCaseSnapshotForAction(correlation.caseId);
    if (!loaded) {
      await store.updateInboundMessage(message.id, { correlationMethod: correlation.method, status: "PENDING_HUMAN_REVIEW", statusReason: "Alerta não encontrado", requiresHumanReview: true });
      result.pendingHumanReview += 1;
      continue;
    }
    const senderProfile = profileByEmail.get(message.headers.from.trim().toLowerCase()) ?? null;
    const authorization = authorizeReply({
      senderEmail: message.headers.from,
      profile: senderProfile ? { userId: senderProfile.userId, email: senderProfile.email, active: true } : null,
      membershipStatus: senderProfile?.membershipStatus ?? null,
      alertRecipientUserIds: loaded.alertRecipientUserIds,
      allowlistUserIds: config?.pilotRecipientAllowlistUserIds ?? [],
      activeForwardToUserId: loaded.snapshot.activeForward?.state === "ACTIVE" ? loaded.snapshot.activeForward.toUserId : null,
      corporateDomain,
      authenticationResults: message.headers.authenticationResults ?? null,
    });
    if (!authorization.authorized) {
      // Não altera o alerta; não devolve dados do projeto; registra o motivo.
      await store.updateInboundMessage(message.id, { caseId: correlation.caseId, correlationMethod: correlation.method, bodyClean: parsed.clean, quotedText: parsed.quoted, signatureText: parsed.signature, status: "UNAUTHORIZED_REPLY", statusReason: authorization.reason });
      await store.audit(projectId, [{ action: "RISK_ALERT_UNAUTHORIZED_REPLY", entityType: "RISK_ALERT_CASE", entityId: correlation.caseId, detail: `Resposta não autorizada (${authorization.reason}); mensagem ${message.id}.` }]);
      result.unauthorized += 1;
      continue;
    }
    const classification = classifyReply(parsed.clean);
    const basePatch = { caseId: correlation.caseId, senderUserId: authorization.userId, bodyClean: parsed.clean, quotedText: parsed.quoted, signatureText: parsed.signature, classification: classification.classification, confidence: classification.confidence, correlationMethod: correlation.method };
    const riskLevel = loaded.snapshot.riskLevel as SlaRiskLevel;
    const formal = replyToFormalAction(classification);
    const digestLike = riskLevel === "LOW" || riskLevel === "MEDIUM";
    if (classification.ambiguous || !formal || loaded.snapshot.state === "RESOLVED") {
      // Ambígua/inconclusiva: registra sem confirmar, resolver ou reatribuir.
      await store.updateInboundMessage(message.id, { ...basePatch, status: classification.ambiguous ? "REVIEW_REQUIRED" : "PROCESSED", statusReason: classification.ambiguous ? "Classificação ambígua" : "Registrada sem ação formal", requiresHumanReview: classification.ambiguous });
      if (classification.ambiguous) result.reviewRequired += 1;
      else result.recorded += 1;
      continue;
    }
    if (!config) {
      await store.updateInboundMessage(message.id, { ...basePatch, status: "REVIEW_REQUIRED", statusReason: "Projeto sem configuração", requiresHumanReview: true });
      result.reviewRequired += 1;
      continue;
    }
    const policy = resolveMatrixPolicy({ rules: snapshot.matrixRules, responsibles: snapshot.areaResponsibles, settings: snapshot.settings, area: loaded.record.area, riskLevel });
    // Pergunta ao Expert por resposta livre: roteamento por NOME/TEMA
    // (multidisciplinar => multi-Expert); sem confiança => revisão humana.
    // Nunca cai em Planejamento por falta de classificação.
    const expertRouting = formal === "EXPERT_CONSULTATION" ? routeExpert({ question: parsed.clean }) : null;
    if (expertRouting?.reviewRequired) {
      await store.updateInboundMessage(message.id, { ...basePatch, expertRouting: { ...expertRouting }, status: "EXPERT_SELECTION_REVIEW_REQUIRED", statusReason: expertRouting.reason, requiresHumanReview: true });
      result.reviewRequired += 1;
      continue;
    }
    const transition = applyAlertAction({
      now: nowIso,
      snapshot: loaded.snapshot,
      action: formal,
      actorUserId: authorization.userId,
      origin: "EMAIL",
      payload: formal === "EXPERT_CONSULTATION" ? { expertId: expertRouting!.expertId, expertRouting: { ...expertRouting }, question: parsed.clean, messageId: message.id } : { text: parsed.clean, messageId: message.id },
      policy,
      config,
      recipients: snapshot.recipients,
      eligibleForwardUserIds: [],
    });
    if (!transition.ok || digestLike) {
      // LOW/MEDIUM: resposta registrada; sem escalonamento/ação automática.
      await store.updateInboundMessage(message.id, { ...basePatch, status: "PROCESSED", statusReason: transition.ok ? "Registrada (consolidado LOW/MEDIUM — sem ação automática)" : transition.message });
      result.recorded += 1;
      continue;
    }
    try {
      await store.applyTransition(correlation.caseId, transition, authorization.userId);
      await store.updateInboundMessage(message.id, { ...basePatch, expertId: expertRouting?.expertId ?? null, expertRouting: expertRouting ? { ...expertRouting } : null, status: "PROCESSED", statusReason: `Ação ${formal} aplicada por e-mail` });
      result.applied += 1;
    } catch (error) {
      await store.updateInboundMessage(message.id, { ...basePatch, status: "REVIEW_REQUIRED", statusReason: error instanceof Error ? error.message.slice(0, 200) : "Falha ao aplicar", requiresHumanReview: true });
      result.reviewRequired += 1;
    }
  }
  return result;
}
