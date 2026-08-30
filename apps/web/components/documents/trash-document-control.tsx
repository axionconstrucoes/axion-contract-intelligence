"use client";

import { useActionState, useState } from "react";
import { trashProjectDocumentAction } from "@/app/[projectId]/documentos/actions";
import { initialTrashDocumentState } from "@/app/[projectId]/documentos/actions-state";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// Mesmo mínimo/máximo de UnlinkContractualAttachmentControl e da RPC
// trash_project_document (migration 20260829150000) — validação aqui é
// só UX, o servidor sempre revalida.
const MIN_REASON_LENGTH = 20;
const MAX_REASON_LENGTH = 2000;

// "Enviar para a lixeira" — nunca um botão de um clique só (details
// fechado por padrão exige expandir + justificar + confirmar).
// Justificativa obrigatória (20-2000 caracteres, mesmo padrão do
// desvincular contratual) — mesmo sendo reversível, é uma ação com
// efeito real na visibilidade do documento. Só renderizado pelo caller
// para o ADMINISTRADOR (mesmo padrão de canLinkContractualAttachment)
// — a RPC trash_project_document revalida a permissão no servidor de
// qualquer forma.
export function TrashDocumentControl({
  projectId,
  documentId,
  documentTitle,
}: {
  projectId: string;
  documentId: string;
  documentTitle: string;
}) {
  const [state, formAction, pending] = useActionState(trashProjectDocumentAction, initialTrashDocumentState);
  const [reason, setReason] = useState("");

  return (
    <details className="text-xs">
      <summary className="cursor-pointer whitespace-nowrap opacity-80">Enviar para a lixeira</summary>
      <form action={formAction} className="mt-1.5 flex flex-col gap-1.5 rounded-md border bg-card p-2 text-card-foreground">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="documentId" value={documentId} />

        <p>
          Enviar &quot;{documentTitle}&quot; para a lixeira? O documento sai da lista principal, mas nada é apagado —
          um Administrador pode restaurá-lo a qualquer momento.
        </p>

        <label className="flex flex-col gap-1 font-medium">
          Justificativa (mínimo {MIN_REASON_LENGTH} caracteres)
          <Textarea
            name="reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            required
            minLength={MIN_REASON_LENGTH}
            maxLength={MAX_REASON_LENGTH}
            placeholder="Ex.: Documento obsoleto, substituído pela versão revisada em anexo."
          />
        </label>

        {state.error ? <p className="text-destructive">{state.error}</p> : null}
        {state.success ? <p className="text-emerald-600">Documento enviado para a lixeira.</p> : null}

        <Button
          type="submit"
          size="sm"
          variant="outline"
          className="border-destructive text-destructive hover:bg-destructive/10"
          disabled={pending || reason.trim().length < MIN_REASON_LENGTH}
        >
          {pending ? "Enviando…" : "Confirmar envio para a lixeira"}
        </Button>
      </form>
    </details>
  );
}
