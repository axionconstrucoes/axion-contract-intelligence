// Enriquecimento específico do Diretor de ESG IA sobre a resposta
// genérica do fake provider a uma consulta conversacional. O provider
// genérico (providers/fake-provider.ts) não conhece obrigações ESG/SSMA
// — isso é julgamento específico deste Expert, então vive aqui.
//
// Heurística deliberadamente simples (dados reais + palavras-chave para
// detectar pedido de rascunho) — não finge análise inteligente real.

import type { ContextEsgObligationSummary, EventAnalysisContext, ProjectAnalysisContext } from "../../context/types";
import type { ExpertQueryDraft, ExpertQueryDraftType } from "../../query/types";

const DRAFT_KEYWORDS: Array<{ keywords: string[]; type: ExpertQueryDraftType }> = [
  { keywords: ["cobrança", "cobranca", "cobre"], type: "NOTIFICATION" },
  { keywords: ["e-mail", "email"], type: "EMAIL" },
  { keywords: ["solicitação", "solicitacao", "esclarecimento"], type: "INFORMATION_REQUEST" },
  { keywords: ["relatório", "relatorio"], type: "MEMO" },
];

function detectRequestedDraftType(question: string): ExpertQueryDraftType | null {
  const normalized = question.toLowerCase();
  const verbTriggers = ["redija", "redigir", "prepare", "preparar", "escreva", "escrever", "elabore", "elaborar"];
  const hasVerbTrigger = verbTriggers.some((verb) => normalized.includes(verb));

  if (!hasVerbTrigger) return null;

  for (const { keywords, type } of DRAFT_KEYWORDS) {
    if (keywords.some((keyword) => normalized.includes(keyword))) {
      return type;
    }
  }

  return "EMAIL";
}

function isRelevant(o: ContextEsgObligationSummary): boolean {
  return o.latestSubmissionRiskLevel === "HIGH" || o.latestSubmissionRiskLevel === "CRITICAL";
}

function missingEvidence(o: ContextEsgObligationSummary): boolean {
  return Boolean(o.requiredEvidenceDescription) && o.latestSubmissionEvidenceCount === 0;
}

function describeObligation(o: ContextEsgObligationSummary): string {
  const status = o.latestSubmissionStatus ?? "sem comprovação registrada";
  const due = o.latestSubmissionDueDate ? `, prazo ${o.latestSubmissionDueDate}` : "";
  const risk = o.latestSubmissionRiskLevel ? `, risco ${o.latestSubmissionRiskLevel}` : "";
  return `Obrigação "${o.title}" (${o.category}, periodicidade ${o.periodicity}): status ${status}${due}${risk}.`;
}

export interface EsgQueryEnrichment {
  fatosDocumentados: string[];
  riscos: string[];
  acoesSugeridas: string[];
  rascunhoSugerido: ExpertQueryDraft | null;
}

export function deriveFakeEsgQueryEnrichment(
  question: string,
  projectContext: ProjectAnalysisContext | null,
  eventContext: EventAnalysisContext | null
): EsgQueryEnrichment {
  const obligations = projectContext?.esgObligations ?? [];

  const fatosDocumentados = obligations.map(describeObligation);

  const riscos = obligations
    .filter(isRelevant)
    .map(
      (o) =>
        `Risco ${o.latestSubmissionRiskLevel} — obrigação "${o.title}"${o.penaltyDescription ? `: ${o.penaltyDescription}` : " (penalidade não descrita no checklist)."}`
    );

  const acoesSugeridas: string[] = [];
  const missing = obligations.filter(missingEvidence);
  if (missing.length > 0) {
    acoesSugeridas.push(
      `Cobrar evidência faltante de: ${missing.map((o) => o.title).join(", ")}.`
    );
  }
  const overdueOrRelevant = obligations.filter(isRelevant);
  if (overdueOrRelevant.length > 0) {
    acoesSugeridas.push("Priorizar revisão humana das obrigações com risco HIGH/CRITICAL antes do próximo relatório ao cliente.");
  }

  const draftType = detectRequestedDraftType(question);
  let rascunhoSugerido: ExpertQueryDraft | null = null;

  if (draftType) {
    const pendingTitles = missing.length > 0 ? missing.map((o) => o.title) : obligations.filter(isRelevant).map((o) => o.title);
    const projectLabel = projectContext ? projectContext.project.name : eventContext ? eventContext.event.title : "o projeto";

    rascunhoSugerido = {
      type: draftType,
      subject: `Pendências ESG/SSMA — ${projectLabel}`,
      body:
        `[RASCUNHO GERADO PELO PROVIDER DE TESTE (FAKE) — apenas estrutura, sem conteúdo real de cobrança]\n\n` +
        `Pergunta original: "${question}"\n\n` +
        (pendingTitles.length > 0
          ? `Itens pendentes/relevantes identificados: ${pendingTitles.join(", ")}.\n`
          : "Nenhum item pendente/relevante identificado no contexto atual.\n") +
        `Este rascunho não contém texto de cobrança real — é apenas uma demonstração da estrutura de saída. ` +
        `Necessária revisão humana antes de qualquer envio.`,
      status: "DRAFT_PENDING_REVIEW",
    };
  }

  return { fatosDocumentados, riscos, acoesSugeridas, rascunhoSugerido };
}
