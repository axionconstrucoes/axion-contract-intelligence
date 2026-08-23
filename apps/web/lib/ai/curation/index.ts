// Ponto único de importação da fundação de curadoria IA multiagente. Ver
// docs/ai/experts.md para a arquitetura completa dos Experts individuais.

export type { CurationInput, CurationSourceType, ExpertCurationResult, ExpertRoutingDecision, MultiExpertCuration } from "./types";
export { decideExpertRouting } from "./route-experts";
export { runMultiExpertCuration } from "./run-multi-expert-curation";
