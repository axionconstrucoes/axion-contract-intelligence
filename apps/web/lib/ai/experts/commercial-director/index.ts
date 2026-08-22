// Diretor Comercial IA — primeiro AI Expert oficial do ACC. Orquestra:
// identidade/instruções versionadas + provider abstrato + validação
// estrutural (genérica + específica de negociação). Nenhuma lógica de
// negócio de outro domínio (RLS, revisão humana, Event Ledger, envio de
// e-mail) é duplicada aqui — este módulo só produz uma sugestão
// estruturada; a autoridade de dados continua nas RPCs/Server Actions já
// existentes. Nenhuma comunicação é enviada por este módulo.

import type { EventAnalysisContext } from "../../context/types";
import {
  adjustConfidenceForGrounding,
  applySafeGroundingCorrection,
  buildGroundingSource,
  buildResponseGroundingSummary,
  NOT_PERFORMED_GROUNDING_SUMMARY,
  validateDraftGrounding,
} from "../../grounding/index";
import type { AiProvider } from "../../providers/types";
import { resolveAiProviderForExpert } from "../../providers/resolve-provider-for-expert";
import { deriveFakeNegotiationAnalysis } from "./fake-negotiation-analysis";
import { COMMERCIAL_DIRECTOR_ASSESSMENT_JSON_SCHEMA } from "./json-schema";
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
    /** Motivo de parada do provider real (ex.: "end_turn"). Null para o fake provider. */
    stopReason: string | null;
    /** Uso de tokens do provider real, quando disponível. Null para o fake provider. */
    usage: { inputTokens: number | null; outputTokens: number | null } | null;
    /**
     * Metadata do guardrail de grounding (apps/web/lib/ai/grounding/) —
     * somente contagens, nunca o texto completo das afirmações (ver
     * docs/ai/grounding-and-citation-guardrails.md, seção "Auditoria").
     */
    grounding: {
      performed: boolean;
      valid: boolean;
      supportedClaimCount: number;
      inferredClaimCount: number;
      unsupportedClaimCount: number;
      humanInputRequiredClaimCount: number;
    };
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
  provider: AiProvider = resolveAiProviderForExpert(COMMERCIAL_DIRECTOR_EXPERT_ID)
): Promise<CommercialDirectorRunResult> {
  const response = await provider.generateAssessment({
    expertId: COMMERCIAL_DIRECTOR_EXPERT_ID,
    expertName: COMMERCIAL_DIRECTOR_NAME,
    expertVersion: COMMERCIAL_DIRECTOR_VERSION,
    instructions: COMMERCIAL_DIRECTOR_INSTRUCTIONS,
    analysisType: "COMMERCIAL_NEGOTIATION_STRATEGY",
    context,
    outputSchema: COMMERCIAL_DIRECTOR_ASSESSMENT_JSON_SCHEMA,
  });

  const rawOutput =
    response.providerId === "fake" && typeof response.output === "object" && response.output !== null
      ? { ...(response.output as Record<string, unknown>), negotiation: deriveFakeNegotiationAnalysis(context) }
      : response.output;

  const validated = validateCommercialDirectorAssessment(rawOutput, {
    expertId: COMMERCIAL_DIRECTOR_EXPERT_ID,
    expertName: COMMERCIAL_DIRECTOR_NAME,
    expertVersion: COMMERCIAL_DIRECTOR_VERSION,
  });

  // Guardrail de grounding: só roda para o provider real (Anthropic) —
  // o fake provider é determinístico por construção e suas frases
  // estruturais ("[RASCUNHO GERADO PELO PROVIDER DETERMINÍSTICO...]")
  // não passam por (nem precisam de) checagem de fidelidade textual.
  // Ver docs/ai/grounding-and-citation-guardrails.md.
  let assessment = validated;
  let groundingAudit = { performed: false, valid: true, supportedClaimCount: 0, inferredClaimCount: 0, unsupportedClaimCount: 0, humanInputRequiredClaimCount: 0 };

  if (response.providerId === "anthropic" && validated.negotiation.draftCommunication) {
    const draft = validated.negotiation.draftCommunication;
    const source = buildGroundingSource({ eventContext: context, contractualBasis: validated.contractualBasis });
    const result = validateDraftGrounding(draft.body, source);

    let correctedDraft = draft;
    let draftSuppressed = false;
    let correctionApplied = false;

    if (!result.valid) {
      const correction = applySafeGroundingCorrection(draft.body, result);
      if (correction.stillRequiresRejection) {
        draftSuppressed = true;
      } else {
        correctedDraft = { ...draft, body: correction.correctedBody };
        correctionApplied = true;
      }
    }

    assessment = {
      ...validated,
      confidence: adjustConfidenceForGrounding(validated.confidence, result, { draftSuppressed, correctionApplied }),
      negotiation: { ...validated.negotiation, draftCommunication: draftSuppressed ? null : correctedDraft },
      uncertainties: draftSuppressed
        ? [
            ...validated.uncertainties,
            "Rascunho de comunicação removido pelo guardrail de grounding: continha afirmação sem suporte no contexto fornecido.",
          ]
        : validated.uncertainties,
      grounding: buildResponseGroundingSummary(result, { correctionApplied, draftSuppressed }),
    };

    groundingAudit = {
      performed: true,
      valid: result.valid,
      supportedClaimCount: result.supportedClaims.length,
      inferredClaimCount: result.inferredClaims.length,
      unsupportedClaimCount: result.unsupportedClaims.length,
      humanInputRequiredClaimCount: result.humanInputRequiredClaims.length,
    };
  } else {
    assessment = { ...validated, grounding: NOT_PERFORMED_GROUNDING_SUMMARY };
  }

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
      stopReason: response.stopReason ?? null,
      usage: response.usage ?? null,
      grounding: groundingAudit,
    },
  };
}
