"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createAdditionalProposalAction } from "@/app/[projectId]/adicionais/actions";
import { initialCreateAdditionalProposalState } from "@/app/[projectId]/adicionais/actions-state";
import type { AdditionalProposalSourceType } from "@/lib/additionals/types";

// "+ Nova proposta de adicional" — três origens (seção B do requisito).
// Sem Dialog/modal (nenhum primitivo disponível nesta base — ver
// components/ui/) — mesmo padrão inline de SlaActionForm.
export function AdditionalProposalCreateForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState(createAdditionalProposalAction, initialCreateAdditionalProposalState);
  const [sourceType, setSourceType] = useState<AdditionalProposalSourceType>("MANUAL");
  const [originKind, setOriginKind] = useState<"documentVersionId" | "emailId" | "emailAttachmentId" | "eventId">("documentVersionId");

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border border-dashed p-4">
      <input type="hidden" name="projectId" value={projectId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Origem
          <Select
            name="sourceType"
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value as AdditionalProposalSourceType)}
            required
          >
            <option value="MANUAL">Manual</option>
            <option value="DRIVE">Google Drive</option>
            <option value="EXISTING">Fonte já existente no ACC</option>
          </Select>
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Número da proposta
          <Input name="proposalNumber" required placeholder="Ex.: AXN CP 621" />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Título
          <Input name="title" required placeholder="Título curto do adicional" />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Data (opcional)
          <Input type="date" name="proposalDate" />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Valor proposto (opcional)
          <Input type="number" step="0.01" name="proposedValue" />
        </label>
      </div>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Descrição
        <Textarea name="description" rows={2} />
      </label>

      {sourceType === "DRIVE" ? (
        <div className="grid gap-3 rounded-md bg-muted/40 p-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            URL da pasta/arquivo no Drive
            <Input name="driveUrl" placeholder="https://drive.google.com/…" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Drive ID
            <Input name="driveFileId" />
          </label>
        </div>
      ) : null}

      {sourceType === "EXISTING" ? (
        <div className="flex flex-col gap-2 rounded-md bg-muted/40 p-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Tipo de fonte existente
            <Select value={originKind} onChange={(e) => setOriginKind(e.target.value as typeof originKind)}>
              <option value="documentVersionId">Documento</option>
              <option value="emailId">E-mail</option>
              <option value="emailAttachmentId">Anexo de e-mail</option>
              <option value="eventId">Evento/evidência do Event Ledger</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            ID da fonte
            <Input name={`origin${originKind.charAt(0).toUpperCase()}${originKind.slice(1)}`} required placeholder="UUID do documento/e-mail/anexo/evento" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Observação sobre o vínculo (opcional)
            <Input name="originNote" />
          </label>
        </div>
      ) : null}

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Observação (opcional)
        <Textarea name="note" rows={2} />
      </label>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-emerald-600">Proposta criada como &quot;Possível adicional&quot;.</p> : null}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Criando…" : "Criar proposta"}
      </Button>
    </form>
  );
}
