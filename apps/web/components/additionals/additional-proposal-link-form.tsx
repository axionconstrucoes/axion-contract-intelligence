"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { linkAdditionalProposalSourceAction } from "@/app/[projectId]/adicionais/actions";
import { initialLinkAdditionalProposalSourceState } from "@/app/[projectId]/adicionais/actions-state";
import type { AdditionalProposalLinkRole } from "@/lib/additionals/types";

type SourceKind = "documentVersionId" | "emailId" | "emailAttachmentId" | "eventId";

/**
 * "Vincular documento existente" / "Marcar não aplicável" (seção
 * "DOCUMENTAÇÃO DO ADICIONAL CONTRATADO") — nunca "Fazer upload" aqui:
 * upload de arquivo novo é a mesma funcionalidade já existente na tela
 * de Documentos (/[projectId]/documentos), não duplicada nesta fase.
 */
export function AdditionalProposalLinkForm({
  projectId,
  proposalId,
  linkRole,
}: {
  projectId: string;
  proposalId: string;
  linkRole: AdditionalProposalLinkRole;
}) {
  const [state, formAction, pending] = useActionState(linkAdditionalProposalSourceAction, initialLinkAdditionalProposalSourceState);
  const [notApplicable, setNotApplicable] = useState(false);
  const [kind, setKind] = useState<SourceKind>("documentVersionId");

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2 text-xs">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="proposalId" value={proposalId} />
      <input type="hidden" name="linkRole" value={linkRole} />

      <label className="flex items-center gap-1.5 font-medium">
        <input type="checkbox" name="notApplicable" checked={notApplicable} onChange={(e) => setNotApplicable(e.target.checked)} />
        Não aplicável
      </label>

      {notApplicable ? (
        <Input name="notApplicableJustification" placeholder="Justificativa" required className="h-8 w-56 text-xs" />
      ) : (
        <>
          <Select value={kind} onChange={(e) => setKind(e.target.value as SourceKind)} className="h-8 text-xs">
            <option value="documentVersionId">Documento</option>
            <option value="emailId">E-mail</option>
            <option value="emailAttachmentId">Anexo</option>
            <option value="eventId">Evento</option>
          </Select>
          <Input name={kind} required placeholder="UUID" className="h-8 w-56 text-xs" />
        </>
      )}

      <Button type="submit" variant="outline" size="sm" disabled={pending} className="h-8">
        {pending ? "Salvando…" : "Vincular"}
      </Button>
      {state.error ? <p className="w-full text-destructive">{state.error}</p> : null}
    </form>
  );
}
