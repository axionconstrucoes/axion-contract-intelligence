// Tipos de "Propostas de Adicionais" — espelham 1:1
// public.project_additional_proposals / project_additional_proposal_links
// (ver supabase/migrations/20260823070000_additional_proposal_lifecycle.sql).
// Nenhum registro do piloto WEG (AXN CP 621/626/631/638) é hardcoded em
// código de produção — são apenas dados inseridos por um humano/script,
// como qualquer outra proposta.

export type AdditionalProposalSourceType = "DRIVE" | "MANUAL" | "EXISTING";

export type AdditionalProposalStatus =
  | "POSSIBLE_ADDITIONAL"
  | "UNDER_ANALYSIS"
  | "IN_NEGOTIATION"
  | "CONTRACTED"
  | "NOT_CONTRACTED"
  | "CANCELLED";

/** Comum a scope_approval_status e commercial_approval_status — nunca inferidos um do outro nem do status geral. */
export type AdditionalProposalApprovalStatus = "NOT_EVALUATED" | "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED";

export type AdditionalProposalScheduleExtensionStatus =
  | "NOT_EVALUATED"
  | "NOT_REQUIRED"
  | "TO_BE_REQUESTED"
  | "REQUESTED"
  | "APPROVED"
  | "PARTIALLY_APPROVED"
  | "REJECTED";

export type AdditionalProposalExecutionStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";

export type AdditionalProposalFormalizationType =
  | "ADITIVO_CONTRATUAL"
  | "EMAIL_APROVACAO"
  | "ORDEM_COMPRA_PO"
  | "ORDEM_SERVICO"
  | "CARTA_AUTORIZACAO_FORMAL"
  | "ATA_REGISTRO_FORMAL_ACEITO"
  | "OUTRO"
  | "NAO_IDENTIFICADO";

/** "Não exigir aditivo contratual" — CONTRATADO_FORMALIZACAO_COM_RESSALVA nunca bloqueia a contratação já ocorrida. */
export type AdditionalProposalDocumentalState =
  | "CONTRATADO_DOCUMENTACAO_COMPLETA"
  | "CONTRATADO_DOCUMENTACAO_PENDENTE"
  | "CONTRATADO_FORMALIZACAO_COM_RESSALVA";

export interface AdditionalProposal {
  id: string;
  projectId: string;
  proposalNumber: string;
  title: string;
  description: string;
  sourceType: AdditionalProposalSourceType;
  driveUrl: string | null;
  driveFileId: string | null;
  proposalDate: string | null;
  proposedValue: number | null;
  note: string | null;
  status: AdditionalProposalStatus;
  scopeApprovalStatus: AdditionalProposalApprovalStatus;
  commercialApprovalStatus: AdditionalProposalApprovalStatus;
  scheduleExtensionStatus: AdditionalProposalScheduleExtensionStatus;
  executionStatus: AdditionalProposalExecutionStatus;
  contractedAt: string | null;
  contractedValue: number | null;
  formalizationType: AdditionalProposalFormalizationType | null;
  approvalEvidenceNote: string | null;
  executionStarted: boolean | null;
  contractedNote: string | null;
  documentalState: AdditionalProposalDocumentalState | null;
  reservationConflictingClause: string | null;
  reservationRisk: string | null;
  reservationRecommendation: string | null;
  createdByType: "SYSTEM" | "USER" | "LEGACY";
  createdByUserId: string | null;
  createdByLabel: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AdditionalProposalLinkRole =
  | "ORIGIN_SOURCE"
  | "EVIDENCIA_CONTRATACAO"
  | "PROPOSTA_FINAL_AXION"
  | "CRONOGRAMA_IMPACTO"
  | "EVIDENCIA_VALOR"
  | "EVIDENCIA_PRAZO"
  | "ESCOPO_PROJETO";

/** Os 6 itens do checklist documental exigido ao marcar CONTRATADO — nunca inclui ORIGIN_SOURCE (esse é a Fonte C da criação, não checklist). */
export const CHECKLIST_LINK_ROLES: AdditionalProposalLinkRole[] = [
  "EVIDENCIA_CONTRATACAO",
  "PROPOSTA_FINAL_AXION",
  "CRONOGRAMA_IMPACTO",
  "EVIDENCIA_VALOR",
  "EVIDENCIA_PRAZO",
  "ESCOPO_PROJETO",
];

export interface AdditionalProposalLink {
  id: string;
  proposalId: string;
  linkRole: AdditionalProposalLinkRole;
  documentVersionId: string | null;
  emailId: string | null;
  emailAttachmentId: string | null;
  eventId: string | null;
  notApplicable: boolean;
  notApplicableJustification: string | null;
  note: string | null;
  createdByType: "SYSTEM" | "USER" | "LEGACY";
  createdByUserId: string | null;
  createdByLabel: string | null;
  createdAt: string;
}
