"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@axion/db/server";
import { getCurrentProjectPermission } from "@/lib/contract-review";
import type { ConfigureContractAlertResponsibleState } from "./responsible-actions-state";

// Este módulo é "use server" — só pode exportar funções async (Server
// Actions). Tipo e estado inicial vivem em ./responsible-actions-state.ts.

function optionalField(formData: FormData, name: string): string | null {
  const value = String(formData.get(name) ?? "").trim();
  return value || null;
}

function requiredField(formData: FormData, name: string): string {
  const value = optionalField(formData, name);
  if (!value) throw new Error(`Campo obrigatório ausente: ${name}`);
  return value;
}

// "Responsável pelos alertas contratuais" — decisão aprovada (ver
// relatório enviado ao usuário): configuração EXPLÍCITA por projeto,
// nunca inferida (nem ADMINISTRADOR, nem criador do evento, nem último
// responsável). Esta action é a ÚNICA forma de gravar/alterar
// contract_alert_responsibles — o job semanal automático
// (run-weekly-contract-alert-batches.ts) só lê, nunca escreve.
export async function configureContractAlertResponsibleAction(
  _prevState: ConfigureContractAlertResponsibleState,
  formData: FormData
): Promise<ConfigureContractAlertResponsibleState> {
  const supabase = await createSupabaseServerClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return { error: "Sessão expirada. Faça login novamente.", success: false };
  }

  try {
    const projectId = requiredField(formData, "projectId");
    const responsibleUserId = requiredField(formData, "responsibleUserId");

    // Checagem no servidor (requisito 9) — nunca confia na permissão
    // exibida no navegador. RLS (contract_alert_responsibles_write_
    // admin_only) reforça isso de qualquer forma; esta checagem só evita
    // uma escrita que a RLS rejeitaria silenciosamente sem mensagem
    // clara para quem tentou.
    if ((await getCurrentProjectPermission(projectId)) !== "ADMINISTRADOR") {
      return { error: "Apenas administradores podem definir o responsável pelos alertas contratuais.", success: false };
    }

    // Requisito 9: o usuário escolhido precisa pertencer ao projeto E
    // estar ativo — nunca confiar no que veio do <select> do navegador,
    // sempre revalidar contra a mesma fonte canônica de membros
    // (project_memberships), como todo outro fluxo de destinatário deste
    // repositório (send-alert-actions.ts, sla área responsáveis).
    const { data: membership, error: membershipError } = await supabase
      .from("project_memberships")
      .select("user_id,status")
      .eq("project_id", projectId)
      .eq("user_id", responsibleUserId)
      .maybeSingle();

    if (membershipError || !membership) {
      return { error: "O usuário selecionado não pertence a este projeto.", success: false };
    }
    if (membership.status !== "ACTIVE") {
      return { error: "O usuário selecionado não está ativo neste projeto.", success: false };
    }

    const { error: upsertError } = await supabase.from("contract_alert_responsibles").upsert(
      {
        project_id: projectId,
        responsible_user_id: responsibleUserId,
        updated_by_user_id: authData.user.id,
      },
      { onConflict: "project_id" }
    );

    if (upsertError) {
      return { error: "Não foi possível salvar o responsável pelos alertas contratuais.", success: false };
    }

    revalidatePath(`/${projectId}/ledger/lote-alertas`);
    return { error: null, success: true };
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message, success: false };
    }
    throw error;
  }
}
