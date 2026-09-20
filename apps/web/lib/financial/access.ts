// Regra ÚNICA de acesso ao dashboard FINANCEIRO — espelhada nas funções
// SQL public.can_view_project_financial_dashboard e
// public.can_edit_project_financial_data (migration 20260920120000),
// usadas pela RLS da aba FINANCEIRO e pelas RPCs. Nunca baseada em
// nome/e-mail: só papel + área + status da membership do projeto.
//
// VISUALIZAR (política restritiva):
//   membership ACTIVE no projeto E (
//     papel ADMINISTRADOR ou GERENTE
//     OU área DIRETORIA ou FINANCEIRO
//   ).
// CORRIGIR/VALIDAR valores financeiros:
//   visualizar E permissão de edição do modelo existente
//   (can_manage_project_documents = ADMINISTRADOR ou GERENTE) —
//   nunca perfil somente LEITURA nem COLABORADOR.
//
// O valor legado GESTOR (=> GERENTE) é tratado exclusivamente em
// lib/users/project-permission.ts; aqui só existem papéis normalizados.

import type { ProjectPermission } from "@axion/types";
import { hasProjectEditPermission, normalizeProjectPermission, type NormalizedProjectPermission } from "@/lib/users/project-permission";

export const FINANCIAL_DASHBOARD_ROLES: ReadonlyArray<NormalizedProjectPermission> = ["ADMINISTRADOR", "GERENTE"];
export const FINANCIAL_DASHBOARD_AREAS: ReadonlyArray<string> = ["DIRETORIA", "FINANCEIRO"];

export interface FinancialAccessInput {
  permission: ProjectPermission | string | null;
  status: "ACTIVE" | "INACTIVE" | string | null;
  area: string | null;
}

export function evaluateFinancialDashboardAccess(input: FinancialAccessInput): { allowed: boolean; reason: string } {
  const permission = normalizeProjectPermission(input.permission);
  if (!permission || input.status !== "ACTIVE") return { allowed: false, reason: "Sem membership ACTIVE neste projeto." };
  if (FINANCIAL_DASHBOARD_ROLES.includes(permission)) return { allowed: true, reason: `Papel ${permission}.` };
  if (input.area && FINANCIAL_DASHBOARD_AREAS.includes(input.area)) return { allowed: true, reason: `Área ${input.area}.` };
  return { allowed: false, reason: `Papel ${permission}${input.area ? ` / área ${input.area}` : ""} sem acesso financeiro.` };
}

export function evaluateFinancialEditAccess(input: FinancialAccessInput): { allowed: boolean; reason: string } {
  const view = evaluateFinancialDashboardAccess(input);
  if (!view.allowed) return view;
  const permission = normalizeProjectPermission(input.permission);
  if (hasProjectEditPermission(permission)) return { allowed: true, reason: `Visualiza e tem permissão de edição (${permission}).` };
  return { allowed: false, reason: `Visualiza, mas o papel ${permission} não tem permissão de edição (somente ADMINISTRADOR/GERENTE).` };
}
