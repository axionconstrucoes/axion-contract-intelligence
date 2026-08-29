"use client";

import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createAdditionalProposalAction } from "@/app/[projectId]/adicionais/actions";
import { initialCreateAdditionalProposalState } from "@/app/[projectId]/adicionais/actions-state";
import { resolveAdditionalProposalFromDriveAction } from "@/app/[projectId]/adicionais/drive-lookup-actions";
import { initialResolveAdditionalProposalFromDriveState } from "@/app/[projectId]/adicionais/drive-lookup-actions-state";
import type { AdditionalProposalDriveFolderOption } from "@/lib/additionals/proposal-drive-lookup/list-orcamentos-proposals";
import type { AdditionalProposalSourceType } from "@/lib/additionals/types";

// "+ Nova proposta de adicional" — três origens (seção B do requisito).
// Sem Dialog/modal (nenhum primitivo disponível nesta base — ver
// components/ui/) — mesmo padrão inline de SlaActionForm.
//
// Origem DRIVE: número da proposta NUNCA é digitado livremente — um
// formulário próprio ("Selecionar proposta em ORÇAMENTOS", 2 <form>
// separados nunca aninhados) resolve número/escopo/preço no SERVIDOR a
// partir só do driveFolderId escolhido; o formulário de criação abaixo
// só recebe esses valores já resolvidos como campos ocultos — o
// servidor os resolve de novo mesmo assim (ver actions.ts), nunca
// confiando no que está no DOM.
export function AdditionalProposalCreateForm({
  projectId,
  driveProposalFolders,
  driveIntegrationConfigured,
}: {
  projectId: string;
  driveProposalFolders: AdditionalProposalDriveFolderOption[];
  // false em produção (fail-closed, ver get-proposal-drive-lookup-client.ts
  // — nenhum cliente real do Drive existe ainda). Distingue "integração
  // não configurada" de "ORÇAMENTOS genuinamente vazio" — as duas
  // situações chegam aqui com driveProposalFolders=[], mas exigem
  // mensagens diferentes.
  driveIntegrationConfigured: boolean;
}) {
  const [state, formAction, pending] = useActionState(createAdditionalProposalAction, initialCreateAdditionalProposalState);
  const [sourceType, setSourceType] = useState<AdditionalProposalSourceType>("MANUAL");
  const [originKind, setOriginKind] = useState<"documentVersionId" | "emailId" | "emailAttachmentId" | "eventId">("documentVersionId");

  const [resolveState, resolveFormAction, resolvePending] = useActionState(
    resolveAdditionalProposalFromDriveAction,
    initialResolveAdditionalProposalFromDriveState
  );
  const resolved = resolveState.status === "resolved" ? resolveState.result : null;
  const resolveFormRef = useRef<HTMLFormElement>(null);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Origem
          <Select
            name="sourceTypeSelector"
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value as AdditionalProposalSourceType)}
            required
          >
            <option value="MANUAL">Manual</option>
            <option value="DRIVE">Google Drive</option>
            <option value="EXISTING">Fonte já existente no ACC</option>
          </Select>
        </label>
      </div>

      {sourceType === "DRIVE" && !resolved ? (
        <div className="flex flex-col gap-2 rounded-md bg-muted/40 p-3">
          <p className="text-sm font-medium">Selecionar proposta em ORÇAMENTOS</p>
          {!driveIntegrationConfigured ? (
            <p className="text-sm text-muted-foreground">
              Integração com Google Drive ainda não configurada. Não é possível criar uma proposta com origem Drive
              agora — use a origem Manual.
            </p>
          ) : driveProposalFolders.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma proposta encontrada na pasta ORÇAMENTOS. Não é possível criar uma proposta com origem Drive
              agora — use a origem Manual, ou tente novamente mais tarde.
            </p>
          ) : (
            // Sem botão "Buscar": selecionar uma proposta já dispara a
            // resolução no servidor sozinha (onChange -> requestSubmit),
            // igual ao resto do formulário reagir a escolhas do usuário.
            <form ref={resolveFormRef} action={resolveFormAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="projectId" value={projectId} />
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Proposta (ORÇAMENTOS)
                <Select
                  name="driveFolderId"
                  required
                  defaultValue=""
                  className="min-w-64"
                  disabled={resolvePending}
                  onChange={() => resolveFormRef.current?.requestSubmit()}
                >
                  <option value="" disabled>
                    Selecione…
                  </option>
                  {driveProposalFolders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </Select>
              </label>
              {resolvePending ? <span className="text-xs text-muted-foreground">Buscando…</span> : null}
              {resolveState.status === "error" ? <span className="text-xs text-destructive">{resolveState.error}</span> : null}
            </form>
          )}
        </div>
      ) : null}

      {sourceType === "DRIVE" && resolved ? (
        // Somente leitura — tudo aqui veio do servidor a partir só do
        // driveFolderId (ver drive-lookup-actions.ts); nada disto é
        // editável nem reenviado como texto livre pelo formulário abaixo
        // (os hidden inputs logo adiante carregam os mesmos valores).
        <div className="flex flex-col gap-1.5 rounded-md border border-emerald-600/40 bg-emerald-600/5 p-3 text-sm">
          <p className="font-medium">Proposta selecionada (somente leitura)</p>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-2 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Número</dt>
            <dd>{resolved.proposalNumber}</dd>
            <dt className="text-muted-foreground">Nome completo / escopo</dt>
            <dd>{resolved.folderName}</dd>
            <dt className="text-muted-foreground">Preço de venda</dt>
            <dd>
              {resolved.salePrice !== null
                ? resolved.salePrice.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                : "Não pôde ser resolvido automaticamente"}
            </dd>
            {resolved.salePrice !== null ? (
              <>
                <dt className="text-muted-foreground">Estimativa</dt>
                <dd>
                  {resolved.isEstimate ? (
                    <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-800">ESTIMATIVA (FECHAMENTO/B12)</span>
                  ) : (
                    "Não — valor exato"
                  )}
                </dd>
              </>
            ) : null}
            {resolved.costFileName ? (
              <>
                <dt className="text-muted-foreground">Arquivo de origem</dt>
                <dd>{resolved.costFileName}</dd>
              </>
            ) : null}
          </dl>
          {resolved.warnings.map((warning) => (
            <p key={warning} className="text-xs text-amber-700">
              {warning}
            </p>
          ))}
        </div>
      ) : null}

      <form action={formAction} className="flex flex-col gap-3 rounded-md border border-dashed p-4">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="sourceType" value={sourceType} />

        {sourceType === "DRIVE" && resolved ? (
          <>
            <input type="hidden" name="driveFolderId" value={resolved.folderId} />
            <input type="hidden" name="proposalNumber" value={resolved.proposalNumber} />
            <input type="hidden" name="description" value={resolved.folderName} />
            {resolved.salePrice !== null ? <input type="hidden" name="proposedValue" value={resolved.salePrice} /> : null}
          </>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          {sourceType === "DRIVE" ? (
            resolved ? (
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Número da proposta
                <Input value={resolved.proposalNumber} readOnly disabled />
              </label>
            ) : null
          ) : (
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Número da proposta
              <Input name="proposalNumber" required placeholder="Ex.: AXN CP 621" />
            </label>
          )}

          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Título
            <Input name="title" required placeholder="Título curto do adicional" />
          </label>

          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Data (opcional)
            <Input type="date" name="proposalDate" />
          </label>

          {sourceType !== "DRIVE" ? (
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Valor proposto (opcional)
              <Input name="proposedValue" type="number" step="0.01" />
            </label>
          ) : null}
        </div>

        {sourceType !== "DRIVE" ? (
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Descrição
            <Textarea name="description" rows={2} />
          </label>
        ) : null}

        {sourceType === "MANUAL" ? (
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Planilha de custo (opcional — .xlsx/.xls)
            <Input name="costFile" type="file" accept=".xlsx,.xls" />
            <span className="text-xs font-normal text-muted-foreground">
              Google Drive está desabilitado nesta fase — selecione a planilha diretamente. Se ela tiver exatamente
              uma aba &quot;FECHAMENTO&quot;, o valor da célula B12 preenche automaticamente o valor proposto acima
              (estimativa, nunca definitivo).
            </span>
          </label>
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

        <Button
          type="submit"
          disabled={pending || (sourceType === "DRIVE" && (!resolved || driveProposalFolders.length === 0))}
          className="self-start"
        >
          {pending ? "Criando…" : "Criar proposta"}
        </Button>
      </form>
    </div>
  );
}
