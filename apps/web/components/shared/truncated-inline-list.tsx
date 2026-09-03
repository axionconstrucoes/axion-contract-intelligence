// Lista de identificadores técnicos (caixas de e-mail, domínios,
// participantes) que pode crescer sem limite — nunca quebra o layout
// do card que a contém: mostra os primeiros `visibleCount`, e o
// restante fica atrás de um <details>/<summary> nativo ("+ N"), que
// já vem com foco de teclado e leitor de tela acessíveis do próprio
// HTML, sem precisar de JS/estado (funciona em Server Component).
// Nenhum item é omitido permanentemente — só recolhido por padrão.

export function TruncatedInlineList({
  items,
  visibleCount = 2,
  emptyLabel,
  moreLabel,
}: {
  items: string[];
  visibleCount?: number;
  emptyLabel: string;
  moreLabel: (remaining: number) => string;
}) {
  if (items.length === 0) {
    return <>{emptyLabel}</>;
  }

  if (items.length <= visibleCount) {
    return <>{items.join(", ")}</>;
  }

  const visible = items.slice(0, visibleCount);
  const rest = items.slice(visibleCount);

  return (
    <span className="inline-flex flex-wrap items-baseline gap-1">
      <span>{visible.join(", ")}</span>
      <details className="inline-block">
        <summary className="inline-flex cursor-pointer list-none items-center rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring">
          {moreLabel(rest.length)}
        </summary>
        <div className="mt-1 max-h-40 max-w-xs overflow-y-auto rounded-md border bg-background p-2 text-xs leading-relaxed text-foreground sm:max-w-sm">
          {rest.join(", ")}
        </div>
      </details>
    </span>
  );
}
