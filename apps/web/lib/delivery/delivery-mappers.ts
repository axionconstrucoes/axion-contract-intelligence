// Puro — mapeia linhas de project_delivery_items para o modelo de domínio.
import type { AlertSeverity } from "@axion/types";

import type { DeliveryItem, DeliveryPhase, DeliveryStatus, DependencyKind } from "./delivery-items";

export interface DeliveryItemRow {
  id: string;
  title: string;
  phase: DeliveryPhase;
  checklist_key: string | null;
  deadline: string | null;
  internal_deadline: string | null;
  responsible_user_id: string | null;
  dependency_kind: DependencyKind | null;
  dependency_name: string | null;
  status: DeliveryStatus;
  risk: AlertSeverity | null;
  evidence: string | null;
  justification: string | null;
  blocks_delivery: boolean;
  applicability_confirmed: boolean;
  cno_number: string | null;
}

export const DELIVERY_ITEM_COLUMNS =
  "id,title,phase,checklist_key,deadline,internal_deadline,responsible_user_id,dependency_kind,dependency_name,status,risk,evidence,justification,blocks_delivery,applicability_confirmed,cno_number";

const day = (value: string | null): string | null => (value ? String(value).slice(0, 10) : null);

export function toDeliveryItem(row: DeliveryItemRow): DeliveryItem {
  return {
    id: row.id,
    title: row.title,
    phase: row.phase,
    checklistKey: row.checklist_key,
    deadline: day(row.deadline),
    internalDeadline: day(row.internal_deadline),
    responsibleUserId: row.responsible_user_id,
    dependencyKind: row.dependency_kind,
    dependencyName: row.dependency_name,
    status: row.status,
    risk: row.risk,
    evidence: row.evidence,
    justification: row.justification,
    blocksDelivery: row.blocks_delivery,
    applicabilityConfirmed: row.applicability_confirmed,
    cnoNumber: row.cno_number,
  };
}
