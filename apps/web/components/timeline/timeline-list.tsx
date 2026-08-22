import Link from "next/link";
import type { ContractEvent } from "@axion/types";
import { CategoryBadge, StatusBadge } from "@/components/shared/badges";
import { sourceTypeShortLabels, formatDateTime } from "@/lib/labels";

export function TimelineList({
  events,
  projectId,
  selectedEventIds,
  onToggleEvent,
  onToggleAll,
}: {
  events: ContractEvent[];
  projectId: string;
  selectedEventIds: Set<string>;
  onToggleEvent: (eventId: string) => void;
  onToggleAll: () => void;
}) {
  const allSelected = events.length > 0 && events.every((e) => selectedEventIds.has(e.id));

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={allSelected} onChange={onToggleAll} />
        {selectedEventIds.size > 0
          ? `${selectedEventIds.size} evento(s) selecionado(s) manualmente para exportação`
          : "Selecionar eventos específicos para exportação (opcional — sem seleção, todos os eventos filtrados abaixo são exportados)"}
      </label>

      <ol className="flex flex-col gap-0 border-l border-border pl-6">
        {events.map((event) => (
          <li key={event.id} className="relative pb-6 last:pb-0">
            <span className="absolute -left-[29px] top-1.5 size-2.5 rounded-full border-2 border-background bg-primary" />
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1.5"
                checked={selectedEventIds.has(event.id)}
                onChange={() => onToggleEvent(event.id)}
                aria-label={`Selecionar evento ${event.title} para exportação`}
              />
              <Link
                href={`/${projectId}/ledger/${event.id}`}
                className="flex flex-1 flex-col gap-1 rounded-md p-2 -m-2 hover:bg-accent/50"
              >
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{formatDateTime(event.timestamp)}</span>
                  <span>·</span>
                  <span>{sourceTypeShortLabels[event.sourceType]}</span>
                </div>
                <p className="text-sm font-medium">{event.title}</p>
                <p className="text-sm text-muted-foreground">{event.description}</p>
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <StatusBadge status={event.status} />
                  {event.categories.map((c) => (
                    <CategoryBadge key={c} category={c} />
                  ))}
                </div>
              </Link>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
