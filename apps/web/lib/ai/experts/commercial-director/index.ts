// Diretor Comercial IA — primeiro AI Expert oficial do ACC. Orquestra:
// identidade/instruções versionadas + provider abstrato + validação
// estrutural (genérica + específica de negociação). Nenhuma lógica de
// negócio de outro domínio (RLS, revisão humana, Event Ledger, envio de
// e-mail) é duplicada aqui — este módulo só produz uma sugestão
// estruturada; a autoridade de dados continua nas RPCs/Server Actions já
// existentes. Nenhuma comunicação é enviada por este módulo.

import type { EventAnalysisContext } from "../../context/types";
import type { AiProvider } from "../../providers/types";
import { getAiProvider } from "../../providers/get-ai-provider";
import { deriveFakeNegotiationAnalysis } from "./fake-negotiation-analysis";
import { validateCommercialDirectorAssessment } from "./schema";
import type { CommercialDirectorAssessment } from "./types";
import {
  COMMERCIAL_DIRECTOR_EXPERT_ID,
  COMMERCIAL_DIRECTOR_INSTRUCTIONS,
  COMMERCIAL_DIRECTOR_NAME,
  COMMERCIAL_DIRECTOR_VERSION,
} from "./identity";

export {
  COMMERCIAL_DIRECTOR_EXPERT_ID,
  COMMERCIAL_DIRECTOR_INSTRUCTIONS,
  COMMERCIAL_DIRECTOR_NAME,
  COMMERCIAL_DIRECTOR_VERSION,
} from "./identity";

export interface CommercialDirectorRunResult {
  assessment: CommercialDirectorAssessment;
  /** Metadata para auditoria futura — ver docs/ai/experts.md seção de auditoria. */
  audit: {
    expertId: typeof COMMERCIAL_DIRECTOR_EXPERT_ID;
    expertVersion: typeof COMMERCIAL_DIRECTOR_VERSION;
    providerId: string;
    model: string | null;
    projectId: string;
    eventId: string;
    focusCandidateId: string | null;
    generatedAt: string;
  };
}

/**
 * Executa o Diretor Comercial IA sobre um contexto já montado (ver
 * buildEventAnalysisContext, reutilizado sem alteração). Não acessa o
 * banco diretamente — recebe o contexto pronto, somente leitura, e o
 * provider (fake por default, fail-closed para provider real não
 * configurado).
 *
 * Quando o provider ativo é o fake/determinístico, a parte `negotiation`
 * é montada por deriveFakeNegotiationAnalysis (lógica específica deste
 * Expert, nunca dentro do provider genérico) — um provider real deve
 * devolver `negotiation` já preenchido em seu próprio JSON, seguindo as
 * instruções versionadas deste Expert.
 */
export async function runCommercialDirectorExpert(
  context: EventAnalysisContext,
  provider: AiProvider = getAiProvider()
): Promise<CommercialDirectorRunResult> {
  const response = await provider.generateAssessment({
    expertId: COMMERCIAL_DIRECTOR_EXPERT_ID,
    expertName: COMMERCIAL_DIRECTOR_NAME,
    expertVersion: COMMERCIAL_DIRECTOR_VERSION,
    instructions: COMMERCIAL_DIRECTOR_INSTRUCTIONS,
    analysisType: "COMMERCIAL_NEGOTIATION_STRATEGY",
    context,
  });

  const rawOutput =
    response.providerId === "fake" && typeof response.output === "object" && response.output !== null
      ? { ...(response.output as Record<string, unknown>), negotiation: deriveFakeNegotiationAnalysis(context) }
      : response.output;

  const assessment = validateCommercialDirectorAssessment(rawOutput, {
    expertId: COMMERCIAL_DIRECTOR_EXPERT_ID,
    expertName: COMMERCIAL_DIRECTOR_NAME,
    expertVersion: COMMERCIAL_DIRECTOR_VERSION,
  });

  return {
    assessment,
    audit: {
      expertId: COMMERCIAL_DIRECTOR_EXPERT_ID,
      expertVersion: COMMERCIAL_DIRECTOR_VERSION,
      providerId: response.providerId,
      model: response.model,
      projectId: context.projectId,
      eventId: context.eventId,
      focusCandidateId: context.focusCandidateId,
      generatedAt: new Date().toISOString(),
    },
  };
}
