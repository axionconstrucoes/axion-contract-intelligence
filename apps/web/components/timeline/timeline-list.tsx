import Link from "next/link";
import type { ContractEvent } from "@axion/types";
import { CategoryBadge, StatusBadge } from "@/components/shared/badges";
import { sourceTypeShortLabels, formatDateTime } from "@/lib/labels";

export function TimelineList({ events, projectId }: { events: ContractEvent[]; projectId: string }) {
  return (
    <ol className="flex flex-col gap-0 border-l border-border pl-6">
      {events.map((event) => (
        <li key={event.id} className="relative pb-6 last:pb-0">
          <span className="absolute -left-[29px] top-1.5 size-2.5 rounded-full border-2 border-background bg-primary" />
          <Link href={`/${projectId}/ledger/${event.id}`} className="flex flex-col gap-1 rounded-md p-2 -m-2 hover:bg-accent/50">
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
        </li>
      ))}
    </ol>
  );
}
