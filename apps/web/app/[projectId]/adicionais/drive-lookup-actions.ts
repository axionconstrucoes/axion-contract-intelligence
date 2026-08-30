"use server";

import { getCurrentProjectPermission } from "@/lib/contract-review";
import { getProposalDriveLookupClient } from "@/lib/additionals/proposal-drive-lookup/get-proposal-drive-lookup-client";
import { resolveAdditionalProposalFromDrive } from "@/lib/additionals/proposal-drive-lookup/resolve-proposal-from-drive";
import type { ResolveAdditionalProposalFromDriveState } from "./drive-lookup-actions-state";

// "Selecionar proposta em ORÇAMENTOS" — nunca confia em nome/número/
// escopo/preço vindos do navegador (o <option> poderia ter sido
// adulterado no DOM antes do submit, ou o formulário pode ter sido
// forjado inteiro): o navegador só envia projectId + o identificador
// canônico driveFolderId; TUDO o mais (nome real da pasta, número,
// planilha de custo, preço) é resolvido de novo aqui, a partir do
// folderId, contra a MESMA fonte que alimenta o dropdown — nunca a
// partir de um valor solto submetido junto.
//
// Permissão: mesma barreira real de criação de proposta (RLS de
// project_additional_proposals exige "EDITOR", que por
// 20260824232516_enforce_admin_only_write.sql só ADMINISTRADOR atinge —
// ver actions.ts, header do arquivo). getCurrentProjectPermission já
// exige status=ACTIVE da membership (nunca uma membership desativada
// concede permissão) — nenhuma checagem de "ACTIVE" duplicada à parte.
//
// Fixture determinística nesta etapa (nunca o Drive real).
export async function resolveAdditionalProposalFromDriveAction(
  _prevState: ResolveAdditionalProposalFromDriveState,
  formData: FormData
): Promise<ResolveAdditionalProposalFromDriveState> {
  const projectId = String(formData.get("projectId") ?? "").trim();
  const folderId = String(formData.get("driveFolderId") ?? "").trim();

  if (!projectId) {
    return { status: "error", error: "Projeto ausente. Recarregue a página e tente novamente.", result: null };
  }
  if (!folderId) {
    return { status: "error", error: "Selecione uma proposta na lista.", result: null };
  }

  const permission = await getCurrentProjectPermission(projectId);
  if (permission !== "ADMINISTRADOR") {
    return {
      status: "error",
      error: "Selecionar uma proposta em ORÇAMENTOS exige permissão ADMINISTRADOR neste projeto.",
      result: null,
    };
  }

  const client = getProposalDriveLookupClient();

  // Fail-closed: em produção (sem cliente real configurado) o servidor
  // recusa ANTES de qualquer outra checagem — nunca só a interface
  // esconde o dropdown; mesmo uma chamada direta a esta Server Action
  // (bypassando a UI) é bloqueada aqui.
  if (!client) {
    return {
      status: "error",
      error: "Integração com Google Drive ainda não configurada.",
      result: null,
    };
  }

  // Busca de novo a lista real (nunca confia num id solto) e só aceita
  // um folderId que é descendente DIRETO de ORÇAMENTOS nessa lista —
  // nenhuma pasta "externa"/mais funda pode ser resolvida a partir daqui.
  const folders = await client.listOrcamentosSubfolders();
  const folder = folders.find((f) => f.id === folderId);

  if (!folder) {
    return {
      status: "error",
      error: "A pasta selecionada não é uma subpasta direta de ORÇAMENTOS ou não foi encontrada — nenhuma pasta externa é aceita.",
      result: null,
    };
  }

  const result = await resolveAdditionalProposalFromDrive(client, folder.id, folder.name);
  return { status: "resolved", error: null, result };
}
