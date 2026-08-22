"use client";

import { useMemo, useState } from "react";
import type { ContractEvent } from "@axion/types";

import { EmptyState } from "@/components/shared/empty-state";
import { TimelineFilters } from "./timeline-filters";
import { TimelineList } from "./timeline-list";
import { TimelineExportPanel } from "./timeline-export-panel";
import { applyTimelineFilters } from "@/lib/timeline-export/apply-filters";
import { deriveParticipants } from "@/lib/timeline-export/derive-participants";
import {
  emptyTimelineFilterCriteria,
  type TimelineDocumentContext,
  type TimelineEmailContext,
  type TimelineEventNoteContext,
} from "@/lib/timeline-export/types";

export function TimelinePageClient({
  events,
  projectId,
  projectName,
  emailEntries,
  documentVersionEntries,
  eventNoteEntries,
  exportedByUserId,
  exportedByName,
}: {
  events: ContractEvent[];
  projectId: string;
  projectName: string;
  emailEntries: Array<[string, TimelineEmailContext]>;
  documentVersionEntries: Array<[string, TimelineDocumentContext]>;
  eventNoteEntries: Array<[string, TimelineEventNoteContext[]]>;
  exportedByUserId: string;
  exportedByName: string;
}) {
  const emailsById = useMemo(() => new Map(emailEntries), [emailEntries]);
  const documentVersionsById = useMemo(() => new Map(documentVersionEntries), [documentVersionEntries]);
  const eventNotesByEventId = useMemo(() => new Map(eventNoteEntries), [eventNoteEntries]);

  const [criteria, setCriteria] = useState(emptyTimelineFilterCriteria());
  const [selectedEventIds, setSelectedEventIds] = useState<Set<string>>(new Set());

  const participants = useMemo(() => deriveParticipants(events, emailsById), [events, emailsById]);

  const visibleEvents = useMemo(
    () => applyTimelineFilters(events, { ...criteria, selectedEventIds: null }, emailsById),
    [events, criteria, emailsById]
  );

  // Seleção manual "ativa": interseção entre o que o usuário marcou e o
  // que está atualmente visível sob os demais filtros. Não é armazenada
  // de volta em estado (evita setState dentro de efeito) — se o usuário
  // remover um filtro depois, uma marcação anterior reaparece sozinha.
  const activeSelectedEventIds = useMemo(() => {
    const visibleIds = new Set(visibleEvents.map((e) => e.id));
    return new Set([...selectedEventIds].filter((id) => visibleIds.has(id)));
  }, [visibleEvents, selectedEventIds]);

  const exportEvents = useMemo(
    () =>
      activeSelectedEventIds.size > 0
        ? visibleEvents.filter((e) => activeSelectedEventIds.has(e.id))
        : visibleEvents,
    [visibleEvents, activeSelectedEventIds]
  );

  const exportCriteria = useMemo(
    () => ({
      ...criteria,
      selectedEventIds: activeSelectedEventIds.size > 0 ? Array.from(activeSelectedEventIds) : null,
    }),
    [criteria, activeSelectedEventIds]
  );

  function toggleEvent(eventId: string) {
    setSelectedEventIds((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  }

  function toggleAll() {
    setSelectedEventIds((prev) => {
      const allSelected = visibleEvents.length > 0 && visibleEvents.every((e) => prev.has(e.id));
      return allSelected ? new Set() : new Set(visibleEvents.map((e) => e.id));
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <TimelineFilters criteria={criteria} participants={participants} onChange={setCriteria} />

      <TimelineExportPanel
        projectId={projectId}
        projectName={projectName}
        criteria={exportCriteria}
        exportEvents={exportEvents}
        totalAvailableCount={events.length}
        emailsById={emailsById}
        documentVersionsById={documentVersionsById}
        eventNotesByEventId={eventNotesByEventId}
        exportedByUserId={exportedByUserId}
        exportedByName={exportedByName}
      />

      {visibleEvents.length === 0 ? (
        <EmptyState message="Nenhum evento encontrado para os filtros selecionados." />
      ) : (
        <TimelineList
          events={visibleEvents}
          projectId={projectId}
          selectedEventIds={activeSelectedEventIds}
          onToggleEvent={toggleEvent}
          onToggleAll={toggleAll}
        />
      )}
    </div>
  );
}
