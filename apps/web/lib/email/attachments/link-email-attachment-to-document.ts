// Promoção de um anexo já ingerido para o pipeline documental
// (documents/document_versions) — nunca automática: quem chama decide
// explicitamente `kind`/título/data/resumo (o sistema nunca classifica
// sozinho que tipo de documento um anexo é). Reaproveita o MESMO objeto
// já salvo no Supabase Storage — nunca re-upload, nunca duplica bytes.
//
// Depois de promovido, o anexo passa a ser um document_version normal:
// aparece em getManagedDocuments, pode ser citado como
// evidenceRef/contractualBasis via event_evidence (mesmo mecanismo já
// usado por qualquer outro documento) e entra automaticamente na fila
// de extração de texto (processing_status='AWAITING_PROCESSING', o
// mesmo pipeline de scripts/process-document-version.mjs — nenhuma
// extração de texto nova foi criada aqui).
//
// Deliberadamente NÃO cria um contract_event nem um event_evidence —
// só a existência de um anexo nunca justifica um evento no Ledger (ver
// docs/email-attachments-and-drive-mirror.md). Vincular o
// document_version resultante a um evento real continua sendo uma ação
// humana separada e explícita, como qualquer outro documento hoje.

import type { SupabaseClient } from "@supabase/supabase-js";

/** Mesmos valores de documents.kind já existentes — nunca um novo valor "ANEXO_EMAIL" genérico. */
export type EmailAttachmentDocumentKind =
  | "CONTRATO_BASE"
  | "ADITIVO"
  | "EDITAL"
  | "RFI"
  | "RFP"
  | "ESPECIFICACAO"
  | "DESENHO"
  | "PLANILHA"
  | "CRONOGRAMA_BASELINE"
  | "CRONOGRAMA_REVISAO"
  | "RELATORIO_SEMANAL"
  | "PROPOSTA_AXION"
  | "CLARIFICACAO_CLIENTE";

export interface LinkEmailAttachmentToDocumentInput {
  attachmentId: string;
  kind: EmailAttachmentDocumentKind;
  documentTitle: string;
  /** Data ISO (YYYY-MM-DD) do documento — normalmente a data de recebimento do e-mail. */
  documentDate: string;
  author: string;
  summary: string;
}

export interface LinkEmailAttachmentToDocumentResult {
  documentId: string;
  documentVersionId: string;
}

type AttachmentRow = {
  id: string;
  project_id: string;
  storage_bucket: string;
  storage_path: string;
  original_file_name: string;
  mime_type: string;
  file_size_bytes: number;
  source_language: string | null;
  document_version_id: string | null;
};

export async function linkEmailAttachmentToDocument(
  supabase: SupabaseClient,
  input: LinkEmailAttachmentToDocumentInput
): Promise<LinkEmailAttachmentToDocumentResult> {
  const { attachmentId, kind, documentTitle, documentDate, author, summary } = input;

  const { data: attachmentData, error: attachmentError } = await supabase
    .from("email_attachments")
    .select("id,project_id,storage_bucket,storage_path,original_file_name,mime_type,file_size_bytes,source_language,document_version_id")
    .eq("id", attachmentId)
    .maybeSingle();

  if (attachmentError) {
    throw new Error(`Falha ao carregar anexo para promoção: ${attachmentError.message}`);
  }
  const attachment = attachmentData as AttachmentRow | null;
  if (!attachment) {
    throw new Error(`Anexo (id=${attachmentId}) não encontrado.`);
  }

  // Idempotente: já promovido? nunca cria um segundo document_version para o mesmo anexo.
  if (attachment.document_version_id) {
    const { data: existingVersion, error: existingVersionError } = await supabase
      .from("document_versions")
      .select("id,document_id")
      .eq("id", attachment.document_version_id)
      .maybeSingle();
    if (existingVersionError) {
      throw new Error(`Falha ao verificar promoção existente: ${existingVersionError.message}`);
    }
    if (existingVersion) {
      return { documentId: existingVersion.document_id, documentVersionId: existingVersion.id };
    }
  }

  try {
    const { data: documentData, error: documentError } = await supabase
      .from("documents")
      .insert({ project_id: attachment.project_id, kind, title: documentTitle })
      .select("id")
      .single();

    if (documentError) {
      throw new Error(`Falha ao criar documento a partir do anexo: ${documentError.message}`);
    }
    const documentId = documentData.id as string;

    const { data: versionData, error: versionError } = await supabase
      .from("document_versions")
      .insert({
        document_id: documentId,
        version_label: "v1",
        version_index: 1,
        document_date: documentDate,
        source_type: "EMAIL",
        author,
        summary,
        // Reaproveita o MESMO objeto de Storage já salvo na ingestão —
        // nunca re-upload.
        file_path: attachment.storage_path,
        storage_bucket: attachment.storage_bucket,
        original_file_name: attachment.original_file_name,
        mime_type: attachment.mime_type,
        file_size_bytes: attachment.file_size_bytes,
        // Entra na mesma fila de extração de texto já existente —
        // nenhum pipeline de processamento novo foi criado.
        processing_status: "AWAITING_PROCESSING",
        source_language: attachment.source_language,
      })
      .select("id")
      .single();

    if (versionError) {
      throw new Error(`Falha ao criar versão de documento a partir do anexo: ${versionError.message}`);
    }
    const documentVersionId = versionData.id as string;

    const { error: updateError } = await supabase
      .from("email_attachments")
      .update({ document_version_id: documentVersionId, processing_status: "PROCESSED", processing_error: null })
      .eq("id", attachmentId);

    if (updateError) {
      throw new Error(`Falha ao vincular anexo ao documento criado: ${updateError.message}`);
    }

    const { error: auditError } = await supabase.from("audit_log_entries").insert({
      project_id: attachment.project_id,
      actor_type: "SYSTEM",
      actor_user_id: null,
      actor_label: null,
      action: "EMAIL_ATTACHMENT_PROCESSED",
      entity_type: "EMAIL_ATTACHMENT",
      entity_id: attachmentId,
      detail: `Anexo "${attachment.original_file_name}" promovido a documento (kind=${kind}, document_version_id=${documentVersionId}).`,
    });
    if (auditError) {
      throw new Error(`Falha ao registrar auditoria de processamento de anexo: ${auditError.message}`);
    }

    return { documentId, documentVersionId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase
      .from("email_attachments")
      .update({ processing_status: "FAILED", processing_error: message })
      .eq("id", attachmentId);
    throw error instanceof Error ? error : new Error(message);
  }
}
