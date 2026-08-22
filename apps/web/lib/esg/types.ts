// Tipos de domínio da Comprovação de Obrigações ESG/SSMA. Escopo
// estritamente contratual — ver docs/esg-obligations.md. Puro (só tipos),
// sem I/O, deliberadamente sem "server-only" para ser testável tanto
// pelo bundler do Next.js quanto por um script Node standalone.

export type EsgObligationCategory =
  | "DDS"
  | "INTEGRACAO_SEGURANCA"
  | "TREINAMENTO"
  | "INSPECAO"
  | "RELATORIO"
  | "DOCUMENTACAO_TERCEIROS"
  | "REGISTRO_ACIDENTE_INCIDENTE"
  | "DESTINACAO_RESIDUOS"
  | "COMPROVANTE_AMBIENTAL"
  | "LICENCA"
  | "CERTIFICADO"
  | "PERMISSAO"
  | "ENTREGA_EPI"
  | "DOCUMENTO_CLIENTE"
  | "FOTO_CAMPO"
  | "OUTRO";

export type EsgObligationPeriodicity =
  | "UNICA"
  | "DIARIA"
  | "SEMANAL"
  | "QUINZENAL"
  | "MENSAL"
  | "POR_EVENTO"
  | "POR_MARCO"
  | "PERSONALIZADA";

export type EsgObligationStatus =
  | "CUMPRIDO"
  | "CUMPRIDO_PARCIALMENTE"
  | "PENDENTE"
  | "NAO_CUMPRIDO"
  | "NAO_APLICAVEL"
  | "DISPENSADO";

export type EsgEvidenceKind = "FOTO" | "DOCUMENTO" | "PLANILHA" | "LISTA_PRESENCA" | "OUTRO";

export type EsgRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** Obrigação contratual configurada no checklist de um projeto (seção 6). */
export interface EsgObligation {
  id: string;
  projectId: string;
  title: string;
  category: EsgObligationCategory;
  description: string | null;
  sourceDocumentVersionId: string | null;
  sourceDocumentTitle: string | null; // resolvido por join, quando disponível
  clauseId: string | null;
  clauseNumber: string | null; // resolvido por join, quando disponível
  sourceReference: string | null;
  responsibleUserId: string | null;
  responsibleName: string | null; // resolvido por join, quando disponível
  responsibleLabel: string | null;
  periodicity: EsgObligationPeriodicity;
  requiredEvidenceDescription: string | null;
  penaltyDescription: string | null;
  active: boolean;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface EsgDdsDetails {
  tema: string;
  publico: string | null;
  numeroParticipantes: number | null;
}

/** Uma comprovação registrada para uma obrigação, em um período/data de referência (seção 4). */
export interface EsgObligationSubmission {
  id: string;
  projectId: string;
  obligationId: string;
  referenceDate: string; // ISO date
  referencePeriodLabel: string | null;
  dueDate: string | null; // ISO date
  filledByUserId: string;
  filledByName: string | null; // resolvido por join, quando disponível
  status: EsgObligationStatus;
  description: string | null;
  observation: string | null;
  justification: string | null;
  riskLevel: EsgRiskLevel | null;
  ddsDetails: EsgDdsDetails | null;
  reviewedByUserId: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Um arquivo anexado a uma comprovação (seção 9/10). */
export interface EsgObligationEvidence {
  id: string;
  projectId: string;
  submissionId: string;
  obligationId: string;
  evidenceKind: EsgEvidenceKind;
  storageBucket: string;
  filePath: string;
  originalFileName: string;
  mimeType: string;
  fileSizeBytes: number;
  replacesEvidenceId: string | null;
  uploadedByUserId: string;
  uploadedByName: string | null; // resolvido por join, quando disponível
  uploadedAt: string;
}
