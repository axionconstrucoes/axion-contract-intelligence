"use client";

import { useActionState, useState } from "react";
import { linkDocumentAsContractualAttachmentAction } from "@/app/[projectId]/documentos/actions";
import { initialLinkContractualAttachmentState } from "@/app/[projectId]/documentos/actions-state";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export interface ContractualParentOption {
  id: string;
  label: string;
  title: string;
}

// Mesmos limites da CHECK constraint
// documents_contractual_incorporation_basis_length_check (migration
// 20260829090000) — nunca a garantia real (isso é sempre o servidor),
// só evita um round-trip óbvio.
const MIN_INCORPORATION_BASIS_LENGTH = 20;
const MAX_INCORPORATION_BASIS_LENGTH = 2000;

// "Vincular como anexo contratual" — só oferecido a usuário autorizado
// (ver documentos/page.tsx: canManageDocuments, mesma permissão de
// register_project_document_upload). O dropdown só lista candidatos já
// resolvidos pelo servidor (documentos CONTRATO_BASE/ADITIVO do MESMO
// projeto, ver page.tsx) — mas a RPC
// link_document_as_contractual_attachment resolve/valida TUDO de novo
// (mesmo projeto, tipo do pai, ciclo) a partir só dos ids, nunca
// confiando no que está no <option> (que poderia ter sido adulterado
// no DOM antes do submit).
//
// Confirmação antes de trocar o pai: quando o documento já tem um
// vínculo (currentParentId não nulo) e o usuário seleciona um pai
// DIFERENTE, um resumo explícito da troca aparece antes do botão de
// envio e uma marcação (checkbox) de confirmação passa a ser exigida —
// nunca uma troca silenciosa de um clique só.
export function LinkContractualAttachmentControl({
  projectId,
  childDocumentId,
  childDocumentTitle,
  parentOptions,
  currentParentId,
  currentParentLabel,
}: {
  projectId: string;
  childDocumentId: string;
  childDocumentTitle: string;
  parentOptions: ContractualParentOption[];
  currentParentId: string | null;
  currentParentLabel: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    linkDocumentAsContractualAttachmentAction,
    initialLinkContractualAttachmentState
  );
  const [selectedParentId, setSelectedParentId] = useState("");
  const [basis, setBasis] = useState("");
  const [changeConfirmed, setChangeConfirmed] = useState(false);

  const selectedOption = parentOptions.find((option) => option.id === selectedParentId) ?? null;
  const isChangingExistingLink = Boolean(currentParentId) && selectedParentId !== "" && selectedParentId !== currentParentId;
  // Mesmo mínimo de 20 caracteres exigido pela RPC/trigger/CHECK
  // constraint — validação aqui é só UX (evita um round-trip com erro
  // óbvio); o servidor nunca confia neste comprimento e revalida tudo.
  const canSubmit =
    selectedParentId !== "" && basis.trim().length >= MIN_INCORPORATION_BASIS_LENGTH && (!isChangingExistingLink || changeConfirmed);

  if (parentOptions.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Nenhum contrato-base ou aditivo disponível neste projeto para vincular como anexo contratual.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-md border border-dashed p-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="childDocumentId" value={childDocumentId} />
      <input type="hidden" name="parentDocumentId" value={selectedParentId} />
      {/* Concorrência otimista: o que ESTA TELA acha que é o pai atual
          agora — a RPC recusa (CONFLICT_STALE_PARENT) se o valor real
          no banco já for outro. "" quando a tela não conhece nenhum
          pai (currentParentId null) — o servidor trata isso como
          "esperava null". */}
      <input type="hidden" name="expectedParentDocumentId" value={currentParentId ?? ""} />
      {/* A confirmação REAL é sempre validada de novo dentro da RPC —
          isto só repassa o estado do checkbox React, nunca é a
          autorização em si. */}
      <input type="hidden" name="confirmParentChange" value={changeConfirmed ? "true" : "false"} />

      <label className="flex flex-col gap-1 text-xs font-medium">
        {currentParentId ? "Trocar anexo contratual para" : "Vincular como anexo contratual de"}
        <Select
          value={selectedParentId}
          onChange={(event) => {
            setSelectedParentId(event.target.value);
            setChangeConfirmed(false);
          }}
          required
        >
          <option value="" disabled>
            Selecione…
          </option>
          {parentOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label} — {option.title}
            </option>
          ))}
        </Select>
      </label>

      <label className="flex flex-col gap-1 text-xs font-medium">
        Fundamento da incorporação (mínimo {MIN_INCORPORATION_BASIS_LENGTH} caracteres)
        <Textarea
          name="incorporationBasis"
          value={basis}
          onChange={(event) => setBasis(event.target.value)}
          rows={2}
          required
          minLength={MIN_INCORPORATION_BASIS_LENGTH}
          maxLength={MAX_INCORPORATION_BASIS_LENGTH}
          placeholder="Ex.: Cláusula 4.2 do contrato incorpora esta proposta por referência."
        />
        {basis.trim().length > 0 && basis.trim().length < MIN_INCORPORATION_BASIS_LENGTH ? (
          <span className="text-xs text-destructive">
            Faltam {MIN_INCORPORATION_BASIS_LENGTH - basis.trim().length} caracteres.
          </span>
        ) : null}
      </label>

      {selectedOption ? (
        <p className="text-xs text-muted-foreground">
          {isChangingExistingLink
            ? `"${childDocumentTitle}" vai deixar de ser anexo de "${currentParentLabel}" e passar a ser anexo de "${selectedOption.label}".`
            : `"${childDocumentTitle}" vai ser vinculado como anexo contratual de "${selectedOption.label}".`}
        </p>
      ) : null}

      {isChangingExistingLink ? (
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={changeConfirmed}
            onChange={(event) => setChangeConfirmed(event.target.checked)}
          />
          Confirmo a troca do documento pai.
        </label>
      ) : null}

      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      {state.success ? <p className="text-xs text-emerald-600">Vínculo salvo.</p> : null}

      {state.conflict ? (
        // CONFLICT_STALE_PARENT: o pai real no banco já não é o que
        // esta tela achava — nunca reenviar o mesmo formulário sem
        // recarregar (evita sobrescrever silenciosamente o que outra
        // sessão já fez).
        <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
          Recarregar página
        </Button>
      ) : null}

      {state.confirmationRequired && !isChangingExistingLink ? (
        <p className="text-xs text-destructive">
          Já existe um vínculo com outro documento pai. Selecione o novo pai de novo e marque &quot;Confirmo a troca do
          documento pai&quot; antes de salvar.
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || !canSubmit}>
          {pending ? "Salvando…" : isChangingExistingLink ? "Salvar (confirmar troca)" : "Salvar"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => {
            setSelectedParentId("");
            setBasis("");
            setChangeConfirmed(false);
          }}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}
