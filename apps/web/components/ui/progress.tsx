import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Percentual sempre vem de uma prop `value` real (0-100) — nunca um
 * timer/CSS animation interno fingindo progresso. `value={null}`
 * renderiza a barra em estado indeterminado ("Preparando...").
 */
function Progress({ value, className, ...props }: React.HTMLAttributes<HTMLDivElement> & { value: number | null }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={value ?? undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      {...props}
    >
      <div
        className={cn("h-full rounded-full bg-primary transition-all", value === null && "w-1/3 animate-pulse")}
        style={value !== null ? { width: `${value}%` } : undefined}
      />
    </div>
  );
}

export { Progress };
