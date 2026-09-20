// Roteamento da opção ESPECIALISTA — puro. Só Experts realmente
// cadastrados (OfficialExpertId). O Expert apenas recomenda: nunca
// executa ações, nunca resolve o alerta; em HIGH/CRITICAL a resposta
// carrega requiresHumanReview e é enviada na MESMA thread do alerta.
//
// Precedência (nunca há um "default" de Planejamento):
//   1. escolha EXPLÍCITA no dropdown (sempre respeitada);
//   2. nome do Expert escrito de forma inequívoca no texto;
//   3. classificação por TEMA da pergunta (um único tema);
//   4. dois ou mais temas relevantes => mecanismo multi-Expert existente (ceo);
//   5. sem confiança suficiente => EXPERT_SELECTION_REVIEW_REQUIRED
//      (revisão humana; nada é enviado automaticamente a nenhum Expert).
// Tudo que entrou na decisão (pergunta original, temas, confiança, Expert
// sugerido × confirmado) sai em ExpertRouting para ser persistido/auditado.

import type { SlaArea } from "@/lib/sla/types";

import type { ExpertId } from "../types";

export const ALERT_EXPERT_OPTIONS: Array<{ id: ExpertId; label: string; domains: string }> = [
  { id: "legal-consultant", label: "Expert Jurídico", domains: "contrato, cláusula, obrigação, multa, responsabilidade, notificação" },
  { id: "planning-director", label: "Diretor de Planejamento", domains: "prazo, atividade, MPP, cronograma, Curva S, Histograma, marco, caminho crítico" },
  { id: "commercial-director", label: "Diretor Comercial/Financeiro", domains: "custo, receita, faturamento, medição, pagamento, financeiro" },
  { id: "esg-director", label: "ESG/SSMA", domains: "segurança, meio ambiente, acidente, SSMA, ESG" },
  { id: "ceo", label: "Multi-Expert (CEO)", domains: "multidisciplinar — só quando há mais de um tema" },
];

export type ExpertRoutingSource = "EXPLICIT_SELECTION" | "NAMED_IN_TEXT" | "TOPIC" | "MULTI_TOPIC" | "REVIEW_REQUIRED";

export interface ExpertRouting {
  /** Expert a consultar; null quando a seleção exige revisão humana. */
  expertId: ExpertId | null;
  source: ExpertRoutingSource;
  confidence: number;
  /** Experts detectados pelo tema (mesmo quando a escolha explícita prevaleceu). */
  topics: ExpertId[];
  /** Expert que o tema sugeriria (para auditar correções humanas). */
  suggestedExpertId: ExpertId | null;
  /** Expert efetivamente escolhido por humano (dropdown), quando houve. */
  selectedExpertId: ExpertId | null;
  /** true quando o humano escolheu um Expert diferente do sugerido pelo tema. */
  humanOverride: boolean;
  reviewRequired: boolean;
  reason: string;
}

// Temas (pista textual). Cada padrão conta um acerto; o Expert com acertos
// em um único tema é o roteado; temas distintos => multidisciplinar.
const TOPIC_PATTERNS: Array<[RegExp, ExpertId]> = [
  [/\b(prazos?|atividades?|mpp|cronogramas?|curva s|histogramas?|marcos?|caminho cr[íi]tico|caminhos cr[íi]ticos|baseline|replanejamento)\b/i, "planning-director"],
  [/\b(contrat(o|os|ual|uais)|cl[áa]usulas?|obriga[çc][õo]es|obriga[çc][ãa]o|multas?|responsabilidades?|notifica[çc][õo]es|notifica[çc][ãa]o|penalidades?|aditivos?|inadimpl\w*)\b/i, "legal-consultant"],
  [/\b(custos?|receitas?|faturamentos?|medi[çc][õo]es|medi[çc][ãa]o|pagamentos?|financeir[oa]s?|margem|fluxo de caixa|reajustes?|boletim de medi[çc][ãa]o)\b/i, "commercial-director"],
  [/\b(seguran[çc]a( do trabalho)?|meio ambiente|ambientais?|acidentes?|incidentes?|ssma|esg|epi|licen[çc]a ambiental|sustentabilidade)\b/i, "esg-director"],
];

// Nome do Expert escrito de forma inequívoca ("Expert Jurídico", "Diretor de
// Planejamento", "Diretor Comercial", "ESG/SSMA", "CEO"). Um único nome
// citado prevalece sobre o tema; mais de um nome => segue para o tema.
const NAME_PATTERNS: Array<[RegExp, ExpertId]> = [
  [/\b(expert|consultor|especialista)\s+jur[íi]dic[oa]\b|\bjur[íi]dico\b\s*[:,-]/i, "legal-consultant"],
  [/\bdiretor(a)?\s+de\s+planejamento\b|\bexpert\s+de\s+planejamento\b|\bplanejamento\s*[:,-]/i, "planning-director"],
  [/\bdiretor(a)?\s+comercial\b|\bdiretor(a)?\s+financeir[oa]\b|\bexpert\s+comercial\b/i, "commercial-director"],
  [/\b(expert|diretor(a)?)\s+(de\s+)?(esg|ssma)\b|\besg\s*\/\s*ssma\b/i, "esg-director"],
  [/\bceo\b|\bmulti[- ]?expert\b/i, "ceo"],
];

export function isKnownExpert(value: string | null | undefined): value is ExpertId {
  return ALERT_EXPERT_OPTIONS.some((option) => option.id === value);
}

/** Temas detectados no texto (Experts distintos, na ordem de detecção). */
export function detectExpertTopics(question: string): ExpertId[] {
  const q = question.toLowerCase();
  return Array.from(new Set(TOPIC_PATTERNS.filter(([pattern]) => pattern.test(q)).map(([, id]) => id)));
}

/** Expert nomeado de forma inequívoca no texto (exatamente um); null caso contrário. */
export function detectNamedExpert(question: string): ExpertId | null {
  const named = Array.from(new Set(NAME_PATTERNS.filter(([pattern]) => pattern.test(question)).map(([, id]) => id)));
  return named.length === 1 ? named[0] : null;
}

function topicSuggestion(topics: ExpertId[]): ExpertId | null {
  if (topics.length > 1) return "ceo";
  return topics[0] ?? null;
}

export function routeExpert(input: { question: string; selectedExpertId?: string | null }): ExpertRouting {
  const question = (input.question ?? "").trim();
  const topics = detectExpertTopics(question);
  const suggested = topicSuggestion(topics);
  const selected = isKnownExpert(input.selectedExpertId) ? input.selectedExpertId : null;

  if (selected) {
    return {
      expertId: selected,
      source: "EXPLICIT_SELECTION",
      confidence: 1,
      topics,
      suggestedExpertId: suggested,
      selectedExpertId: selected,
      humanOverride: suggested !== null && suggested !== selected,
      reviewRequired: false,
      reason: "Expert escolhido explicitamente pelo usuário.",
    };
  }

  const named = detectNamedExpert(question);
  if (named) {
    return { expertId: named, source: "NAMED_IN_TEXT", confidence: 0.9, topics, suggestedExpertId: suggested, selectedExpertId: null, humanOverride: false, reviewRequired: false, reason: "Expert nomeado de forma inequívoca no texto." };
  }

  if (topics.length > 1) {
    return { expertId: "ceo", source: "MULTI_TOPIC", confidence: 0.7, topics, suggestedExpertId: "ceo", selectedExpertId: null, humanOverride: false, reviewRequired: false, reason: `Mais de um tema relevante (${topics.join(", ")}) — mecanismo multi-Expert.` };
  }

  if (topics.length === 1) {
    return { expertId: topics[0], source: "TOPIC", confidence: 0.75, topics, suggestedExpertId: topics[0], selectedExpertId: null, humanOverride: false, reviewRequired: false, reason: `Tema único identificado: ${topics[0]}.` };
  }

  // Sem tema/nome: NUNCA cai em Planejamento por falta de classificação.
  return { expertId: null, source: "REVIEW_REQUIRED", confidence: 0, topics: [], suggestedExpertId: null, selectedExpertId: null, humanOverride: false, reviewRequired: true, reason: "Tema não identificado com confiança suficiente — seleção do Expert exige revisão humana." };
}

/**
 * Pré-seleção do dropdown pela ÁREA do alerta — só uma sugestão visual que
 * o humano confirma/troca (a escolha explícita é o que vale). Áreas sem
 * correspondência direta não sugerem nada (dropdown vazio).
 */
export function suggestExpertForArea(area: SlaArea): ExpertId | null {
  switch (area) {
    case "FINANCEIRO":
    case "COMERCIAL":
    case "ORCAMENTO":
      return "commercial-director";
    case "ESG_SSMA":
      return "esg-director";
    case "JURIDICO":
      return "legal-consultant";
    case "PLANEJAMENTO":
    case "ENGENHARIA":
      return "planning-director";
    default:
      return null;
  }
}
