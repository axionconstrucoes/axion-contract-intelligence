// Consolidação executiva do CEO IA sobre posições já produzidas por
// outros Experts nesta mesma rodada de curadoria (ver
// apps/web/lib/ai/curation/run-multi-expert-curation.ts, único chamador
// real desta função). Nunca acessa o banco, nunca reexecuta um Expert —
// recebe as posições prontas e só consolida. "Máximo uma rodada de
// especialistas + uma consolidação CEO" (ver docs do pacote de
// curadoria) — este módulo é exatamente essa consolidação, nunca um
// segundo round de debate entre Experts.

import type { AiProvider, AiProviderExpertPosition } from "../../providers/types";
import { resolveAiProviderForExpert } from "../../providers/resolve-provider-for-expert";
import { CEO_EXPERT_ID, CEO_INSTRUCTIONS, CEO_NAME, CEO_VERSION } from "./identity";
import { EXECUTIVE_CURATION_JSON_SCHEMA } from "./json-schema";
import { validateExecutiveCuration } from "./schema";
import type { ExecutiveCuration } from "./types";

export interface ExecutiveCurationResult {
  curation: ExecutiveCuration;
  /** Metadata compacta para auditoria — nunca prompts/texto integral (ver seção de auditoria de docs/ai/experts.md). */
  audit: {
    expertId: typeof CEO_EXPERT_ID;
    expertVersion: typeof CEO_VERSION;
    providerId: string;
    model: string | null;
    consultedExpertIds: string[];
    generatedAt: string;
    stopReason: string | null;
    usage: { inputTokens: number | null; outputTokens: number | null } | null;
  };
}

/**
 * Consolida as posições fornecidas (já produzidas pelos Experts
 * especializados) em uma ExecutiveCuration. `positions` vazio é
 * permitido — significa uma rodada onde nenhum especialista se aplicou
 * ao tema (ver decideExpertRouting em curation/route-experts.ts), e a
 * consolidação deve refletir isso honestamente, nunca inventar posição.
 */
export async function runExecutiveCuration(
  situationSummary: string,
  positions: AiProviderExpertPosition[],
  provider: AiProvider = resolveAiProviderForExpert(CEO_EXPERT_ID)
): Promise<ExecutiveCurationResult> {
  const response = await provider.consolidateExecutiveCuration({
    expertId: CEO_EXPERT_ID,
    expertName: CEO_NAME,
    expertVersion: CEO_VERSION,
    instructions: CEO_INSTRUCTIONS,
    situationSummary,
    positions,
    outputSchema: EXECUTIVE_CURATION_JSON_SCHEMA,
  });

  const curation = validateExecutiveCuration(response.output, {
    expertIds: positions.map((p) => p.expertId),
  });

  return {
    curation,
    audit: {
      expertId: CEO_EXPERT_ID,
      expertVersion: CEO_VERSION,
      providerId: response.providerId,
      model: response.model,
      consultedExpertIds: positions.map((p) => p.expertId),
      generatedAt: new Date().toISOString(),
      stopReason: response.stopReason ?? null,
      usage: response.usage ?? null,
    },
  };
}
