// Helper ÚNICO de compatibilidade do papel de projeto.
//
// Modelo vigente (packages/types ProjectPermission + CHECK em
// project_memberships): ADMINISTRADOR, GERENTE, COLABORADOR, LEITURA.
// "GESTOR" é o valor LEGADO de GERENTE (rótulo "Gerente"; mantido no CHECK
// apenas por compatibilidade — migration 20260829200000). Este é o único
// lugar do código novo que conhece o valor legado: todo o resto trabalha
// com o papel normalizado. Nenhum papel é inventado fora do modelo.
//
// Permissão de EDIÇÃO do modelo existente = SQL can_manage_project_documents
// (membership ACTIVE e papel ADMINISTRADOR ou GERENTE). COLABORADOR e
// LEITURA não editam.

import type { ProjectPermission } from "@axion/types";

export type NormalizedProjectPermission = "ADMINISTRADOR" | "GERENTE" | "COLABORADOR" | "LEITURA";

export const PROJECT_EDIT_ROLES: ReadonlyArray<NormalizedProjectPermission> = ["ADMINISTRADOR", "GERENTE"];

export function normalizeProjectPermission(permission: ProjectPermission | string | null | undefined): NormalizedProjectPermission | null {
  switch (permission) {
    case "ADMINISTRADOR":
    case "GERENTE":
    case "COLABORADOR":
    case "LEITURA":
      return permission;
    case "GESTOR":
      return "GERENTE";
    default:
      return null;
  }
}

/** Espelho TS de public.can_manage_project_documents (sem o status, que é do chamador). */
export function hasProjectEditPermission(permission: ProjectPermission | string | null | undefined): boolean {
  const normalized = normalizeProjectPermission(permission);
  return normalized !== null && PROJECT_EDIT_ROLES.includes(normalized);
}
