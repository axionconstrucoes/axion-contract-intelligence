"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FeatureInfo } from "@/components/shared/feature-info";
import { markAdditionalProposalContractedAction } from "@/app/[projectId]/adicionais/actions";
import { initialMarkAdditionalProposalContractedState } from "@/app/[projectId]/adicionais/actions-state";
import { additionalProposalDocumentalStateLabels, additionalProposalFormalizationTypeLabels } from "@/lib/labels";
import type { AdditionalProposalDocumentalState, AdditionalProposalFormalizationType } from "@/lib/additionals/types";

const FORMALIZATION_TYPES: AdditionalProposalFormalizationType[] = [
  "ADITIVO_CONTRATUAL",
  "EMAIL_APROVACAO",
  "ORDEM_COMPRA_PO",
  "ORDEM_SERVICO",
  "CARTA_AUTORIZACAO_FORMAL",
  "ATA_REGISTRO_FORMAL_ACEITO",
  "OUTRO",
  "NAO_IDENTIFICADO",
];

const DOCUMENTAL_STATES: AdditionalProposalDocumentalState[] = [
  "CONTRATADO_DOCUMENTACAO_COMPLETA",
  "CONTRATADO_DOCUMENTACAO_PENDENTE",
  "CONTRATADO_FORMALIZACAO_COM_RESSALVA",
];

/**
 * "Marcar como CONTRATADO" — somente humano (RLS EDITOR). Nunca exige
 * aditivo contratual: qualquer forma de formalização é aceita, inclusive
 * NAO_IDENTIFICADO. CONTRATADO_FORMALIZACAO_COM_RESSALVA nunca bloqueia
 * a contratação já ocorrida — só registra a divergência para revisão
 * humana (ver seção "RESSALVA JURÍDICA").
 */
export function AdditionalProposalContractedForm({ projectId, proposalId }: { projectId: string; proposalId: string }) {
  const [state, formAction, pending] = useActionState(markAdditionalProposalContractedAction, initialMarkAdditionalProposalContractedState);
  const [documentalState, setDocumentalState] = useState<AdditionalProposalDocumentalState>("CONTRATADO_DOCUMENTACAO_PENDENTE");

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border border-severity-alta/40 bg-severity-alta/5 p-4">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="proposalId" value={proposalId} />
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        Marcar como CONTRATADO
        <FeatureInfo helpId="adicionais-marcar-contratado" />
      </p>
      <p className="text-xs text-muted-foreground">Ação exclusivamente humana — nenhum Expert IA pode executar esta ação.</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Data da contratação
          <Input type="date" name="contractedAt" required />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Valor contratado (se conhecido)
          <Input type="number" step="0.01" name="contractedValue" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          <span className="flex items-center gap-1.5">
            Forma de formalização
            <FeatureInfo helpId="adicionais-formalizacao" />
          </span>
          <Select name="formalizationType" defaultValue="NAO_IDENTIFICADO" required>
            {FORMALIZATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {additionalProposalFormalizationTypeLabels[t]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Execução já iniciada?
          <Select name="executionStarted" defaultValue="">
            <option value="">Não</option>
            <option value="on">Sim</option>
          </Select>
        </label>
      </div>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Evidência de aprovação (descrição/referência)
        <Textarea name="approvalEvidenceNote" rows={2} placeholder="Ex.: e-mail do cliente de 12/08 aprovando a proposta AXN CP 621" />
      </label>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Estado documental
        <Select name="documentalState" value={documentalState} onChange={(e) => setDocumentalState(e.target.value as AdditionalProposalDocumentalState)} required>
          {DOCUMENTAL_STATES.map((s) => (
            <option key={s} value={s}>
              {additionalProposalDocumentalStateLabels[s]}
            </option>
          ))}
        </Select>
      </label>

      {documentalState === "CONTRATADO_FORMALIZACAO_COM_RESSALVA" ? (
        <div className="flex flex-col gap-3 rounded-md bg-muted/40 p-3">
          <p className="text-xs font-medium text-muted-foreground">
            Ressalva jurídica — o contrato-base pode exigir forma específica (ex.: aditivo assinado) que não foi a
            forma realmente usada. Isso não bloqueia o registro da contratação já ocorrida.
          </p>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Cláusula contratual conflitante
            <Textarea name="reservationConflictingClause" rows={2} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Risco identificado
            <Textarea name="reservationRisk" rows={2} required />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Recomendação de regularização
            <Textarea name="reservationRecommendation" rows={2} />
          </label>
        </div>
      ) : null}

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Observação (opcional)
        <Textarea name="contractedNote" rows={2} />
      </label>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-emerald-600">Proposta marcada como CONTRATADO.</p> : null}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Salvando…" : "Confirmar contratação"}
      </Button>
    </form>
  );
}
