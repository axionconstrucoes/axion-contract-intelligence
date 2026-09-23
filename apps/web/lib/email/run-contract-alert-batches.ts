import "server-only";

import { createSupabaseAdminClient } from "@axion/db/admin";

import { getAppBaseUrl } from "../app-base-url";
import { createAndSendContractAlertBatch, type ContractAlertBatchSourceItem } from "./create-and-send-contract-alert-batch";

type SlaActionRow = {
  id: string;
  project_id: string;
  responsible_user_id: string;
  title: string;
  description: string;
  risk_level: "LOW" | "MEDIUM";
  related_event_id: string;
};

type EventRow = {
  id: string;
  project_id: string;
  title: string;
  description: string;
};

type AssessmentRow = {
  event_id: string;
  severity: "BAIXA" | "MEDIA" | "ALTA" | "CRITICA";
  summary: string;
};

type EvidenceRow = {
  event_id: string;
  source_type: string;
  label: string;
};

type ExistingBatchItemRow = {
  event_id: string;
  batch_id: string;
};

type ExistingBatchRow = {
  id: string;
  status: "PENDING" | "SENT" | "RESPONDED" | "FAILED";
};

type ProjectConfigRow = {
  project_id: string;
  pilot_delivery_override_email: string | null;
};

const SLA_TO_ALERT_SEVERITY = {
  LOW: "BAIXA",
  MEDIUM: "MEDIA",
} as const;

function groupKey(projectId: string, responsibleUserId: string): string {
  return `${projectId}:${responsibleUserId}`;
}

export interface ContractAlertBatchRunResult {
  groupsFound: number;
  groupsSent: number;
  groupsSkipped: number;
  groupsFailed: number;
  eventsEligible: number;
  eventsSkippedAsAlreadyBatched: number;
}

export async function runContractAlertBatches(): Promise<ContractAlertBatchRunResult> {
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("sla_actions")
    .select("id,project_id,responsible_user_id,title,description,risk_level,related_event_id")
    .in("risk_level", ["LOW", "MEDIUM"])
    .not("responsible_user_id", "is", null)
    .not("related_event_id", "is", null)
    .not("status", "in", "(COMPLETED,CANCELLED)")
    .order("risk_level", { ascending: false })
    .order("title", { ascending: true });

  if (error) throw new Error(`Falha ao carregar ações elegíveis para lotes de contrato: ${error.message}`);

  const actions = (data ?? []) as unknown as SlaActionRow[];
  const eventIds = Array.from(new Set(actions.map((action) => action.related_event_id)));

  const blockedEventIds = new Set<string>();
  if (eventIds.length > 0) {
    const { data: existingItems, error: existingItemsError } = await admin
      .from("contract_alert_batch_items")
      .select("event_id,batch_id")
      .in("event_id", eventIds);

    if (existingItemsError) {
      throw new Error(`Falha ao verificar eventos já incluídos em lotes: ${existingItemsError.message}`);
    }

    const itemRows = (existingItems ?? []) as ExistingBatchItemRow[];
    const batchIds = Array.from(new Set(itemRows.map((row) => row.batch_id)));

    if (batchIds.length > 0) {
      const { data: existingBatches, error: existingBatchesError } = await admin
        .from("contract_alert_batches")
        .select("id,status")
        .in("id", batchIds)
        .in("status", ["PENDING", "SENT", "RESPONDED"]);

      if (existingBatchesError) {
        throw new Error(`Falha ao verificar estado dos lotes existentes: ${existingBatchesError.message}`);
      }

      const activeBatchIds = new Set(((existingBatches ?? []) as ExistingBatchRow[]).map((row) => row.id));
      for (const row of itemRows) {
        if (activeBatchIds.has(row.batch_id)) blockedEventIds.add(row.event_id);
      }
    }
  }

  const eligibleActions = actions.filter((action) => !blockedEventIds.has(action.related_event_id));

  // Um evento pode, por configuração ou legado, ter mais de uma ação SLA.
  // O lote contém o evento uma única vez. Em caso de duplicidade, preserva
  // o maior risco operacional (MEDIUM > LOW).
  const actionByEventId = new Map<string, SlaActionRow>();
  for (const action of eligibleActions) {
    const current = actionByEventId.get(action.related_event_id);
    if (!current || (current.risk_level === "LOW" && action.risk_level === "MEDIUM")) {
      actionByEventId.set(action.related_event_id, action);
    }
  }

  const dedupedActions = Array.from(actionByEventId.values());
  const eligibleEventIds = dedupedActions.map((action) => action.related_event_id);

  const [{ data: events, error: eventsError }, { data: assessments, error: assessmentsError }, { data: evidence, error: evidenceError }] =
    eligibleEventIds.length > 0
      ? await Promise.all([
          admin
            .from("contract_events")
            .select("id,project_id,title,description")
            .in("id", eligibleEventIds),
          admin
            .from("event_ai_assessments")
            .select("event_id,severity,summary")
            .in("event_id", eligibleEventIds),
          admin
            .from("event_evidence")
            .select("event_id,source_type,label")
            .in("event_id", eligibleEventIds),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
        ];

  if (eventsError) throw new Error(`Falha ao carregar eventos dos lotes: ${eventsError.message}`);
  if (assessmentsError) throw new Error(`Falha ao carregar avaliações de risco dos eventos: ${assessmentsError.message}`);
  if (evidenceError) throw new Error(`Falha ao carregar evidências dos eventos: ${evidenceError.message}`);

  const eventById = new Map(((events ?? []) as EventRow[]).map((row) => [row.id, row]));
  const assessmentByEventId = new Map(((assessments ?? []) as AssessmentRow[]).map((row) => [row.event_id, row]));
  const evidenceByEventId = new Map<string, EvidenceRow[]>();
  for (const row of (evidence ?? []) as EvidenceRow[]) {
    evidenceByEventId.set(row.event_id, [...(evidenceByEventId.get(row.event_id) ?? []), row]);
  }

  const projectIds = Array.from(new Set(dedupedActions.map((action) => action.project_id)));
  const { data: configRows, error: configError } = projectIds.length
    ? await admin
        .from("project_weekly_schedule_ingestion_configs")
        .select("project_id,pilot_delivery_override_email")
        .in("project_id", projectIds)
    : { data: [], error: null };

  if (configError) {
    throw new Error(`Falha ao carregar configuração de entrega dos lotes: ${configError.message}`);
  }

  const configByProjectId = new Map(
    ((configRows ?? []) as ProjectConfigRow[]).map((row) => [row.project_id, row])
  );

  const groups = new Map<string, SlaActionRow[]>();
  for (const action of dedupedActions) {
    const event = eventById.get(action.related_event_id);
    if (!event || event.project_id !== action.project_id) continue;

    const key = groupKey(action.project_id, action.responsible_user_id);
    groups.set(key, [...(groups.get(key) ?? []), action]);
  }

  const baseUrl = getAppBaseUrl();
  const result: ContractAlertBatchRunResult = {
    groupsFound: groups.size,
    groupsSent: 0,
    groupsSkipped: 0,
    groupsFailed: 0,
    eventsEligible: dedupedActions.length,
    eventsSkippedAsAlreadyBatched: blockedEventIds.size,
  };

  for (const groupActions of groups.values()) {
    const first = groupActions[0];
    if (!first) continue;

    const items: ContractAlertBatchSourceItem[] = groupActions
      .map((action) => {
        const event = eventById.get(action.related_event_id);
        if (!event) return null;

        const assessment = assessmentByEventId.get(event.id);
        const severity = assessment?.severity ?? SLA_TO_ALERT_SEVERITY[action.risk_level];
        const riskDescription =
          assessment?.summary?.trim() ||
          action.description?.trim() ||
          event.description?.trim() ||
          "Evento contratual com ação SLA aberta.";

        return {
          eventId: event.id,
          title: event.title,
          severity,
          riskDescription,
          clauseLabel: null,
          clauseText: null,
          evidence: (evidenceByEventId.get(event.id) ?? []).map(
            (row) => `${row.source_type}: ${row.label}`
          ),
          eventUrl: `${baseUrl}/${event.project_id}/ledger/${event.id}`,
        } satisfies ContractAlertBatchSourceItem;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => {
        const rank = { CRITICA: 0, ALTA: 1, MEDIA: 2, BAIXA: 3 } as const;
        return rank[a.severity] - rank[b.severity] || a.title.localeCompare(b.title, "pt-BR");
      });

    if (items.length === 0) {
      result.groupsSkipped += 1;
      continue;
    }

    try {
      await createAndSendContractAlertBatch({
        projectId: first.project_id,
        recipientUserId: first.responsible_user_id,
        deliveryEmail: configByProjectId.get(first.project_id)?.pilot_delivery_override_email ?? undefined,
        items,
      });
      result.groupsSent += 1;
    } catch {
      result.groupsFailed += 1;
    }
  }

  return result;
}
