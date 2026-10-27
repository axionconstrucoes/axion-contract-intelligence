// Puro, sem I/O — monta os FATOS de uma classificação a partir de (a) o que o ACC já sabe com
// referência verificável (cláusula aprovada, evidências, prazo da providência) e (b) o que a
// pessoa autorizada declara no formulário. O navegador nunca entrega cláusula/evidência: elas
// vêm do servidor (ver load-risk-panel-data.ts).

import type { DeadlineStatus, InputSource, Judgment, RiskFacts, RiskNature, SourceRef } from "./suggest-risk";

export interface RiskReviewFormInput {
  nature: RiskNature;
  deadlineStatus: DeadlineStatus;
  deadlineDate: string | null;
  imminence: Judgment;
  mitigationTime: Judgment;
  consequenceDescription: string;
  /** A pessoa confirma que a consequência descrita está prevista na cláusula verificada do alerta. */
  consequenceInVerifiedClause: boolean;
}

const NATURES: readonly RiskNature[] = ["DESCUMPRIMENTO_CONTRATUAL", "PROCESSUAL", "DESCONHECIDA"];
const DEADLINES: readonly DeadlineStatus[] = ["VENCIDO", "A_VENCER", "SEM_PRAZO", "DESCONHECIDO"];
const JUDGMENTS: readonly Judgment[] = ["SIM", "NAO", "DESCONHECIDA"];

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Normaliza o formulário; valor ausente/inválido vira "desconhecido" (nunca um valor assumido). */
export function parseRiskReviewForm(raw: Record<string, unknown>): RiskReviewFormInput {
  const date = typeof raw.deadlineDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.deadlineDate) ? raw.deadlineDate : null;
  return {
    nature: pick(raw.nature, NATURES, "DESCONHECIDA"),
    deadlineStatus: pick(raw.deadlineStatus, DEADLINES, "DESCONHECIDO"),
    deadlineDate: date,
    imminence: pick(raw.imminence, JUDGMENTS, "DESCONHECIDA"),
    mitigationTime: pick(raw.mitigationTime, JUDGMENTS, "DESCONHECIDA"),
    consequenceDescription: String(raw.consequenceDescription ?? "").trim().slice(0, 600),
    consequenceInVerifiedClause: raw.consequenceInVerifiedClause === true || raw.consequenceInVerifiedClause === "on",
  };
}

export function buildRiskFacts(input: {
  form: RiskReviewFormInput;
  /** Cláusula VERIFICADA do alerta (vínculo aprovado); null = pendente de confirmação. */
  verifiedClause: SourceRef | null;
  obligationDescription?: string | null;
  evidence: SourceRef[];
  deadlineRef?: SourceRef | null;
}): RiskFacts {
  const { form, verifiedClause } = input;
  const declared: InputSource = "PESSOA_AUTORIZADA";
  const consequenceText = form.consequenceDescription;
  return {
    nature: { value: form.nature, source: declared },
    obligation: verifiedClause ? { description: input.obligationDescription?.trim() || verifiedClause.label, clauseRef: verifiedClause } : null,
    consequence: consequenceText
      ? { description: consequenceText, clauseRef: form.consequenceInVerifiedClause ? verifiedClause : null }
      : null,
    deadline: { status: form.deadlineStatus, dueDate: form.deadlineDate, ref: input.deadlineRef ?? null },
    imminence: { value: form.imminence, source: declared },
    mitigationTime: { value: form.mitigationTime, source: declared },
    evidence: input.evidence,
  };
}

/** Prazo da providência: único fato de prazo que o ACC calcula sozinho (data < hoje ⇒ vencido). */
export function deadlineStatusFromDate(deadline: string | null, today: string): DeadlineStatus {
  if (!deadline) return "SEM_PRAZO";
  return deadline < today ? "VENCIDO" : "A_VENCER";
}
