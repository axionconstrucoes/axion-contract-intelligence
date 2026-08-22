// Enriquecimento específico do Diretor Comercial IA sobre a resposta
// genérica do fake provider a uma consulta conversacional. O provider
// genérico (providers/fake-provider.ts) nunca decide se um rascunho é
// necessário nem produz "práticas negociais" — isso é julgamento
// específico deste Expert, então vive aqui, não no provider.
//
// Heurística deliberadamente simples (palavras-chave) e claramente
// identificada como tal — não finge análise inteligente real.

import type { EventAnalysisContext } from "../../context/types";
import type { ExpertQueryDraft, ExpertQueryDraftType } from "../../query/types";

const DRAFT_KEYWORDS: Array<{ keywords: string[]; type: ExpertQueryDraftType }> = [
  { keywords: ["contraproposta"], type: "COUNTER_PROPOSAL" },
  { keywords: ["proposta"], type: "PROPOSAL" },
  { keywords: ["e-mail", "email"], type: "EMAIL" },
  { keywords: ["carta"], type: "LETTER" },
  { keywords: ["notifica"], type: "NOTIFICATION" },
  { keywords: ["pauta", "reunião", "reuniao"], type: "MEETING_AGENDA" },
  { keywords: ["roteiro", "negociação", "negociacao"], type: "NEGOTIATION_SCRIPT" },
  { keywords: ["memorando", "memo"], type: "MEMO" },
  { keywords: ["esclarecimento", "solicitação de informação", "solicitacao de informacao"], type: "INFORMATION_REQUEST" },
  { keywords: ["aditivo"], type: "AMENDMENT_TEXT" },
];

function detectRequestedDraftType(question: string): ExpertQueryDraftType | null {
  const normalized = question.toLowerCase();
  const verbTriggers = ["redija", "redigir", "prepare", "preparar", "escreva", "escrever", "elabore", "elaborar"];
  const hasVerbTrigger = verbTriggers.some((verb) => normalized.includes(verb));

  for (const { keywords, type } of DRAFT_KEYWORDS) {
    if (keywords.some((keyword) => normalized.includes(keyword))) {
      // Só sugere rascunho se a pergunta parecer realmente pedir um texto
      // (verbo de redação) OU citar diretamente um tipo de rascunho
      // (ex.: "contraproposta"), nunca por menção incidental.
      if (hasVerbTrigger || keywords.some((k) => k.length > 4 && normalized.includes(k))) {
        return type;
      }
    }
  }

  return null;
}

export interface CommercialQueryEnrichment {
  praticasNegociais: never[];
  rascunhoSugerido: ExpertQueryDraft | null;
}

export function deriveFakeQueryEnrichment(
  question: string,
  eventContext: EventAnalysisContext | null
): CommercialQueryEnrichment {
  const draftType = detectRequestedDraftType(question);

  if (!draftType) {
    return { praticasNegociais: [], rascunhoSugerido: null };
  }

  const subjectBase = eventContext ? eventContext.event.title : "Assunto comercial";

  return {
    praticasNegociais: [],
    rascunhoSugerido: {
      type: draftType,
      subject: `Re: ${subjectBase}`,
      body:
        `[RASCUNHO GERADO PELO PROVIDER DE TESTE (FAKE) — apenas estrutura, sem conteúdo comercial real]\n\n` +
        `Pergunta original: "${question}"\n\n` +
        (eventContext
          ? `Referente ao evento "${eventContext.event.title}" (id=${eventContext.event.id}).\n`
          : "Referente ao projeto (consulta de escopo PROJECT).\n") +
        `Este rascunho não contém estratégia, posição ou condição comercial real — é apenas uma demonstração ` +
        `da estrutura de saída. Necessária definição humana para qualquer conteúdo comercial antes do envio.`,
      status: "DRAFT_PENDING_REVIEW",
    },
  };
}
