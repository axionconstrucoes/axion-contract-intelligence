// Diretor de Planejamento IA — Expert oficial do ACC, escopo
// deliberadamente reduzido (só atraso/aceleração com consequência
// econômica ou contratual relevante). Só consulta conversacional nesta
// fase (mesmo padrão de experts/esg-director). Nenhuma lógica de negócio
// de outro domínio (RLS, revisão humana, Event Ledger, cronograma real)
// é duplicada aqui.

import {
  PLANNING_DIRECTOR_EXPERT_ID,
  PLANNING_DIRECTOR_INSTRUCTIONS,
  PLANNING_DIRECTOR_NAME,
  PLANNING_DIRECTOR_VERSION,
} from "./identity";
import { answerPlanningDirectorQuery } from "./query";

export {
  PLANNING_DIRECTOR_EXPERT_ID,
  PLANNING_DIRECTOR_INSTRUCTIONS,
  PLANNING_DIRECTOR_NAME,
  PLANNING_DIRECTOR_VERSION,
  answerPlanningDirectorQuery,
};
export type { PlanningDirectorQueryResult } from "./query";
