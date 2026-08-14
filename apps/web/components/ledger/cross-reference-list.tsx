import type { CrossReference } from "@axion/types";
import { resolveCrossReferenceLabel } from "@/lib/data";

const kindLabels: Record<CrossReference["kind"], string> = {
  CONTRATO_ADITIVO: "Contrato/Aditivo",
  EDITAL_RFI_RFP: "Edital/RFI/RFP",
  PROPOSTA_AXION: "Proposta Axion",
  CRONOGRAMA: "Cronograma",
  PROJETO_TECNICO: "Projeto Técnico",
  COMUNICACAO: "Comunicação",
};

export function CrossReferenceList({ crossReferences }: { crossReferences: CrossReference[] }) {
  if (crossReferences.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma referência cruzada registrada.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {crossReferences.map((ref, i) => (
        <li key={i} className="rounded-md border border-border p-3 text-sm">
          <p className="text-xs font-medium uppercase text-muted-foreground">{kindLabels[ref.kind]}</p>
          <p className="font-medium">{resolveCrossReferenceLabel(ref.refType, ref.refId)}</p>
          <p className="text-muted-foreground">{ref.note}</p>
        </li>
      ))}
    </ul>
  );
}
