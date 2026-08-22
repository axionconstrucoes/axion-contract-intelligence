import { esgObligationCategoryLabels, formatDate, type EsgObligationCategory } from "@/lib/labels";

export interface EsgPendingItem {
  obligationId: string;
  title: string;
  category: EsgObligationCategory;
  dueDate: string | null;
  requiredEvidenceDescription: string | null;
  evidenceCount: number;
  hasSubmission: boolean;
}

// "Pendências que preciso comprovar" (seção 21) — tela prática para o
// técnico, sem excesso de informação: só o que falta comprovar.
export function EsgTechnicianPendingList({ items }: { items: EsgPendingItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma pendência no momento.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.obligationId} className="rounded-md border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              {item.title} <span className="text-xs text-muted-foreground">({esgObligationCategoryLabels[item.category]})</span>
            </p>
            {item.dueDate ? (
              <span className="text-xs text-muted-foreground">Prazo: {formatDate(item.dueDate)}</span>
            ) : (
              <span className="text-xs text-muted-foreground">Sem prazo definido</span>
            )}
          </div>

          {!item.hasSubmission ? (
            <p className="mt-1 text-xs text-muted-foreground">[ ] Nenhuma comprovação registrada ainda</p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              {item.evidenceCount > 0 ? "[x]" : "[ ]"} Evidência anexada ({item.evidenceCount})
              {item.requiredEvidenceDescription ? ` — exigido: ${item.requiredEvidenceDescription}` : ""}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
