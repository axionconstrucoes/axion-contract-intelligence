import type { CrossReference } from "@axion/types";
import { getClause, getDocument, getEmail, getScheduleActivity } from "@/lib/data";

const kindLabels: Record<CrossReference["kind"], string> = {
  CONTRATO_ADITIVO: "Contrato/Aditivo",
  EDITAL_RFI_RFP: "Edital/RFI/RFP",
  PROPOSTA_AXION: "Proposta Axion",
  CRONOGRAMA: "Cronograma",
  PROJETO_TECNICO: "Projeto Técnico",
  COMUNICACAO: "Comunicação",
};

async function resolveCrossReferenceRealLabel(ref: CrossReference): Promise<string> {
  switch (ref.refType) {
    case "DOCUMENT": {
      const document = await getDocument(ref.refId);
      return document?.title ?? "Referência não disponível";
    }
    case "CLAUSE": {
      const clause = await getClause(ref.refId);
      return clause ? `Cláusula ${clause.clauseNumber} — ${clause.title}` : "Referência não disponível";
    }
    case "SCHEDULE_ACTIVITY": {
      const activity = await getScheduleActivity(ref.refId);
      return activity?.name ?? "Referência não disponível";
    }
    case "EMAIL": {
      const email = await getEmail(ref.refId);
      return email?.subject ?? "Referência não disponível";
    }
    default:
      return "Referência não disponível";
  }
}

export async function CrossReferenceList({ crossReferences }: { crossReferences: CrossReference[] }) {
  if (crossReferences.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma referência cruzada registrada.</p>;
  }

  const labels = await Promise.all(crossReferences.map(resolveCrossReferenceRealLabel));

  return (
    <ul className="flex flex-col gap-2">
      {crossReferences.map((ref, i) => (
        <li key={i} className="rounded-md border border-border p-3 text-sm">
          <p className="text-xs font-medium uppercase text-muted-foreground">{kindLabels[ref.kind]}</p>
          <p className="font-medium">{labels[i]}</p>
          <p className="text-muted-foreground">{ref.note}</p>
        </li>
      ))}
    </ul>
  );
}
