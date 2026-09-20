// Verificação server-side do acesso financeiro — mesma regra de access.ts
// aplicada com o client de SESSÃO (a membership do próprio usuário é
// legível via RLS). Usada pelo layout (esconder o item), pela rota
// (acesso negado), pelo loader e pelas actions — nunca só pelo menu.

import "server-only";

import { createSupabaseServerClient } from "@axion/db/server";
import { evaluateFinancialDashboardAccess, evaluateFinancialEditAccess, type FinancialAccessInput } from "./access";

export interface ProjectFinancialAccess {
  canView: boolean;
  canEdit: boolean;
}

async function loadOwnMembership(projectId: string, userId?: string | null): Promise<FinancialAccessInput | null> {
  const supabase = await createSupabaseServerClient();
  let resolvedUserId = userId ?? null;
  if (!resolvedUserId) {
    const { data } = await supabase.auth.getUser();
    resolvedUserId = data.user?.id ?? null;
  }
  if (!resolvedUserId) return null;

  const { data, error } = await supabase
    .from("project_memberships")
    .select("permission,status,area")
    .eq("project_id", projectId)
    .eq("user_id", resolvedUserId)
    .maybeSingle();
  if (error) throw new Error(`Falha ao verificar acesso financeiro: ${error.message}`);
  if (!data) return null;
  return { permission: data.permission as string, status: data.status as string, area: (data.area as string | null) ?? null };
}

/** Decisão única (visualizar + corrigir) para menu, rota, loader e actions. */
export async function getProjectFinancialAccess(input: { projectId: string; userId?: string | null }): Promise<ProjectFinancialAccess> {
  const membership = await loadOwnMembership(input.projectId, input.userId);
  if (!membership) return { canView: false, canEdit: false };
  return {
    canView: evaluateFinancialDashboardAccess(membership).allowed,
    canEdit: evaluateFinancialEditAccess(membership).allowed,
  };
}

export async function canViewProjectFinancialDashboard(input: { projectId: string; userId?: string | null }): Promise<boolean> {
  return (await getProjectFinancialAccess(input)).canView;
}
