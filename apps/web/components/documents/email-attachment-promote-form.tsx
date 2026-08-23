"use client";

// [Incorporar aos Documentos] — Stage B, sempre humana (seção 15 do
// requisito de Anexos de E-mail): a IA nunca escolhe kind/título
// sozinha. Chama promoteEmailAttachmentAction (RPC SECURITY DEFINER
// promote_email_attachment_to_document) — nunca reimplementa a escrita
// aqui, nunca reenvia o arquivo (reaproveita o Storage já existente).

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { promoteEmailAttachmentAction } from "@/app/[projectId]/documentos/actions";
import { initialPromoteEmailAttachmentState } from "@/app/[projectId]/documentos/actions-state";
import { documentKindLabels } from "@/lib/labels";
import type { DocumentKind } from "@axion/types";

const KIND_OPTIONS = Object.keys(documentKindLabels) as DocumentKind[];

export function EmailAttachmentPromoteForm({
  projectId,
  attachmentId,
  defaultTitle,
  defaultDate,
  defaultAuthor,
  onCancel,
}: {
  projectId: string;
  attachmentId: string;
  defaultTitle: string;
  defaultDate: string;
  defaultAuthor: string;
  onCancel: () => void;
}) {
  const [state, formAction, pending] = useActionState(promoteEmailAttachmentAction, initialPromoteEmailAttachmentState);

  if (state.success) {
    return <p className="rounded-md bg-muted/40 p-3 text-sm">Anexo incorporado aos Documentos com sucesso.</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md bg-muted/40 p-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="attachmentId" value={attachmentId} />

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Tipo documental
          <Select name="kind" required defaultValue="CLARIFICACAO_CLIENTE">
            {KIND_OPTIONS.map((kind) => (
              <option key={kind} value={kind}>
                {documentKindLabels[kind]}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Título do documento
          <Input name="documentTitle" required defaultValue={defaultTitle} />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Data do documento
          <Input type="date" name="documentDate" required defaultValue={defaultDate} />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Autor / emissor
          <Input name="author" required defaultValue={defaultAuthor} />
        </label>
      </div>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Resumo
        <Textarea name="summary" required rows={2} />
      </label>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Incorporando…" : "Incorporar aos Documentos"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
