"use client";

// "ANEXOS DO CONTRATO" — painel expansível no card de CONTRATO_BASE.
// Nunca cria contrato novo, nunca substitui o arquivo principal, nunca
// cria cláusula — só adiciona/lista/exclui arquivos complementares
// vinculados à versão atual (document_version_files, file_role =
// 'ANEXO_CONTRATUAL'). Mesmo padrão visual compacto dos demais
// controles do card (<details>, nunca aumenta a altura quando fechado).

import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@axion/db/browser";
import { formatDateTime, formatFileSize } from "@/lib/labels";
import type { ContractAttachment } from "@/lib/documents/contract-attachments/types";
import { ACCEPT_ATTRIBUTE } from "@/lib/documents/multi-upload/allowed-file-types";
import { useContractAttachments, type UploadItem } from "./use-contract-attachments";

const STATUS_LABELS: Record<UploadItem["status"], string> = {
  VALIDANDO: "Validando…",
  CALCULANDO_HASH: "Calculando hash…",
  ENVIANDO: "Enviando…",
  REGISTRANDO: "Registrando…",
  CONCLUIDO: "Concluído",
  ERRO: "Erro",
  DUPLICADO: "Já existe",
};

function extensionOf(fileName: string): string {
  const parts = fileName.split(".");
  return parts.length > 1 ? (parts.pop() ?? "").toUpperCase() : "—";
}

function AttachmentRow({
  attachment,
  canDelete,
  onDelete,
}: {
  attachment: ContractAttachment;
  canDelete: boolean;
  onDelete: (fileId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function openSignedUrl(forceDownload: boolean) {
    setBusy(true);
    setActionError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.storage
        .from(attachment.storageBucket)
        .createSignedUrl(attachment.storagePath, 60, forceDownload ? { download: attachment.originalFileName } : undefined);

      if (error) throw error;
      if (!data?.signedUrl) throw new Error("Não foi possível gerar o link temporário.");

      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (caughtError) {
      setActionError(caughtError instanceof Error ? caughtError.message : "Não foi possível abrir o arquivo.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    setActionError(null);
    try {
      await onDelete(attachment.id);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="flex flex-col gap-1 rounded-md border p-1.5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium" title={attachment.originalFileName}>
            {attachment.originalFileName}
          </span>
          <span className="text-muted-foreground">
            {extensionOf(attachment.originalFileName)} · {formatFileSize(attachment.fileSizeBytes)} ·{" "}
            {formatDateTime(attachment.uploadedAt)}
            {attachment.uploadedByUserName ? ` · ${attachment.uploadedByUserName}` : ""}
          </span>
          {attachment.description ? <span className="text-muted-foreground">{attachment.description}</span> : null}
        </div>

        <div className="flex shrink-0 flex-wrap gap-1">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => openSignedUrl(false)}>
            Visualizar
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => openSignedUrl(true)}>
            Baixar
          </Button>
          {canDelete && !confirming ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-destructive text-destructive hover:bg-destructive/10"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              Remover anexo do contrato
            </Button>
          ) : null}
        </div>
      </div>

      {/* Nunca "Excluir definitivamente": o objeto de Storage é
          deliberadamente preservado (histórico/auditoria) — só o
          vínculo/metadado é removido. A confirmação explica isso antes
          de qualquer ação irreversível na visualização. */}
      {canDelete && confirming ? (
        <div className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/5 p-1.5">
          <p>O vínculo será removido da visualização. O arquivo histórico permanecerá preservado para auditoria.</p>
          <div className="flex gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-destructive text-destructive hover:bg-destructive/10"
              disabled={busy}
              onClick={handleDelete}
            >
              {busy ? "Removendo…" : "Confirmar remoção"}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}

      {actionError ? <span className="text-destructive">{actionError}</span> : null}
    </div>
  );
}

export function ContractAttachmentsPanel({
  projectId,
  documentId,
  documentVersionId,
  initialCount,
  canAdd,
  canDelete,
}: {
  projectId: string;
  documentId: string;
  documentVersionId: string;
  initialCount: number;
  canAdd: boolean;
  canDelete: boolean;
}) {
  const { attachments, loaded, loading, listError, uploadItems, fetchAttachments, addFiles, deleteAttachment } =
    useContractAttachments(projectId, documentId, documentVersionId);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const count = loaded ? attachments.length : initialCount;

  function handleToggle(event: React.SyntheticEvent<HTMLDetailsElement>) {
    if (event.currentTarget.open && !loaded && !loading) {
      void fetchAttachments();
    }
  }

  async function handleFilesSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    await addFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleDelete(fileId: string) {
    setDeleteError(null);
    const { error } = await deleteAttachment(fileId);
    if (error) setDeleteError(error);
  }

  return (
    <details className="rounded-md border p-2" onToggle={handleToggle}>
      <summary className="cursor-pointer text-sm font-medium">Anexos do Contrato ({count})</summary>

      <div className="mt-1.5 flex flex-col gap-1.5">
        {loading && !loaded ? <p className="text-xs text-muted-foreground">Carregando anexos…</p> : null}
        {listError ? <p className="text-xs text-destructive">{listError}</p> : null}

        {loaded && attachments.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum anexo cadastrado.</p>
        ) : null}

        {attachments.map((attachment) => (
          <AttachmentRow key={attachment.id} attachment={attachment} canDelete={canDelete} onDelete={handleDelete} />
        ))}

        {deleteError ? <p className="text-xs text-destructive">{deleteError}</p> : null}

        {canAdd ? (
          <div className="flex flex-col gap-1 pt-1">
            <label className="flex flex-col gap-1 text-xs font-medium">
              Adicionar anexo(s)
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPT_ATTRIBUTE}
                onChange={handleFilesSelected}
                className="text-xs"
              />
            </label>

            {uploadItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">{item.fileName}</span>
                <span className="flex items-center gap-1">
                  {item.status !== "ERRO" && item.status !== "CONCLUIDO" && item.status !== "DUPLICADO" ? (
                    <Badge variant="outline">{item.progressPercent}%</Badge>
                  ) : null}
                  <Badge
                    variant={item.status === "ERRO" ? "destructive" : item.status === "CONCLUIDO" ? "secondary" : "outline"}
                  >
                    {STATUS_LABELS[item.status]}
                  </Badge>
                </span>
                {item.errorMessage ? <span className="text-destructive">{item.errorMessage}</span> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}
