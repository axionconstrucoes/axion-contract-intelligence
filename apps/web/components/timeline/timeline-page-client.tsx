"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ContractEvent } from "@axion/types";

import { EmptyState } from "@/components/shared/empty-state";
import { TimelineFilters } from "./timeline-filters";
import { TimelineList } from "./timeline-list";
import { TimelineExportPanel } from "./timeline-export-panel";
import { TimelineArchiveResults } from "./timeline-archive-results";
import { applyTimelineFilters } from "@/lib/timeline-export/apply-filters";
import { deriveParticipants } from "@/lib/timeline-export/derive-participants";
import {
  emptyTimelineFilterCriteria,
  type TimelineDocumentContext,
  type TimelineEmailContext,
  type TimelineEventNoteContext,
} from "@/lib/timeline-export/types";
import {
  searchTimelineArchive,
  type TimelineArchiveHit,
} from "@/app/[projectId]/timeline/timeline-search-actions";

export function TimelinePageClient({
  events,
  projectId,
  projectName,
  projectStartDate,
  projectEndDate,
  emailEntries,
  documentVersionEntries,
  eventNoteEntries,
  exportedByUserId,
  exportedByName,
}: {
  events: ContractEvent[];
  projectId: string;
  projectName: string;
  projectStartDate: string | null;
  projectEndDate: string | null;
  emailEntries: Array<[string, TimelineEmailContext]>;
  documentVersionEntries: Array<[string, TimelineDocumentContext]>;
  eventNoteEntries: Array<[string, TimelineEventNoteContext[]]>;
  exportedByUserId: string;
  exportedByName: string;
}) {
  const emailsById = useMemo(
    () => new Map(emailEntries),
    [emailEntries]
  );

  const documentVersionsById = useMemo(
    () => new Map(documentVersionEntries),
    [documentVersionEntries]
  );

  const eventNotesByEventId = useMemo(
    () => new Map(eventNoteEntries),
    [eventNoteEntries]
  );

  const [criteria, setCriteria] = useState(() => ({
    ...emptyTimelineFilterCriteria(),
    dateFrom: projectStartDate,
    dateTo: projectEndDate,
  }));

  const [selectedEventIds, setSelectedEventIds] =
    useState<Set<string>>(new Set());

  // Resultado da última busca concluída, com a chave dos critérios a que
  // pertence. Tudo que a UI mostra durante a busca (indicador, progresso,
  // erro) é derivado da comparação entre essa chave e a dos critérios atuais.
  const [settledSearch, setSettledSearch] = useState<{
    key: string;
    hits: TimelineArchiveHit[];
    scannedCount: number;
    error: string | null;
  } | null>(null);
  const [progressState, setProgressState] = useState<{
    key: string;
    value: number;
  } | null>(null);

  const searchGeneration = useRef(0);

  const participants = useMemo(
    () => deriveParticipants(events, emailsById),
    [events, emailsById]
  );

  const hasArchiveQuery = criteria.searchText.trim().length > 0;

  const searchKey = JSON.stringify([
    criteria.searchText.trim(),
    criteria.dateFrom,
    criteria.dateTo,
    criteria.sources,
    criteria.categories,
    criteria.participants,
  ]);
  const searchSettled = settledSearch?.key === searchKey;
  const isSearching = hasArchiveQuery && !searchSettled;
  const archiveHits = hasArchiveQuery ? (settledSearch?.hits ?? []) : [];
  const searchScannedCount = hasArchiveQuery
    ? (settledSearch?.scannedCount ?? 0)
    : 0;
  const searchError =
    hasArchiveQuery && searchSettled ? settledSearch.error : null;
  const searchProgress = !hasArchiveQuery
    ? 0
    : searchSettled
      ? 100
      : progressState?.key === searchKey
        ? progressState.value
        : 5;

  const visibleEvents = useMemo(
    () =>
      applyTimelineFilters(
        events,
        {
          ...criteria,
          searchText: "",
          selectedEventIds: null,
        },
        emailsById,
        documentVersionsById,
        eventNotesByEventId
      ),
    [
      events,
      criteria,
      emailsById,
      documentVersionsById,
      eventNotesByEventId,
    ]
  );

  useEffect(() => {
    const query = criteria.searchText.trim();

    searchGeneration.current += 1;
    const generation = searchGeneration.current;

    if (!query) return;

    const debounce = window.setTimeout(async () => {
      let progress = 8;

      const progressTimer = window.setInterval(() => {
        progress = Math.min(progress + 7, 90);

        if (generation === searchGeneration.current) {
          setProgressState({ key: searchKey, value: progress });
        }
      }, 140);

      try {
        const result = await searchTimelineArchive({
          projectId,
          query,
          dateFrom: criteria.dateFrom,
          dateTo: criteria.dateTo,
          sources: criteria.sources,
          categories: criteria.categories,
          participants: criteria.participants,
        });

        if (generation !== searchGeneration.current) return;

        if (!result.ok) {
          setSettledSearch({
            key: searchKey,
            hits: [],
            scannedCount: result.scannedCount,
            error: result.error ?? "Falha ao pesquisar o acervo.",
          });
          return;
        }

        setSettledSearch({
          key: searchKey,
          hits: result.hits,
          scannedCount: result.scannedCount,
          error: null,
        });
      } catch (error) {
        if (generation !== searchGeneration.current) return;

        setSettledSearch({
          key: searchKey,
          hits: [],
          scannedCount: 0,
          error:
            error instanceof Error
              ? error.message
              : "Falha ao pesquisar o acervo.",
        });
      } finally {
        window.clearInterval(progressTimer);
      }
    }, 350);

    return () => {
      window.clearTimeout(debounce);
    };
  }, [
    projectId,
    searchKey,
    criteria.searchText,
    criteria.dateFrom,
    criteria.dateTo,
    criteria.sources,
    criteria.categories,
    criteria.participants,
  ]);

  const activeSelectedEventIds = useMemo(() => {
    const visibleIds = new Set(
      visibleEvents.map((event) => event.id)
    );

    return new Set(
      [...selectedEventIds].filter((id) =>
        visibleIds.has(id)
      )
    );
  }, [visibleEvents, selectedEventIds]);

  const exportEvents = useMemo(
    () =>
      activeSelectedEventIds.size > 0
        ? visibleEvents.filter((event) =>
            activeSelectedEventIds.has(event.id)
          )
        : visibleEvents,
    [visibleEvents, activeSelectedEventIds]
  );

  const exportCriteria = useMemo(
    () => ({
      ...criteria,
      searchText: "",
      selectedEventIds:
        activeSelectedEventIds.size > 0
          ? Array.from(activeSelectedEventIds)
          : null,
    }),
    [criteria, activeSelectedEventIds]
  );

  function toggleEvent(eventId: string) {
    setSelectedEventIds((previous) => {
      const next = new Set(previous);

      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }

      return next;
    });
  }

  function toggleAll() {
    setSelectedEventIds((previous) => {
      const allSelected =
        visibleEvents.length > 0 &&
        visibleEvents.every((event) =>
          previous.has(event.id)
        );

      return allSelected
        ? new Set()
        : new Set(
            visibleEvents.map((event) => event.id)
          );
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <TimelineFilters
        criteria={criteria}
        participants={participants}
        projectStartDate={projectStartDate}
        projectEndDate={projectEndDate}
        onChange={setCriteria}
        isSearching={isSearching}
        resultCount={
          hasArchiveQuery
            ? archiveHits.length
            : visibleEvents.length
        }
        searchProgress={searchProgress}
        searchScannedCount={searchScannedCount}
        searchError={searchError}
      />

      {hasArchiveQuery ? (
        <TimelineArchiveResults hits={archiveHits} />
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
