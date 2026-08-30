"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";

import { createSupabaseBrowserClient } from "@axion/db/browser";

import { Button } from "@/components/ui/button";
import { computeFileSha256Hex } from "@/lib/documents/multi-upload/sha256";

const BUCKET = "project-documents";
const MAX_FILE_SIZE = 50 * 1024 * 1024;

const DOCUMENT_KINDS = [
  ["CONTRATO_BASE", "Contrato base"],
  ["ADITIVO", "Aditivo"],
  ["EDITAL", "Edital"],
  ["RFI", "RFI"],
  ["RFP", "RFP"],
  ["ESPECIFICACAO", "Especificação"],
  ["DESENHO", "Desenho"],
  ["PLANILHA", "Planilha"],
  ["CRONOGRAMA_BASELINE", "Cronograma baseline"],
  ["CRONOGRAMA_REVISAO", "Revisão de cronograma"],
  ["RELATORIO_SEMANAL", "Relatório semanal"],
  ["PROPOSTA_AXION", "Proposta AXION"],
  ["CLARIFICACAO_CLIENTE", "Clarificação do cliente"],
] as const;

const SOURCE_TYPES = [
  ["CONTRATO", "Contrato"],
  ["RECEBIDOS_CLIENTE", "Recebido do cliente"],
  ["EMAIL", "E-mail"],
  ["GOOGLE_DRIVE", "Google Drive"],
  ["EDITAL_RFI_RFP", "Edital / RFI / RFP"],
  ["CRONOGRAMA", "Cronograma"],
  ["ORCAMENTO", "Orçamento"],
  ["DIARIO_OBRA", "Diário de Obra"],
  ["CONSTRUMANAGER", "Construmanager"],
  ["RELATORIO_SEMANAL", "Relatório semanal"],
  ["ERP", "ERP"],
] as const;

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

type ExistingDocument = {
  id: string;
  kind: string;
  title: string;
  nextVersionIndex: number;
};

type Props = {
  projectId: string;
  existingDocument?: ExistingDocument;
};

function sanitizeFileName(fileName: string) {
  return (
    fileName
      .normalize("NFKD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "arquivo"
  );
}

function resolveMimeType(file: File) {
  const extension =
    file.name.split(".").pop()?.toLowerCase() ?? "";

  return MIME_BY_EXTENSION[extension] ?? null;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function DocumentUploadForm({
  projectId,
  existingDocument,
}: Props) {
  const router = useRouter();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // .mpp (Microsoft Project) é sempre um cronograma pela própria
  // natureza do formato — nunca um contrato/aditivo/etc. Só este tipo
  // de arquivo ganha sugestão automática (e seletor bloqueado nela);
  // nenhum outro tipo (PDF incluso) é classificado só pelo nome.
  const [isMppSelected, setIsMppSelected] = useState(false);
  const kindSelectRef = useRef<HTMLSelectElement>(null);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const extension = file?.name.split(".").pop()?.toLowerCase() ?? "";
    const mpp = extension === "mpp";
    setIsMppSelected(mpp);
    if (mpp && kindSelectRef.current) {
      kindSelectRef.current.value = "CRONOGRAMA_BASELINE";
    }
  }

  const isNewDocument = !existingDocument;

  const defaultVersion =
    existingDocument
      ? `${existingDocument.nextVersionIndex}.0`
      : "1.0";

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);

    setSubmitting(true);
    setError(null);
    setMessage(null);

    let uploadedPath: string | null = null;

    try {
      const file = formData.get("file");

      if (!(file instanceof File) || file.size === 0) {
        throw new Error("Selecione um arquivo válido.");
      }

      if (file.size > MAX_FILE_SIZE) {
        throw new Error(
          "O arquivo ultrapassa o limite de 50 MB."
        );
      }

      const mimeType = resolveMimeType(file);

      if (!mimeType) {
        throw new Error(
          "Formato de arquivo não permitido."
        );
      }

      const documentId =
        existingDocument?.id ?? crypto.randomUUID();

      const documentVersionId =
        crypto.randomUUID();

      const kind =
        existingDocument?.kind ??
        String(formData.get("kind") ?? "");

      const title =
        existingDocument?.title ??
        String(formData.get("title") ?? "").trim();

      const versionLabel =
        String(
          formData.get("versionLabel") ?? ""
        ).trim();

      const documentDate =
        String(formData.get("documentDate") ?? "");

      const sourceType =
        String(formData.get("sourceType") ?? "");

      const author =
        String(formData.get("author") ?? "").trim();

      const summary =
        String(formData.get("summary") ?? "").trim();

      const notes =
        String(formData.get("notes") ?? "").trim();

      if (
        !kind ||
        !title ||
        !versionLabel ||
        !documentDate ||
        !sourceType ||
        !author ||
        !summary
      ) {
        throw new Error(
          "Preencha todos os campos obrigatórios."
        );
      }

      // Este formulário (upload individual/"avançado" e "Adicionar nova
      // versão") historicamente nunca calculava hash nem enviava
      // p_sha256_hash — ficava de fora da proteção de deduplicação real
      // (índice único project_id+sha256_hash, ver migration
      // 20260825130000): dois uploads do mesmo conteúdo por AQUI nunca
      // eram detectados como duplicados. Corrigido para usar o mesmo
      // hash canônico do upload múltiplo — cobertura de deduplicação
      // completa na aba Documentos, não só no painel de arrastar/soltar.
      const sha256Hash = await computeFileSha256Hex(file);

      uploadedPath =
        `${projectId}/${documentId}/${documentVersionId}/${sanitizeFileName(
          file.name
        )}`;

      const supabase =
        createSupabaseBrowserClient();

      const { error: uploadError } =
        await supabase.storage
          .from(BUCKET)
          .upload(uploadedPath, file, {
            upsert: false,
            contentType: mimeType,
          });

      if (uploadError) {
        throw new Error(
          `Falha no upload: ${uploadError.message}`
        );
      }

      const rpcClient =
        supabase as unknown as {
          rpc: (
            name: string,
            parameters: Record<string, unknown>
          ) => Promise<{
            data: unknown;
            error: { message: string } | null;
          }>;
        };

      const { error: registerError } =
        await rpcClient.rpc(
          "register_project_document_upload",
          {
            p_project_id: projectId,
            p_document_id: documentId,
            p_document_version_id:
              documentVersionId,
            p_kind: kind,
            p_title: title,
            p_version_label: versionLabel,
            p_document_date: documentDate,
            p_source_type: sourceType,
            p_author: author,
            p_summary: summary,
            p_file_path: uploadedPath,
            p_original_file_name: file.name,
            p_mime_type: mimeType,
            p_file_size_bytes: file.size,
            p_notes: notes || null,
            p_sha256_hash: sha256Hash,
          }
        );

      if (registerError) {
        await supabase.storage
          .from(BUCKET)
          .remove([uploadedPath]);

        uploadedPath = null;

        // Mesma mensagem clara do upload múltiplo — nunca "Falha ao
        // registrar documento: DUPLICATE_FILE_HASH: ..." cru para o
        // usuário quando a causa real é deduplicação, não um erro.
        if (registerError.message.includes("DUPLICATE_FILE_HASH")) {
          throw new Error(
            "Este arquivo já existe neste projeto (conteúdo idêntico a um documento já cadastrado) — não foi enviado de novo."
          );
        }

        if (registerError.message.includes("SINGLE_ACTIVE_CONTRACT_BASE")) {
          throw new Error(
            "Este projeto já tem um Contrato-base ativo. Abra o card do Contrato-base existente e use \"Adicionar nova versão\" em vez de criar um novo documento."
          );
        }

        throw new Error(
          `Falha ao registrar documento: ${registerError.message}`
        );
      }

      uploadedPath = null;

      setMessage(
        existingDocument
          ? "Nova versão registrada com sucesso."
          : "Documento registrado com sucesso."
      );

      form.reset();
      router.refresh();
    } catch (caughtError) {
      if (uploadedPath) {
        try {
          const supabase =
            createSupabaseBrowserClient();

          await supabase.storage
            .from(BUCKET)
            .remove([uploadedPath]);
        } catch {
          // Limpeza best-effort de upload órfão.
        }
      }

      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Não foi possível enviar o documento."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4"
    >
      {isNewDocument ? (
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">
              Tipo documental *
            </span>

            {/* Nunca "disabled" aqui: este <select> é lido via
                FormData(form) no submit — um campo disabled não é
                enviado no FormData e quebraria o envio. Para .mpp, o
                valor já vem pré-selecionado (handleFileChange) — o
                usuário só altera se explicitamente escolher outro
                valor, nunca um default silencioso. */}
            <select
              ref={kindSelectRef}
              name="kind"
              required
              defaultValue=""
              className="h-10 rounded-md border bg-background px-3"
            >
              <option value="" disabled>
                Selecione o tipo documental
              </option>
              {DOCUMENT_KINDS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {isMppSelected ? (
              <span className="text-xs text-muted-foreground">
                Arquivo .mpp — tipo definido automaticamente como Cronograma baseline.
              </span>
            ) : null}
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">
              Título *
            </span>

            <input
              name="title"
              required
              placeholder="Ex.: Contrato de empreitada"
              className="h-10 rounded-md border bg-background px-3"
            />
          </label>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">
            Versão *
          </span>

          <input
            name="versionLabel"
            required
            defaultValue={defaultVersion}
            className="h-10 rounded-md border bg-background px-3"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">
            Data do documento *
          </span>

          <input
            type="date"
            name="documentDate"
            required
            defaultValue={today()}
            className="h-10 rounded-md border bg-background px-3"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">
            Origem *
          </span>

          <select
            name="sourceType"
            required
            defaultValue="CONTRATO"
            className="h-10 rounded-md border bg-background px-3"
          >
            {SOURCE_TYPES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">
          Autor / emissor *
        </span>

        <input
          name="author"
          required
          className="h-10 rounded-md border bg-background px-3"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">
          Resumo *
        </span>

        <textarea
          name="summary"
          required
          rows={3}
          className="rounded-md border bg-background px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">
          Observações
        </span>

        <textarea
          name="notes"
          rows={2}
          className="rounded-md border bg-background px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">
          Arquivo *
        </span>

        <input
          type="file"
          name="file"
          required
          accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.xml,.mpp,.jpg,.jpeg,.png"
          onChange={isNewDocument ? handleFileChange : undefined}
          className="rounded-md border bg-background px-3 py-2"
        />

        <span className="text-xs text-muted-foreground">
          PDF, Word, Excel, CSV, TXT, XML, MPP,
          JPG ou PNG. Máximo 50 MB.
        </span>
      </label>

      {error ? (
        <p className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {message ? (
        <p className="text-sm">
          {message}
        </p>
      ) : null}

      <div>
        <Button
          type="submit"
          disabled={submitting}
        >
          {submitting
            ? "Enviando..."
            : existingDocument
              ? "Enviar nova versão"
              : "Adicionar documento"}
        </Button>
      </div>
    </form>
  );
}
