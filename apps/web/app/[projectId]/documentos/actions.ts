"use server";

// Server Actions de Documentos. A promoção de anexo de e-mail passa
// pelo client de sessão (createSupabaseServerClient) chamando a RPC
// SECURITY DEFINER promote_email_attachment_to_document (ver migration
// 20260823100000) — nunca service-role a partir daqui: a RPC valida
// EDITOR/ADMIN e faz a escrita privilegiada internamente, exatamente
// como register_project_document_upload já faz para upload manual.

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@axion/db/server";
import type { EmailAttachmentDocumentKind } from "@/lib/email/attachments/link-email-attachment-to-document";
import type {
  LinkContractualAttachmentState,
  PromoteEmailAttachmentState,
  RestoreDocumentState,
  TrashDocumentState,
  UnlinkContractualAttachmentState,
} from "./actions-state";

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

export async function promoteEmailAttachmentAction(
  _prevState: PromoteEmailAttachmentState,
  formData: FormData
): Promise<PromoteEmailAttachmentState> {
  const supabase = await createSupabaseServerClient();
  try {
    await requireUser(supabase);
    const projectId = requiredField(formData, "projectId");
    const attachmentId = requiredField(formData, "attachmentId");
    const kind = requiredField(formData, "kind") as EmailAttachmentDocumentKind;
    const documentTitle = requiredField(formData, "documentTitle");
    const documentDate = requiredField(formData, "documentDate");
    const author = requiredField(formData, "author");
    const summary = requiredField(formData, "summary");

    const { data, error } = await supabase
      .rpc("promote_email_attachment_to_document", {
        p_attachment_id: attachmentId,
        p_kind: kind,
        p_document_title: documentTitle,
        p_document_date: documentDate,
        p_author: author,
        p_summary: summary,
      })
      .single();

    if (error) throw new Error(error.message);

    revalidatePath(`/${projectId}/documentos`);
    return { error: null, success: true, documentVersionId: (data as { document_version_id: string }).document_version_id };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Falha ao incorporar anexo aos Documentos.",
      success: false,
      documentVersionId: null,
    };
  }
}

// "Vincular como anexo contratual" / "Desvincular" — chamam
// exclusivamente as RPCs link_document_as_contractual_attachment /
// unlink_document_contractual_attachment (migration
// 20260829090000_document_contractual_attachment_linkage.sql, AINDA
// NÃO APLICADA — ver relatório "Compatibilidade de deploy"). O
// navegador só envia projectId + os ids + o texto do fundamento/
// justificativa + o que a TELA ACHA que é o pai atual (concorrência
// otimista) — TUDO o mais (mesmo projeto, tipo do pai, ciclo,
// permissão, se o pai esperado ainda bate com o real) é resolvido e
// validado de novo dentro da RPC, nunca confiado ao formulário.
// Nenhuma escrita direta em `documents` — a RPC é o único caminho
// (reforçado por trigger no banco).
//
// CONFLICT_STALE_PARENT / CONFIRMATION_REQUIRED: prefixos que a RPC
// usa na mensagem de erro para os dois casos que o formulário precisa
// tratar de forma diferenciada (ver LinkContractualAttachmentState) —
// nunca inferidos do texto livre da mensagem, sempre desse prefixo
// estável.
export async function linkDocumentAsContractualAttachmentAction(
  _prevState: LinkContractualAttachmentState,
  formData: FormData
): Promise<LinkContractualAttachmentState> {
  const supabase = await createSupabaseServerClient();
  try {
    await requireUser(supabase);
    const projectId = requiredField(formData, "projectId");
    const childDocumentId = requiredField(formData, "childDocumentId");
    const parentDocumentId = requiredField(formData, "parentDocumentId");
    const incorporationBasis = requiredField(formData, "incorporationBasis");
    // null = "a tela acha que este documento não tem pai algum agora"
    // — um valor legítimo, nunca tratado como campo ausente.
    const expectedParentDocumentId = optionalField(formData, "expectedParentDocumentId");
    // A confirmação real é sempre validada de novo dentro da RPC
    // (p_confirm_parent_change) — isto aqui só repassa o que o
    // checkbox React sinalizou, nunca é, sozinho, a autorização.
    const confirmParentChange = formData.get("confirmParentChange") === "true";

    const { error } = await supabase.rpc("link_document_as_contractual_attachment", {
      p_project_id: projectId,
      p_child_document_id: childDocumentId,
      p_parent_document_id: parentDocumentId,
      p_incorporation_basis: incorporationBasis,
      p_expected_parent_document_id: expectedParentDocumentId,
      p_confirm_parent_change: confirmParentChange,
    });

    if (error) {
      if (error.message.includes("CONFLICT_STALE_PARENT")) {
        return {
          error: "O vínculo deste documento mudou desde que a página foi carregada. Recarregue a página e tente novamente.",
          success: false,
          conflict: true,
          confirmationRequired: false,
        };
      }
      if (error.message.includes("CONFIRMATION_REQUIRED")) {
        return {
          error: "Já existe um vínculo com outro documento pai. Confirme a troca e envie novamente.",
          success: false,
          conflict: false,
          confirmationRequired: true,
        };
      }
      throw new Error(error.message);
    }

    revalidatePath(`/${projectId}/documentos`);
    return { error: null, success: true, conflict: false, confirmationRequired: false };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Falha ao vincular o documento como anexo contratual.",
      success: false,
      conflict: false,
      confirmationRequired: false,
    };
  }
}

export async function unlinkDocumentContractualAttachmentAction(
  _prevState: UnlinkContractualAttachmentState,
  formData: FormData
): Promise<UnlinkContractualAttachmentState> {
  const supabase = await createSupabaseServerClient();
  try {
    await requireUser(supabase);
    const projectId = requiredField(formData, "projectId");
    const childDocumentId = requiredField(formData, "childDocumentId");
    const reason = requiredField(formData, "reason");

    const { error } = await supabase.rpc("unlink_document_contractual_attachment", {
      p_project_id: projectId,
      p_child_document_id: childDocumentId,
      p_reason: reason,
    });

    if (error) throw new Error(error.message);

    revalidatePath(`/${projectId}/documentos`);
    return { error: null, success: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Falha ao desvincular o anexo contratual.",
      success: false,
    };
  }
}

// "Enviar para a lixeira" / "Restaurar" — chamam exclusivamente
// trash_project_document/restore_project_document (migration
// 20260829150000_document_trash_restore.sql). Reversível por
// construção: nunca apaga arquivo de Storage, versão, cláusula ou
// evidência — só um flag. Somente ADMINISTRADOR ativo do projeto (a
// RPC revalida isso no servidor, nunca confia na UI).
export async function trashProjectDocumentAction(
  _prevState: TrashDocumentState,
  formData: FormData
): Promise<TrashDocumentState> {
  const supabase = await createSupabaseServerClient();
  try {
    await requireUser(supabase);
    const projectId = requiredField(formData, "projectId");
    const documentId = requiredField(formData, "documentId");
    const reason = requiredField(formData, "reason");

    const { error } = await supabase.rpc("trash_project_document", {
      p_document_id: documentId,
      p_reason: reason,
    });
    if (error) throw new Error(error.message);

    revalidatePath(`/${projectId}/documentos`);
    return { error: null, success: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Falha ao enviar o documento para a lixeira.",
      success: false,
    };
  }
}

export async function restoreProjectDocumentAction(
  _prevState: RestoreDocumentState,
  formData: FormData
): Promise<RestoreDocumentState> {
  const supabase = await createSupabaseServerClient();
  try {
    await requireUser(supabase);
    const projectId = requiredField(formData, "projectId");
    const documentId = requiredField(formData, "documentId");

    const { error } = await supabase.rpc("restore_project_document", { p_document_id: documentId });
    if (error) throw new Error(error.message);

    revalidatePath(`/${projectId}/documentos`);
    return { error: null, success: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Falha ao restaurar o documento da lixeira.",
      success: false,
    };
  }
}
