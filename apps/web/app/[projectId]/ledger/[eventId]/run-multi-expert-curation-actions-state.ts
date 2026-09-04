// Tipo e estado inicial do Server Action de curadoria multiagente
// (./run-multi-expert-curation-actions.ts) — deliberadamente FORA do
// módulo "use server". Ver
// apps/web/app/[projectId]/acoes/actions-state.ts para a explicação
// completa do porquê.

import type { MultiExpertCuration } from "@/lib/ai/curation/types";

export interface RunMultiExpertCurationState {
  error: string | null;
  success: MultiExpertCuration | null;
}

export const initialRunMultiExpertCurationState: RunMultiExpertCurationState = { error: null, success: null };
