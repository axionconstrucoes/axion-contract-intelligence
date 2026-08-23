// "Lido pelo ACC" (persistido + processado/indexado) e "Considerado"
// (efetivamente usado em finding/curadoria) são conceitos DISTINTOS
// (seção 6/19 do requisito) — nunca colapsados no mesmo número. Mesmo
// padrão já usado para anexos de e-mail (ver
// lib/email/attachments/registry/build-registry-rows.ts), aplicado
// diretamente ao e-mail em si.
//
// Puro, sem I/O.

import type { AiCurationRun, AiFinding } from "@/lib/additionals/findings/types";

export interface EmailProcessingSets {
  /** ids com pelo menos uma ai_curation_runs (qualquer status) de source_type=EMAIL. */
  processedEmailIds: Set<string>;
  /** ids referenciados em source_refs OU conflicting_source_refs (type=EMAIL) de algum finding. */
  consideredEmailIds: Set<string>;
}

export function resolveEmailProcessingSets(curationRuns: AiCurationRun[], findings: AiFinding[]): EmailProcessingSets {
  const processedEmailIds = new Set<string>();
  for (const run of curationRuns) {
    if (run.sourceType === "EMAIL") processedEmailIds.add(run.sourceId);
  }

  const consideredEmailIds = new Set<string>();
  for (const finding of findings) {
    for (const ref of [...finding.sourceRefs, ...finding.conflictingSourceRefs]) {
      if (ref.type === "EMAIL") consideredEmailIds.add(ref.id);
    }
  }

  return { processedEmailIds, consideredEmailIds };
}
