// Parte PURA do registro documental por e-mail (opções do dropdown,
// rótulos e normalização dos searchParams) — importável por componentes
// client, server components e scripts de teste. O I/O fica em
// email-document-registry-data.ts (server-only).

import type { EmailDocumentClassification } from "./classify-email-document";

export type RegistryClassificationFilter =
  | "ALL"
  | "ATA_REUNIAO"
  | "DIARIO_OBRA"
  | "ALTERACAO_PROJETO"
  | "ESG_SSMA"
  | "RELATORIO_SEMANAL"
  | "SENT_TO_CLIENT"
  | "UNCLASSIFIED"
  | "PENDING_REVIEW";

export const REGISTRY_CLASSIFICATION_OPTIONS: Array<{ value: RegistryClassificationFilter; label: string }> = [
  { value: "ALL", label: "Todos" },
  { value: "ATA_REUNIAO", label: "Atas de reunião" },
  { value: "DIARIO_OBRA", label: "Diário de Obra / RDO" },
  { value: "ALTERACAO_PROJETO", label: "Alterações de projetos" },
  { value: "ESG_SSMA", label: "Relatórios diários de SSMA / ESG" },
  { value: "RELATORIO_SEMANAL", label: "Relatório semanal de Planejamento" },
  { value: "SENT_TO_CLIENT", label: "E-mails enviados ao cliente" },
  { value: "UNCLASSIFIED", label: "Não classificados" },
  { value: "PENDING_REVIEW", label: "Pendentes de revisão" },
];

export const EMAIL_CLASSIFICATION_LABELS: Record<EmailDocumentClassification, string> = {
  ATA_REUNIAO: "Ata de reunião",
  DIARIO_OBRA: "Diário de Obra / RDO",
  ALTERACAO_PROJETO: "Alteração de projeto",
  ESG_SSMA: "Relatório diário SSMA / ESG",
  RELATORIO_SEMANAL: "Relatório semanal de Planejamento",
  UNCLASSIFIED: "Não classificado",
};

export interface RegistrySearchParams {
  classification: RegistryClassificationFilter;
  query: string;
  from: string | null;
  to: string | null;
  sender: string | null;
  recipient: string | null;
  workWeek: number | null;
  direction: "INBOUND" | "OUTBOUND" | null;
  intakeStatus: string | null;
  risk: string | null;
  page: number;
  pageSize: number;
}

/** Normaliza searchParams da URL (nunca confia no formato). */
export function parseRegistrySearchParams(params: Record<string, string | string[] | undefined>): RegistrySearchParams {
  const pick = (key: string) => {
    const value = params[key];
    const text = Array.isArray(value) ? value[0] : value;
    return text?.trim() ? text.trim() : null;
  };
  const classification = (pick("classificacao") ?? "ALL") as RegistryClassificationFilter;
  const validClassification = REGISTRY_CLASSIFICATION_OPTIONS.some((option) => option.value === classification) ? classification : "ALL";
  const page = Math.max(1, Number(pick("pagina") ?? "1") || 1);
  const workWeek = pick("semana");
  const direction = pick("direcao");
  return {
    classification: validClassification,
    query: pick("q") ?? "",
    from: pick("de"),
    to: pick("ate"),
    sender: pick("remetente"),
    recipient: pick("destinatario"),
    workWeek: workWeek && /^\d{1,3}$/.test(workWeek) ? Number(workWeek) : null,
    direction: direction === "INBOUND" || direction === "OUTBOUND" ? direction : null,
    intakeStatus: pick("status"),
    risk: pick("risco"),
    page,
    pageSize: 25,
  };
}
