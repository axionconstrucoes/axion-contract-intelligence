"use client";

// Formulário genérico de "Origem da fonte" (seções 8-18 do requisito)
// — reutilizado por Construmanager/Drive/Diário de Obra/Contrato e
// Aditivos/Recebidos Cliente/RFI-RFP/Cronograma/Relatórios/ERP/
// Orçamento/ESG-SSMA. Sempre preenchido por humano (ADMIN) — nunca
// inventa informação; campo vazio nunca é exibido como se tivesse um
// valor.

import { useActionState } from "react";
import { FeatureInfo } from "@/components/shared/feature-info";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { saveIntegrationOriginAction } from "@/app/[projectId]/integracoes/actions";
import { initialSaveIntegrationOriginState } from "@/app/[projectId]/integracoes/actions-state";
import { driveTypeLabels } from "@/lib/labels";
import type { DriveType, IntegrationConfig, SourceType } from "@axion/types";

function fieldLabels(sourceType: SourceType) {
  if (sourceType === "ESG_SSMA") {
    return { account: "Técnico de Segurança", responsible: "Responsável/Gerente ESG" };
  }
  if (sourceType === "GOOGLE_DRIVE") {
    return { account: "Conta Google", responsible: "Responsável" };
  }
  return { account: "Conta", responsible: "Responsável" };
}

export function IntegrationOriginForm({
  projectId,
  sourceType,
  config,
  onCancel,
}: {
  projectId: string;
  sourceType: SourceType;
  config: IntegrationConfig | undefined;
  onCancel: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveIntegrationOriginAction, initialSaveIntegrationOriginState);
  const labels = fieldLabels(sourceType);

  if (state.success) {
    return <p className="rounded-md bg-muted/40 p-3 text-sm">Origem da fonte salva.</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border p-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="sourceType" value={sourceType} />

      {sourceType !== "ESG_SSMA" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-xs font-medium">
            Sistema
            <Input name="externalSystemReference" defaultValue={config?.externalSystemReference ?? ""} placeholder="Ex.: Construmanager" />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium">
            Projeto/Obra
            <Input
              name="externalProjectReference"
              defaultValue={config?.externalProjectReference ?? ""}
              placeholder="Ex.: WEG — Fábrica de Fios"
            />
          </label>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-xs font-medium">
          {labels.account}
          <Input name="accountReference" defaultValue={config?.accountReference ?? ""} placeholder="nome@axion.com.br" />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-medium">
          {labels.responsible}
          <Input name="responsibleReference" defaultValue={config?.responsibleReference ?? ""} placeholder="nome@axion.com.br" />
        </label>
      </div>

      {sourceType === "GOOGLE_DRIVE" ? (
        <label className="flex flex-col gap-1.5 text-xs font-medium">
          <span className="flex items-center gap-1.5">
            Tipo
            <FeatureInfo helpId="drive-type" />
          </span>
          <Select name="driveType" defaultValue={config?.driveType ?? ""}>
            <option value="">Selecione…</option>
            {(Object.keys(driveTypeLabels) as DriveType[]).map((type) => (
              <option key={type} value={type}>
                {driveTypeLabels[type]}
              </option>
            ))}
          </Select>
        </label>
      ) : null}

      {sourceType !== "ESG_SSMA" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-xs font-medium">
            Pasta/Local
            <Input name="folderReference" defaultValue={config?.folderReference ?? ""} placeholder="Ex.: 01_RECEBIDOS CLIENTE" />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium">
            Arquivo
            <Input name="fileReference" defaultValue={config?.fileReference ?? ""} placeholder="Ex.: cronograma-baseline.mpp" />
          </label>
        </div>
      ) : null}

      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Salvando…" : "Salvar origem"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
