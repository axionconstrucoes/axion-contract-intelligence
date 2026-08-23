// Roteamento determinístico pós-classificação de confronto (seção 14 do
// requisito) — distinto do roteador por palavra-chave de
// apps/web/lib/ai/curation/route-experts.ts (que serve o Event Ledger em
// geral) e da curadoria fixa de propostas (curation.ts, sempre os 3).
// Aqui a composição depende da CLASSIFICAÇÃO já produzida pelo
// confronto Jurídico, nunca de palavra-chave livre.

import type { OfficialExpertId } from "../../ai/expert-definitions/types";
import type { ClientSourceConfrontationClassification } from "../confrontation/types";

export interface RouteConfrontationExpertsInput {
  classification: ClientSourceConfrontationClassification;
  /** true quando a exigência adicional identificada tem custo ou prazo associado — só então ADDITIONAL_REQUIREMENT aciona Comercial+Planejamento. */
  hasCostOrScheduleImpact?: boolean;
}

/**
 * Legal Consultant IA sempre participa (é quem produz a classificação em
 * si — ver run-client-source-confrontation.ts); esta função decide quais
 * especialistas ADICIONAIS devem ser consultados. `ceoMaterial` indica se
 * o CEO IA deveria consolidar (seção 14: "Depois: CEO consolida quando
 * material").
 */
export function routeExpertsForConfrontation(input: RouteConfrontationExpertsInput): {
  additionalExpertIds: OfficialExpertId[];
  ceoMaterial: boolean;
} {
  const { classification, hasCostOrScheduleImpact = false } = input;

  if (classification === "CONTRACTUAL_CONFLICT") {
    return { additionalExpertIds: ["commercial-director"], ceoMaterial: true };
  }

  if (classification === "POSSIBLE_SCOPE_CHANGE") {
    return { additionalExpertIds: ["commercial-director", "planning-director"], ceoMaterial: true };
  }

  if (classification === "ADDITIONAL_REQUIREMENT" && hasCostOrScheduleImpact) {
    return { additionalExpertIds: ["commercial-director", "planning-director"], ceoMaterial: false };
  }

  // COMPATIBLE / INCORPORATED_CONTRACT_DOCUMENT / INDETERMINATE /
  // ADDITIONAL_REQUIREMENT sem impacto conhecido: só o Jurídico mesmo,
  // nunca especialistas adicionais sem motivo.
  return { additionalExpertIds: [], ceoMaterial: false };
}
