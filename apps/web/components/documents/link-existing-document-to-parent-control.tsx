"use client";

import { useActionState, useState } from "react";
import { linkDocumentAsContractualAttachmentAction } from "@/app/[projectId]/documentos/actions";
import { initialLinkContractualAttachmentState } from "@/app/[projectId]/documentos/actions-state";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

// Mesmos limites da CHECK constraint
// documents_contractual_incorporation_basis_length_check (migration
// 20260829090000) — só evita um round-trip óbvio, o servidor sempre
// revalida.
const MIN_INCORPORATION_BASIS_LENGTH = 20;
const MAX_INCORPORATION_BASIS_LENGTH = 2000;

export interface LinkableDocumentCandidate {
  id: string;
  title: string;
  kind: string;
}

// Complemento de LinkContractualAttachmentControl (que parte de um
// documento FILHO já conhecido e deixa escolher o pai) — este parte de
// um documento PAI já conhecido (o contrato-base/aditivo deste grupo)
// e deixa escolher qual documento AINDA SEM VÍNCULO vira anexo dele.
// Chama a MESMA RPC/Server Action, nunca uma segunda regra de negócio —
// só a direção da escolha no formulário é invertida. Só oferecido
// dentro da área "sem anexos" de um grupo contratual (ver
// contractual-document-group-section.tsx), e só ao ADMINISTRADOR.
//
// candidateDocuments é sempre a lista de documentos SEM vínculo
// contratual (ungrouped) — um documento já vinculado a outro pai nunca
// aparece aqui (a RPC recusaria a troca sem confirmação explícita, e
// esta tela não oferece esse fluxo de troca, só o de PRIMEIRO vínculo:
// expectedParentDocumentId é sempre "" / confirmParentChange é sempre
// false).
export function LinkExistingDocumentToParentControl({
  projectId,
  parentDocumentId,
  parentLabel,
  candidateDocuments,
}: {
  projectId: string;
  parentDocumentId: string;
  parentLabel: string;
  candidateDocuments: LinkableDocumentCandidate[];
}) {
  const [state, formAction, pending] = useActionState(
    linkDocumentAsContractualAttachmentAction,
    initialLinkContractualAttachmentState
  );
  const [childDocumentId, setChildDocumentId] = useState("");
  const [basis, setBasis] = useState("");
  const canSubmit = childDocumentId !== "" && basis.trim().length >= MIN_INCORPORATION_BASIS_LENGTH;

  if (candidateDocuments.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Nenhum documento sem vínculo disponível neste projeto para anexar a {parentLabel}.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-1.5 rounded-md border border-dashed p-2 text-xs">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="parentDocumentId" value={parentDocumentId} />
      <input type="hidden" name="childDocumentId" value={childDocumentId} />
      {/* Candidatos são sempre documentos ainda sem pai (ungrouped) —
          "" sinaliza à RPC "esperava nenhum vínculo anterior" (primeiro
          vínculo, nunca uma troca). */}
      <input type="hidden" name="expectedParentDocumentId" value="" />
      <input type="hidden" name="confirmParentChange" value="false" />

      <label className="flex flex-col gap-1 font-medium">
        Vincular documento a {parentLabel}
        <Select value={childDocumentId} onChange={(event) => setChildDocumentId(event.target.value)} required>
          <option value="" disabled>
            Selecione…
          </option>
          {candidateDocuments.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.title} ({candidate.kind.replaceAll("_", " ")})
            </option>
          ))}
        </Select>
      </label>

      <label className="flex flex-col gap-1 font-medium">
        Fundamento da incorporação (mínimo {MIN_INCORPORATION_BASIS_LENGTH} caracteres)
        <Textarea
          name="incorporationBasis"
          value={basis}
          onChange={(event) => setBasis(event.target.value)}
          rows={2}
          required
          minLength={MIN_INCORPORATION_BASIS_LENGTH}
          maxLength={MAX_INCORPORATION_BASIS_LENGTH}
          placeholder="Ex.: Cláusula 4.2 do contrato incorpora este documento por referência."
        />
      </label>

      {state.error ? <p className="text-destructive">{state.error}</p> : null}
      {state.success ? <p className="text-emerald-600">Vínculo salvo.</p> : null}

      <Button type="submit" size="sm" disabled={pending || !canSubmit}>
        {pending ? "Salvando…" : "Vincular"}
      </Button>
    </form>
  );
}
