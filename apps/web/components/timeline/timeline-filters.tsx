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
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="timeline-search"
          className="text-sm font-semibold"
        >
          Buscar palavra / assunto
        </label>

        <input
          id="timeline-search"
          type="search"
          value={criteria.searchText}
          onChange={(e) =>
            onChange({
              ...criteria,
              searchText: e.target.value,
            })
          }
          placeholder="Ex.: compactação do solo"
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        />

        <span className="text-xs text-muted-foreground">
          Pesquisa eventos, assuntos de e-mail, documentos e anotações.
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-xs font-medium text-muted-foreground">Fontes</legend>

          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={criteria.sources.length === 0}
              onChange={() =>
                onChange({
                  ...criteria,
                  sources: [],
                })
              }
            />
            Todos
          </label>

          {sourceTypes.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={
                  criteria.sources.length === 0 ||
                  criteria.sources.includes(s)
                }
                onChange={() => {
                  const nextSources =
                    criteria.sources.length === 0
                      ? sourceTypes.filter((source) => source !== s)
                      : toggle(criteria.sources, s);

                  onChange({
                    ...criteria,
                    sources:
                      nextSources.length === sourceTypes.length
                        ? []
                        : nextSources,
                  });
                }}
              />
              {sourceTypeShortLabels[s]}
            </label>
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-xs font-medium text-muted-foreground">Categorias/Impactos</legend>

          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={criteria.categories.length === 0}
              onChange={() =>
                onChange({
                  ...criteria,
                  categories: [],
                })
              }
            />
            Todos
          </label>

          {categories.map((c) => (
            <label key={c} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={
                  criteria.categories.length === 0 ||
                  criteria.categories.includes(c)
                }
                onChange={() => {
                  const nextCategories =
                    criteria.categories.length === 0
                      ? categories.filter((category) => category !== c)
                      : toggle(criteria.categories, c);

                  onChange({
                    ...criteria,
                    categories:
                      nextCategories.length === categories.length
                        ? []
                        : nextCategories,
                  });
                }}
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

          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={criteria.participants.length === 0}
              onChange={() =>
                onChange({
                  ...criteria,
                  participants: [],
                })
              }
            />
            Todos
          </label>

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
                    checked={
                      criteria.participants.length === 0 ||
                      criteria.participants.includes(p.address)
                    }
                    onChange={() => {
                      const allAddresses = participants.map(
                        (participant) => participant.address
                      );

                      const nextParticipants =
                        criteria.participants.length === 0
                          ? allAddresses.filter(
                              (address) => address !== p.address
                            )
                          : toggle(
                              criteria.participants,
                              p.address
                            );

                      onChange({
                        ...criteria,
                        participants:
                          nextParticipants.length === allAddresses.length
                            ? []
                            : nextParticipants,
                      });
                    }}
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
