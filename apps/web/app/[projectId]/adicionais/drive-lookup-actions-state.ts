// Tipo e estado inicial do Server Action de resolução de proposta a
// partir de ORÇAMENTOS (./drive-lookup-actions.ts) — deliberadamente FORA
// do módulo "use server". Ver ./actions-state.ts para a explicação
// completa do porquê.

import type { ResolvedAdditionalProposalFromDrive } from "@/lib/additionals/proposal-drive-lookup/types";

export type ResolveAdditionalProposalFromDriveState =
  | { status: "idle"; error: null; result: null }
  | { status: "error"; error: string; result: null }
  | { status: "resolved"; error: null; result: ResolvedAdditionalProposalFromDrive };

export const initialResolveAdditionalProposalFromDriveState: ResolveAdditionalProposalFromDriveState = {
  status: "idle",
  error: null,
  result: null,
};
