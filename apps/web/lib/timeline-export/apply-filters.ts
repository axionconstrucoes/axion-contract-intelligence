// Aplicação pura dos critérios de filtro do Timeline — a MESMA função é
// usada pela tela (para decidir o que mostrar) e pela exportação (para
// decidir exatamente o que exportar). Nunca existem dois caminhos de
// filtragem divergentes — isso é o que garante "nunca exportar
// silenciosamente itens fora do filtro".

import type { ContractEvent } from "@axion/types";
import type {
  TimelineDocumentContext,
  TimelineEmailContext,
  TimelineEventNoteContext,
  TimelineFilterCriteria,
} from "./types";

function normalizeTimelineSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

function buildTimelineSearchText(
  event: ContractEvent,
  emailsById: Map<string, TimelineEmailContext>,
  documentVersionsById: Map<string, TimelineDocumentContext>,
  eventNotesByEventId: Map<string, TimelineEventNoteContext[]>
): string {
  const parts: string[] = [
    event.title ?? "",
    event.description ?? "",
    event.sourceType ?? "",
  ];

  for (const evidence of event.evidence ?? []) {
    parts.push(
      evidence.label ?? "",
      evidence.locator ?? ""
    );

    if (evidence.emailId) {
      const email = emailsById.get(evidence.emailId);

      if (email) {
        parts.push(
          email.subject ?? "",
          email.snippet ?? "",
          email.from ?? "",
          email.to ?? ""
        );
      }
    }

    if (evidence.documentVersionId) {
      const document = documentVersionsById.get(
        evidence.documentVersionId
      );

      if (document) {
        parts.push(
          document.documentTitle ?? "",
          document.originalFileName ?? ""
        );
      }
    }
  }

  for (const note of eventNotesByEventId.get(event.id) ?? []) {
    parts.push(
      note.text ?? "",
      note.category ?? "",
      note.authorName ?? ""
    );
  }

  return normalizeTimelineSearchText(parts.join(" "));
}

function eventEmailAddresses(
  event: ContractEvent,
  emailsById: Map<string, TimelineEmailContext>
): string[] {
  const addresses: string[] = [];
  for (const evidence of event.evidence) {
    if (!evidence.emailId) continue;
    const email = emailsById.get(evidence.emailId);
    if (!email) continue;
    addresses.push(email.from, ...email.to.split(",").map((a) => a.trim()));
  }
  return addresses;
}

function isWithinDateRange(timestamp: string, dateFrom: string | null, dateTo: string | null): boolean {
  const eventDate = timestamp.slice(0, 10); // yyyy-mm-dd, comparação lexicográfica é segura em ISO
  if (dateFrom && eventDate < dateFrom) return false;
  if (dateTo && eventDate > dateTo) return false;
  return true;
}

/**
 * Filtra eventos pelos critérios ativos. `emailsById` só é necessário
 * quando `criteria.participants` não está vazio — passar um Map vazio é
 * seguro (resulta em nenhum evento correspondendo, nunca em erro).
 */
export function applyTimelineFilters(
  events: ContractEvent[],
  criteria: TimelineFilterCriteria,
  emailsById: Map<string, TimelineEmailContext> = new Map(),
  documentVersionsById: Map<string, TimelineDocumentContext> = new Map(),
  eventNotesByEventId: Map<string, TimelineEventNoteContext[]> = new Map()
): ContractEvent[] {
  const bySelection =
    criteria.selectedEventIds && criteria.selectedEventIds.length > 0
      ? new Set(criteria.selectedEventIds)
      : null;

  return events.filter((event) => {
    if (bySelection && !bySelection.has(event.id)) return false;

    if (criteria.sources.length > 0 && !criteria.sources.includes(event.sourceType)) {
      return false;
    }

    if (criteria.categories.length > 0 && !event.categories.some((c) => criteria.categories.includes(c))) {
      return false;
    }

    if (!isWithinDateRange(event.timestamp, criteria.dateFrom, criteria.dateTo)) {
      return false;
    }

    if (criteria.participants.length > 0) {
      const addresses = eventEmailAddresses(event, emailsById).map((a) => a.toLowerCase());
      const wanted = criteria.participants.map((p) => p.toLowerCase());

      if (!wanted.some((w) => addresses.includes(w))) {
        return false;
      }
    }

    const wantedSearchText =
      normalizeTimelineSearchText(criteria.searchText ?? "");

    if (wantedSearchText) {
      const searchableText = buildTimelineSearchText(
        event,
        emailsById,
        documentVersionsById,
        eventNotesByEventId
      );

      const terms = wantedSearchText
        .split(/\s+/)
        .filter(Boolean);

      if (!terms.every((term) => searchableText.includes(term))) {
        return false;
      }
    }

    return true;
  });
}

/** Ordem cronológica padrão: mais antigo → mais recente (seção 3 do requisito). */
export function sortChronological(events: ContractEvent[]): ContractEvent[] {
  return [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
