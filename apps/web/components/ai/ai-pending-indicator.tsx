// Indicador de atividade exibido enquanto uma consulta aos Experts IA
// está em andamento (`pending` do useActionState). É só sinal de que a
// análise está rodando: não há percentual, estimativa nem cronômetro —
// não conhecemos o tempo real e não inventamos um. Reaproveitado pela
// consulta individual (ExpertQueryPanel) e pelas curadorias multiagente.

import { Loader2 } from "lucide-react";

export function AiPendingIndicator({
  message = "Análise em andamento. Isso pode levar algum tempo — aguarde nesta tela.",
}: {
  message?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-2.5 text-xs text-muted-foreground"
    >
      <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}
