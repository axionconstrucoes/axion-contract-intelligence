"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { createSupabaseBrowserClient } from "@axion/db/browser";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { esgObligationStatusLabels, type EsgObligationStatus } from "@/lib/labels";
import { createEsgObligationSubmissionAction } from "@/app/[projectId]/esg/actions";
import { initialCreateEsgSubmissionState } from "@/app/[projectId]/esg/actions-state";

const STATUS_OPTIONS = Object.keys(esgObligationStatusLabels) as EsgObligationStatus[];
const BUCKET = "project-documents";
const MAX_FILE_SIZE = 50 * 1024 * 1024;

const EVIDENCE_KIND_BY_EXTENSION: Record<string, string> = {
  jpg: "FOTO",
  jpeg: "FOTO",
  png: "FOTO",
  pdf: "DOCUMENTO",
  doc: "DOCUMENTO",
  docx: "DOCUMENTO",
  xls: "PLANILHA",
  xlsx: "PLANILHA",
  csv: "PLANILHA",
  txt: "DOCUMENTO",
};

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
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

export function EsgSubmissionForm({
  projectId,
  obligationId,
  isDds,
}: {
  projectId: string;
  obligationId: string;
  isDds: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<EsgObligationStatus>("CUMPRIDO");

  const requiresJustification = status === "NAO_APLICAVEL" || status === "DISPENSADO";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    formData.set("projectId", projectId);
    formData.set("obligationId", obligationId);

    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const result = await createEsgObligationSubmissionAction(initialCreateEsgSubmissionState, formData);

      if (result.error || !result.submissionId) {
        throw new Error(result.error ?? "Falha ao registrar comprovação.");
      }

      const submissionId = result.submissionId;
      const files = formData.getAll("evidenceFiles").filter((f): f is File => f instanceof File && f.size > 0);

      if (files.length > 0) {
        const supabase = createSupabaseBrowserClient();

        for (const file of files) {
          if (file.size > MAX_FILE_SIZE) {
            throw new Error(`Arquivo "${file.name}" ultrapassa 50 MB.`);
          }

          const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
          const mimeType = MIME_BY_EXTENSION[extension];
          if (!mimeType) {
            throw new Error(`Formato de arquivo não permitido: ${file.name}`);
          }

          const evidenceId = crypto.randomUUID();
          const filePath = `${projectId}/esg-evidence/${obligationId}/${submissionId}/${evidenceId}-${sanitizeFileName(file.name)}`;

          const { error: uploadError } = await supabase.storage
            .from(BUCKET)
            .upload(filePath, file, { upsert: false, contentType: mimeType });

          if (uploadError) {
            throw new Error(`Falha no upload de "${file.name}": ${uploadError.message}`);
          }

          const { data: authData } = await supabase.auth.getUser();
          if (!authData.user) {
            throw new Error("Sessão expirada. Faça login novamente.");
          }

          const { error: insertError } = await supabase.from("esg_obligation_evidence").insert({
            project_id: projectId,
            submission_id: submissionId,
            obligation_id: obligationId,
            evidence_kind: EVIDENCE_KIND_BY_EXTENSION[extension] ?? "OUTRO",
            storage_bucket: BUCKET,
            file_path: filePath,
            original_file_name: file.name,
            mime_type: mimeType,
            file_size_bytes: file.size,
            uploaded_by_user_id: authData.user.id,
          });

          if (insertError) {
            await supabase.storage.from(BUCKET).remove([filePath]);
            throw new Error(`Falha ao registrar evidência "${file.name}": ${insertError.message}`);
          }
        }
      }

      setMessage("Comprovação registrada com sucesso.");
      form.reset();
      setStatus("CUMPRIDO");
      router.refresh();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Não foi possível registrar a comprovação.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-md border p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5 text-sm">
          Data de referência
          <Input type="date" name="referenceDate" required defaultValue={new Date().toISOString().slice(0, 10)} />
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          Rótulo do período (opcional)
          <Input name="referencePeriodLabel" placeholder="Ex.: Semana 34" />
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          Prazo (opcional)
          <Input type="date" name="dueDate" />
        </label>
      </div>

      <label className="flex flex-col gap-1.5 text-sm">
        Status
        <Select name="status" value={status} onChange={(e) => setStatus(e.target.value as EsgObligationStatus)}>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {esgObligationStatusLabels[s]}
            </option>
          ))}
        </Select>
      </label>

      {isDds ? (
        <div className="grid gap-3 rounded-md border border-dashed p-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5 text-sm">
            Tema do DDS
            <Input name="ddsTema" placeholder="Ex.: Trabalho em altura" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            Equipe/público
            <Input name="ddsPublico" placeholder="Ex.: Equipe de estrutura" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            Número de participantes
            <Input type="number" name="ddsNumeroParticipantes" min="0" />
          </label>
        </div>
      ) : null}

      <label className="flex flex-col gap-1.5 text-sm">
        Descrição
        <Textarea name="description" rows={2} />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        Observação
        <Textarea name="observation" rows={2} />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        Justificativa {requiresJustification ? "(obrigatória para Não aplicável/Dispensado)" : "(opcional)"}
        <Textarea name="justification" rows={2} required={requiresJustification} />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        Evidências (fotos, PDF, planilha, documento — múltiplos arquivos)
        <input
          type="file"
          name="evidenceFiles"
          multiple
          accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png"
          className="rounded-md border bg-card px-3 py-2 text-sm"
        />
      </label>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-600">{message}</p> : null}

      <Button type="submit" disabled={submitting} className="self-start">
        {submitting ? "Enviando…" : "Registrar comprovação"}
      </Button>
    </form>
  );
}
