"use client";

import type { ImplicationCategory, SourceType } from "@axion/types";
import { categoryLabels, sourceTypeShortLabels } from "@/lib/labels";
import type { TimelineFilterCriteria, TimelineParticipant } from "@/lib/timeline-export/types";

const sourceTypes = Object.keys(sourceTypeShortLabels) as SourceType[];
const categories = Object.keys(categoryLabels) as ImplicationCategory[];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function TimelineFilters({
  criteria,
  participants,
  onChange,
}: {
  criteria: TimelineFilterCriteria;
  participants: TimelineParticipant[];
  onChange: (next: TimelineFilterCriteria) => void;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-md border border-border p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-xs font-medium text-muted-foreground">Fontes</legend>
          {sourceTypes.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={criteria.sources.includes(s)}
                onChange={() => onChange({ ...criteria, sources: toggle(criteria.sources, s) })}
              />
              {sourceTypeShortLabels[s]}
            </label>
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-xs font-medium text-muted-foreground">Categorias/Impactos</legend>
          {categories.map((c) => (
            <label key={c} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={criteria.categories.includes(c)}
                onChange={() => onChange({ ...criteria, categories: toggle(criteria.categories, c) })}
              />
              {categoryLabels[c]}
            </label>
          ))}
        </fieldset>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">Período</span>
          <label className="flex flex-col gap-1 text-sm">
            De
            <input
              type="date"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              value={criteria.dateFrom ?? ""}
              onChange={(e) => onChange({ ...criteria, dateFrom: e.target.value || null })}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Até
            <input
              type="date"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              value={criteria.dateTo ?? ""}
              onChange={(e) => onChange({ ...criteria, dateTo: e.target.value || null })}
            />
          </label>
        </div>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-xs font-medium text-muted-foreground">Participantes (e-mail)</legend>
          <div className="flex max-h-32 flex-col gap-1 overflow-y-auto">
            {participants.length === 0 ? (
              <span className="text-xs text-muted-foreground">
                Nenhum participante identificado nos e-mails do projeto.
              </span>
            ) : (
              participants.map((p) => (
                <label key={p.address} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={criteria.participants.includes(p.address)}
                    onChange={() =>
                      onChange({ ...criteria, participants: toggle(criteria.participants, p.address) })
                    }
                  />
                  <span className="truncate" title={p.address}>
                    {p.address}
                  </span>
                  <span className="text-xs text-muted-foreground">({p.eventCount})</span>
                </label>
              ))
            )}
          </div>
        </fieldset>
      </div>
    </div>
  );
}
