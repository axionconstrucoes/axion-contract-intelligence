// Máquina de estados do alerta — pura, determinística, sem I/O.
// Calcula a TRANSIÇÃO completa de uma ação formal (RESOLVIDO / TOMANDO
// PROVIDÊNCIAS / ENVIAR P/ / ESPECIALISTA / OUTRO) — eventos, estado,
// encaminhamento, escalonamento imediato e entradas da outbox — que a
// RPC record_risk_alert_action persiste atomicamente (com concorrência
// otimista pelo estado esperado e idempotência por chave única).
//
// REGRA ÚNICA DE ESCALONAMENTO IMEDIATO (HIGH/CRITICAL): TOMANDO
// PROVIDÊNCIAS, ENVIAR P/, ESPECIALISTA e OUTRO escalam imediatamente ao
// próximo nível hierárquico calculado pelo NÍVEL ATUAL DO ALERTA
// (nunca pelo cargo da pessoa encaminhada): N1 -> N2 -> N3 ->
// TOP_LEVEL_REACHED (sem Nível 4; Diretoria informada uma única vez).
// RESOLVIDO validamente confirmado é a única que não escala.
// LOW/MEDIUM nunca escalam imediatamente por essas ações.
//
// Bloqueios: resolver duas vezes, devolver duas vezes, encaminhar
// resolvido, mais de um responsável ativo, ação expirada assumir
// responsabilidade, escalonamento duplicado, Nível 4 fictício.

import { slaEscalationLevelLabels } from "@/lib/labels";
import { computePolicyDeadlines, matrixPolicySnapshot, type MatrixPolicy } from "@/lib/sla/resolve-matrix-policy";
import type { SlaEscalationLevel, SlaRiskLevel } from "@/lib/sla/types";

import { evaluateRecipient } from "./plan-risk-alerts";
import type {
  AlertActionOrigin,
  AlertActionType,
  AlertEventType,
  AlertState,
  ExpertId,
  PlannedRecipient,
  RecipientProfile,
  RiskAlertProjectConfig,
  RiskNotificationType,
  RiskSuppressionReason,
} from "./types";

export const IMMEDIATE_ESCALATION_ACTIONS: ReadonlySet<AlertActionType> = new Set(["TAKING_ACTION", "FORWARD", "EXPERT_CONSULTATION", "OTHER"]);

/**
 * Matriz ÚNICA de ações permitidas por estado — usada pela interface
 * (botões exibidos), pela máquina de estados (recusa antes de qualquer
 * cálculo) e espelhada no banco por risk_alert_action_allowed (RPC).
 */
export const ACTIONS_BY_STATE: Record<AlertState, AlertActionType[]> = {
  OPEN: ["RESOLVED", "TAKING_ACTION", "FORWARD", "EXPERT_CONSULTATION", "OTHER"],
  ACKNOWLEDGED: ["RESOLVED", "TAKING_ACTION", "FORWARD", "EXPERT_CONSULTATION", "OTHER"],
  IN_PROGRESS: ["RESOLVED", "TAKING_ACTION", "FORWARD", "EXPERT_CONSULTATION", "OTHER"],
  FORWARDED: ["RESOLVED", "TAKING_ACTION", "EXPERT_CONSULTATION", "OTHER"],
  AWAITING_RECIPIENT_ACTION: ["RESOLVED", "TAKING_ACTION", "EXPERT_CONSULTATION", "OTHER"],
  RETURNED_TO_SENDER: ["RESOLVED", "TAKING_ACTION", "FORWARD", "EXPERT_CONSULTATION", "OTHER"],
  EXPERT_CONSULTATION_PENDING: ["RESOLVED", "TAKING_ACTION", "FORWARD", "OTHER"],
  EXPERT_ANSWERED: ["RESOLVED", "TAKING_ACTION", "FORWARD", "EXPERT_CONSULTATION", "OTHER"],
  RESOLUTION_PROPOSED: ["RESOLUTION_CONFIRMED", "TAKING_ACTION", "OTHER"],
  RESOLVED: [],
  REVIEW_REQUIRED: ["RESOLVED", "TAKING_ACTION", "FORWARD", "EXPERT_CONSULTATION", "OTHER"],
  TOP_LEVEL_REACHED: ["RESOLVED", "TAKING_ACTION", "FORWARD", "EXPERT_CONSULTATION", "OTHER"],
};
const IMMEDIATE_LEVELS: ReadonlySet<SlaRiskLevel> = new Set(["HIGH", "CRITICAL"]);
const TERMINAL_STATES: ReadonlySet<AlertState> = new Set(["RESOLVED"]);

export interface ActiveForward {
  id: string;
  fromUserId: string;
  toUserId: string;
  assumeDueAt: string;
  timeoutAt: string;
  state: "ACTIVE" | "ACTED" | "TIMED_OUT" | "RETURNED" | "CANCELLED";
}

export interface AlertCaseSnapshot {
  id: string;
  projectId: string;
  /** Chave de caso usada pelo motor horário e pela RPC manual: sourceType:sourceId. */
  sourceType: string;
  sourceId: string;
  riskLevel: SlaRiskLevel;
  state: AlertState;
  currentLevel: SlaEscalationLevel;
  topLevelReachedAt: string | null;
  currentResponsibleUserId: string | null;
  previousResponsibleUserId: string | null;
  slaActionId: string | null;
  title: string;
  reference: string;
  activeForward: ActiveForward | null;
  /** Níveis já escalados por ação imediata (idempotência) — do histórico de eventos. */
  escalatedLevels: SlaEscalationLevel[];
}

export interface AlertActionPayload {
  text?: string | null;
  justification?: string | null;
  evidence?: string | null;
  forecastAt?: string | null;
  targetUserId?: string | null;
  expertId?: ExpertId | null;
  /** Decisão de roteamento (fonte, confiança, temas, sugerido × confirmado) — auditada com o evento. */
  expertRouting?: Record<string, unknown> | null;
  question?: string | null;
  messageId?: string | null;
  confirmed?: boolean;
}

export interface ApplyAlertActionInput {
  now: string;
  snapshot: AlertCaseSnapshot;
  action: AlertActionType;
  actorUserId: string | null;
  origin: AlertActionOrigin;
  payload: AlertActionPayload;
  policy: MatrixPolicy;
  config: RiskAlertProjectConfig;
  recipients: Map<string, RecipientProfile>;
  /** Membros ACTIVE do projeto elegíveis para ENVIAR P/ (já filtrados por quem pode ver o alerta). */
  eligibleForwardUserIds: string[];
}

export interface TransitionEvent {
  actionType: AlertEventType;
  actorUserId: string | null;
  origin: AlertActionOrigin;
  fromState: AlertState;
  toState: AlertState;
  fromLevel: SlaEscalationLevel | null;
  toLevel: SlaEscalationLevel | null;
  text: string | null;
  justification: string | null;
  evidence: string | null;
  forecastAt: string | null;
  targetUserId: string | null;
  expertId: ExpertId | null;
  expertRouting: Record<string, unknown> | null;
  messageId: string | null;
  idempotencyKey: string;
}

export interface TransitionOutboxEntry {
  idempotencyKey: string;
  notificationType: RiskNotificationType;
  origin: "WEB_ACTION" | "EMAIL_REPLY" | "AUTOMATIC";
  escalationLevel: SlaEscalationLevel | null;
  riskLevel: SlaRiskLevel;
  recipientUserId: string;
  status: "PENDING" | "SUPPRESSED";
  suppressionReason: RiskSuppressionReason | null;
  matrixRuleSnapshot: Record<string, unknown>;
  payloadSummary: Record<string, unknown>;
}

export interface AlertTransition {
  ok: true;
  /** Ação solicitada (null em transições do sistema, ex.: timeout de encaminhamento). */
  action: AlertActionType | null;
  summary: string;
  expectedState: AlertState;
  events: TransitionEvent[];
  caseUpdate: {
    state: AlertState;
    currentLevel?: SlaEscalationLevel;
    topLevelReached?: boolean;
    currentResponsibleUserId?: string | null;
    previousResponsibleUserId?: string | null;
    slaActionStatus?: "ACKNOWLEDGED" | "IN_PROGRESS" | "COMPLETED";
    completionNote?: string;
    responsibleUserId?: string | null;
  };
  forward: { fromUserId: string; toUserId: string; instruction: string; pilotException: boolean; assumeDueAt: string; timeoutAt: string; cancelActive: boolean } | null;
  closeActiveForwardAs: "ACTED" | "RETURNED" | "CANCELLED" | null;
  escalation: { fromLevel: SlaEscalationLevel; toLevel: SlaEscalationLevel; reason: string } | null;
  topLevelReached: boolean;
  outbox: TransitionOutboxEntry[];
}

export interface AlertTransitionError {
  ok: false;
  code:
    | "ALREADY_RESOLVED"
    | "NOT_PROPOSED"
    | "ALREADY_RETURNED"
    | "FORWARD_ACTIVE"
    | "FORWARD_TARGET_INVALID"
    | "FORWARD_SELF"
    | "ASSIGNMENT_EXPIRED"
    | "TEXT_REQUIRED"
    | "QUESTION_REQUIRED"
    | "EXPERT_REQUIRED"
    | "CONFIRMATION_REQUIRED"
    | "JUSTIFICATION_REQUIRED"
    | "EVIDENCE_REQUIRED"
    | "ACTOR_REQUIRED"
    | "ACTION_NOT_ALLOWED";
  message: string;
}

export type ApplyAlertActionResult = AlertTransition | AlertTransitionError;

const LEVEL_ORDER: SlaEscalationLevel[] = ["RESPONSAVEL", "ESCALAO_1", "DIRETORIA"];

/** Próximo nível a partir do NÍVEL ATUAL do alerta; null quando já está no topo. */
export function nextHierarchyLevel(current: SlaEscalationLevel): SlaEscalationLevel | null {
  if (current === "ESCALAO_2") return "DIRETORIA"; // legado tratado como Nível 2
  const index = LEVEL_ORDER.indexOf(current);
  return index >= 0 && index < LEVEL_ORDER.length - 1 ? LEVEL_ORDER[index + 1] : null;
}

function levelRecipient(policy: MatrixPolicy, level: SlaEscalationLevel): string | null {
  if (level === "ESCALAO_1") return policy.level2UserId ?? policy.level3UserId;
  if (level === "DIRETORIA") return policy.level3UserId;
  return policy.level1UserId;
}

function fail(code: AlertTransitionError["code"], message: string): AlertTransitionError {
  return { ok: false, code, message };
}

function eventKey(caseId: string, type: string, discriminator: string): string {
  return `${caseId}:${type}:${discriminator}`;
}

function recipientEntry(userId: string, config: RiskAlertProjectConfig, recipients: Map<string, RecipientProfile>, forwardException: boolean): PlannedRecipient {
  const evaluated = evaluateRecipient(userId, config, recipients);
  // Exceção MANUAL do piloto: o encaminhado recebe SÓ este alerta, mesmo fora
  // da allowlist automática (que não é ampliada) — registrada como exceção.
  if (forwardException && evaluated.status === "SUPPRESSED" && evaluated.suppressionReason === "PILOT_RECIPIENT_SUPPRESSED") {
    return { ...evaluated, status: "PENDING", suppressionReason: null };
  }
  return evaluated;
}

export function applyAlertAction(input: ApplyAlertActionInput): ApplyAlertActionResult {
  const { snapshot, action, payload, policy } = input;
  const caseId = snapshot.id;
  const from = snapshot.state;
  const nowKey = input.now.slice(0, 16); // idempotência por minuto para ações repetidas idênticas
  const isImmediateLevel = IMMEDIATE_LEVELS.has(snapshot.riskLevel);
  const events: TransitionEvent[] = [];
  const outbox: TransitionOutboxEntry[] = [];

  if (TERMINAL_STATES.has(from)) return fail("ALREADY_RESOLVED", "Alerta já resolvido — não pode ser resolvido, encaminhado ou alterado novamente.");
  if (!ACTIONS_BY_STATE[from].includes(action)) return fail("ACTION_NOT_ALLOWED", `Ação ${action} não permitida no estado ${from}.`);
  if (!input.actorUserId && input.origin !== "SYSTEM") return fail("ACTOR_REQUIRED", "Ação humana exige usuário identificado.");

  // Encaminhado com prazo expirado não pode agir como responsável ativo.
  const activeForward = snapshot.activeForward?.state === "ACTIVE" ? snapshot.activeForward : null;
  if (activeForward && input.actorUserId === activeForward.toUserId && input.now > activeForward.timeoutAt) {
    return fail("ASSIGNMENT_EXPIRED", "O prazo para assumir este encaminhamento expirou; a responsabilidade voltou ao remetente.");
  }

  const baseEvent = (type: AlertEventType, toState: AlertState, extra: Partial<TransitionEvent> = {}): TransitionEvent => ({
    actionType: type,
    actorUserId: input.actorUserId,
    origin: input.origin,
    fromState: from,
    toState,
    fromLevel: null,
    toLevel: null,
    text: payload.text ?? null,
    justification: payload.justification ?? null,
    evidence: payload.evidence ?? null,
    forecastAt: payload.forecastAt ?? null,
    targetUserId: null,
    expertId: null,
    expertRouting: null,
    messageId: payload.messageId ?? null,
    idempotencyKey: eventKey(caseId, type, `${input.actorUserId ?? "system"}:${nowKey}`),
    ...extra,
  });

  let toState: AlertState = from;
  let summary = "";
  let forward: AlertTransition["forward"] = null;
  let closeActiveForwardAs: AlertTransition["closeActiveForwardAs"] = null;
  let caseUpdate: AlertTransition["caseUpdate"] = { state: from };

  // Ação de quem recebeu um encaminhamento conta como "ação do encaminhado".
  const actedOnForward = Boolean(activeForward && input.actorUserId === activeForward.toUserId);

  switch (action) {
    case "RESOLVED": {
      if (!payload.confirmed) return fail("CONFIRMATION_REQUIRED", "RESOLVIDO exige confirmação explícita.");
      if (policy.requiresDelayJustification && !payload.justification?.trim()) return fail("JUSTIFICATION_REQUIRED", "A Matriz exige justificativa para este risco.");
      if (isImmediateLevel && !payload.evidence?.trim()) return fail("EVIDENCE_REQUIRED", "Risco ALTO/CRÍTICO exige evidência da resolução.");
      const needsHumanReview = isImmediateLevel && policy.requiresAcknowledgmentConfirmation;
      toState = needsHumanReview ? "RESOLUTION_PROPOSED" : "RESOLVED";
      summary = needsHumanReview ? "Resolução proposta — aguardando revisão humana" : "Resolvido";
      events.push(baseEvent(needsHumanReview ? "RESOLUTION_PROPOSED" : "RESOLVED", toState));
      caseUpdate = {
        state: toState,
        ...(toState === "RESOLVED" ? { slaActionStatus: "COMPLETED", completionNote: payload.text ?? payload.justification ?? "Resolvido via alerta de risco." } : { slaActionStatus: "ACKNOWLEDGED" }),
      };
      if (activeForward) closeActiveForwardAs = "ACTED";
      break;
    }
    case "RESOLUTION_CONFIRMED": {
      if (from !== "RESOLUTION_PROPOSED") return fail("NOT_PROPOSED", "Só uma resolução proposta pode ser confirmada.");
      if (!payload.confirmed) return fail("CONFIRMATION_REQUIRED", "Confirmação explícita obrigatória.");
      toState = "RESOLVED";
      summary = "Resolução confirmada";
      events.push(baseEvent("RESOLUTION_CONFIRMED", toState));
      caseUpdate = { state: toState, slaActionStatus: "COMPLETED", completionNote: payload.text ?? "Resolução confirmada via alerta de risco." };
      break;
    }
    case "TAKING_ACTION": {
      if (!payload.text?.trim()) return fail("TEXT_REQUIRED", "Descreva a providência.");
      toState = "IN_PROGRESS";
      summary = "Tomando providências";
      events.push(baseEvent("TAKING_ACTION", toState));
      caseUpdate = { state: toState, slaActionStatus: "IN_PROGRESS", currentResponsibleUserId: input.actorUserId ?? snapshot.currentResponsibleUserId };
      if (activeForward && actedOnForward) closeActiveForwardAs = "ACTED";
      break;
    }
    case "FORWARD": {
      const target = payload.targetUserId ?? null;
      if (!target) return fail("FORWARD_TARGET_INVALID", "Selecione um destinatário.");
      if (target === input.actorUserId) return fail("FORWARD_SELF", "Não é possível encaminhar para si mesmo.");
      if (!input.eligibleForwardUserIds.includes(target)) return fail("FORWARD_TARGET_INVALID", "Destinatário não elegível (precisa ser membro ACTIVE do projeto com e-mail corporativo verificado).");
      // Um único encaminhamento ativo: enquanto houver um, ninguém (nem o
      // encaminhado) re-encaminha — o encaminhado age (TOMANDO PROVIDÊNCIAS
      // etc.), o que encerra o seu encaminhamento, e só então pode encaminhar.
      if (activeForward || from === "AWAITING_RECIPIENT_ACTION" || from === "FORWARDED") return fail("FORWARD_ACTIVE", "Já existe um encaminhamento ativo; aguarde a ação ou a devolução.");
      const deadlines = computePolicyDeadlines(policy, input.now);
      const allowlist = input.config.pilotRecipientAllowlistUserIds ?? [];
      const pilotException = allowlist.length > 0 && !allowlist.includes(target);
      forward = {
        fromUserId: input.actorUserId!,
        toUserId: target,
        instruction: payload.text?.trim() ?? "",
        pilotException,
        assumeDueAt: deadlines.assumeDueAt,
        timeoutAt: deadlines.assumeDueAt,
        cancelActive: false,
      };
      toState = "AWAITING_RECIPIENT_ACTION";
      summary = `Encaminhado para ${target}`;
      events.push(baseEvent("FORWARD", toState, { targetUserId: target, idempotencyKey: eventKey(caseId, "FORWARD", `${input.actorUserId}:${target}:${nowKey}`) }));
      caseUpdate = { state: toState, currentResponsibleUserId: target, previousResponsibleUserId: input.actorUserId, responsibleUserId: target, slaActionStatus: "ACKNOWLEDGED" };
      const recipient = recipientEntry(target, input.config, input.recipients, true);
      outbox.push({
        idempotencyKey: `${caseId}:FORWARD:${target}:${input.now.slice(0, 10)}`,
        notificationType: "FORWARD",
        origin: input.origin === "EMAIL" ? "EMAIL_REPLY" : "WEB_ACTION",
        escalationLevel: null,
        riskLevel: snapshot.riskLevel,
        recipientUserId: target,
        status: recipient.status,
        suppressionReason: recipient.suppressionReason,
        matrixRuleSnapshot: matrixPolicySnapshot(policy),
        payloadSummary: { forwardedBy: input.actorUserId, assumeDueAt: deadlines.assumeDueAt, pilotException, instruction: (payload.text ?? "").slice(0, 200) },
      });
      break;
    }
    case "EXPERT_CONSULTATION": {
      if (!payload.expertId) return fail("EXPERT_REQUIRED", "Selecione o Expert.");
      if (!payload.question?.trim()) return fail("QUESTION_REQUIRED", "A pergunta ao Expert é obrigatória.");
      toState = "EXPERT_CONSULTATION_PENDING";
      summary = `Consulta ao Expert ${payload.expertId}`;
      events.push(baseEvent("EXPERT_CONSULTATION", toState, { expertId: payload.expertId, expertRouting: payload.expertRouting ?? null, text: payload.question, idempotencyKey: eventKey(caseId, "EXPERT_CONSULTATION", `${payload.expertId}:${input.actorUserId}:${nowKey}`) }));
      caseUpdate = { state: toState, slaActionStatus: "ACKNOWLEDGED" };
      if (activeForward && actedOnForward) closeActiveForwardAs = "ACTED";
      break;
    }
    case "OTHER": {
      if (!payload.text?.trim()) return fail("TEXT_REQUIRED", "O campo de texto é obrigatório.");
      toState = from === "OPEN" ? "ACKNOWLEDGED" : from;
      summary = "Outro (registro livre)";
      events.push(baseEvent("OTHER", toState));
      caseUpdate = { state: toState, slaActionStatus: "ACKNOWLEDGED" };
      if (activeForward && actedOnForward) closeActiveForwardAs = "ACTED";
      break;
    }
  }

  // ---------------- Escalonamento imediato (HIGH/CRITICAL) ----------------
  let escalation: AlertTransition["escalation"] = null;
  let topLevelReached = false;
  if (isImmediateLevel && IMMEDIATE_ESCALATION_ACTIONS.has(action)) {
    const currentLevel = snapshot.currentLevel;
    const rawNext = nextHierarchyLevel(currentLevel);
    // Nível 2 ausente na Matriz => Nível 3 (mesma regra de resolveEscalationDestination / RPC).
    const next = rawNext === "ESCALAO_1" && !policy.level2UserId && policy.level3UserId ? "DIRETORIA" : rawNext;
    if (!next) {
      // Já na Diretoria: sem Nível 4; registra TOP_LEVEL_REACHED uma única vez, sem novo e-mail.
      topLevelReached = true;
      if (!snapshot.topLevelReachedAt) {
        events.push(baseEvent("TOP_LEVEL_REACHED", toState, { fromLevel: currentLevel, toLevel: currentLevel, idempotencyKey: eventKey(caseId, "TOP_LEVEL_REACHED", "once") }));
      }
      caseUpdate.topLevelReached = true;
    } else if (!snapshot.escalatedLevels.includes(next)) {
      escalation = { fromLevel: currentLevel, toLevel: next, reason: "NEW_EVIDENCE_INCREASED_RISK" };
      events.push(baseEvent("IMMEDIATE_ESCALATION", toState, { fromLevel: currentLevel, toLevel: next, text: `Escalonamento imediato por ação ${action}`, idempotencyKey: eventKey(caseId, "IMMEDIATE_ESCALATION", next) }));
      caseUpdate.currentLevel = next;
      const recipientUserId = levelRecipient(policy, next);
      if (recipientUserId) {
        const recipient = policy.notifyByEmail
          ? recipientEntry(recipientUserId, input.config, input.recipients, false)
          : ({ userId: recipientUserId, email: null, name: null, status: "SUPPRESSED", suppressionReason: "NOTIFY_BY_EMAIL_DISABLED" } as PlannedRecipient);
        outbox.push({
          // MESMA chave do motor horário e do botão manual
          // (sourceType:sourceId:ESCALATION:nível:usuário): nunca duplicam.
          idempotencyKey: `${snapshot.sourceType}:${snapshot.sourceId}:ESCALATION:${next}:${recipientUserId}`,
          notificationType: "ESCALATION",
          origin: input.origin === "EMAIL" ? "EMAIL_REPLY" : "WEB_ACTION",
          escalationLevel: next,
          riskLevel: snapshot.riskLevel,
          recipientUserId,
          status: recipient.status,
          suppressionReason: recipient.suppressionReason,
          matrixRuleSnapshot: matrixPolicySnapshot(policy),
          payloadSummary: { trigger: action, fromLevel: currentLevel, toLevel: next, levelLabel: slaEscalationLevelLabels[next] },
        });
      }
      if (next === "DIRETORIA") caseUpdate.topLevelReached = false;
    }
  }

  return {
    ok: true,
    action,
    summary,
    expectedState: from,
    events,
    caseUpdate,
    forward,
    closeActiveForwardAs,
    escalation,
    topLevelReached,
    outbox,
  };
}

/** Timeout do encaminhado sem ação: devolve ao remetente (sem resetar prazos originais). */
export function applyForwardTimeout(input: {
  now: string;
  snapshot: AlertCaseSnapshot;
  policy: MatrixPolicy;
  config: RiskAlertProjectConfig;
  recipients: Map<string, RecipientProfile>;
}): AlertTransition | null {
  const forward = input.snapshot.activeForward;
  if (!forward || forward.state !== "ACTIVE" || input.now <= forward.timeoutAt) return null;
  if (input.snapshot.state === "RETURNED_TO_SENDER") return null; // nunca devolver duas vezes
  const caseId = input.snapshot.id;
  const from = input.snapshot.state;
  const recipient = evaluateRecipient(forward.fromUserId, input.config, input.recipients);
  return {
    ok: true,
    action: null,
    summary: "Encaminhado sem ação — devolvido ao responsável anterior",
    expectedState: from,
    events: [
      {
        actionType: "FORWARD_TIMEOUT",
        actorUserId: null,
        origin: "SYSTEM",
        fromState: from,
        toState: "RETURNED_TO_SENDER",
        fromLevel: null,
        toLevel: null,
        text: `Sem ação do encaminhado até ${forward.timeoutAt}.`,
        justification: null,
        evidence: null,
        forecastAt: null,
        targetUserId: forward.toUserId,
        expertId: null,
        expertRouting: null,
        messageId: null,
        idempotencyKey: eventKey(caseId, "FORWARD_TIMEOUT", forward.id),
      },
      {
        actionType: "RETURNED_TO_SENDER",
        actorUserId: null,
        origin: "SYSTEM",
        fromState: from,
        toState: "RETURNED_TO_SENDER",
        fromLevel: null,
        toLevel: null,
        text: null,
        justification: null,
        evidence: null,
        forecastAt: null,
        targetUserId: forward.fromUserId,
        expertId: null,
        expertRouting: null,
        messageId: null,
        idempotencyKey: eventKey(caseId, "RETURNED_TO_SENDER", forward.id),
      },
    ],
    caseUpdate: { state: "RETURNED_TO_SENDER", currentResponsibleUserId: forward.fromUserId, previousResponsibleUserId: forward.toUserId, responsibleUserId: forward.fromUserId },
    forward: null,
    closeActiveForwardAs: "RETURNED",
    escalation: null,
    topLevelReached: false,
    outbox: [
      {
        idempotencyKey: `${caseId}:RETURNED:${forward.id}:${forward.fromUserId}`,
        notificationType: "RETURNED",
        origin: "AUTOMATIC",
        escalationLevel: null,
        riskLevel: input.snapshot.riskLevel,
        recipientUserId: forward.fromUserId,
        status: recipient.status,
        suppressionReason: recipient.suppressionReason,
        matrixRuleSnapshot: matrixPolicySnapshot(input.policy),
        payloadSummary: { reason: "NO_ACTION_TIMEOUT", forwardedTo: forward.toUserId, timeoutAt: forward.timeoutAt },
      },
    ],
  };
}
