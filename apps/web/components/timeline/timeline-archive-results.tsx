"use client";

import Link from "next/link";
import type { TimelineArchiveHit } from "@/app/[projectId]/timeline/timeline-search-actions";

function formatHitDate(value: string): string {
  if (!value) return "Data não disponível";

  const dateOnly = value.slice(0, 10);
  const [year, month, day] = dateOnly.split("-");

  if (year && month && day) {
    return `${day}/${month}/${year}`;
  }

  return value;
}

const kindLabels: Record<TimelineArchiveHit["kind"], string> = {
  EMAIL: "E-mail",
  ANEXO_EMAIL: "Anexo de e-mail",
  DOCUMENTO: "Documento",
  TEXTO_DOCUMENTO: "Conteúdo de documento",
  CONSTRUMANAGER: "Construmanager",
  DIARIO_OBRA: "Diário de Obra",
  RELATORIO_SEMANAL: "Relatório Semanal",
  EVENTO: "Evento",
  ANOTACAO: "Anotação",
};

export function TimelineArchiveResults({
  hits,
}: {
  hits: TimelineArchiveHit[];
}) {
  if (hits.length === 0) {
    return (
      <div className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
        Nenhum item do acervo contém a palavra ou expressão pesquisada.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-semibold">
        Timeline temática — {hits.length} ocorrência
        {hits.length === 1 ? "" : "s"}
      </div>

      <ol className="flex flex-col border-l border-border pl-6">
        {hits.map((hit) => (
          <li
            key={hit.id}
            className="relative pb-5 last:pb-0"
          >
            <span className="absolute -left-[29px] top-2 size-2.5 rounded-full border-2 border-background bg-primary" />

            <Link
              href={hit.href}
              className="block rounded-md border border-border bg-card p-3 transition-colors hover:bg-accent/50"
            >
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{formatHitDate(hit.date)}</span>
                <span>·</span>
                <span>{kindLabels[hit.kind]}</span>
                <span>·</span>
                <span>{hit.sourceType}</span>
                <span>·</span>
                <span>{hit.matchedIn}</span>
              </div>

              <p className="text-sm font-semibold">
                {hit.title}
              </p>

              {hit.detail ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  {hit.detail}
                </p>
              ) : null}
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
