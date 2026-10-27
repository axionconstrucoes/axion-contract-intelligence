// Visão (somente leitura) dos registros de campo já gravados no servidor: mapeamento das linhas do
// banco para o formato usado pelo painel do ACC e pelo app de campo. Puro (sem rede/React).

import type { ActionStatus, FieldRecordKind, FieldRecordRisk } from "./types";

export interface FieldRecordRow {
  id: string;
  kind: FieldRecordKind;
  category: string;
  description: string;
  location: string;
  occurred_at: string;
  client_created_at: string;
  received_at: string;
  risk_level: FieldRecordRisk;
  responsible_user_id: string | null;
  due_date: string | null;
  reported_by_user_id: string;
  ssma_corrective_actions?: Array<{
    id: string;
    status: ActionStatus;
    due_date: string;
    concluded_at: string | null;
    responsible_user_id: string;
  }> | null;
  ssma_field_record_photos?: Array<{ id: string; purpose: "REGISTRO" | "EVIDENCIA_ACAO" }> | null;
}

export interface FieldRecordView {
  id: string;
  kind: FieldRecordKind;
  category: string;
  description: string;
  location: string;
  occurredAt: string;
  clientCreatedAt: string;
  receivedAt: string;
  risk: FieldRecordRisk;
  reportedById: string;
  reportedByName: string;
  responsibleId: string | null;
  responsibleName: string | null;
  dueDate: string | null;
  photoCount: number;
  evidenceCount: number;
  photos: Array<{ id: string; purpose: "REGISTRO" | "EVIDENCIA_ACAO" }>;
  action: { id: string; status: ActionStatus; dueDate: string; concludedAt: string | null } | null;
}

export function mapFieldRecordRow(row: FieldRecordRow, names: ReadonlyMap<string, string>): FieldRecordView {
  const action = row.ssma_corrective_actions?.[0] ?? null;
  const photos = row.ssma_field_record_photos ?? [];
  return {
    id: row.id,
    kind: row.kind,
    category: row.category,
    description: row.description,
    location: row.location,
    occurredAt: row.occurred_at,
    clientCreatedAt: row.client_created_at,
    receivedAt: row.received_at,
    risk: row.risk_level,
    reportedById: row.reported_by_user_id,
    reportedByName: names.get(row.reported_by_user_id) ?? "Usuário",
    responsibleId: row.responsible_user_id,
    responsibleName: row.responsible_user_id ? (names.get(row.responsible_user_id) ?? "Usuário") : null,
    dueDate: row.due_date,
    photoCount: photos.filter((photo) => photo.purpose === "REGISTRO").length,
    evidenceCount: photos.filter((photo) => photo.purpose === "EVIDENCIA_ACAO").length,
    photos: photos.map((photo) => ({ id: photo.id, purpose: photo.purpose })),
    action: action ? { id: action.id, status: action.status, dueDate: action.due_date, concludedAt: action.concluded_at } : null,
  };
}

/** Ação em atraso: prazo (AAAA-MM-DD) anterior a `today` (AAAA-MM-DD) e ainda não concluída. */
export function isActionOverdue(action: FieldRecordView["action"], today: string): boolean {
  return action !== null && action.status !== "CONCLUIDA" && action.dueDate < today;
}

export function summarizeFieldRecords(records: readonly FieldRecordView[], today: string) {
  const open = records.filter((record) => record.action && record.action.status !== "CONCLUIDA");
  return {
    total: records.length,
    openActions: open.length,
    overdueActions: open.filter((record) => isActionOverdue(record.action, today)).length,
    critical: records.filter((record) => record.risk === "CRITICA" && record.action?.status !== "CONCLUIDA").length,
    byRisk: { CRITICA: 0, ALTA: 0, MEDIA: 0, BAIXA: 0, ...Object.fromEntries(["CRITICA", "ALTA", "MEDIA", "BAIXA"].map((risk) => [risk, records.filter((record) => record.risk === risk).length])) } as Record<FieldRecordRisk, number>,
  };
}
