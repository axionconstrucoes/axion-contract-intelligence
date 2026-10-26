// Puro, sem I/O — SUGESTÃO de grau de risco pelos critérios definidos por Reynaldo.
//
//   CRÍTICO: risco iminente de descumprimento e penalização contratual, com necessidade de ação imediata.
//   ALTO:    risco iminente de descumprimento e penalização, mas ainda existe tempo para mitigação.
//   MÉDIO:   risco com possível consequência a médio prazo.
//   BAIXO:   risco processual, relacionado ao acompanhamento e à organização.
//
// Regras de projeto:
//  - NÃO existe número de dias separando crítico/alto/médio (não foi definido). "Iminência" e
//    "possibilidade de mitigação" são INSUMOS declarados (por pessoa autorizada ou por avaliação
//    estruturada), nunca deduzidos de um limiar de dias. Único fato derivado: prazo já VENCIDO.
//  - Penalidade só é afirmada com apoio contratual: exige descrição E referência verificável
//    (cláusula). Sem isso, nunca entra como fato.
//  - Cada passo da justificativa é FATO (veio de dado com referência), INFERÊNCIA (consequência
//    lógica dos critérios sobre os fatos) ou RECOMENDAÇÃO (o que confirmar). Nada é misturado.
//  - Faltando dado que distinga níveis, a sugestão NÃO escolhe: devolve `level: null`, os níveis
//    possíveis e o que precisa ser confirmado. A decisão final é sempre humana.
//  - Não altera nenhum alerta: é uma função pura de entrada → sugestão.

import type { AlertSeverity } from "@axion/types";

export const RISK_CRITERIA: Record<AlertSeverity, string> = {
  CRITICA: "Risco iminente de descumprimento e penalização contratual, com necessidade de ação imediata.",
  ALTA: "Risco iminente de descumprimento e penalização, mas ainda existe tempo para mitigação.",
  MEDIA: "Risco com possível consequência a médio prazo.",
  BAIXA: "Risco processual, relacionado ao acompanhamento e à organização.",
};

export const RISK_LEVEL_LABEL: Record<AlertSeverity, string> = {
  CRITICA: "Crítico",
  ALTA: "Alto",
  MEDIA: "Médio",
  BAIXA: "Baixo",
};

const RANK: Record<AlertSeverity, number> = { BAIXA: 0, MEDIA: 1, ALTA: 2, CRITICA: 3 };

export type RiskNature = "DESCUMPRIMENTO_CONTRATUAL" | "PROCESSUAL" | "DESCONHECIDA";
export type DeadlineStatus = "VENCIDO" | "A_VENCER" | "SEM_PRAZO" | "DESCONHECIDO";
export type Judgment = "SIM" | "NAO" | "DESCONHECIDA";
export type InputSource = "PESSOA_AUTORIZADA" | "AVALIACAO_ESTRUTURADA" | "REGISTRO_DO_ACC";

/** Referência consultável no ACC (cláusula, documento, evento, evidência, providência). */
export interface SourceRef {
  kind: "CLAUSULA" | "DOCUMENTO" | "EVENTO" | "EVIDENCIA" | "PROVIDENCIA" | "PRAZO";
  label: string;
  /** Caminho ou URL no ACC; null quando só existe o rótulo. */
  url?: string | null;
}

export interface RiskFacts {
  nature: { value: RiskNature; source?: InputSource | null };
  /** Obrigação contratual em jogo, com a cláusula que a sustenta (quando verificada). */
  obligation?: { description: string; clauseRef: SourceRef | null } | null;
  /** Penalidade/consequência contratual PREVISTA — só vale com referência verificável. */
  consequence?: { description: string; clauseRef: SourceRef | null } | null;
  deadline: { status: DeadlineStatus; dueDate?: string | null; ref?: SourceRef | null };
  /** "O descumprimento é iminente?" — declarado; nunca calculado por dias. */
  imminence: { value: Judgment; source?: InputSource | null };
  /** "Ainda há tempo para mitigação?" — SIM = existe tempo; NAO = nenhum. */
  mitigationTime: { value: Judgment; source?: InputSource | null };
  evidence: SourceRef[];
}

export type BasisKind = "FATO" | "INFERENCIA" | "RECOMENDACAO";

export interface BasisItem {
  kind: BasisKind;
  text: string;
  refs: SourceRef[];
}

export interface RiskSuggestion {
  /** Nível sugerido; null quando os dados disponíveis não distinguem entre níveis. */
  level: AlertSeverity | null;
  /** Todos os níveis compatíveis com os dados atuais (1 quando definido). */
  possibleLevels: AlertSeverity[];
  /** Menor nível compatível — piso conservador para quem precisa de um valor provisório. */
  minimumLevel: AlertSeverity | null;
  status: "DEFINIDA" | "INDETERMINADA";
  /** Incerteza da sugestão (não confundir com a gravidade do risco). */
  uncertainty: "BAIXA" | "MEDIA" | "ALTA";
  criterion: string | null;
  basis: BasisItem[];
  /** Resumo textual para exibição/registro (derivado de `basis`). */
  justification: string;
  /** Informações que precisam ser confirmadas para fechar/segurar a classificação. */
  missingInformation: string[];
  /** Sempre true: a sugestão nunca dispensa revisão humana. */
  requiresHumanReview: true;
}

interface Resolved {
  imminent: Judgment;
  mitigation: Judgment;
  penaltySupported: boolean;
}

function classify(nature: RiskNature, r: Resolved): AlertSeverity | null {
  if (nature === "DESCONHECIDA") return null;
  if (nature === "PROCESSUAL") return "BAIXA";
  // DESCUMPRIMENTO_CONTRATUAL
  if (r.imminent === "SIM") {
    if (!r.penaltySupported) return "MEDIA"; // sem penalidade com apoio contratual não há "penalização" afirmável
    return r.mitigation === "NAO" ? "CRITICA" : "ALTA";
  }
  return "MEDIA"; // não iminente: possível consequência a médio prazo
}

const ref = (r: SourceRef | null | undefined): SourceRef[] => (r ? [r] : []);

export function suggestRisk(facts: RiskFacts): RiskSuggestion {
  const basis: BasisItem[] = [];
  const missing: string[] = [];

  const clauseOfObligation = facts.obligation?.clauseRef ?? null;
  const penaltyRef = facts.consequence?.clauseRef ?? null;
  const penaltySupported = Boolean(facts.consequence && facts.consequence.description.trim() && penaltyRef);

  // ── FATOS (somente o que tem dado/referência) ─────────────────────────────
  if (facts.obligation && clauseOfObligation) {
    basis.push({ kind: "FATO", text: `Obrigação: ${facts.obligation.description.trim()}`, refs: [clauseOfObligation] });
  }
  if (penaltySupported && facts.consequence) {
    basis.push({ kind: "FATO", text: `Consequência contratual prevista: ${facts.consequence.description.trim()}`, refs: [penaltyRef as SourceRef] });
  }
  if (facts.deadline.status === "VENCIDO") {
    basis.push({
      kind: "FATO",
      text: `Prazo aplicável já vencido${facts.deadline.dueDate ? ` (${facts.deadline.dueDate})` : ""}.`,
      refs: ref(facts.deadline.ref),
    });
  } else if (facts.deadline.status === "A_VENCER") {
    basis.push({
      kind: "FATO",
      text: `Prazo aplicável ainda não vencido${facts.deadline.dueDate ? ` (${facts.deadline.dueDate})` : ""}.`,
      refs: ref(facts.deadline.ref),
    });
  }
  if (facts.evidence.length > 0) {
    basis.push({ kind: "FATO", text: `${facts.evidence.length} evidência(s) vinculada(s).`, refs: facts.evidence });
  }

  // ── Resolução dos insumos (único dado derivado: prazo vencido ⇒ descumprimento em curso) ──
  const imminentResolved: Judgment = facts.deadline.status === "VENCIDO" ? "SIM" : facts.imminence.value;
  const resolved: Resolved = { imminent: imminentResolved, mitigation: facts.mitigationTime.value, penaltySupported };

  if (facts.nature.value !== "DESCONHECIDA") {
    basis.push({
      kind: "FATO",
      text:
        facts.nature.value === "PROCESSUAL"
          ? "Natureza declarada: risco processual (acompanhamento/organização)."
          : "Natureza declarada: possível descumprimento contratual.",
      refs: [],
    });
  }
  if (facts.imminence.value !== "DESCONHECIDA" && facts.deadline.status !== "VENCIDO") {
    basis.push({
      kind: "FATO",
      text: facts.imminence.value === "SIM" ? "Iminência de descumprimento declarada." : "Iminência de descumprimento descartada pelo declarante.",
      refs: [],
    });
  }
  if (facts.mitigationTime.value !== "DESCONHECIDA") {
    basis.push({
      kind: "FATO",
      text: facts.mitigationTime.value === "SIM" ? "Declarado: ainda há tempo para mitigação." : "Declarado: não há tempo para mitigação.",
      refs: [],
    });
  }

  // ── Informações faltantes ─────────────────────────────────────────────────
  if (facts.nature.value === "DESCONHECIDA") missing.push("Natureza do risco: descumprimento contratual ou risco processual/organizacional.");
  if (facts.nature.value === "DESCUMPRIMENTO_CONTRATUAL") {
    if (!clauseOfObligation) missing.push("Cláusula e obrigação contratual que sustentam o risco (vínculo verificado).");
    if (!penaltySupported) missing.push("Consequência/penalidade contratual prevista, com a cláusula que a sustenta (sem isso não é possível afirmar penalização).");
    if (facts.deadline.status === "DESCONHECIDO") missing.push("Prazo contratual aplicável.");
    if (resolved.imminent === "DESCONHECIDA") missing.push("Se o descumprimento é iminente.");
    if (resolved.imminent === "SIM" && penaltySupported && resolved.mitigation === "DESCONHECIDA") missing.push("Se ainda há tempo para mitigação.");
  }
  if (facts.evidence.length === 0) missing.push("Evidência que comprove o fato gerador do risco.");

  // ── Níveis possíveis (varre apenas as dimensões desconhecidas — sem limiar inventado) ──
  const imminentOptions: Judgment[] = resolved.imminent === "DESCONHECIDA" ? ["SIM", "NAO"] : [resolved.imminent];
  const mitigationOptions: Judgment[] = resolved.mitigation === "DESCONHECIDA" ? ["SIM", "NAO"] : [resolved.mitigation];
  const penaltyOptions = [penaltySupported]; // penalidade não confirmada NÃO é "possível" — fica como pendência
  const natureOptions: RiskNature[] = facts.nature.value === "DESCONHECIDA" ? ["DESCUMPRIMENTO_CONTRATUAL", "PROCESSUAL"] : [facts.nature.value];

  const possible = new Set<AlertSeverity>();
  for (const n of natureOptions)
    for (const i of imminentOptions)
      for (const m of mitigationOptions)
        for (const p of penaltyOptions) {
          const level = classify(n, { imminent: i, mitigation: m, penaltySupported: p });
          if (level) possible.add(level);
        }
  const possibleLevels = Array.from(possible).sort((a, b) => RANK[a] - RANK[b]);
  const level = possibleLevels.length === 1 ? possibleLevels[0] : null;
  const minimumLevel = possibleLevels[0] ?? null;

  // ── INFERÊNCIA e RECOMENDAÇÃO ─────────────────────────────────────────────
  if (level) {
    basis.push({ kind: "INFERENCIA", text: `Critério aplicado — ${RISK_LEVEL_LABEL[level]}: ${RISK_CRITERIA[level]}`, refs: [] });
    if (facts.nature.value === "DESCUMPRIMENTO_CONTRATUAL" && resolved.imminent === "SIM" && !penaltySupported) {
      basis.push({
        kind: "INFERENCIA",
        text: "Há indício de descumprimento iminente, mas nenhuma penalidade foi confirmada em cláusula; por isso não se afirma penalização e o nível fica em Médio até a confirmação.",
        refs: [],
      });
    }
  } else if (possibleLevels.length > 1) {
    basis.push({
      kind: "INFERENCIA",
      text: `Os dados atuais não distinguem entre ${possibleLevels.map((l) => RISK_LEVEL_LABEL[l]).join(", ")}; nenhum nível foi escolhido.`,
      refs: [],
    });
  } else {
    basis.push({ kind: "INFERENCIA", text: "Dados insuficientes para sugerir um nível.", refs: [] });
  }
  if (missing.length > 0) {
    basis.push({ kind: "RECOMENDACAO", text: `Confirmar antes de decidir: ${missing.join(" ")}`, refs: [] });
  }

  const evidenceBacked = facts.evidence.length > 0;
  const grounded = facts.nature.value !== "DESCUMPRIMENTO_CONTRATUAL" || Boolean(clauseOfObligation);
  const uncertainty: RiskSuggestion["uncertainty"] = level === null ? "ALTA" : evidenceBacked && grounded && missing.length === 0 ? "BAIXA" : "MEDIA";

  return {
    level,
    possibleLevels,
    minimumLevel,
    status: level ? "DEFINIDA" : "INDETERMINADA",
    uncertainty,
    criterion: level ? RISK_CRITERIA[level] : null,
    basis,
    justification: basis.map((b) => `[${b.kind === "FATO" ? "Fato" : b.kind === "INFERENCIA" ? "Inferência" : "Recomendação"}] ${b.text}`).join(" "),
    missingInformation: missing,
    requiresHumanReview: true,
  };
}
