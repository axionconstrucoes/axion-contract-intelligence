"use client";

import type { ImplicationCategory, SourceType } from "@axion/types";
import { categoryLabels, sourceTypeShortLabels } from "@/lib/labels";
import type {
  TimelineFilterCriteria,
  TimelineParticipant,
} from "@/lib/timeline-export/types";

const sourceTypes =
  Object.keys(sourceTypeShortLabels) as SourceType[];

const categories =
  Object.keys(categoryLabels) as ImplicationCategory[];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value];
}

export function TimelineFilters({
  criteria,
  participants,
  projectStartDate,
  projectEndDate,
  onChange,
  isSearching,
  resultCount,
  searchProgress,
  searchScannedCount,
  searchError,
}: {
  criteria: TimelineFilterCriteria;
  participants: TimelineParticipant[];
  projectStartDate: string | null;
  projectEndDate: string | null;
  onChange: (next: TimelineFilterCriteria) => void;
  isSearching: boolean;
  resultCount: number;
  searchProgress: number;
  searchScannedCount: number;
  searchError: string | null;
}) {
  const wholeProjectPeriod =
    criteria.dateFrom === projectStartDate &&
    criteria.dateTo === projectEndDate;

  const hasSearch = criteria.searchText.trim().length > 0;

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border p-4">
      <div className="flex flex-col gap-2">
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
          onChange={(event) =>
            onChange({
              ...criteria,
              searchText: event.target.value,
            })
          }
          placeholder="Ex.: compactação do solo"
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        />

        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-muted-foreground">
            Pesquisa todo o acervo: e-mails, anexos, documentos,
            conteúdo extraído, Diário de Obra, Construmanager,
            relatórios, eventos e anotações.
          </span>

          {hasSearch ? (
            <span className="shrink-0 text-sm font-semibold">
              {searchError
                ? "Erro na busca"
                : isSearching
                  ? `Buscando... ${searchProgress}%`
                  : `${resultCount} resultado${
                      resultCount === 1 ? "" : "s"
                    } encontrado${
                      resultCount === 1 ? "" : "s"
                    }`}
            </span>
          ) : null}
        </div>

        {hasSearch ? (
          <div className="space-y-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-[width] duration-150"
                style={{
                  width: `${Math.max(
                    2,
                    Math.min(100, searchProgress)
                  )}%`,
                }}
              />
            </div>

            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {isSearching
                  ? "Pesquisando o acervo completo..."
                  : searchError
                    ? searchError
                    : "Busca concluída"}
              </span>

              {!isSearching &&
              !searchError &&
              searchScannedCount > 0 ? (
                <span>
                  {searchScannedCount} itens examinados
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-xs font-medium text-muted-foreground">
            Fontes
          </legend>

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

          {sourceTypes.map((source) => (
            <label
              key={source}
              className="flex items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                checked={
                  criteria.sources.length === 0 ||
                  criteria.sources.includes(source)
                }
                onChange={() => {
                  const next =
                    criteria.sources.length === 0
                      ? sourceTypes.filter(
                          (item) => item !== source
                        )
                      : toggle(criteria.sources, source);

                  onChange({
                    ...criteria,
                    sources:
                      next.length === sourceTypes.length
                        ? []
                        : next,
                  });
                }}
              />

              {sourceTypeShortLabels[source]}
            </label>
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-xs font-medium text-muted-foreground">
            Categorias/Impactos
          </legend>

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

          {categories.map((category) => (
            <label
              key={category}
              className="flex items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                checked={
                  criteria.categories.length === 0 ||
                  criteria.categories.includes(category)
                }
                onChange={() => {
                  const next =
                    criteria.categories.length === 0
                      ? categories.filter(
                          (item) => item !== category
                        )
                      : toggle(
                          criteria.categories,
                          category
                        );

                  onChange({
                    ...criteria,
                    categories:
                      next.length === categories.length
                        ? []
                        : next,
                  });
                }}
              />

              {categoryLabels[category]}
            </label>
          ))}
        </fieldset>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Período
          </span>

          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={wholeProjectPeriod}
              onChange={(event) => {
                if (event.target.checked) {
                  onChange({
                    ...criteria,
                    dateFrom: projectStartDate,
                    dateTo: projectEndDate,
                  });
                } else {
                  onChange({
                    ...criteria,
                    dateFrom: null,
                    dateTo: null,
                  });
                }
              }}
            />
            Todo período da obra
          </label>

          <label className="flex flex-col gap-1 text-sm">
            De
            <input
              type="date"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              value={criteria.dateFrom ?? ""}
              disabled={wholeProjectPeriod}
              onChange={(event) =>
                onChange({
                  ...criteria,
                  dateFrom: event.target.value || null,
                })
              }
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Até
            <input
              type="date"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              value={criteria.dateTo ?? ""}
              disabled={wholeProjectPeriod}
              onChange={(event) =>
                onChange({
                  ...criteria,
                  dateTo: event.target.value || null,
                })
              }
            />
          </label>
        </div>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-xs font-medium text-muted-foreground">
            Participantes (e-mail)
          </legend>

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
              participants.map((participant) => (
                <label
                  key={participant.address}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={
                      criteria.participants.length === 0 ||
                      criteria.participants.includes(
                        participant.address
                      )
                    }
                    onChange={() => {
                      const allAddresses =
                        participants.map(
                          (item) => item.address
                        );

                      const next =
                        criteria.participants.length === 0
                          ? allAddresses.filter(
                              (address) =>
                                address !==
                                participant.address
                            )
                          : toggle(
                              criteria.participants,
                              participant.address
                            );

                      onChange({
                        ...criteria,
                        participants:
                          next.length ===
                          allAddresses.length
                            ? []
                            : next,
                      });
                    }}
                  />

                  <span
                    className="truncate"
                    title={participant.address}
                  >
                    {participant.address}
                  </span>

                  <span className="text-xs text-muted-foreground">
                    ({participant.eventCount})
                  </span>
                </label>
              ))
            )}
          </div>
        </fieldset>
      </div>
    </div>
  );
}
