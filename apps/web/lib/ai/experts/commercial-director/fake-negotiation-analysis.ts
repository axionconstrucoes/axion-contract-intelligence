// Deriva deterministicamente a parte `negotiation` a partir do
// EventAnalysisContext, para uso com o provider fake/determinístico.
//
// Isto é lógica específica do Diretor Comercial IA — não pertence à
// fundação genérica (providers/fake-provider.ts nunca conhece
// "negociação"). Um provider real de IA produziria este objeto sozinho,
// a partir das instruções do Expert; aqui ele é montado sem nenhuma
// chamada de modelo, e nunca inventa dado econômico: campos sensíveis
// ficam UNAVAILABLE ou REQUIRES_HUMAN_DEFINITION quando o contexto não
// sustenta um valor real.

import type { EventAnalysisContext } from "../../context/types";
import type { CommercialImpactAssessment, CommercialNegotiationAnalysis } from "./types";

const AXION_DOMAIN = "@axion.com.br";

function unavailableImpact(category: CommercialImpactAssessment["category"]): CommercialImpactAssessment {
  return {
    category,
    status: "UNAVAILABLE",
    description: null,
    estimatedValue: null,
    basis: null,
  };
}

function deriveCounterparts(context: EventAnalysisContext): string[] {
  const addresses = new Set<string>();

  for (const email of context.relatedEmails) {
    for (const address of [email.fromAddress, email.toAddress]) {
      for (const single of address.split(",").map((a) => a.trim())) {
        if (single && !single.toLowerCase().includes(AXION_DOMAIN)) {
          addresses.add(single);
        }
      }
    }
  }

  return Array.from(addresses);
}

function deriveCommercialRisks(context: EventAnalysisContext): string[] {
  return context.confrontationCandidates
    .filter((candidate) => candidate.severity === "HIGH" || candidate.severity === "CRITICAL")
    .map(
      (candidate) =>
        `Risco comercial já sinalizado pelo confronto automático (candidato ${candidate.id}, severidade ${candidate.severity}): ${candidate.summary}`
    );
}

export function deriveFakeNegotiationAnalysis(context: EventAnalysisContext): CommercialNegotiationAnalysis {
  const counterparts = deriveCounterparts(context);

  return {
    negotiationObjective: null,
    currentPosition: null,
    targetPosition: null,
    minimumAcceptablePosition: { status: "REQUIRES_HUMAN_DEFINITION", value: null, basis: null },
    nonNegotiableItems: [],
    negotiableItems: [],
    possibleConcessions: [],
    requiredCounterparts: counterparts,
    counterpartyLikelyInterests: [],
    recommendedStrategy: null,
    arguments: [],
    anticipatedObjections: [],
    suggestedResponses: [],
    recommendedSequence: [],
    commercialRisks: deriveCommercialRisks(context),
    financialImpact: unavailableImpact("FINANCIAL"),
    scheduleImpact: unavailableImpact("SCHEDULE"),
    contractualImpact: unavailableImpact("CONTRACTUAL"),
    draftCommunication: {
      type: "EMAIL",
      subject: `Re: ${context.event.title}`,
      body:
        `[RASCUNHO GERADO PELO PROVIDER DETERMINÍSTICO — apenas estrutura, sem conteúdo comercial real]\n\n` +
        `Referente ao evento "${context.event.title}" (id=${context.event.id}).\n` +
        `${context.relatedClauses.length} cláusula(s) e ${context.evidence.length} evidência(s) relacionadas foram identificadas no projeto.\n\n` +
        `Este rascunho não contém estratégia, posição ou condição comercial real — é apenas uma demonstração da estrutura de saída. Necessária definição humana para qualquer conteúdo comercial antes do envio.`,
      status: "DRAFT_PENDING_REVIEW",
    },
  };
}
