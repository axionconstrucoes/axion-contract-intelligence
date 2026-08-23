// Roteamento determinístico de uma nova informação para o(s) Expert(s)
// competente(s) (seção 5 do requisito de curadoria multiagente). Sempre
// derivado de EXPERT_COLLABORATION_MATRIX (expert-definitions/shared.ts)
// — nunca uma segunda matriz paralela. Classificação por palavra-chave é
// determinística e auditável (nunca uma chamada de IA para decidir quem
// consultar); a análise de fato (IA) só começa depois do roteamento.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmailAttachmentsForEmail } from "../../email/attachments/get-email-attachments";
import { EXPERT_COLLABORATION_MATRIX } from "../expert-definitions/shared";
import type { OfficialExpertId } from "../expert-definitions/types";
import type { CurationInput, ExpertRoutingDecision } from "./types";

const NEGOTIATION_KEYWORDS = [
  "escopo adicional",
  "aditivo",
  "preço",
  "reajuste",
  "negocia",
  "proposta",
  "contraproposta",
  "concessão",
  "desconto",
  "medição",
  "pagamento",
];

const DISPUTE_KEYWORDS = ["disputa", "litígio", "arbitragem", "notificação formal", "inadimplemento", "descumprimento"];

const SCHEDULE_KEYWORDS = ["atraso", "prazo", "extensão de prazo", "cronograma", "aceleração", "aceleracao"];

const PENALTY_KEYWORDS = ["multa", "penalidade", "paralisação", "paralisacao", "retenção", "retencao"];

const ESG_KEYWORDS = ["ssma", "segurança do trabalho", "seguranca do trabalho", "meio ambiente", "esg", "acidente", "epi", "licença ambiental", "licenca ambiental"];

function containsAny(haystack: string, keywords: string[]): boolean {
  return keywords.some((keyword) => haystack.includes(keyword));
}

function findMatrixRow(topic: string) {
  return EXPERT_COLLABORATION_MATRIX.find((rule) => rule.topic === topic) ?? null;
}

/**
 * Classifica `input.description` e devolve a decisão de roteamento.
 * Nunca lê o banco para classificar — só a checagem de anexos (seção 7)
 * é I/O, e é sempre separada da classificação por palavra-chave.
 */
function classifyTopic(description: string): { topic: string; primaryExpertIds: OfficialExpertId[]; supportingExpertIds: OfficialExpertId[]; reason: string } {
  const normalized = description.toLowerCase();

  if (containsAny(normalized, DISPUTE_KEYWORDS)) {
    const row = findMatrixRow("DISPUTA")!;
    return {
      topic: row.topic,
      primaryExpertIds: [row.primaryExpertId],
      supportingExpertIds: row.supportingExpertIds,
      reason: `Palavra-chave de disputa/notificação formal detectada — roteado por EXPERT_COLLABORATION_MATRIX (tema "${row.topic}").`,
    };
  }

  if (containsAny(normalized, NEGOTIATION_KEYWORDS)) {
    const row = findMatrixRow("NEGOCIAÇÃO")!;
    return {
      topic: row.topic,
      primaryExpertIds: [row.primaryExpertId],
      supportingExpertIds: row.supportingExpertIds,
      reason: `Palavra-chave de negociação/escopo adicional/preço detectada — roteado por EXPERT_COLLABORATION_MATRIX (tema "${row.topic}").`,
    };
  }

  if (containsAny(normalized, SCHEDULE_KEYWORDS)) {
    const row = findMatrixRow("ATRASO COM MULTA")!;
    return {
      topic: row.topic,
      primaryExpertIds: [row.primaryExpertId],
      supportingExpertIds: row.supportingExpertIds,
      reason: `Palavra-chave de atraso/prazo/cronograma detectada — roteado por EXPERT_COLLABORATION_MATRIX (tema "${row.topic}").`,
    };
  }

  if (containsAny(normalized, ESG_KEYWORDS)) {
    const hasContractualConsequence = containsAny(normalized, PENALTY_KEYWORDS);
    if (hasContractualConsequence) {
      const row = findMatrixRow("SSMA COM PENALIDADE")!;
      return {
        topic: row.topic,
        primaryExpertIds: [row.primaryExpertId],
        supportingExpertIds: row.supportingExpertIds,
        reason: `Palavra-chave de SSMA/ESG com consequência contratual (multa/penalidade/paralisação/retenção) detectada — roteado por EXPERT_COLLABORATION_MATRIX (tema "${row.topic}").`,
      };
    }
    return {
      topic: "SSMA",
      primaryExpertIds: ["esg-director"],
      supportingExpertIds: [],
      reason: "Palavra-chave de SSMA/ESG detectada, sem consequência contratual explícita (multa/penalidade) — só o Diretor de ESG IA é consultado.",
    };
  }

  const row = findMatrixRow("DECISÃO EXECUTIVA")!;
  return {
    topic: "GERAL",
    primaryExpertIds: [row.primaryExpertId],
    supportingExpertIds: row.supportingExpertIds,
    reason:
      "Nenhum tema específico foi reconhecido na descrição — tratado como multi-área: todos os Experts especializados " +
      `são consultados e o CEO IA consolida (mesma composição do tema "${row.topic}" em EXPERT_COLLABORATION_MATRIX).`,
  };
}

/**
 * Decide o roteamento para uma CurationInput. Assíncrono porque, quando
 * `input.emailId` está presente, checa se algum anexo do e-mail ainda
 * não foi processado (seção 7 do requisito) — nunca finge que analisou o
 * conteúdo de um anexo só porque conhece o filename.
 */
export async function decideExpertRouting(supabase: SupabaseClient, input: CurationInput): Promise<ExpertRoutingDecision> {
  const classification = classifyTopic(input.description);

  let sourceRequiresProcessing = false;
  let unprocessedAttachmentFileNames: string[] = [];

  if (input.emailId) {
    const attachments = await getEmailAttachmentsForEmail(supabase, input.emailId);
    const unprocessed = attachments.filter((attachment) => attachment.processingStatus !== "PROCESSED");
    sourceRequiresProcessing = unprocessed.length > 0;
    unprocessedAttachmentFileNames = unprocessed.map((attachment) => attachment.originalFileName);
  }

  return {
    topic: classification.topic,
    primaryExpertIds: classification.primaryExpertIds,
    supportingExpertIds: classification.supportingExpertIds,
    reason: classification.reason,
    sourceRequiresProcessing,
    unprocessedAttachmentFileNames,
  };
}
