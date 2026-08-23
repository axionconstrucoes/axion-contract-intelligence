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
import type { PromoteEmailAttachmentState } from "./actions-state";

function requiredField(formData: FormData, name: string): string {
  const value = String(formData.get(name) ?? "").trim();
  if (!value) throw new Error(`Campo obrigatório ausente: ${name}`);
  return value;
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
