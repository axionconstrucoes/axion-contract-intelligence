"use client";

import { useActionState, useState } from "react";
import { unlinkDocumentContractualAttachmentAction } from "@/app/[projectId]/documentos/actions";
import { initialUnlinkContractualAttachmentState } from "@/app/[projectId]/documentos/actions-state";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Link2 } from "lucide-react";

// Desvincular exige justificativa (texto obrigatório, mesmo mínimo de
// 20 caracteres da RPC unlink_document_contractual_attachment — ver
// migration 20260829090000) — nunca um botão de um clique só. Compacto
// (details/summary), consistente com o resto da aba Documentos
// ("Adicionar nova versão", "Upload individual").
const MIN_REASON_LENGTH = 20;
const MAX_REASON_LENGTH = 2000;

export function UnlinkContractualAttachmentControl({
  projectId,
  documentId,
  documentTitle,
}: {
  projectId: string;
  documentId: string;
  documentTitle: string;
}) {
  const [state, formAction, pending] = useActionState(
    unlinkDocumentContractualAttachmentAction,
    initialUnlinkContractualAttachmentState
  );
  const [reason, setReason] = useState("");

  return (
    <details className="text-xs">
      <summary
        title="Vinculado — clique para desvincular"
        aria-label="Vinculado — clique para desvincular"
        className="inline-flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-400 [&::-webkit-details-marker]:hidden"
      >
        <Link2 className="h-5 w-5" aria-hidden="true" />
      </summary>
      <form action={formAction} className="mt-1.5 flex flex-col gap-1.5 rounded-md border bg-card p-2 text-card-foreground">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="childDocumentId" value={documentId} />

        <label className="flex flex-col gap-1 font-medium">
          Justificativa da desvinculação de &quot;{documentTitle}&quot; (mínimo {MIN_REASON_LENGTH} caracteres)
          <Textarea
            name="reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            required
            minLength={MIN_REASON_LENGTH}
            maxLength={MAX_REASON_LENGTH}
            placeholder="Ex.: Documento incluído por engano neste contrato."
          />
        </label>

        {state.error ? <p className="text-destructive">{state.error}</p> : null}
        {state.success ? <p className="text-emerald-600">Anexo desvinculado.</p> : null}

        <Button
          type="submit"
          size="sm"
          variant="outline"
          className="border-destructive text-destructive hover:bg-destructive/10"
          disabled={pending || reason.trim().length < MIN_REASON_LENGTH}
        >
          {pending ? "Desvinculando…" : "Confirmar desvinculação"}
        </Button>
      </form>
    </details>
  );
}
