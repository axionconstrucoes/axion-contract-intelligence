// Consultor Jurídico IA — Expert oficial do ACC, análise jurídica
// aprofundada com fontes rastreáveis (nunca memória do modelo como base
// legal). Só consulta conversacional nesta fase (mesmo padrão de
// experts/esg-director — sem generateAssessment/ExpertAssessment
// dedicado). Nenhuma lógica de negócio de outro domínio (RLS, revisão
// humana, Event Ledger, envio de comunicação) é duplicada aqui.

import {
  LEGAL_CONSULTANT_EXPERT_ID,
  LEGAL_CONSULTANT_INSTRUCTIONS,
  LEGAL_CONSULTANT_NAME,
  LEGAL_CONSULTANT_VERSION,
} from "./identity";
import { answerLegalConsultantQuery } from "./query";

export {
  LEGAL_CONSULTANT_EXPERT_ID,
  LEGAL_CONSULTANT_INSTRUCTIONS,
  LEGAL_CONSULTANT_NAME,
  LEGAL_CONSULTANT_VERSION,
  answerLegalConsultantQuery,
};
export type { LegalConsultantQueryResult } from "./query";
