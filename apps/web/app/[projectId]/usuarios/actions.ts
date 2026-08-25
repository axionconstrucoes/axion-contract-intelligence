"use server";

// Server Actions do módulo Usuários & Permissões.
// Toda escrita passa pelo client de sessão (createSupabaseServerClient)
// — nunca service-role — chamando as RPCs SECURITY DEFINER
// (find_profile_by_email, add_project_member, update_project_member_role,
// set_project_member_status, remove_project_member), que validam
// Administrador do projeto e bloqueiam autoalteração internamente
// (defesa em profundidade além de RLS — ver migration
// 20260824090000_project_membership_roles_status_area.sql).

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@axion/db/server";
import { sendPolicyAcknowledgementEmail } from "@/lib/email/send-policy-acknowledgement-email";
import type {
  AddProjectMemberState,
  RemoveProjectMemberState,
  SetProjectMemberStatusState,
  UpdateProjectMemberRoleState,
} from "./actions-state";

const ALLOWED_EMAIL_DOMAIN = "axion.com.br";

function requiredField(formData: FormData, name: string): string {
  const value = String(formData.get(name) ?? "").trim();
  if (!value) throw new Error(`Campo obrigatório ausente: ${name}`);
  return value;
}

function optionalField(formData: FormData, name: string): string | null {
  const value = String(formData.get(name) ?? "").trim();
  return value || null;
}

async function requireUser(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Sessão expirada. Faça login novamente.");
  return data.user;
}

export async function addProjectMemberAction(
  _prevState: AddProjectMemberState,
  formData: FormData
): Promise<AddProjectMemberState> {
  const supabase = await createSupabaseServerClient();
  try {
    await requireUser(supabase);
    const projectId = requiredField(formData, "projectId");
    const email = requiredField(formData, "email").toLowerCase();
    const permission = requiredField(formData, "permission");
    const area = optionalField(formData, "area");

    const emailDomain = email.split("@")[1];
    if (emailDomain !== ALLOWED_EMAIL_DOMAIN) {
      return {
        error: `Apenas e-mails do domínio @${ALLOWED_EMAIL_DOMAIN} podem ser adicionados ao ACC.`,
        success: false,
        notOnboarded: false,
      };
    }

    const { data: profiles, error: lookupError } = await supabase.rpc("find_profile_by_email", {
      p_project_id: projectId,
      p_email: email,
    });
    if (lookupError) throw new Error(lookupError.message);

    if (!profiles || profiles.length === 0) {
      return {
        error: null,
        success: false,
        notOnboarded: true,
      };
    }

    const profile = profiles[0] as { id: string };

    const { error: addError } = await supabase.rpc("add_project_member", {
      p_project_id: projectId,
      p_user_id: profile.id,
      p_permission: permission,
      p_area: area,
    });
    if (addError) throw new Error(addError.message);

    const {
      data: acknowledgementRows,
      error: acknowledgementError,
    } = await supabase.rpc(
      "ensure_current_policy_acknowledgement",
      {
        p_project_id: projectId,
        p_user_id: profile.id,
      }
    );

    if (acknowledgementError) {
      throw new Error(acknowledgementError.message);
    }

    const acknowledgement =
      (acknowledgementRows?.[0] ?? null) as
        | {
            acknowledgement_id: string;
            acknowledgement_status: string;
            needs_send: boolean;
          }
        | null;

    if (!acknowledgement) {
      throw new Error(
        "Não foi possível criar/localizar o Termo de Ciência do usuário."
      );
    }

    if (
      acknowledgement.acknowledgement_status ===
        "AGUARDANDO_APROVACAO" &&
      acknowledgement.needs_send
    ) {
      await sendPolicyAcknowledgementEmail({
        projectId,
        acknowledgementId:
          acknowledgement.acknowledgement_id,
      });
    }

    revalidatePath(`/${projectId}/usuarios`);
    return { error: null, success: true, notOnboarded: false };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Falha ao adicionar usuário ao projeto.",
      success: false,
      notOnboarded: false,
    };
  }
}

export async function updateProjectMemberRoleAction(
  _prevState: UpdateProjectMemberRoleState,
  formData: FormData
): Promise<UpdateProjectMemberRoleState> {
  const supabase = await createSupabaseServerClient();
  try {
    await requireUser(supabase);
    const projectId = requiredField(formData, "projectId");
    const userId = requiredField(formData, "userId");
    const newPermission = requiredField(formData, "newPermission");

    const { error } = await supabase.rpc("update_project_member_role", {
      p_project_id: projectId,
      p_user_id: userId,
      p_new_permission: newPermission,
    });
    if (error) throw new Error(error.message);

    revalidatePath(`/${projectId}/usuarios`);
    return { error: null, success: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Falha ao alterar o papel do usuário.",
      success: false,
    };
  }
}

export async function setProjectMemberStatusAction(
  _prevState: SetProjectMemberStatusState,
  formData: FormData
): Promise<SetProjectMemberStatusState> {
  const supabase = await createSupabaseServerClient();
  try {
    await requireUser(supabase);
    const projectId = requiredField(formData, "projectId");
    const userId = requiredField(formData, "userId");
    const status = requiredField(formData, "status");

    const { error } = await supabase.rpc("set_project_member_status", {
      p_project_id: projectId,
      p_user_id: userId,
      p_status: status,
    });
    if (error) throw new Error(error.message);

    revalidatePath(`/${projectId}/usuarios`);
    return { error: null, success: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Falha ao ativar/desativar o usuário.",
      success: false,
    };
  }
}

export async function removeProjectMemberAction(
  _prevState: RemoveProjectMemberState,
  formData: FormData
): Promise<RemoveProjectMemberState> {
  const supabase = await createSupabaseServerClient();
  try {
    await requireUser(supabase);
    const projectId = requiredField(formData, "projectId");
    const userId = requiredField(formData, "userId");

    const { error } = await supabase.rpc("remove_project_member", {
      p_project_id: projectId,
      p_user_id: userId,
    });
    if (error) throw new Error(error.message);

    revalidatePath(`/${projectId}/usuarios`);
    return { error: null, success: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Falha ao remover o usuário do projeto.",
      success: false,
    };
  }
}

export type PolicyAcknowledgementSendState = {
  error: string | null;
  success: boolean;
};

export async function sendPolicyAcknowledgementRequestAction(
  _prevState: PolicyAcknowledgementSendState,
  formData: FormData
): Promise<PolicyAcknowledgementSendState> {
  const supabase = await createSupabaseServerClient();

  try {
    await requireUser(supabase);

    const projectId = requiredField(formData, "projectId");
    const userId = requiredField(formData, "userId");

    const {
      data: acknowledgementRows,
      error: acknowledgementError,
    } = await supabase.rpc(
      "ensure_current_policy_acknowledgement",
      {
        p_project_id: projectId,
        p_user_id: userId,
      }
    );

    if (acknowledgementError) {
      throw new Error(acknowledgementError.message);
    }

    const acknowledgement =
      (acknowledgementRows?.[0] ?? null) as
        | {
            acknowledgement_id: string;
            acknowledgement_status: string;
          }
        | null;

    if (!acknowledgement) {
      throw new Error(
        "Não foi possível localizar/criar o Termo deste usuário."
      );
    }

    if (
      acknowledgement.acknowledgement_status === "APROVADO"
    ) {
      return {
        error: null,
        success: true,
      };
    }

    await sendPolicyAcknowledgementEmail({
      projectId,
      acknowledgementId:
        acknowledgement.acknowledgement_id,
    });

    revalidatePath(`/${projectId}/usuarios`);

    return {
      error: null,
      success: true,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Falha ao enviar o Termo.",
      success: false,
    };
  }
}