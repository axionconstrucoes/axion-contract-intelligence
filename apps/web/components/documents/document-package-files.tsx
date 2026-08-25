"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/navigation";

import {
  createSupabaseBrowserClient,
} from "@axion/db/browser";

import { Button } from "@/components/ui/button";
import {
  DocumentDownloadButton,
} from "@/components/documents/document-download-button";

const BUCKET = "project-documents";
const MAX_FILE_SIZE = 50 * 1024 * 1024;

const ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.xml,.mpp,.jpg,.jpeg,.png";

type FileRole =
  | "ANEXO_CONTRATUAL"
  | "EVIDENCIA_APROVACAO"
  | "DOCUMENTO_APOIO";

type StoredRole =
  | "PRINCIPAL"
  | FileRole;

type PendingFile = {
  key: string;
  file: File;
  role: FileRole;
  description: string;
};

type StoredFile = {
  id: string;
  file_role: StoredRole;
  original_file_name: string;
  mime_type: string;
  file_size_bytes: number;
  storage_bucket: string;
  storage_path: string;
  processing_status: string;
  uploaded_at: string;
};

type Props = {
  projectId: string;
  documentId: string;
  documentVersionId: string;
  canEdit: boolean;
};

type DbError = {
  message: string;
};

type FilesQueryClient = {
  from: (
    table: string
  ) => {
    select: (
      columns: string
    ) => {
      eq: (
        column: string,
        value: string
      ) => {
        order: (
          column: string,
          options: {
            ascending: boolean;
          }
        ) => Promise<{
          data: StoredFile[] | null;
          error: DbError | null;
        }>;
      };
    };
  };
};

type RpcClient = {
  rpc: (
    name: string,
    parameters: Record<string, unknown>
  ) => Promise<{
    data: unknown;
    error: DbError | null;
  }>;
};

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx:
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  xml: "application/xml",
  mpp: "application/vnd.ms-project",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

const ROLE_LABELS: Record<StoredRole, string> = {
  PRINCIPAL: "Arquivo principal",
  ANEXO_CONTRATUAL: "Anexo contratual",
  EVIDENCIA_APROVACAO: "Evidência de aprovação",
  DOCUMENTO_APOIO: "Documento de apoio",
};

function sanitizeFileName(name: string) {
  return (
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") ||
    "arquivo"
  );
}

function resolveMimeType(file: File) {
  const extension =
    file.name
      .split(".")
      .pop()
      ?.toLowerCase() ?? "";

  return MIME_BY_EXTENSION[extension] ?? null;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(
    bytes /
    (1024 * 1024)
  ).toFixed(1)} MB`;
}

async function sha256Hex(file: File) {
  const buffer = await file.arrayBuffer();

  const digest = await crypto.subtle.digest(
    "SHA-256",
    buffer
  );

  return Array.from(
    new Uint8Array(digest)
  )
    .map((byte) =>
      byte.toString(16).padStart(2, "0")
    )
    .join("");
}

export function DocumentPackageFiles({
  projectId,
  documentId,
  documentVersionId,
  canEdit,
}: Props) {
  const router = useRouter();

  const [storedFiles, setStoredFiles] =
    useState<StoredFile[]>([]);

  const [pendingFiles, setPendingFiles] =
    useState<PendingFile[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [uploading, setUploading] =
    useState(false);

  const [processed, setProcessed] =
    useState(0);

  const [error, setError] =
    useState<string | null>(null);

  const [message, setMessage] =
    useState<string | null>(null);

  const loadFiles = useCallback(
    async () => {
      const supabase =
        createSupabaseBrowserClient();

      const db =
        supabase as unknown as FilesQueryClient;

      const { data, error: queryError } =
        await db
          .from("document_version_files")
          .select(
            [
              "id",
              "file_role",
              "original_file_name",
              "mime_type",
              "file_size_bytes",
              "storage_bucket",
              "storage_path",
              "processing_status",
              "uploaded_at",
            ].join(",")
          )
          .eq(
            "document_version_id",
            documentVersionId
          )
          .order(
            "uploaded_at",
            { ascending: true }
          );

      if (queryError) {
        setError(queryError.message);
        setLoading(false);
        return;
      }

      setStoredFiles(data ?? []);
      setLoading(false);
    },
    [documentVersionId]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadFiles();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [loadFiles]);

  function handleFileSelection(
    event:
      React.ChangeEvent<HTMLInputElement>
  ) {
    setError(null);
    setMessage(null);

    const selected =
      Array.from(
        event.currentTarget.files ?? []
      );

    if (selected.length === 0) {
      return;
    }

    try {
      for (const file of selected) {
        if (file.size <= 0) {
          throw new Error(
            `Arquivo inválido: ${file.name}`
          );
        }

        if (file.size > MAX_FILE_SIZE) {
          throw new Error(
            `${file.name} ultrapassa o limite de 50 MB.`
          );
        }

        if (!resolveMimeType(file)) {
          throw new Error(
            `Formato não permitido: ${file.name}`
          );
        }
      }

      const newFiles =
        selected.map(
          (file): PendingFile => ({
            key: crypto.randomUUID(),
            file,
            role: "DOCUMENTO_APOIO",
            description: "",
          })
        );

      setPendingFiles(
        (current) => [
          ...current,
          ...newFiles,
        ]
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Não foi possível selecionar os arquivos."
      );
    } finally {
      event.currentTarget.value = "";
    }
  }

  function updateRole(
    key: string,
    role: FileRole
  ) {
    setPendingFiles((current) =>
      current.map((item) =>
        item.key === key
          ? { ...item, role }
          : item
      )
    );
  }

  function updateDescription(
    key: string,
    description: string
  ) {
    setPendingFiles((current) =>
      current.map((item) =>
        item.key === key
          ? {
              ...item,
              description,
            }
          : item
      )
    );
  }

  function removePendingFile(
    key: string
  ) {
    setPendingFiles((current) =>
      current.filter(
        (item) => item.key !== key
      )
    );
  }

  async function handleUpload() {
    if (pendingFiles.length === 0) {
      setError(
        "Selecione pelo menos um arquivo."
      );
      return;
    }

    setUploading(true);
    setProcessed(0);
    setError(null);
    setMessage(null);

    const supabase =
      createSupabaseBrowserClient();

    const rpcClient =
      supabase as unknown as RpcClient;

    let completed = 0;

    try {
      for (const item of pendingFiles) {
        const mimeType =
          resolveMimeType(item.file);

        if (!mimeType) {
          throw new Error(
            `Formato não permitido: ${item.file.name}`
          );
        }

        const sha256 =
          await sha256Hex(item.file);

        const storagePath =
          `${projectId}/` +
          `${documentId}/` +
          `${documentVersionId}/` +
          `${crypto.randomUUID()}-` +
          `${sanitizeFileName(
            item.file.name
          )}`;

        const {
          error: uploadError,
        } =
          await supabase.storage
            .from(BUCKET)
            .upload(
              storagePath,
              item.file,
              {
                upsert: false,
                contentType: mimeType,
              }
            );

        if (uploadError) {
          throw new Error(
            `Falha no upload de ${item.file.name}: ` +
              uploadError.message
          );
        }

        const {
          error: registerError,
        } =
          await rpcClient.rpc(
            "register_document_version_file",
            {
              p_document_version_id:
                documentVersionId,

              p_file_role:
                item.role,

              p_storage_path:
                storagePath,

              p_original_file_name:
                item.file.name,

              p_mime_type:
                mimeType,

              p_file_size_bytes:
                item.file.size,

              p_sha256_hash:
                sha256,

              p_origin:
                "UPLOAD",

              p_description:
                item.description.trim()
                  ? item.description.trim()
                  : null,

              p_replaces_file_id:
                null,
            }
          );

        if (registerError) {
          await supabase.storage
            .from(BUCKET)
            .remove([storagePath]);

          throw new Error(
            `Falha ao registrar ${item.file.name}: ` +
              registerError.message
          );
        }

        completed += 1;
        setProcessed(completed);
      }

      const total =
        pendingFiles.length;

      setPendingFiles([]);

      setMessage(
        total === 1
          ? "1 arquivo adicionado ao pacote."
          : `${total} arquivos adicionados ao pacote.`
      );

      await loadFiles();

      router.refresh();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Falha ao adicionar arquivos."
      );
    } finally {
      setUploading(false);
    }
  }

  const progress =
    pendingFiles.length > 0
      ? Math.round(
          (processed /
            pendingFiles.length) *
            100
        )
      : 0;

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-muted/20 p-3">
      <div>
        <p className="text-sm font-medium">
          Arquivos desta versão
        </p>

        <p className="text-xs text-muted-foreground">
          O arquivo principal e seus anexos
          permanecem vinculados à mesma versão
          documental.
        </p>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">
          Carregando arquivos...
        </p>
      ) : storedFiles.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhum arquivo registrado.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {storedFiles.map((file) => (
            <div
              key={file.id}
              className="flex flex-col justify-between gap-2 rounded-md border bg-card p-3 md:flex-row md:items-center"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded border px-2 py-0.5 text-xs font-medium">
                    {ROLE_LABELS[
                      file.file_role
                    ] ??
                      file.file_role}
                  </span>

                  <span className="break-all text-sm">
                    {file.original_file_name}
                  </span>
                </div>

                <p className="mt-1 text-xs text-muted-foreground">
                  {formatBytes(
                    file.file_size_bytes
                  )}
                </p>
              </div>

              <DocumentDownloadButton
                bucket={
                  file.storage_bucket
                }
                filePath={
                  file.storage_path
                }
                originalFileName={
                  file.original_file_name
                }
              />
            </div>
          ))}
        </div>
      )}

      {canEdit ? (
        <div className="flex flex-col gap-3 border-t pt-3">
          <label className="flex flex-col gap-2 text-sm">
            <span className="font-medium">
              Adicionar arquivos ao pacote
            </span>

            <input
              type="file"
              multiple
              accept={ACCEPT}
              disabled={uploading}
              onChange={
                handleFileSelection
              }
              className="rounded-md border bg-card px-3 py-2"
            />

            <span className="text-xs text-muted-foreground">
              Selecione vários arquivos de uma vez.
              Máximo de 50 MB por arquivo.
            </span>
          </label>

          {pendingFiles.length > 0 ? (
            <div className="flex flex-col gap-2">
              {pendingFiles.map(
                (item) => (
                  <div
                    key={item.key}
                    className="grid gap-2 rounded-md border bg-card p-3 md:grid-cols-[minmax(0,1fr)_220px_minmax(0,1fr)_auto]"
                  >
                    <div>
                      <p className="break-all text-sm font-medium">
                        {item.file.name}
                      </p>

                      <p className="text-xs text-muted-foreground">
                        {formatBytes(
                          item.file.size
                        )}
                      </p>
                    </div>

                    <select
                      value={item.role}
                      disabled={uploading}
                      onChange={(event) =>
                        updateRole(
                          item.key,
                          event.target
                            .value as FileRole
                        )
                      }
                      className="rounded-md border bg-card px-3 py-2 text-sm"
                    >
                      <option value="ANEXO_CONTRATUAL">
                        Anexo contratual
                      </option>

                      <option value="EVIDENCIA_APROVACAO">
                        Evidência de aprovação
                      </option>

                      <option value="DOCUMENTO_APOIO">
                        Documento de apoio
                      </option>
                    </select>

                    <input
                      type="text"
                      value={
                        item.description
                      }
                      disabled={uploading}
                      placeholder="Descrição opcional"
                      onChange={(event) =>
                        updateDescription(
                          item.key,
                          event.target.value
                        )
                      }
                      className="rounded-md border bg-card px-3 py-2 text-sm"
                    />

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={uploading}
                      onClick={() =>
                        removePendingFile(
                          item.key
                        )
                      }
                    >
                      Remover
                    </Button>
                  </div>
                )
              )}
            </div>
          ) : null}

          {uploading ? (
            <div className="flex flex-col gap-1">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: `${progress}%`,
                  }}
                />
              </div>

              <p className="text-xs text-muted-foreground">
                {processed} de{" "}
                {pendingFiles.length}{" "}
                arquivos · {progress}%
              </p>
            </div>
          ) : null}

          {error ? (
            <p className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {message ? (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">
              {message}
            </p>
          ) : null}

          <div>
            <Button
              type="button"
              disabled={
                uploading ||
                pendingFiles.length === 0
              }
              onClick={handleUpload}
            >
              {uploading
                ? "Enviando..."
                : pendingFiles.length === 1
                  ? "Adicionar 1 arquivo"
                  : `Adicionar ${pendingFiles.length} arquivos`}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}