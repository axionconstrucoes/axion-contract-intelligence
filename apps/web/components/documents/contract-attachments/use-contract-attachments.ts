"use client";

// "Anexos do Contrato" — hook client-side do painel expansível no card
// de CONTRATO_BASE. Reaproveita integralmente a infraestrutura já
// testada do upload múltiplo de Documentos (validação de
// extensão/tamanho, sha256, sanitização de nome, classificação de erro
// de Storage, limpeza de objeto órfão) — nunca duplica essas regras.
//
// Mais simples que useDocumentUploadQueue (multi-upload de Documentos):
// um anexo NUNCA cria documento novo, NUNCA precisa classificar
// NOVO/NOVA_VERSAO/CONFLITO — é sempre "adicionar mais um arquivo à
// versão atual", então não há decisão humana no meio do fluxo.
//
// Concorrência limitada (3 por vez, mesmo valor de
// useDocumentUploadQueue) — evita saturar o Storage com lotes grandes,
// sem a complexidade de fila com pause/retry por item.

import { useCallback, useState } from "react";
import { createSupabaseBrowserClient } from "@axion/db/browser";
import {
  classifyStorageUploadError,
  resolveExtension,
  sanitizeFileName,
} from "@/lib/documents/multi-upload/queue-core";
import { MAX_FILE_SIZE_BYTES, MIME_BY_EXTENSION } from "@/lib/documents/multi-upload/allowed-file-types";
import { computeFileSha256Hex } from "@/lib/documents/multi-upload/sha256";
import { removeOrphanedStorageObject } from "@/lib/documents/multi-upload/storage-cleanup";
import type { ContractAttachment } from "@/lib/documents/contract-attachments/types";

const BUCKET = "project-documents";
const UPLOAD_CONCURRENCY = 3;

export type UploadItemStatus = "VALIDANDO" | "CALCULANDO_HASH" | "ENVIANDO" | "REGISTRANDO" | "CONCLUIDO" | "ERRO" | "DUPLICADO";

export type UploadItem = {
  id: string;
  fileName: string;
  status: UploadItemStatus;
  progressPercent: number;
  errorMessage: string | null;
};

type AttachmentRow = {
  id: string;
  document_version_id: string;
  original_file_name: string;
  mime_type: string;
  file_size_bytes: number;
  description: string | null;
  uploaded_at: string;
  uploaded_by: string | null;
  storage_bucket: string;
  storage_path: string;
};

function mapRow(row: AttachmentRow, nameById: Map<string, string>): ContractAttachment {
  return {
    id: row.id,
    documentVersionId: row.document_version_id,
    originalFileName: row.original_file_name,
    mimeType: row.mime_type,
    fileSizeBytes: row.file_size_bytes,
    description: row.description,
    uploadedAt: row.uploaded_at,
    uploadedByUserId: row.uploaded_by,
    uploadedByUserName: row.uploaded_by ? (nameById.get(row.uploaded_by) ?? null) : null,
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
  };
}

export function useContractAttachments(projectId: string, documentId: string, documentVersionId: string) {
  const [attachments, setAttachments] = useState<ContractAttachment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);

  const fetchAttachments = useCallback(async () => {
    setLoading(true);
    setListError(null);

    try {
      const supabase = createSupabaseBrowserClient();

      const { data, error } = await supabase
        .from("document_version_files")
        .select("id,document_version_id,original_file_name,mime_type,file_size_bytes,description,uploaded_at,uploaded_by,storage_bucket,storage_path")
        .eq("document_version_id", documentVersionId)
        .eq("file_role", "ANEXO_CONTRATUAL")
        .order("uploaded_at", { ascending: false });

      if (error) throw error;

      const rows = (data ?? []) as unknown as AttachmentRow[];

      const uploaderIds = Array.from(new Set(rows.map((row) => row.uploaded_by).filter((id): id is string => Boolean(id))));

      const nameById = new Map<string, string>();
      if (uploaderIds.length > 0) {
        const { data: profilesData, error: profilesError } = await supabase.from("profiles").select("id,name").in("id", uploaderIds);
        if (profilesError) throw profilesError;
        for (const profile of (profilesData ?? []) as unknown as { id: string; name: string }[]) {
          nameById.set(profile.id, profile.name);
        }
      }

      setAttachments(rows.map((row) => mapRow(row, nameById)));
      setLoaded(true);
    } catch (caughtError) {
      setListError(caughtError instanceof Error ? caughtError.message : "Não foi possível carregar os anexos do contrato.");
    } finally {
      setLoading(false);
    }
  }, [documentVersionId]);

  const uploadOne = useCallback(
    async (file: File): Promise<void> => {
      const itemId = crypto.randomUUID();
      const setStatus = (patch: Partial<UploadItem>) =>
        setUploadItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, ...patch } : item)));

      setUploadItems((prev) => [
        ...prev,
        { id: itemId, fileName: file.name, status: "VALIDANDO", progressPercent: 0, errorMessage: null },
      ]);

      const extension = resolveExtension(file.name);
      const expectedMimeType = MIME_BY_EXTENSION[extension];

      if (file.size <= 0) {
        setStatus({ status: "ERRO", errorMessage: "Arquivo vazio." });
        return;
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        setStatus({ status: "ERRO", errorMessage: "Arquivo ultrapassa o limite de 50 MB." });
        return;
      }
      if (!expectedMimeType) {
        setStatus({ status: "ERRO", errorMessage: `Formato ".${extension || "?"}" não é aceito pelo sistema.` });
        return;
      }

      setStatus({ status: "CALCULANDO_HASH", progressPercent: 15 });

      let sha256Hash: string;
      try {
        sha256Hash = await computeFileSha256Hex(file);
      } catch {
        setStatus({ status: "ERRO", errorMessage: "Falha ao calcular o hash do arquivo." });
        return;
      }

      const supabase = createSupabaseBrowserClient();
      const sanitizedName = sanitizeFileName(file.name);
      const storagePath = `${projectId}/${documentId}/${documentVersionId}/anexos-contratuais/${crypto.randomUUID()}-${sanitizedName}`;

      let uploadedPath: string | null = null;

      try {
        setStatus({ status: "ENVIANDO", progressPercent: 35 });

        const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
          upsert: false,
          contentType: expectedMimeType,
        });

        if (uploadError) {
          setStatus({ status: "ERRO", errorMessage: classifyStorageUploadError(uploadError.message) });
          return;
        }

        uploadedPath = storagePath;
        setStatus({ status: "REGISTRANDO", progressPercent: 75 });

        const { error: registerError } = await supabase.rpc("register_document_version_file", {
          p_document_version_id: documentVersionId,
          p_file_role: "ANEXO_CONTRATUAL",
          p_storage_path: storagePath,
          p_original_file_name: file.name,
          p_mime_type: expectedMimeType,
          p_file_size_bytes: file.size,
          p_sha256_hash: sha256Hash,
          p_origin: "UPLOAD",
          p_description: null,
          p_replaces_file_id: null,
        });

        if (registerError) {
          const cleanup = await removeOrphanedStorageObject((paths) => supabase.storage.from(BUCKET).remove(paths), uploadedPath);
          uploadedPath = null;

          const isDuplicate = registerError.message.includes("DUPLICATE_ATTACHMENT_HASH");
          const baseMessage = isDuplicate
            ? "este arquivo (mesmo conteúdo) já está anexado a este contrato"
            : registerError.message.includes("Insufficient permission")
              ? "sem permissão para adicionar anexos contratuais"
              : "falha ao registrar o anexo";

          setStatus({
            status: isDuplicate ? "DUPLICADO" : "ERRO",
            errorMessage: cleanup.removed ? baseMessage : `${baseMessage}. ${cleanup.reconciliationError}`,
          });
          return;
        }

        uploadedPath = null;
        setStatus({ status: "CONCLUIDO", progressPercent: 100 });
      } catch (caughtError) {
        if (uploadedPath) {
          await removeOrphanedStorageObject((paths) => supabase.storage.from(BUCKET).remove(paths), uploadedPath);
        }
        setStatus({
          status: "ERRO",
          errorMessage: caughtError instanceof Error ? caughtError.message : "Falha inesperada no envio.",
        });
      }
    },
    [projectId, documentId, documentVersionId]
  );

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      for (let i = 0; i < list.length; i += UPLOAD_CONCURRENCY) {
        const batch = list.slice(i, i + UPLOAD_CONCURRENCY);
        await Promise.all(batch.map((file) => uploadOne(file)));
      }
      await fetchAttachments();
    },
    [uploadOne, fetchAttachments]
  );

  const deleteAttachment = useCallback(
    async (fileId: string): Promise<{ error: string | null }> => {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.rpc("delete_contract_attachment", { p_file_id: fileId });

      if (error) {
        return { error: error.message };
      }

      setAttachments((prev) => prev.filter((attachment) => attachment.id !== fileId));
      return { error: null };
    },
    []
  );

  return {
    attachments,
    loaded,
    loading,
    listError,
    uploadItems,
    fetchAttachments,
    addFiles,
    deleteAttachment,
  };
}
