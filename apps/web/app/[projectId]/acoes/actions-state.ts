// Tipos e estados iniciais dos Server Actions de "Ações e
// Escalonamentos" (./actions.ts) — deliberadamente FORA do módulo
// "use server". Next.js só permite que um arquivo "use server" exporte
// funções async (Server Actions); um objeto/const exportado dali quebra
// em runtime com "A 'use server' file can only export async functions,
// found object." quando importado por um Client Component (como os
// formulários em components/sla/*). Ver
// docs/product-go-live.md/apps/web/lib/ai/expert-query-state.ts para o
// mesmo padrão já aplicado ao fluxo dos Experts.

export type CreateSlaActionState = { error: string | null; success: boolean };
export const initialCreateSlaActionState: CreateSlaActionState = { error: null, success: false };

export type AssumeSlaActionState = { error: string | null; success: boolean };
export const initialAssumeSlaActionState: AssumeSlaActionState = { error: null, success: false };

export type StartSlaActionState = { error: string | null; success: boolean };
export const initialStartSlaActionState: StartSlaActionState = { error: null, success: false };

export type CompleteSlaActionState = { error: string | null; success: boolean };
export const initialCompleteSlaActionState: CompleteSlaActionState = { error: null, success: false };

export type ReassignSlaActionState = { error: string | null; success: boolean };
export const initialReassignSlaActionState: ReassignSlaActionState = { error: null, success: false };

export type ConfigureSlaMatrixState = { error: string | null; success: boolean };
export const initialConfigureSlaMatrixState: ConfigureSlaMatrixState = { error: null, success: false };

export type ConfigureSlaResponsiblesState = { error: string | null; success: boolean };
export const initialConfigureSlaResponsiblesState: ConfigureSlaResponsiblesState = { error: null, success: false };

export type ProcessSlaEscalationsState = { error: string | null; escalatedCount: number };
export const initialProcessSlaEscalationsState: ProcessSlaEscalationsState = { error: null, escalatedCount: 0 };

export type ConfigureSlaProjectSettingsState = { error: string | null; success: boolean };
export const initialConfigureSlaProjectSettingsState: ConfigureSlaProjectSettingsState = {
  error: null,
  success: false,
};
