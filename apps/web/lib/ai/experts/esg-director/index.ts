// Diretor de ESG IA — Expert oficial do ACC, escopo estritamente
// contratual (obrigações ESG/SSMA com origem contratual relevante). Só
// consulta conversacional nesta fase (sem generateAssessment/
// ExpertAssessment dedicado — as obrigações ESG/SSMA são, por natureza,
// um dado de nível de PROJETO, não de um único evento; ver
// docs/esg-obligations.md). Nenhuma lógica de negócio de outro domínio
// (RLS, revisão humana, Event Ledger, envio de e-mail) é duplicada aqui.

import {
  ESG_DIRECTOR_EXPERT_ID,
  ESG_DIRECTOR_INSTRUCTIONS,
  ESG_DIRECTOR_NAME,
  ESG_DIRECTOR_VERSION,
} from "./identity";
import { answerEsgDirectorQuery } from "./query";

export {
  ESG_DIRECTOR_EXPERT_ID,
  ESG_DIRECTOR_INSTRUCTIONS,
  ESG_DIRECTOR_NAME,
  ESG_DIRECTOR_VERSION,
  answerEsgDirectorQuery,
};
export type { EsgDirectorQueryResult } from "./query";
