// Tipos da fundação de curadoria IA multiagente (seção 5 do requisito
// "MODO ACELERADO ACC — 5 AGENTES CLAUDE + CURADORIA MULTIAGENTE").
// Fluxo: ENTRA NOVA INFORMAÇÃO → classificação/relevância →
// agente(s) competente(s) → análise especializada → grounding →
// curadoria → CEO IA → humano. Nenhum scheduler é criado nesta fase —
// isto é sempre invocado sob demanda (ver run-multi-expert-curation.ts).

import type { OfficialExpertId } from "../expert-definitions/types";
import type { ExecutiveCuration } from "../experts/ceo/types";
import type { ExpertQueryResponse } from "../query/types";

export type CurationSourceType = "EVENT" | "EMAIL" | "PROJECT";

/**
 * Nova informação/pergunta a rotear e analisar. `description` é sempre
 * um resumo curto (nunca o texto integral de um documento — mesmo
 * princípio de "não despejar tudo no modelo" já aplicado pelos Context
 * Builders); a análise de fato usa sempre EventAnalysisContext/
 * ProjectAnalysisContext, nunca este campo como fonte de fatos.
 */
export interface CurationInput {
  projectId: string;
  sourceType: CurationSourceType;
  /** Obrigatório quando sourceType é EVENT ou EMAIL vinculado a um evento. */
  eventId?: string;
  /** Presente quando a informação chegou por e-mail — usado para checar anexos ainda não processados (seção 7). */
  emailId?: string;
  description: string;
}

/**
 * Decisão de roteamento determinística (ver route-experts.ts) — sempre
 * derivada de EXPERT_COLLABORATION_MATRIX (expert-definitions/shared.ts),
 * nunca uma matriz paralela duplicada.
 */
export interface ExpertRoutingDecision {
  /** Tema classificado (rótulo de EXPERT_COLLABORATION_MATRIX, ou "GERAL"/"SSMA" quando não há penalidade/consequência contratual detectada). */
  topic: string;
  primaryExpertIds: OfficialExpertId[];
  supportingExpertIds: OfficialExpertId[];
  reason: string;
  /** true quando a fonte é um e-mail com ao menos um anexo ainda não promovido/processado (seção 7 do requisito). */
  sourceRequiresProcessing: boolean;
  unprocessedAttachmentFileNames: string[];
}

/** Resultado de um Expert especializado já executado nesta rodada. */
export interface ExpertCurationResult {
  expertId: OfficialExpertId;
  response: ExpertQueryResponse;
}

/**
 * Resultado completo de uma rodada de curadoria: roteamento + análises
 * especializadas + consolidação executiva do CEO IA (sempre a etapa
 * final, mesmo quando `expertResults` está vazio — ver
 * run-multi-expert-curation.ts).
 */
export interface MultiExpertCuration {
  input: CurationInput;
  routing: ExpertRoutingDecision;
  expertResults: ExpertCurationResult[];
  executiveCuration: ExecutiveCuration;
  /** Metadata compacta para auditoria (AI_MULTI_EXPERT_CURATION_CREATED) — nunca prompts/texto integral. */
  audit: {
    projectId: string;
    eventId: string | null;
    topic: string;
    consultedExpertIds: OfficialExpertId[];
    generatedAt: string;
  };
}
