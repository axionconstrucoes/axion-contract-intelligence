// Confronto de fonte do cliente (RECEBIDOS CLIENTE / planilha do
// cliente) contra o contrato-base — seção 5/6 do requisito. Estende
// ExpertAssessment (mesmo padrão de CommercialDirectorAssessment) em vez
// de criar uma segunda arquitetura de resposta estruturada.

import type { ExpertAssessment } from "../../ai/types";

/**
 * "NOVA EXIGÊNCIA DO CLIENTE" nunca é automaticamente "OBRIGAÇÃO
 * CONTRATUAL" — por isso seis classificações distintas, nunca um
 * booleano "está no contrato sim/não".
 */
export type ClientSourceConfrontationClassification =
  | "COMPATIBLE"
  | "ADDITIONAL_REQUIREMENT"
  | "CONTRACTUAL_CONFLICT"
  | "POSSIBLE_SCOPE_CHANGE"
  | "INCORPORATED_CONTRACT_DOCUMENT"
  | "INDETERMINATE";

/**
 * Parte específica do confronto. A cláusula de precedência/incorporação
 * em si (quando encontrada) já é citada via `ExpertAssessment.
 * contractualBasis` (genérico) — nunca duplicada aqui.
 */
export interface ClientSourceConfrontationAnalysis {
  classification: ClientSourceConfrontationClassification;
  /** true só quando uma regra de ordem de precedência/incorporação por referência foi realmente encontrada no contrato-base — nunca inventada. */
  precedenceFound: boolean;
  /** Resumo da regra encontrada, ou null quando precedenceFound é false — nunca preenchido "por padrão". */
  precedenceSummary: string | null;
}

/** Saída completa do confronto: genérico (ExpertAssessment) + `confrontation`. */
export interface ClientSourceConfrontation extends ExpertAssessment {
  confrontation: ClientSourceConfrontationAnalysis;
}
