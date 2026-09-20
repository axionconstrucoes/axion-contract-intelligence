// FONTE OFICIAL DO ESCALÃO: a "Matriz de responsabilidades e prazos"
// (aba Usuários e permissões) = public.sla_area_responsibles.
//
// Correspondência interface ↔ banco (ver
// components/sla/sla-area-responsibles-form.tsx e lib/labels.ts):
//   "Nível 1 · Responsável"    -> responsible_direct_user_id
//   "Nível 1 · Corresponsável" -> secondary_responsible_user_id
//   "Nível 2 · Gerência"       -> escalation_1_user_id
//   "Nível 3 · Diretoria"      -> board_user_id
//   escalation_2_user_id       -> campo LEGADO, não exposto na interface
//
// Este helper é a ÚNICA tradução "usuário -> escalão" do sistema. Nenhum
// outro módulo/tabela pode guardar um escalão paralelo: quem precisa
// saber se alguém é 1º/2º escalão de uma área chama este helper (a
// função pura recebe a linha da matriz; o loader busca a linha).
// Nunca infere escalão por cargo, nome, e-mail ou domínio.

import type { SupabaseClient } from "@supabase/supabase-js";

export type UserResponsibilityTier =
  | "FIRST_TIER"
  | "SECOND_TIER"
  | "NOT_AUTHORIZED"
  | "AMBIGUOUS"
  | "NOT_CONFIGURED";

/** Subconjunto de sla_area_responsibles relevante para o escalão (mesmos nomes de coluna). */
export interface ResponsibilityMatrixRow {
  responsible_direct_user_id: string | null;
  secondary_responsible_user_id: string | null;
  escalation_1_user_id: string | null;
  /** Legado (não exposto na UI): presença aqui nunca autoriza sozinha — gera AMBIGUOUS. */
  escalation_2_user_id: string | null;
  board_user_id: string | null;
}

export interface ResolveUserResponsibilityTierResult {
  tier: UserResponsibilityTier;
  /** Posições da matriz em que o usuário aparece (fato, para evidência). */
  positions: Array<"RESPONSIBLE_DIRECT" | "SECONDARY_RESPONSIBLE" | "ESCALATION_1" | "ESCALATION_2_LEGACY" | "BOARD">;
  reason: string;
}

export function resolveUserResponsibilityTier(input: {
  userId: string;
  matrixRow: ResponsibilityMatrixRow | null;
}): ResolveUserResponsibilityTierResult {
  const { userId, matrixRow } = input;

  if (!matrixRow) {
    return {
      tier: "NOT_CONFIGURED",
      positions: [],
      reason: "Matriz de responsabilidades e prazos não configurada para esta área neste projeto.",
    };
  }

  const positions: ResolveUserResponsibilityTierResult["positions"] = [];
  if (matrixRow.responsible_direct_user_id === userId) positions.push("RESPONSIBLE_DIRECT");
  if (matrixRow.secondary_responsible_user_id === userId) positions.push("SECONDARY_RESPONSIBLE");
  if (matrixRow.escalation_1_user_id === userId) positions.push("ESCALATION_1");
  if (matrixRow.escalation_2_user_id === userId) positions.push("ESCALATION_2_LEGACY");
  if (matrixRow.board_user_id === userId) positions.push("BOARD");

  const firstTier = positions.includes("RESPONSIBLE_DIRECT") || positions.includes("SECONDARY_RESPONSIBLE");
  const secondTier = positions.includes("ESCALATION_1");
  const legacy = positions.includes("ESCALATION_2_LEGACY");
  const board = positions.includes("BOARD");

  if (
    !matrixRow.responsible_direct_user_id &&
    !matrixRow.secondary_responsible_user_id &&
    !matrixRow.escalation_1_user_id &&
    !matrixRow.board_user_id
  ) {
    return {
      tier: "NOT_CONFIGURED",
      positions,
      reason: "Matriz existe, mas nenhum nível está definido para esta área.",
    };
  }

  // Conflitos: mesma pessoa em 1º E 2º escalão, ou só no campo legado
  // não exposto — nunca resolvidos automaticamente.
  if (firstTier && secondTier) {
    return {
      tier: "AMBIGUOUS",
      positions,
      reason: "Usuário aparece simultaneamente no Nível 1 e no Nível 2 da Matriz.",
    };
  }
  if (legacy && !firstTier && !secondTier) {
    return {
      tier: "AMBIGUOUS",
      positions,
      reason: "Usuário consta apenas no campo legado de 2º escalão (não exposto na interface).",
    };
  }

  if (firstTier) return { tier: "FIRST_TIER", positions, reason: "Nível 1 (Responsável/Corresponsável) na Matriz." };
  if (secondTier) return { tier: "SECOND_TIER", positions, reason: "Nível 2 (Gerência) na Matriz." };
  if (board) return { tier: "NOT_AUTHORIZED", positions, reason: "Usuário está no Nível 3 (Diretoria), fora do 1º/2º escalão." };
  return { tier: "NOT_AUTHORIZED", positions, reason: "Usuário não consta na Matriz desta área." };
}

/** Loader: busca a linha da Matriz (projeto + área) e delega à função pura. */
export async function loadUserResponsibilityTier(
  supabase: SupabaseClient,
  input: { projectId: string; userId: string; area: string }
): Promise<ResolveUserResponsibilityTierResult> {
  const { data, error } = await supabase
    .from("sla_area_responsibles")
    .select("responsible_direct_user_id,secondary_responsible_user_id,escalation_1_user_id,escalation_2_user_id,board_user_id")
    .eq("project_id", input.projectId)
    .eq("area", input.area)
    .maybeSingle();
  if (error) throw new Error(`Falha ao carregar Matriz de responsabilidades: ${error.message}`);
  return resolveUserResponsibilityTier({ userId: input.userId, matrixRow: (data as ResponsibilityMatrixRow | null) ?? null });
}

/** Lista quem está no 1º e no 2º escalão de uma área (para exibição na aba Usuários). */
export function listMatrixTierMembers(matrixRow: ResponsibilityMatrixRow | null): {
  firstTier: string[];
  secondTier: string[];
} {
  if (!matrixRow) return { firstTier: [], secondTier: [] };
  const firstTier = [matrixRow.responsible_direct_user_id, matrixRow.secondary_responsible_user_id].filter(
    (value): value is string => Boolean(value)
  );
  const secondTier = matrixRow.escalation_1_user_id ? [matrixRow.escalation_1_user_id] : [];
  return { firstTier: [...new Set(firstTier)], secondTier };
}
