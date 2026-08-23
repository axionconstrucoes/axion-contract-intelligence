"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Info } from "lucide-react";
import { ACC_FEATURE_HELP } from "@/lib/ui/feature-help";
import { cn } from "@/lib/utils";

// Ajuda contextual ⓘ — único componente compartilhado (nunca texto
// explicativo hardcoded em página nenhuma, sempre via ACC_FEATURE_HELP).
// Desktop: hover/focus mostra um tooltip curto (CSS puro, sem JS);
// click abre um popover com a explicação completa. Mobile/touch: tap
// abre o mesmo popover (click e tap disparam o mesmo evento de botão).
// O clique nunca navega/seleciona/fecha a sidebar/executa a ação da
// linha — sempre stopPropagation no próprio botão.

export function FeatureInfo({
  helpId,
  className,
  iconClassName,
}: {
  helpId: string;
  className?: string;
  iconClassName?: string;
}) {
  const help = ACC_FEATURE_HELP[helpId];
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!help) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`FeatureInfo: helpId "${helpId}" não encontrado em ACC_FEATURE_HELP.`);
    }
    return null;
  }

  return (
    <span ref={containerRef} className={cn("group/feature-info relative inline-flex", className)}>
      <button
        type="button"
        aria-label={`Informações sobre ${help.title}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-describedby={open ? popoverId : undefined}
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 outline-none transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          iconClassName
        )}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <Info className="size-3.5" aria-hidden="true" />
      </button>

      {!open ? (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 w-max max-w-56 -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-[11px] text-popover-foreground opacity-0 shadow-sm transition-opacity group-hover/feature-info:opacity-100 group-focus-within/feature-info:opacity-100"
        >
          {help.shortDescription}
        </span>
      ) : null}

      {open ? (
        <div
          id={popoverId}
          role="dialog"
          aria-label={help.title}
          className="absolute left-1/2 top-full z-50 mt-1.5 w-72 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-md border bg-popover p-3 text-xs text-popover-foreground shadow-md"
          onClick={(event) => event.stopPropagation()}
        >
          <p className="mb-1 text-sm font-semibold">{help.title}</p>
          <p className="text-muted-foreground">{help.description}</p>
          {help.uses && help.uses.length > 0 ? (
            <ul className="mt-1.5 list-disc pl-4 text-muted-foreground">
              {help.uses.map((use) => (
                <li key={use}>{use}</li>
              ))}
            </ul>
          ) : null}
          {help.result ? (
            <p className="mt-1.5">
              <strong>Resultado:</strong> {help.result}
            </p>
          ) : null}
          {help.humanReview ? <p className="mt-1.5 italic text-muted-foreground">{help.humanReview}</p> : null}
        </div>
      ) : null}
    </span>
  );
}
