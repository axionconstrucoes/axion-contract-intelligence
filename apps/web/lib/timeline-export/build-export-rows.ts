// Constrói as linhas do índice estruturado (XLSX/CSV, seção 4) a partir
// de eventos já filtrados/ordenados. Cada campo é mapeado a partir de
// dado real já existente — quando não há fonte real no schema atual
// (ex.: sourceLanguage), o campo fica `null`, nunca inventado.

import type { ContractEvent } from "@axion/types";
import type {
  TimelineDocumentContext,
  TimelineEmailContext,
  TimelineEventNoteContext,
  TimelineExportRow,
} from "./types";

const SCOPE_CATEGORIES = ["ESCOPO", "ALTERACOES_PROJETO"];
const PRICE_CATEGORIES = ["CUSTO", "PAGAMENTOS", "MEDICOES"];
const SCHEDULE_CATEGORIES = ["PRAZO"];

export interface BuildExportRowsInput {
  events: ContractEvent[];
  emailsById: Map<string, TimelineEmailContext>;
  documentVersionsById: Map<string, TimelineDocumentContext>;
  eventNotesByEventId: Map<string, TimelineEventNoteContext[]>;
}

export function buildExportRows(input: BuildExportRowsInput): TimelineExportRow[] {
  const { events, emailsById, documentVersionsById, eventNotesByEventId } = input;

  return events.map((event, index) => {
    const firstEvidence = event.evidence[0];
    const firstEmail = event.evidence.map((e) => e.emailId).find(Boolean);
    const email = firstEmail ? emailsById.get(firstEmail) : undefined;

    const firstDocumentVersionId = event.evidence.map((e) => e.documentVersionId).find(Boolean);
    const documentContext = firstDocumentVersionId ? documentVersionsById.get(firstDocumentVersionId) : undefined;

    const contractCrossRef = event.crossReferences.find((c) => c.kind === "CONTRATO_ADITIVO");
    const clauseCrossRef = event.crossReferences.find((c) => c.refType === "CLAUSE");

    const notes = eventNotesByEventId.get(event.id) ?? [];

    const recipients = email
      ? email.to
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean)
          .join("; ")
      : null;

    const participants = email
      ? Array.from(new Set([email.from, ...email.to.split(",").map((a) => a.trim())].filter(Boolean))).join("; ")
      : null;

    return {
      sequence: index + 1,
      eventDate: event.timestamp,
      eventType: event.sourceType,
      title: event.title,
      summary: event.description,
      sourceType: event.sourceType,
      sourceName: email?.subject ?? firstEvidence?.label ?? null,
      sender: email?.from ?? null,
      recipients,
      participants,
      contractReference: contractCrossRef?.note ?? null,
      clauseReference: clauseCrossRef?.note ?? null,
      scopeImpact: event.categories.some((c) => SCOPE_CATEGORIES.includes(c)),
      priceImpact: event.categories.some((c) => PRICE_CATEGORIES.includes(c)),
      scheduleImpact: event.categories.some((c) => SCHEDULE_CATEGORIES.includes(c)),
      evidenceCount: event.evidence.length,
      sourceReference: firstEvidence?.locator ?? null,
      eventId: event.id,
      documentOrEmailId: firstDocumentVersionId ?? firstEmail ?? null,
      originalFilename: documentContext?.originalFileName ?? null,
      sourceLanguage: null,
      notes: notes.length > 0 ? notes.map((n) => `[${n.category}] ${n.text}`).join(" | ") : null,
      reviewStatus: event.status,
    } satisfies TimelineExportRow;
  });
}
