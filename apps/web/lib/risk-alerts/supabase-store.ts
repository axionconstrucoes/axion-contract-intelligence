// Adaptador Supabase do motor de alertas de risco — usado pelo worker
// (service role; nunca por Server Action). Só lê as fontes do módulo
// semanal e a Matriz; escreve apenas em risk_alert_cases,
// risk_alert_outbox, sla_actions (criação SYSTEM), emails e
// audit_log_entries. Escalonamento via RPC escalate_sla_action_system.
// Recebe o client por parâmetro (mesmo padrão de
// schedule/weekly-ingestion/supabase-store.ts) — sem "server-only".

import type { SupabaseClient } from "@supabase/supabase-js";

import { ALERT_REPLY_MAILBOX_ENV, normalizeAlertReplyMailbox } from "@/lib/email/alert-reply-address";
import type { SlaArea, SlaAreaResponsibles, SlaMatrixRule, SlaProjectSettings } from "@/lib/sla/types";

import {
  collectComparisonCases,
  collectIngestionAlertCases,
  collectSheetCases,
  type ComparisonSourceRow,
  type IngestionAlertSourceRow,
  type SheetSourceRow,
} from "./collect-risk-cases";
import type { ActiveForward, AlertCaseSnapshot } from "./alert-state-machine";
import { hashReplyToken, type InboundHeaders } from "./replies/reply-pipeline";
import type { PersistedOutboxEntry, RiskAlertStore } from "./store";
import type { ExpertId, IngestionAlertSeverityMap, LinkedSlaActionState, RecipientProfile, RiskCaseRecord } from "./types";
import { MAX_SEND_ATTEMPTS } from "./types";

type Client = SupabaseClient;
type Row = Record<string, unknown>;

function s(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Erro sanitizado: nunca tokens, e-mails ou corpo; só a classe/mensagem curta. */
export function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>")
    .replace(/(bearer|token|secret|key)[^\s]*/gi, "<redacted>")
    .slice(0, 300);
}

export function createSupabaseRiskAlertStore(client: Client): RiskAlertStore {
  const fail = (context: string, error: { message: string } | null) => {
    if (error) throw new Error(`${context}: ${error.message}`);
  };

  return {
    async listEnabledProjectIds() {
      const { data, error } = await client
        .from("project_weekly_schedule_ingestion_configs")
        .select("project_id")
        .eq("enabled", true)
        .eq("risk_alerts_enabled", true);
      fail("Falha ao listar projetos com alertas", error);
      return (data ?? []).map((row) => row.project_id as string);
    },

    async loadProjectSnapshot(projectId) {
      const [{ data: project }, { data: config }, { data: rules }, { data: responsibles }, { data: settings }] = await Promise.all([
        client.from("projects").select("id,name").eq("id", projectId).maybeSingle(),
        client
          .from("project_weekly_schedule_ingestion_configs")
          .select("enabled,risk_alerts_enabled,pilot_recipient_allowlist_user_ids,sender_domain,risk_alert_severity_map,pilot_project_confirmed_at")
          .eq("project_id", projectId)
          .maybeSingle(),
        client.from("sla_matrix_rules").select("*").eq("project_id", projectId),
        client.from("sla_area_responsibles").select("*").eq("project_id", projectId),
        client.from("sla_project_settings").select("*").eq("project_id", projectId).maybeSingle(),
      ]);

      const [{ data: comparisons }, { data: sheets }, { data: alerts }, { data: intakes }, { data: workbooks }, { data: existing }] = await Promise.all([
        client
          .from("schedule_version_comparisons")
          .select("id,project_id,comparison_type,status,risk_classification,risk_reasons,metrics,computed_at,created_at,current_schedule_version_id")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(200),
        client
          .from("weekly_report_sheets")
          .select("id,project_id,workbook_id,category,status,risk_classification,risk_reasons,alerts,cutoff_date,created_at")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(300),
        client
          .from("weekly_schedule_ingestion_alerts")
          .select("id,project_id,kind,week_start,deadline_at,detail,resolved_at,created_at")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(200),
        client.from("weekly_schedule_email_intakes").select("email_id,document_version_id,work_week_label").eq("project_id", projectId).not("document_version_id", "is", null),
        client.from("weekly_report_workbooks").select("id,email_id,work_week_label").eq("project_id", projectId),
        client.from("risk_alert_cases").select("*").eq("project_id", projectId),
      ]);

      // schedule_version -> document_version -> intake (semana / e-mail de origem)
      const versionIds = Array.from(new Set((comparisons ?? []).map((row) => row.current_schedule_version_id as string)));
      const { data: versions } = versionIds.length
        ? await client.from("schedule_versions").select("id,document_version_id").in("id", versionIds)
        : { data: [] as Row[] };
      const intakeByDocVersion = new Map((intakes ?? []).map((row) => [row.document_version_id as string, row]));
      const versionMeta = new Map(
        (versions ?? []).map((row) => {
          const intake = intakeByDocVersion.get(row.document_version_id as string);
          return [row.id as string, { emailId: s(intake?.email_id), weekLabel: s(intake?.work_week_label) }];
        })
      );
      const workbookById = new Map((workbooks ?? []).map((row) => [row.id as string, row]));

      const comparisonRows: ComparisonSourceRow[] = (comparisons ?? []).map((row) => ({
        ...(row as unknown as ComparisonSourceRow),
        work_week_label: versionMeta.get(row.current_schedule_version_id as string)?.weekLabel ?? null,
        email_id: versionMeta.get(row.current_schedule_version_id as string)?.emailId ?? null,
      }));
      const sheetRows: SheetSourceRow[] = (sheets ?? []).map((row) => ({
        ...(row as unknown as SheetSourceRow),
        work_week_label: s(workbookById.get(row.workbook_id as string)?.work_week_label),
        email_id: s(workbookById.get(row.workbook_id as string)?.email_id),
      }));
      const alertRows = (alerts ?? []) as unknown as IngestionAlertSourceRow[];

      const existingCases: RiskCaseRecord[] = (existing ?? []).map((row) => ({
        id: row.id as string,
        sourceType: row.source_type as RiskCaseRecord["sourceType"],
        sourceId: row.source_id as string,
        area: row.area as SlaArea,
        riskLevel: row.risk_level as RiskCaseRecord["riskLevel"],
        previousRiskLevel: (row.previous_risk_level as RiskCaseRecord["previousRiskLevel"]) ?? null,
        fingerprint: row.fingerprint as string,
        status: row.status as "OPEN" | "CLOSED",
        slaActionId: s(row.sla_action_id),
        lastDigestWindow: s(row.last_digest_window),
        firstSeenAt: row.first_seen_at as string,
        lastChangedAt: row.last_changed_at as string,
        closedAt: s(row.closed_at),
        title: row.title as string,
        summary: (row.summary as string) ?? "",
        impact: (row.impact as string) ?? "",
        recommendation: s(row.recommendation),
        originPath: (row.origin_path as string) ?? "",
        reference: (row.reference as string) ?? "",
        state: row.state as RiskCaseRecord["state"],
        currentLevel: row.current_level as RiskCaseRecord["currentLevel"],
        currentResponsibleUserId: s(row.current_responsible_user_id),
        previousResponsibleUserId: s(row.previous_responsible_user_id),
        visibleCode: (row.visible_code as string) ?? "",
      }));

      const actionIds = existingCases.map((c) => c.slaActionId).filter((id): id is string => Boolean(id));
      const { data: actions } = actionIds.length
        ? await client
            .from("sla_actions")
            .select("id,status,current_escalation_level,assume_due_at,respond_due_at,complete_due_at,acknowledged_at,completed_at,contractual_deadline,responsible_user_id")
            .in("id", actionIds)
        : { data: [] as Row[] };
      const linkedActions = new Map<string, LinkedSlaActionState>(
        (actions ?? []).map((row) => [
          row.id as string,
          {
            id: row.id as string,
            status: row.status as LinkedSlaActionState["status"],
            currentEscalationLevel: row.current_escalation_level as LinkedSlaActionState["currentEscalationLevel"],
            assumeDueAt: row.assume_due_at as string,
            respondDueAt: s(row.respond_due_at),
            completeDueAt: s(row.complete_due_at),
            acknowledgedAt: s(row.acknowledged_at),
            completedAt: s(row.completed_at),
            contractualDeadline: s(row.contractual_deadline),
            responsibleUserId: s(row.responsible_user_id),
          },
        ])
      );

      // Destinatários potenciais: membros do projeto (status) + profile (e-mail).
      const { data: memberships } = await client.from("project_memberships").select("user_id,status").eq("project_id", projectId);
      const memberIds = (memberships ?? []).map((row) => row.user_id as string);
      const { data: profiles } = memberIds.length ? await client.from("profiles").select("id,name,email").in("id", memberIds) : { data: [] as Row[] };
      const profileById = new Map((profiles ?? []).map((row) => [row.id as string, row]));
      const recipients = new Map<string, RecipientProfile>(
        (memberships ?? []).map((row) => {
          const profile = profileById.get(row.user_id as string);
          return [
            row.user_id as string,
            { userId: row.user_id as string, name: s(profile?.name), email: s(profile?.email), membershipStatus: (row.status as string) ?? null },
          ];
        })
      );

      // PENDING (falha transitória em ciclo anterior) NÃO entra aqui: o
      // planejador recria a mesma chave e o envio é retentado (attempt_count
      // limita as tentativas). SENT/FAILED/SUPPRESSED/SKIPPED nunca repetem.
      const { data: keys } = await client.from("risk_alert_outbox").select("idempotency_key").eq("project_id", projectId).neq("status", "PENDING");
      const { data: lastDigest } = await client
        .from("risk_alert_outbox")
        .select("sent_at")
        .eq("project_id", projectId)
        .eq("notification_type", "DIGEST")
        .eq("status", "SENT")
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const mapRule = (row: Row): SlaMatrixRule => ({
        id: row.id as string,
        projectId: row.project_id as string,
        riskLevel: row.risk_level as SlaMatrixRule["riskLevel"],
        area: (row.area as SlaArea | null) ?? null,
        timeUnit: row.time_unit as SlaMatrixRule["timeUnit"],
        assumeDeadlineValue: Number(row.assume_deadline_value),
        respondDeadlineValue: row.respond_deadline_value === null ? null : Number(row.respond_deadline_value),
        completeDeadlineValue: row.complete_deadline_value === null ? null : Number(row.complete_deadline_value),
        escalation2AfterValue: Number(row.escalation_2_after_value),
        boardAfterValue: Number(row.board_after_value),
        notifyByEmail: Boolean(row.notify_by_email),
        requiresAcknowledgmentConfirmation: Boolean(row.requires_acknowledgment_confirmation),
        requiresDelayJustification: Boolean(row.requires_delay_justification),
        isDefault: Boolean(row.is_default),
        active: Boolean(row.active),
      });
      const mapResponsibles = (row: Row): SlaAreaResponsibles => ({
        id: row.id as string,
        projectId: row.project_id as string,
        area: row.area as SlaArea,
        responsibleDirectUserId: s(row.responsible_direct_user_id),
        responsibleDirectInvitationId: s(row.responsible_direct_invitation_id),
        responsibleDirectName: null,
        secondaryResponsibleUserId: s(row.secondary_responsible_user_id),
        secondaryResponsibleInvitationId: s(row.secondary_responsible_invitation_id),
        secondaryResponsibleName: null,
        escalation1UserId: s(row.escalation_1_user_id),
        escalation1InvitationId: s(row.escalation_1_invitation_id),
        escalation1Name: null,
        escalation2UserId: s(row.escalation_2_user_id),
        escalation2Name: null,
        boardUserId: s(row.board_user_id),
        boardInvitationId: s(row.board_invitation_id),
        boardName: null,
        updatedAt: (row.updated_at as string) ?? "",
      });
      const mapSettings = (row: Row | null): SlaProjectSettings | null =>
        row
          ? {
              projectId: row.project_id as string,
              timezone: row.timezone as string,
              businessDayStartHour: Number(row.business_day_start_hour),
              businessDayEndHour: Number(row.business_day_end_hour),
              updatedAt: (row.updated_at as string) ?? "",
            }
          : null;

      return {
        projectId,
        projectName: (project?.name as string) ?? projectId,
        config: config
          ? {
              enabled: Boolean(config.enabled),
              riskAlertsEnabled: Boolean(config.risk_alerts_enabled),
              pilotRecipientAllowlistUserIds: (config.pilot_recipient_allowlist_user_ids as string[] | null) ?? null,
              senderDomain: s(config.sender_domain),
              severityMap: (config.risk_alert_severity_map as IngestionAlertSeverityMap | null) ?? null,
              pilotProjectConfirmedAt: s(config.pilot_project_confirmed_at),
            }
          : null,
        matrixRules: (rules ?? []).map((row) => mapRule(row as Row)),
        areaResponsibles: (responsibles ?? []).map((row) => mapResponsibles(row as Row)),
        settings: mapSettings((settings as Row | null) ?? null),
        cases: [...collectComparisonCases(comparisonRows), ...collectSheetCases(sheetRows), ...collectIngestionAlertCases(alertRows, (config?.risk_alert_severity_map as IngestionAlertSeverityMap | null) ?? null)],
        existingCases,
        linkedActions,
        recipients,
        existingIdempotencyKeys: new Set((keys ?? []).map((row) => row.idempotency_key as string)),
        previousDigestSentAt: s(lastDigest?.sent_at),
        senderMailbox: process.env.GOOGLE_GMAIL_SENDER_EMAIL?.trim() || null,
        replyMailbox: normalizeAlertReplyMailbox(process.env[ALERT_REPLY_MAILBOX_ENV]),
      };
    },

    async upsertCases(projectId, upserts) {
      const ids = new Map<string, string>();
      for (const item of upserts) {
        const closed = item.input.closed;
        const base = {
          project_id: projectId,
          source_type: item.input.sourceType,
          source_id: item.input.sourceId,
          area: item.input.area,
          risk_level: item.input.riskLevel,
          title: item.input.title,
          summary: item.input.summary,
          impact: item.input.impact,
          recommendation: item.input.recommendation,
          fingerprint: item.input.fingerprint,
          origin_path: item.input.originPath,
          reference: item.input.reference,
          status: closed ? "CLOSED" : "OPEN",
          closed_at: closed ? item.now : null,
          matrix_policy_status: item.policyStatus,
          matrix_policy_missing: item.policyMissing,
        };
        if (item.existingId) {
          const patch: Row = { ...base };
          if (item.change === "UNCHANGED") {
            // Só o status de política pode mudar sem alterar o risco.
            const { error } = await client
              .from("risk_alert_cases")
              .update({ matrix_policy_status: item.policyStatus, matrix_policy_missing: item.policyMissing })
              .eq("id", item.existingId);
            fail("Falha ao atualizar caso", error);
          } else {
            patch.previous_risk_level = item.previousRiskLevel;
            patch.last_changed_at = item.now;
            if (item.change === "CLOSED") patch.closed_at = item.now;
            if (item.change === "REOPENED") patch.closed_at = null;
            const { error } = await client.from("risk_alert_cases").update(patch).eq("id", item.existingId);
            fail("Falha ao atualizar caso", error);
          }
          ids.set(item.caseKey, item.existingId);
        } else {
          const { data, error } = await client
            .from("risk_alert_cases")
            .insert({ ...base, first_seen_at: item.now, last_changed_at: item.now })
            .select("id")
            .single();
          fail("Falha ao criar caso", error);
          ids.set(item.caseKey, data!.id as string);
        }
      }
      return ids;
    },

    async createSlaActions(projectId, creates, caseIds) {
      const created = new Map<string, string>();
      for (const item of creates) {
        const { data, error } = await client
          .from("sla_actions")
          .insert({
            project_id: projectId,
            origin: "OTHER",
            title: item.title.slice(0, 200),
            description: item.description,
            risk_level: item.riskLevel,
            area: item.area,
            responsible_user_id: item.responsibleUserId,
            assume_due_at: item.assumeDueAt,
            respond_due_at: item.respondDueAt,
            complete_due_at: item.completeDueAt,
            created_by_type: "SYSTEM",
            created_by_user_id: null,
          })
          .select("id")
          .single();
        fail("Falha ao criar ação SLA do alerta", error);
        const actionId = data!.id as string;
        created.set(item.caseKey, actionId);
        const caseId = caseIds.get(item.caseKey);
        if (caseId) {
          const { error: linkError } = await client
            .from("risk_alert_cases")
            .update({ sla_action_id: actionId, current_responsible_user_id: item.responsibleUserId })
            .eq("id", caseId);
          fail("Falha ao vincular ação ao caso", linkError);
        }
      }
      return created;
    },

    async applyEscalations(_projectId, escalations) {
      let applied = 0;
      let skipped = 0;
      for (const escalation of escalations) {
        const { error } = await client.rpc("escalate_sla_action_system", {
          p_action_id: escalation.slaActionId,
          p_expected_current_level: escalation.expectedCurrentLevel,
          p_new_level: escalation.newLevel,
          p_reason: escalation.reason,
        });
        // Concorrência (nível já mudou) não interrompe o ciclo.
        if (error) skipped += 1;
        else applied += 1;
      }
      return { applied, skipped };
    },

    async enqueue(projectId, entries, caseIds, slaActionIds) {
      const persisted: PersistedOutboxEntry[] = [];
      for (const entry of entries) {
        const caseId = entry.caseKey ? (caseIds.get(entry.caseKey) ?? null) : null;
        const slaActionId = entry.slaActionId ?? (entry.caseKey ? (slaActionIds.get(entry.caseKey) ?? null) : null);
        const { error } = await client
          .from("risk_alert_outbox")
          .upsert(
            {
              project_id: projectId,
              case_id: caseId,
              sla_action_id: slaActionId,
              risk_level: entry.riskLevel,
              notification_type: entry.notificationType,
              escalation_level: entry.escalationLevel,
              recipient_user_id: entry.recipient.userId,
              scheduled_for: entry.scheduledFor,
              status: entry.recipient.status,
              suppression_reason: entry.recipient.suppressionReason,
              digest_window: entry.digestWindow,
              idempotency_key: entry.idempotencyKey,
              matrix_rule_snapshot: entry.matrixRuleSnapshot,
              payload_summary: entry.payloadSummary,
            },
            { onConflict: "idempotency_key", ignoreDuplicates: true }
          );
        fail("Falha ao gravar outbox", error);
        // Relê pela chave: cobre tanto a linha recém-criada quanto uma PENDING
        // de ciclo anterior (retry), preservando attempt_count.
        const { data: row, error: readError } = await client
          .from("risk_alert_outbox")
          .select("id,status,attempt_count,case_id")
          .eq("idempotency_key", entry.idempotencyKey)
          .maybeSingle();
        fail("Falha ao reler outbox", readError);
        if (row?.id && row.status === "PENDING" && Number(row.attempt_count ?? 0) < MAX_SEND_ATTEMPTS) {
          persisted.push({ id: row.id as string, entry: { ...entry, slaActionId }, caseId: s(row.case_id) ?? caseId });
        }
      }
      return persisted;
    },

    async listPendingRows(projectId) {
      const { data, error } = await client
        .from("risk_alert_outbox")
        .select("id,case_id,sla_action_id,risk_level,notification_type,escalation_level,recipient_user_id,idempotency_key,payload_summary,origin,attempt_count")
        .eq("project_id", projectId)
        .eq("status", "PENDING")
        .lt("attempt_count", MAX_SEND_ATTEMPTS)
        .order("scheduled_for", { ascending: true });
      fail("Falha ao listar outbox pendente", error);
      return (data ?? []).map((row) => ({
        id: row.id as string,
        caseId: s(row.case_id),
        slaActionId: s(row.sla_action_id),
        notificationType: row.notification_type as string,
        escalationLevel: s(row.escalation_level),
        riskLevel: row.risk_level as string,
        recipientUserId: row.recipient_user_id as string,
        idempotencyKey: row.idempotency_key as string,
        payloadSummary: (row.payload_summary as Record<string, unknown>) ?? {},
        origin: (row.origin as string) ?? "AUTOMATIC",
        attemptCount: Number(row.attempt_count ?? 0),
      }));
    },

    async loadCaseRecord(caseId) {
      const { data, error } = await client.from("risk_alert_cases").select("*").eq("id", caseId).maybeSingle();
      fail("Falha ao carregar caso", error);
      return data ? mapCaseRow(data as Row) : null;
    },

    async markSent(id, result) {
      const { error } = await client
        .from("risk_alert_outbox")
        .update({
          status: "SENT",
          sent_at: result.sentAt,
          recipient_email: result.recipientEmail,
          provider: result.provider,
          provider_message_id: result.providerMessageId,
          email_id: result.emailId,
          message_id_header: result.messageIdHeader,
          conversation_id: result.conversationId,
          last_error: null,
        })
        .eq("id", id);
      fail("Falha ao marcar envio", error);
    },

    async markFailed(id, sanitizedError) {
      const { data } = await client.from("risk_alert_outbox").select("attempt_count").eq("id", id).maybeSingle();
      const attempts = Number(data?.attempt_count ?? 0) + 1;
      const { error } = await client
        .from("risk_alert_outbox")
        .update({ status: attempts >= MAX_SEND_ATTEMPTS ? "FAILED" : "PENDING", attempt_count: attempts, last_error: sanitizedError })
        .eq("id", id);
      fail("Falha ao registrar erro de envio", error);
    },

    async markSkipped(id, reason) {
      const { error } = await client.from("risk_alert_outbox").update({ status: "SKIPPED", last_error: reason }).eq("id", id);
      fail("Falha ao marcar outbox como ignorada", error);
    },

    async markDigestWindow(caseIds, window) {
      if (caseIds.length === 0) return;
      const { error } = await client.from("risk_alert_cases").update({ last_digest_window: window }).in("id", caseIds);
      fail("Falha ao marcar janela do consolidado", error);
    },

    async recordEmail(projectId, input) {
      const { data, error } = await client
        .from("emails")
        .insert({ project_id: projectId, from_address: input.from, to_address: input.to, subject: input.subject, sent_at: input.sentAt, snippet: input.snippet.slice(0, 280) })
        .select("id")
        .single();
      if (error) return null;
      return (data?.id as string) ?? null;
    },

    async audit(projectId, events) {
      if (events.length === 0) return;
      const { error } = await client.from("audit_log_entries").insert(
        events.map((event) => ({
          project_id: projectId,
          actor_type: "SYSTEM",
          actor_user_id: null,
          actor_label: null,
          action: event.action,
          entity_type: event.entityType,
          entity_id: event.entityId,
          detail: event.detail,
        }))
      );
      fail("Falha ao registrar auditoria", error);
    },

    // ---------------- conversa / mensagens ----------------
    async ensureConversation(projectId, caseId) {
      const { data: existing } = await client.from("alert_email_conversations").select("id,root_message_id_header,provider_thread_id,reply_token_hash").eq("case_id", caseId).maybeSingle();
      if (existing) {
        return { id: existing.id as string, rootMessageIdHeader: s(existing.root_message_id_header), providerThreadId: s(existing.provider_thread_id), replyTokenHash: s(existing.reply_token_hash) };
      }
      // O token da conversa nunca é persistido — só o hash (por mensagem há outro).
      const tokenHash = hashReplyToken(crypto.randomUUID());
      const { data, error } = await client
        .from("alert_email_conversations")
        .insert({ project_id: projectId, case_id: caseId, reply_token_hash: tokenHash })
        .select("id")
        .single();
      fail("Falha ao criar conversa do alerta", error);
      return { id: data!.id as string, rootMessageIdHeader: null, providerThreadId: null, replyTokenHash: tokenHash };
    },

    async setConversationRoot(conversationId, rootMessageIdHeader, providerThreadId) {
      const { error } = await client
        .from("alert_email_conversations")
        .update({ root_message_id_header: rootMessageIdHeader, provider_thread_id: providerThreadId })
        .eq("id", conversationId)
        .is("root_message_id_header", null);
      fail("Falha ao registrar raiz da conversa", error);
    },

    async recordOutboundMessage(record) {
      const { error } = await client.from("alert_email_messages").insert({
        project_id: record.projectId,
        case_id: record.caseId,
        conversation_id: record.conversationId,
        outbox_id: record.outboxId,
        direction: "OUTBOUND",
        provider: record.provider,
        provider_message_id: record.providerMessageId,
        provider_thread_id: record.providerThreadId,
        message_id_header: record.messageIdHeader,
        in_reply_to_header: record.inReplyTo,
        references_header: record.references.join(" "),
        reply_token_hash: record.replyTokenHash,
        recipients: record.recipients,
        subject: record.subject,
        status: "SENT",
        sent_at: record.sentAt,
      });
      fail("Falha ao registrar mensagem enviada", error);
    },

    async loadCorrelationIndex(projectId) {
      const [{ data: messages }, { data: conversations }, { data: cases }] = await Promise.all([
        client.from("alert_email_messages").select("case_id,message_id_header,reply_token_hash,direction,provider_message_id").eq("project_id", projectId),
        client.from("alert_email_conversations").select("case_id,reply_token_hash").eq("project_id", projectId),
        client.from("risk_alert_cases").select("id,visible_code").eq("project_id", projectId),
      ]);
      const byMessageId = new Map<string, string>();
      const byReplyTokenHash = new Map<string, string>();
      const seenMessageIds = new Set<string>();
      for (const row of messages ?? []) {
        if (row.message_id_header && row.case_id) byMessageId.set(row.message_id_header as string, row.case_id as string);
        if (row.message_id_header) seenMessageIds.add(row.message_id_header as string);
        if (row.reply_token_hash && row.case_id) byReplyTokenHash.set(row.reply_token_hash as string, row.case_id as string);
      }
      for (const row of conversations ?? []) if (row.reply_token_hash) byReplyTokenHash.set(row.reply_token_hash as string, row.case_id as string);
      const byVisibleCode = new Map((cases ?? []).map((row) => [row.visible_code as string, row.id as string]));
      return { byMessageId, byReplyTokenHash, byVisibleCode, seenMessageIds };
    },

    async listInboundToProcess(projectId) {
      const { data, error } = await client
        .from("alert_email_messages")
        .select("id,project_id,provider_message_id,message_id_header,in_reply_to_header,references_header,reply_to_header,sender_email,recipients,subject,body_original,auto_submitted,authentication_results,received_at")
        .eq("project_id", projectId)
        .eq("direction", "INBOUND")
        .eq("status", "RECEIVED")
        .order("received_at", { ascending: true })
        .limit(100);
      fail("Falha ao listar respostas recebidas", error);
      return (data ?? []).map((row) => ({
        id: row.id as string,
        projectId: row.project_id as string,
        providerMessageId: row.provider_message_id as string,
        headers: {
          from: (row.sender_email as string) ?? "",
          to: (row.recipients as string[]) ?? [],
          messageId: s(row.message_id_header),
          inReplyTo: s(row.in_reply_to_header),
          references: ((row.references_header as string | null) ?? "").split(/\s+/).filter(Boolean),
          replyTo: s(row.reply_to_header),
          autoSubmitted: row.auto_submitted ? "auto-replied" : null,
          authenticationResults: s(row.authentication_results),
          subject: s(row.subject),
        } as InboundHeaders,
        bodyOriginal: (row.body_original as string) ?? "",
        receivedAt: (row.received_at as string) ?? new Date().toISOString(),
      }));
    },

    async updateInboundMessage(id, patch) {
      const { error } = await client
        .from("alert_email_messages")
        .update({
          case_id: patch.caseId,
          conversation_id: patch.conversationId,
          sender_user_id: patch.senderUserId,
          body_clean: patch.bodyClean,
          quoted_text: patch.quotedText,
          signature_text: patch.signatureText,
          classification: patch.classification,
          confidence: patch.confidence,
          correlation_method: patch.correlationMethod,
          expert_id: patch.expertId,
          expert_routing: patch.expertRouting,
          requires_human_review: patch.requiresHumanReview ?? false,
          status: patch.status,
          status_reason: patch.statusReason ?? null,
          processed_at: new Date().toISOString(),
        })
        .eq("id", id);
      fail("Falha ao atualizar resposta", error);
    },

    // ---------------- ações / estados ----------------
    async loadCaseSnapshotForAction(caseId) {
      const { data: row, error } = await client.from("risk_alert_cases").select("*").eq("id", caseId).maybeSingle();
      fail("Falha ao carregar alerta", error);
      if (!row) return null;
      const record = mapCaseRow(row as Row);
      const [{ data: forward }, { data: events }, { data: outbox }] = await Promise.all([
        client.from("risk_alert_forward_assignments").select("id,from_user_id,to_user_id,assume_due_at,timeout_at,state").eq("case_id", caseId).eq("state", "ACTIVE").maybeSingle(),
        client.from("risk_alert_action_events").select("to_level").eq("case_id", caseId).eq("action_type", "IMMEDIATE_ESCALATION"),
        client.from("risk_alert_outbox").select("recipient_user_id").eq("case_id", caseId),
      ]);
      const snapshot: AlertCaseSnapshot = {
        id: record.id,
        projectId: row.project_id as string,
        sourceType: record.sourceType,
        sourceId: record.sourceId,
        riskLevel: (record.riskLevel === "REVIEW_REQUIRED" ? "MEDIUM" : record.riskLevel) as AlertCaseSnapshot["riskLevel"],
        state: record.state,
        currentLevel: record.currentLevel,
        topLevelReachedAt: s(row.top_level_reached_at),
        currentResponsibleUserId: record.currentResponsibleUserId,
        previousResponsibleUserId: record.previousResponsibleUserId,
        slaActionId: record.slaActionId,
        title: record.title,
        reference: record.reference,
        activeForward: forward
          ? { id: forward.id as string, fromUserId: forward.from_user_id as string, toUserId: forward.to_user_id as string, assumeDueAt: forward.assume_due_at as string, timeoutAt: forward.timeout_at as string, state: forward.state as ActiveForward["state"] }
          : null,
        escalatedLevels: (events ?? []).map((e) => e.to_level as AlertCaseSnapshot["currentLevel"]).filter(Boolean),
      };
      const alertRecipientUserIds = Array.from(new Set([...(outbox ?? []).map((o) => o.recipient_user_id as string), record.currentResponsibleUserId ?? ""].filter(Boolean)));
      return { snapshot, record, alertRecipientUserIds };
    },

    async applyTransition(caseId, transition, actorUserId, options = {}) {
      // A RPC revalida tudo: autor (auth.uid() ou, pelo worker, actorUserId
      // com membership ACTIVE), transição permitida, chaves prefixadas pelo
      // caso, destinatários, token de link (consumido) — nada aqui é confiado.
      const { data, error } = await client.rpc("record_risk_alert_action", {
        p_case_id: caseId,
        p_expected_state: transition.expectedState,
        p_transition: {
          actionType: transition.action,
          actorUserId: actorUserId ?? null,
          actionLinkTokenHash: options.actionLinkTokenHash ?? null,
          summary: transition.summary,
          events: transition.events.map((e) => ({ ...e, actorUserId: e.actorUserId ?? actorUserId ?? null })),
          caseUpdate: transition.caseUpdate,
          forward: transition.forward,
          closeActiveForwardAs: transition.closeActiveForwardAs,
          escalation: transition.escalation,
          outbox: transition.outbox,
        },
      });
      fail("Falha ao aplicar ação do alerta", error);
      const result = (data ?? {}) as { state?: string; escalationId?: string | null };
      return { state: result.state ?? transition.caseUpdate.state, escalationId: result.escalationId ?? null };
    },

    async listActiveForwards(projectId) {
      const { data, error } = await client.from("risk_alert_forward_assignments").select("id,case_id,from_user_id,to_user_id,assume_due_at,timeout_at,state").eq("project_id", projectId).eq("state", "ACTIVE");
      fail("Falha ao listar encaminhamentos", error);
      return (data ?? []).map((row) => ({ id: row.id as string, caseId: row.case_id as string, fromUserId: row.from_user_id as string, toUserId: row.to_user_id as string, assumeDueAt: row.assume_due_at as string, timeoutAt: row.timeout_at as string, state: "ACTIVE" as const }));
    },

    async listPendingExpertConsultations(projectId) {
      const { data, error } = await client
        .from("risk_alert_action_events")
        .select("id,case_id,expert_id,text_content,actor_user_id,created_at")
        .eq("project_id", projectId)
        .eq("action_type", "EXPERT_CONSULTATION")
        .order("created_at", { ascending: true });
      fail("Falha ao listar consultas a Expert", error);
      const pending = data ?? [];
      if (pending.length === 0) return [];
      const { data: answered } = await client.from("risk_alert_action_events").select("idempotency_key").eq("project_id", projectId).eq("action_type", "EXPERT_ANSWERED");
      const answeredFor = new Set((answered ?? []).map((row) => (row.idempotency_key as string).split(":ANSWER:")[0]));
      return pending
        .filter((row) => !answeredFor.has(row.id as string))
        .map((row) => ({ eventId: row.id as string, caseId: row.case_id as string, projectId, expertId: row.expert_id as ExpertId, question: (row.text_content as string) ?? "", askedByUserId: s(row.actor_user_id), createdAt: row.created_at as string }));
    },

    async recordExpertAnswer(input) {
      const { data: caseRow } = await client.from("risk_alert_cases").select("state").eq("id", input.caseId).maybeSingle();
      const fromState = (caseRow?.state as string) ?? "EXPERT_CONSULTATION_PENDING";
      const { error } = await client.from("risk_alert_action_events").insert({
        project_id: input.projectId,
        case_id: input.caseId,
        action_type: "EXPERT_ANSWERED",
        actor_type: "SYSTEM",
        actor_user_id: null,
        origin: "SYSTEM",
        from_state: fromState,
        to_state: fromState === "EXPERT_CONSULTATION_PENDING" ? "EXPERT_ANSWERED" : fromState,
        text_content: input.answerText,
        expert_id: input.expertId,
        idempotency_key: `${input.eventId}:ANSWER:${input.expertId}`,
      });
      fail("Falha ao registrar resposta do Expert", error);
      if (fromState === "EXPERT_CONSULTATION_PENDING") {
        await client.from("risk_alert_cases").update({ state: "EXPERT_ANSWERED" }).eq("id", input.caseId).eq("state", "EXPERT_CONSULTATION_PENDING");
      }
      await client.from("alert_email_messages").insert({
        project_id: input.projectId,
        case_id: input.caseId,
        direction: "OUTBOUND",
        provider: "EXPERT",
        provider_message_id: `expert:${input.eventId}:${input.expertId}`,
        body_clean: input.answerText,
        classification: null,
        confidence: input.confidence,
        expert_id: input.expertId,
        requires_human_review: input.requiresHumanReview,
        status: "PROCESSED",
        sent_at: new Date().toISOString(),
      });
    },

    async createActionLinks(projectId, caseId, recipientUserId, links) {
      if (links.length === 0) return;
      const { error } = await client.from("risk_alert_action_links").insert(
        links.map((link) => ({ project_id: projectId, case_id: caseId, recipient_user_id: recipientUserId, action_type: link.action, token_hash: link.tokenHash, expires_at: link.expiresAt }))
      );
      fail("Falha ao registrar links de ação", error);
    },
  };
}

function mapCaseRow(row: Row): RiskCaseRecord {
  const s2 = (value: unknown) => (typeof value === "string" ? value : null);
  return {
    id: row.id as string,
    sourceType: row.source_type as RiskCaseRecord["sourceType"],
    sourceId: row.source_id as string,
    area: row.area as SlaArea,
    riskLevel: row.risk_level as RiskCaseRecord["riskLevel"],
    previousRiskLevel: (row.previous_risk_level as RiskCaseRecord["previousRiskLevel"]) ?? null,
    fingerprint: row.fingerprint as string,
    status: row.status as "OPEN" | "CLOSED",
    slaActionId: s2(row.sla_action_id),
    lastDigestWindow: s2(row.last_digest_window),
    firstSeenAt: row.first_seen_at as string,
    lastChangedAt: row.last_changed_at as string,
    closedAt: s2(row.closed_at),
    title: row.title as string,
    summary: (row.summary as string) ?? "",
    impact: (row.impact as string) ?? "",
    recommendation: s2(row.recommendation),
    originPath: (row.origin_path as string) ?? "",
    reference: (row.reference as string) ?? "",
    state: row.state as RiskCaseRecord["state"],
    currentLevel: row.current_level as RiskCaseRecord["currentLevel"],
    currentResponsibleUserId: s2(row.current_responsible_user_id),
    previousResponsibleUserId: s2(row.previous_responsible_user_id),
    visibleCode: (row.visible_code as string) ?? "",
  };
}
