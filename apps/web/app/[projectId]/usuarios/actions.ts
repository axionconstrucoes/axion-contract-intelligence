"use server";

// Server Actions de "Usuários & Permissões". Toda escrita passa pelo
// client de sessão (createSupabaseServerClient) — nunca service-role —
// chamando as RPCs SECURITY DEFINER oficiais (find_profile_by_email,
// add_project_member, set_project_member_status), que já validam
// ADMINISTRADOR ativo internamente. Nenhum INSERT/UPDATE direto em
// project_memberships/profiles é feito aqui.

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@axion/db/server";
import type {
  AddProjectMemberState,
  FoundProfile,
  PreRegisterMemberState,
  SearchProfileState,
  SetMemberJobTitleState,
  SetMemberStatusState,
  UpdateMemberPermissionState,
} from "./actions-state";

const AXION_EMAIL_DOMAIN = "@axion.com.br";

// Papéis permitidos ao adicionar um novo membro (LEITURA deliberadamente
// fora — o formulário só oferece ADMINISTRADOR/GESTOR/COLABORADOR, exatamente
// como especificado). O RPC add_project_member também valida isto no
// servidor — este allowlist é só para uma mensagem de erro mais clara
// antes de round-trip até o banco.
const ALLOWED_NEW_MEMBER_PERMISSIONS = ["ADMINISTRADOR", "GESTOR", "COLABORADOR"] as const;

// Os 4 papéis reais do banco (seção 6 — "não reintroduzir ADMIN/EDITOR/VIEWER").
const ALL_PERMISSIONS = ["ADMINISTRADOR", "GESTOR", "COLABORADOR", "LEITURA"] as const;

const ALLOWED_AREAS = [
  "DIRETORIA",
  "ADMINISTRATIVO",
  "COMERCIAL",
  "FINANCEIRO",
  "ENGENHARIA",
  "ORÇAMENTO",
  "JURÍDICO",
  "PLANEJAMENTO",
] as const;

function requiredField(formData: FormData, name: string): string {
  const value = String(formData.get(name) ?? "").trim();
  if (!value) throw new Error(`Campo obrigatório ausente: ${name}`);
  return value;
}

function optionalField(formData: FormData, name: string): string | null {
  const value = String(formData.get(name) ?? "").trim();
  return value || null;
}

// Busca por e-mail completo @axion.com.br via a RPC oficial
// find_profile_by_email — mesma proteção contra enumeração já embutida
// nela (exige ADMINISTRADOR do projeto, só igualdade exata, só domínio
// corporativo). Não existe, hoje, uma RPC de busca parcial por nome sem
// nova migration — deliberadamente fora do escopo desta tarefa ("não
// altere banco/migrations"); buscar por nome parcial não é suportado
// ainda.
export async function searchProfileForMembershipAction(
  _prevState: SearchProfileState,
  formData: FormData
): Promise<SearchProfileState> {
  const supabase = await createSupabaseServerClient();
  const projectId = requiredField(formData, "projectId");
  const query = requiredField(formData, "query").toLowerCase();

  if (!query.includes("@") || !query.endsWith(AXION_EMAIL_DOMAIN)) {
    return {
      error: `Busque pelo e-mail completo @axion.com.br (busca por nome parcial ainda não é suportada).`,
      result: null,
      searchedEmail: query,
      notFound: false,
    };
  }

  const { data, error } = await supabase.rpc("find_profile_by_email", {
    p_project_id: projectId,
    p_email: query,
  });

  if (error) {
    return { error: error.message, result: null, searchedEmail: query, notFound: false };
  }

  const row = (data as { id: string; name: string; avatar_initials: string }[] | null)?.[0] ?? null;

  if (!row) {
    return {
      error: "Nenhum profile encontrado para este e-mail. O usuário precisa ter feito o primeiro login no ACC — ou pode ser pré-cadastrado abaixo.",
      result: null,
      searchedEmail: query,
      notFound: true,
    };
  }

  const { data: existingMembership, error: membershipError } = await supabase
    .from("project_memberships")
    .select("user_id")
    .eq("project_id", projectId)
    .eq("user_id", row.id)
    .maybeSingle();

  if (membershipError) {
    return { error: membershipError.message, result: null, searchedEmail: query, notFound: false };
  }

  const found: FoundProfile = {
    id: row.id,
    name: row.name,
    avatarInitials: row.avatar_initials,
    alreadyMember: existingMembership !== null,
  };

  return {
    error: found.alreadyMember ? "Este usuário já pertence a este projeto." : null,
    result: found,
    searchedEmail: query,
    notFound: false,
  };
}

export async function addProjectMemberAction(
  _prevState: AddProjectMemberState,
  formData: FormData
): Promise<AddProjectMemberState> {
  const supabase = await createSupabaseServerClient();

  try {
    const projectId = requiredField(formData, "projectId");
    const userId = requiredField(formData, "userId");
    const permission = requiredField(formData, "permission");
    const area = requiredField(formData, "area");

    if (!ALLOWED_NEW_MEMBER_PERMISSIONS.includes(permission as (typeof ALLOWED_NEW_MEMBER_PERMISSIONS)[number])) {
      throw new Error(`Papel inválido: ${permission}.`);
    }

    if (!ALLOWED_AREAS.includes(area as (typeof ALLOWED_AREAS)[number])) {
      throw new Error(`Área inválida: ${area}.`);
    }

    const { error } = await supabase.rpc("add_project_member", {
      p_project_id: projectId,
      p_user_id: userId,
      p_permission: permission,
      p_area: area,
    });

    if (error) {
      throw new Error(error.message);
    }

    revalidatePath(`/${projectId}/usuarios`);
    return { error: null, success: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Falha ao adicionar usuário ao projeto.",
      success: false,
    };
  }
}

export async function setMemberStatusAction(
  _prevState: SetMemberStatusState,
  formData: FormData
): Promise<SetMemberStatusState> {
  const supabase = await createSupabaseServerClient();

  try {
    const projectId = requiredField(formData, "projectId");
    const userId = requiredField(formData, "userId");
    const status = requiredField(formData, "status");

    if (status !== "ACTIVE" && status !== "INACTIVE") {
      throw new Error(`Status inválido: ${status}.`);
    }

    const { error } = await supabase.rpc("set_project_member_status", {
      p_project_id: projectId,
      p_user_id: userId,
      p_status: status,
    });

    if (error) {
      throw new Error(error.message);
    }

    revalidatePath(`/${projectId}/usuarios`);
    return { error: null, success: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Falha ao alterar status do membro.",
      success: false,
    };
  }
}

// Edição de permissão — a RPC oficial confirmada no banco chama-se
// update_project_member_role (não "update_project_member_permission").
// A própria RPC já bloqueia: alterar o próprio papel, quem não é
// ADMINISTRADOR do projeto, papel inválido, e — via o trigger
// prevent_last_administrator_removal (20260824090000) — rebaixar o
// último ADMINISTRADOR ativo do projeto. Nenhuma dessas checagens é
// duplicada aqui: o erro da RPC é só repassado.
export async function updateMemberPermissionAction(
  _prevState: UpdateMemberPermissionState,
  formData: FormData
): Promise<UpdateMemberPermissionState> {
  const supabase = await createSupabaseServerClient();

  try {
    const projectId = requiredField(formData, "projectId");
    const userId = requiredField(formData, "userId");
    const newPermission = requiredField(formData, "newPermission");

    // Diferente do formulário de "Adicionar usuário" (que exclui
    // LEITURA de propósito), editar um membro existente aceita os 4
    // papéis reais — LEITURA é um rebaixamento legítimo aqui.
    if (!ALL_PERMISSIONS.includes(newPermission as (typeof ALL_PERMISSIONS)[number])) {
      throw new Error(`Papel inválido: ${newPermission}.`);
    }

    const { error } = await supabase.rpc("update_project_member_role", {
      p_project_id: projectId,
      p_user_id: userId,
      p_new_permission: newPermission,
    });

    if (error) {
      throw new Error(error.message);
    }

    revalidatePath(`/${projectId}/usuarios`);
    return { error: null, success: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Falha ao alterar permissão do membro.",
      success: false,
    };
  }
}

// Cargo (profiles.title) — RPC set_profile_job_title, migration
// 20260825120000, AINDA NÃO APLICADA em nenhum ambiente. Até lá, esta
// action falha com um erro do Postgres ("function ... does not
// exist"), nunca silenciosamente — é o comportamento esperado até a
// migration ser revisada e aplicada.
export async function setMemberJobTitleAction(
  _prevState: SetMemberJobTitleState,
  formData: FormData
): Promise<SetMemberJobTitleState> {
  const supabase = await createSupabaseServerClient();

  try {
    const projectId = requiredField(formData, "projectId");
    const userId = requiredField(formData, "userId");
    const jobTitle = optionalField(formData, "jobTitle");

    const { error } = await supabase.rpc("set_profile_job_title", {
      p_project_id: projectId,
      p_user_id: userId,
      p_job_title: jobTitle,
    });

    if (error) {
      throw new Error(error.message);
    }

    revalidatePath(`/${projectId}/usuarios`);
    return { error: null, success: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Falha ao definir o cargo do membro.",
      success: false,
    };
  }
}

// Pré-cadastro — RPC pre_register_project_member, migration
// 20260825120500, AINDA NÃO APLICADA em nenhum ambiente. Mesmo
// comportamento acima: falha explícita até a migration ser aplicada,
// nunca uma gravação alternativa (nunca INSERT direto, nunca
// service-role).
export async function preRegisterProjectMemberAction(
  _prevState: PreRegisterMemberState,
  formData: FormData
): Promise<PreRegisterMemberState> {
  const supabase = await createSupabaseServerClient();

  try {
    const projectId = requiredField(formData, "projectId");
    const email = requiredField(formData, "email").toLowerCase();
    const name = requiredField(formData, "name");
    const jobTitle = optionalField(formData, "jobTitle");
    const permission = requiredField(formData, "permission");
    const area = requiredField(formData, "area");

    if (!email.endsWith(AXION_EMAIL_DOMAIN)) {
      throw new Error(`Pré-cadastro restrito a e-mails ${AXION_EMAIL_DOMAIN}.`);
    }

    if (!ALLOWED_NEW_MEMBER_PERMISSIONS.includes(permission as (typeof ALLOWED_NEW_MEMBER_PERMISSIONS)[number])) {
      throw new Error(`Papel inválido: ${permission}.`);
    }

    if (!ALLOWED_AREAS.includes(area as (typeof ALLOWED_AREAS)[number])) {
      throw new Error(`Área inválida: ${area}.`);
    }

    const { error } = await supabase.rpc("pre_register_project_member", {
      p_project_id: projectId,
      p_email: email,
      p_name: name,
      p_job_title: jobTitle,
      p_area: area,
      p_permission: permission,
    });

    if (error) {
      throw new Error(error.message);
    }

    revalidatePath(`/${projectId}/usuarios`);
    return { error: null, success: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Falha ao pré-cadastrar usuário.",
      success: false,
    };
  }
}
