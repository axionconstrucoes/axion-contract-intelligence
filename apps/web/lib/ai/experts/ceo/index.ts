// CEO IA — Expert oficial do ACC, camada executiva/integradora sobre os
// demais Experts (nunca substitui uma análise especializada, nunca
// executa uma decisão). Consulta individual (./query.ts) + consolidação
// executiva multi-Expert (./consolidate.ts, usada por
// apps/web/lib/ai/curation/). Nenhuma lógica de negócio de outro domínio
// (RLS, revisão humana, Event Ledger, envio de comunicação) é duplicada
// aqui.

import { CEO_EXPERT_ID, CEO_INSTRUCTIONS, CEO_NAME, CEO_VERSION } from "./identity";
import { answerCeoQuery } from "./query";
import { runExecutiveCuration } from "./consolidate";

export { CEO_EXPERT_ID, CEO_INSTRUCTIONS, CEO_NAME, CEO_VERSION, answerCeoQuery, runExecutiveCuration };
export type { CeoQueryResult } from "./query";
export type { ExecutiveCurationResult } from "./consolidate";
export type { ExecutiveCuration, ExecutiveCurationConflict, ExecutiveCurationPosition } from "./types";
export { ExecutiveCurationValidationError } from "./schema";
