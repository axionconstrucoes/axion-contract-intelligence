"use client";

// Aba "Cláusulas" (Documentos): lista compacta mestre-detalhe em vez de
// concatenar o texto integral de todas as cláusulas em sequência —
// mesmo dado já retornado por getClauses(), só reorganizado. Largura
// de leitura controlada via `max-w-prose`; cláusulas longas começam
// recolhidas com "Mostrar cláusula completa".
//
// NÃO há destaque de entidades/escopo/risco aqui: ContractClause (ver
// lib/clause-mapper.ts) só tem clauseNumber/title/text — nenhum campo
// estruturado de risco, escopo, responsável ou prazo. Adicionar esse
// destaque exigiria inventar classificação/detecção por palavras, o
// que foi explicitamente vetado — registrado como pendência no
// relatório de implementação, não implementado aqui.

import { useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ContractClause } from "@axion/types";

// Abaixo disso, a cláusula já cabe inteira em ~6 linhas — não faz
// sentido oferecer "mostrar mais" para recolher e depois reexpandir o
// mesmo tanto de texto.
const COLLAPSE_THRESHOLD_CHARS = 420;

function ClauseListNav({
  clauses,
  selectedId,
  onSelect,
}: {
  clauses: ContractClause[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <nav className="flex flex-col gap-1" aria-label="Lista de cláusulas">
      {clauses.map((clause) => {
        const isSelected = clause.id === selectedId;
        return (
          <button
            key={clause.id}
            type="button"
            onClick={() => onSelect(clause.id)}
            aria-current={isSelected ? "true" : undefined}
            className={cn(
              "rounded-md border-l-2 px-2.5 py-1.5 text-left text-xs leading-snug transition-colors",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
              isSelected
                ? "border-l-brand-header bg-accent font-medium text-foreground"
                : "border-l-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            Cláusula {clause.clauseNumber} — {clause.title}
          </button>
        );
      })}
    </nav>
  );
}

export function ClausesMasterDetail({ clauses }: { clauses: ContractClause[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(clauses[0]?.id ?? null);
  const [expanded, setExpanded] = useState(false);

  if (clauses.length === 0) {
    return <EmptyState message="Nenhuma cláusula cadastrada." />;
  }

  const selected = clauses.find((clause) => clause.id === selectedId) ?? clauses[0];
  const needsCollapse = selected.text.length > COLLAPSE_THRESHOLD_CHARS;

  function selectClause(id: string) {
    setSelectedId(id);
    setExpanded(false);
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr] lg:items-start">
      {/* Mobile/tablet: lista recolhível (accordion nativo, acessível
          por teclado) — some espaço só quando fechada; a cláusula
          selecionada aparece sempre no resumo. */}
      <details className="rounded-md border lg:hidden">
        <summary className="cursor-pointer rounded-md px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring">
          Cláusulas ({clauses.length}) — selecionada: {selected.clauseNumber}
        </summary>
        <div className="border-t p-2">
          <ClauseListNav clauses={clauses} selectedId={selected.id} onSelect={selectClause} />
        </div>
      </details>

      {/* Desktop: lista sempre visível ao lado do painel de leitura. */}
      <div className="hidden rounded-md border p-2 lg:block">
        <ClauseListNav clauses={clauses} selectedId={selected.id} onSelect={selectClause} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Cláusula {selected.clauseNumber} — {selected.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p
            className={cn(
              "max-w-prose whitespace-pre-line text-sm text-muted-foreground",
              needsCollapse && !expanded && "line-clamp-6"
            )}
          >
            {selected.text}
          </p>
          {needsCollapse ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="w-fit text-xs font-medium text-brand-header underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            >
              {expanded ? "Mostrar menos" : "Mostrar cláusula completa"}
            </button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
