"use client";

import { useMemo, useState } from "react";
import type { ContractEvent } from "@axion/types";
import { EmptyState } from "@/components/shared/empty-state";
import { TimelineFilters } from "./timeline-filters";
import { TimelineList } from "./timeline-list";

export function TimelinePageClient({ events, projectId }: { events: ContractEvent[]; projectId: string }) {
  const [source, setSource] = useState("");
  const [category, setCategory] = useState("");

  const filtered = useMemo(
    () =>
      events.filter(
        (e) =>
          (source === "" || e.sourceType === source) &&
          (category === "" || e.categories.includes(category as never))
      ),
    [events, source, category]
  );

  return (
    <div className="flex flex-col gap-4">
      <TimelineFilters source={source} category={category} onSourceChange={setSource} onCategoryChange={setCategory} />
      {filtered.length === 0 ? (
        <EmptyState message="Nenhum evento encontrado para os filtros selecionados." />
      ) : (
        <TimelineList events={filtered} projectId={projectId} />
      )}
    </div>
  );
}
