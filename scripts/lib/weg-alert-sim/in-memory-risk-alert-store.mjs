// Implementação EM MEMÓRIA da porta RiskAlertStore (apps/web/lib/risk-alerts/store.ts)
// para executar o ciclo REAL (runRiskAlertCycle) e o processador de respostas REAL
// (processAlertReplies) sem banco. Modela, fielmente ao supabase-store.ts e à RPC
// record_risk_alert_action, apenas o necessário: idempotência da outbox por chave,
// eventos com chave única, token de ação de uso único, nível/estado do caso e da
// ação SLA. NÃO valida RLS, permissões nem SQL — isso é coberto por test:sql.
import { createHash } from "node:crypto";

// Mesmo helper PURO usado pelo store real (supabase-store.ts) — a simulação não reimplementa a regra.
const { buildCorrelationIndex } = await import("../../../apps/web/lib/risk-alerts/replies/build-correlation-index");

const MAX_SEND_ATTEMPTS = 3;

export function createInMemoryRiskAlertStore(world) {
  let counter = 0;
  let clockIso = new Date(0).toISOString();
  const uuid = (kind) => `${kind.repeat(8)}-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
  const state = {
    cases: new Map(),
    actions: new Map(),
    outbox: [],
    audit: [],
    events: [],
    escalations: [],
    forwards: [],
    conversations: new Map(),
    messages: [],
    actionLinks: [],
    emails: [],
  };

  const outboxByKey = (key) => state.outbox.find((o) => o.idempotencyKey === key);

  const store = {
    state,
    setClock(iso) {
      clockIso = iso;
    },

    async listEnabledProjectIds() {
      return world.config?.enabled ? [world.projectId] : [];
    },

    async loadProjectSnapshot() {
      const digestSent = state.outbox.filter((o) => o.notificationType === "DIGEST" && o.status === "SENT").map((o) => o.sentAt).sort();
      return {
        projectId: world.projectId,
        projectName: world.projectName,
        config: world.config,
        matrixRules: world.matrixRules,
        areaResponsibles: world.areaResponsibles,
        settings: world.settings ?? null,
        cases: world.sourceCases.map((c) => ({ ...c })),
        existingCases: [...state.cases.values()].map((c) => ({ ...c })),
        linkedActions: new Map([...state.actions.values()].map((a) => [a.id, { ...a }])),
        recipients: world.recipients,
        existingIdempotencyKeys: new Set(state.outbox.map((o) => o.idempotencyKey)),
        previousDigestSentAt: digestSent.length ? digestSent[digestSent.length - 1] : null,
        senderMailbox: world.senderMailbox,
        replyMailbox: world.replyMailbox,
      };
    },

    async upsertCases(_projectId, upserts) {
      const ids = new Map();
      for (const item of upserts) {
        const closed = item.input.closed;
        const existing = item.existingId ? state.cases.get(item.existingId) : null;
        if (existing) {
          if (item.change !== "UNCHANGED") {
            Object.assign(existing, {
              area: item.input.area,
              riskLevel: item.input.riskLevel,
              previousRiskLevel: item.previousRiskLevel,
              fingerprint: item.input.fingerprint,
              title: item.input.title,
              summary: item.input.summary,
              impact: item.input.impact,
              recommendation: item.input.recommendation,
              originPath: item.input.originPath,
              reference: item.input.reference,
              status: closed ? "CLOSED" : "OPEN",
              lastChangedAt: item.now,
              closedAt: closed ? item.now : null,
            });
          }
          ids.set(item.caseKey, existing.id);
        } else {
          const id = uuid("c");
          state.cases.set(id, {
            id,
            sourceType: item.input.sourceType,
            sourceId: item.input.sourceId,
            area: item.input.area,
            riskLevel: item.input.riskLevel,
            previousRiskLevel: null,
            fingerprint: item.input.fingerprint,
            status: closed ? "CLOSED" : "OPEN",
            slaActionId: null,
            lastDigestWindow: null,
            firstSeenAt: item.now,
            lastChangedAt: item.now,
            closedAt: closed ? item.now : null,
            title: item.input.title,
            summary: item.input.summary,
            impact: item.input.impact,
            recommendation: item.input.recommendation,
            originPath: item.input.originPath,
            reference: item.input.reference,
            state: "OPEN",
            currentLevel: "RESPONSAVEL",
            currentResponsibleUserId: null,
            previousResponsibleUserId: null,
            topLevelReachedAt: null,
            visibleCode: createHash("sha256").update(id).digest("hex").slice(0, 8).toUpperCase(),
          });
          ids.set(item.caseKey, id);
        }
      }
      return ids;
    },

    async createSlaActions(_projectId, creates, caseIds) {
      const created = new Map();
      for (const item of creates) {
        const id = uuid("a");
        state.actions.set(id, {
          id,
          status: "PENDING",
          currentEscalationLevel: "RESPONSAVEL",
          assumeDueAt: item.assumeDueAt,
          respondDueAt: item.respondDueAt,
          completeDueAt: item.completeDueAt,
          acknowledgedAt: null,
          completedAt: null,
          contractualDeadline: null,
          responsibleUserId: item.responsibleUserId,
        });
        created.set(item.caseKey, id);
        const caseId = caseIds.get(item.caseKey);
        if (caseId) Object.assign(state.cases.get(caseId), { slaActionId: id, currentResponsibleUserId: item.responsibleUserId });
      }
      return created;
    },

    async applyEscalations(_projectId, escalations) {
      let applied = 0;
      let skipped = 0;
      for (const e of escalations) {
        const action = state.actions.get(e.slaActionId);
        if (!action || action.currentEscalationLevel !== e.expectedCurrentLevel) {
          skipped += 1;
          continue;
        }
        action.currentEscalationLevel = e.newLevel;
        action.status = "ESCALATED";
        state.escalations.push({ slaActionId: e.slaActionId, from: e.expectedCurrentLevel, to: e.newLevel, reason: e.reason, at: clockIso, via: "DEADLINE" });
        applied += 1;
      }
      return { applied, skipped };
    },

    async enqueue(_projectId, entries, caseIds, slaActionIds) {
      const persisted = [];
      for (const entry of entries) {
        const caseId = entry.caseKey ? (caseIds.get(entry.caseKey) ?? null) : null;
        const slaActionId = entry.slaActionId ?? (entry.caseKey ? (slaActionIds.get(entry.caseKey) ?? null) : null);
        let row = outboxByKey(entry.idempotencyKey);
        if (!row) {
          row = {
            id: uuid("b"),
            caseId,
            slaActionId,
            riskLevel: entry.riskLevel,
            notificationType: entry.notificationType,
            escalationLevel: entry.escalationLevel,
            recipientUserId: entry.recipient.userId,
            scheduledFor: entry.scheduledFor,
            status: entry.recipient.status,
            suppressionReason: entry.recipient.suppressionReason,
            digestWindow: entry.digestWindow,
            idempotencyKey: entry.idempotencyKey,
            matrixRuleSnapshot: entry.matrixRuleSnapshot,
            payloadSummary: entry.payloadSummary,
            origin: "AUTOMATIC",
            attemptCount: 0,
            deliveredTo: null,
            sentAt: null,
            provider: null,
            lastError: null,
          };
          state.outbox.push(row);
        }
        if (row.status === "PENDING" && row.attemptCount < MAX_SEND_ATTEMPTS) persisted.push({ id: row.id, entry: { ...entry, slaActionId }, caseId: row.caseId ?? caseId });
      }
      return persisted;
    },

    async listPendingRows() {
      return state.outbox
        .filter((o) => o.status === "PENDING" && o.attemptCount < MAX_SEND_ATTEMPTS)
        .map((o) => ({
          id: o.id,
          caseId: o.caseId,
          slaActionId: o.slaActionId,
          notificationType: o.notificationType,
          escalationLevel: o.escalationLevel,
          riskLevel: o.riskLevel,
          recipientUserId: o.recipientUserId,
          idempotencyKey: o.idempotencyKey,
          payloadSummary: o.payloadSummary,
          origin: o.origin,
          attemptCount: o.attemptCount,
        }));
    },

    async loadCaseRecord(caseId) {
      const c = state.cases.get(caseId);
      return c ? { ...c } : null;
    },

    async markSent(id, result) {
      const row = state.outbox.find((o) => o.id === id);
      Object.assign(row, {
        status: "SENT",
        sentAt: result.sentAt,
        deliveredTo: result.recipientEmail,
        provider: result.provider,
        providerMessageId: result.providerMessageId,
        messageIdHeader: result.messageIdHeader,
        lastError: null,
      });
    },
    // Modelo do UPDATE condicional do store real: lê, cede o turno (latência de rede) e só grava se
    // status e attempt_count continuarem iguais ao lido (compare-and-swap). world.legacyNoClaim=true
    // reproduz o comportamento ANTERIOR (sem reivindicação) para demonstrar a duplicidade.
    async claimOutbox(id) {
      if (world.legacyNoClaim) return true;
      const row = state.outbox.find((o) => o.id === id);
      if (!row || row.status !== "PENDING" || row.attemptCount >= MAX_SEND_ATTEMPTS) return false;
      const observed = row.attemptCount;
      await new Promise((resolve) => setImmediate(resolve));
      if (row.status !== "PENDING" || row.attemptCount !== observed) return false;
      row.attemptCount = observed + 1;
      return true;
    },
    async markFailed(id, message, options = {}) {
      const row = state.outbox.find((o) => o.id === id);
      if (!options.attemptAlreadyClaimed) row.attemptCount += 1;
      row.status = row.attemptCount >= MAX_SEND_ATTEMPTS ? "FAILED" : "PENDING";
      row.lastError = message;
    },
    async markSkipped(id, reason) {
      const row = state.outbox.find((o) => o.id === id);
      row.status = "SKIPPED";
      row.lastError = reason;
    },
    async markDigestWindow(caseIds, window) {
      for (const id of caseIds) state.cases.get(id).lastDigestWindow = window;
    },
    async recordEmail(_projectId, input) {
      const id = uuid("e");
      state.emails.push({ id, ...input });
      return id;
    },
    async audit(_projectId, events) {
      for (const e of events) state.audit.push({ ...e, at: clockIso });
    },

    async ensureConversation(_projectId, caseId) {
      let conv = state.conversations.get(caseId);
      if (!conv) {
        conv = { id: uuid("d"), rootMessageIdHeader: null, providerThreadId: null, replyTokenHash: null };
        state.conversations.set(caseId, conv);
      }
      return { ...conv };
    },
    async setConversationRoot(conversationId, root, thread) {
      for (const conv of state.conversations.values()) {
        if (conv.id === conversationId && !conv.rootMessageIdHeader) Object.assign(conv, { rootMessageIdHeader: root, providerThreadId: thread });
      }
    },
    async recordOutboundMessage(record) {
      state.messages.push({ direction: "OUTBOUND", status: "SENT", ...record });
    },
    async loadCorrelationIndex() {
      return buildCorrelationIndex(
        state.messages.map((m) => ({ case_id: m.caseId ?? null, message_id_header: m.messageIdHeader ?? null, reply_token_hash: m.replyTokenHash ?? null, direction: m.direction, status: m.status ?? null })),
        [],
        [...state.cases.values()].map((c) => ({ id: c.id, visible_code: c.visibleCode }))
      );
    },
    async listInboundToProcess() {
      return state.messages
        .filter((m) => m.direction === "INBOUND" && m.status === "RECEIVED")
        .map((m) => ({ id: m.id, projectId: world.projectId, providerMessageId: m.providerMessageId, headers: m.headers, bodyOriginal: m.bodyOriginal, receivedAt: m.receivedAt }));
    },
    async updateInboundMessage(id, patch) {
      Object.assign(state.messages.find((m) => m.id === id), patch);
    },
    /** Injeta uma resposta recebida (simulação do worker Gmail inbound) com status RECEIVED. */
    receiveInbound(headers, bodyOriginal, receivedAt) {
      const id = uuid("f");
      state.messages.push({ id, direction: "INBOUND", status: "RECEIVED", providerMessageId: `sim-inbound-${id}`, headers, bodyOriginal, receivedAt, messageIdHeader: headers.messageId ?? null });
      return id;
    },

    async loadCaseSnapshotForAction(caseId) {
      const record = state.cases.get(caseId);
      if (!record) return null;
      const forward = state.forwards.find((f) => f.caseId === caseId && f.state === "ACTIVE") ?? null;
      const snapshot = {
        id: record.id,
        projectId: world.projectId,
        sourceType: record.sourceType,
        sourceId: record.sourceId,
        riskLevel: record.riskLevel === "REVIEW_REQUIRED" ? "MEDIUM" : record.riskLevel,
        state: record.state,
        currentLevel: record.currentLevel,
        topLevelReachedAt: record.topLevelReachedAt,
        currentResponsibleUserId: record.currentResponsibleUserId,
        previousResponsibleUserId: record.previousResponsibleUserId,
        slaActionId: record.slaActionId,
        title: record.title,
        reference: record.reference,
        activeForward: forward ? { id: forward.id, fromUserId: forward.fromUserId, toUserId: forward.toUserId, assumeDueAt: forward.assumeDueAt, timeoutAt: forward.timeoutAt, state: "ACTIVE" } : null,
        escalatedLevels: state.events.filter((e) => e.caseId === caseId && e.actionType === "IMMEDIATE_ESCALATION").map((e) => e.toLevel).filter(Boolean),
      };
      const alertRecipientUserIds = Array.from(new Set([...state.outbox.filter((o) => o.caseId === caseId).map((o) => o.recipientUserId), record.currentResponsibleUserId ?? ""].filter(Boolean)));
      return { snapshot, record: { ...record }, alertRecipientUserIds };
    },

    // Modelo da RPC record_risk_alert_action: chave de evento única (replay lança),
    // token de ação de uso único/expirável, atualização de caso + ação SLA + outbox.
    async applyTransition(caseId, transition, actorUserId, options = {}) {
      const record = state.cases.get(caseId);
      if (!record) throw new Error("Alerta não encontrado.");
      if (record.state !== transition.expectedState) throw new Error(`Estado mudou (${record.state} != ${transition.expectedState}).`);
      for (const e of transition.events) {
        if (state.events.some((x) => x.idempotencyKey === e.idempotencyKey)) throw new Error("duplicate key value violates unique constraint (evento já registrado)");
      }
      if (options.actionLinkTokenHash) {
        const link = state.actionLinks.find((l) => l.tokenHash === options.actionLinkTokenHash && l.caseId === caseId);
        if (!link || link.usedAt || link.expiresAt <= clockIso) throw new Error("Link de ação inválido, expirado ou já utilizado.");
        link.usedAt = clockIso;
      }
      for (const e of transition.events) state.events.push({ ...e, caseId, actorUserId: e.actorUserId ?? actorUserId ?? null, at: clockIso });
      const cu = transition.caseUpdate;
      record.state = cu.state;
      if (cu.currentLevel) record.currentLevel = cu.currentLevel;
      if (cu.currentResponsibleUserId !== undefined) record.currentResponsibleUserId = cu.currentResponsibleUserId;
      if (cu.previousResponsibleUserId !== undefined) record.previousResponsibleUserId = cu.previousResponsibleUserId;
      if (cu.topLevelReached && !record.topLevelReachedAt) record.topLevelReachedAt = clockIso;
      const action = record.slaActionId ? state.actions.get(record.slaActionId) : null;
      if (action && actorUserId) {
        if (cu.slaActionStatus === "ACKNOWLEDGED" || cu.slaActionStatus === "IN_PROGRESS") {
          action.status = cu.slaActionStatus;
          action.acknowledgedAt ??= clockIso;
        } else if (cu.slaActionStatus === "COMPLETED") {
          Object.assign(action, { status: "COMPLETED", completedAt: clockIso });
          action.acknowledgedAt ??= clockIso;
        }
      }
      if (transition.escalation) {
        if (action) action.currentEscalationLevel = transition.escalation.toLevel;
        state.escalations.push({ slaActionId: record.slaActionId, from: transition.escalation.fromLevel, to: transition.escalation.toLevel, reason: transition.escalation.reason, at: clockIso, via: "ACTION" });
      }
      for (const o of transition.outbox) {
        if (outboxByKey(o.idempotencyKey)) continue; // unique(idempotency_key) + ignoreDuplicates
        state.outbox.push({
          id: uuid("b"),
          caseId,
          slaActionId: record.slaActionId,
          riskLevel: o.riskLevel,
          notificationType: o.notificationType,
          escalationLevel: o.escalationLevel,
          recipientUserId: o.recipientUserId,
          scheduledFor: clockIso,
          status: o.status,
          suppressionReason: o.suppressionReason,
          digestWindow: null,
          idempotencyKey: o.idempotencyKey,
          matrixRuleSnapshot: o.matrixRuleSnapshot,
          payloadSummary: o.payloadSummary,
          origin: o.origin,
          attemptCount: 0,
          deliveredTo: null,
          sentAt: null,
          provider: null,
          lastError: null,
        });
      }
      state.audit.push({ action: "RISK_ALERT_ACTION", entityType: "RISK_ALERT_CASE", entityId: caseId, detail: `Ação sobre alerta: ${transition.summary} (estado ${transition.expectedState} -> ${cu.state}).`, at: clockIso });
      return { state: cu.state, escalationId: transition.escalation ? `esc-${state.escalations.length}` : null };
    },

    async listActiveForwards() {
      return state.forwards.filter((f) => f.state === "ACTIVE");
    },
    async listPendingExpertConsultations() {
      return [];
    },
    async recordExpertAnswer() {},
    async createActionLinks(_projectId, caseId, recipientUserId, links) {
      for (const l of links) state.actionLinks.push({ caseId, recipientUserId, action: l.action, tokenHash: l.tokenHash, expiresAt: l.expiresAt, usedAt: null });
    },
  };
  return store;
}
