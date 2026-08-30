"use server";

// Server Actions de "Propostas de Adicionais". Toda escrita passa pelo
// client de sessão (createSupabaseServerClient) — nunca service-role —
// para que a RLS (EDITOR + auth.uid() como autor) seja a única
// autoridade real sobre quem pode criar/atualizar/marcar CONTRATADO.
// Nenhuma IA é chamada aqui exceto em runAdditionalProposalCurationAction,
// que é sempre somente-leitura (nunca escreve na proposta).

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@axion/db/server";
import { getProposalDriveLookupClient } from "@/lib/additionals/proposal-drive-lookup/get-proposal-drive-lookup-client";
import { resolveAdditionalProposalFromDrive } from "@/lib/additionals/proposal-drive-lookup/resolve-proposal-from-drive";
import { validateProposalCostFile } from "@/lib/additionals/manual-proposal-upload/validate-proposal-cost-file";
import { readFechamentoEstimateFromBuffer } from "@/lib/additionals/manual-proposal-upload/read-fechamento-estimate-from-buffer";
import { createAdditionalProposal } from "@/lib/additionals/create-additional-proposal";
import { linkAdditionalProposalSource } from "@/lib/additionals/link-additional-proposal-source";
import { markAdditionalProposalContracted } from "@/lib/additionals/mark-additional-proposal-contracted";
import { updateAdditionalProposalApprovals } from "@/lib/additionals/update-additional-proposal-approvals";
import { updateAdditionalProposalStatus } from "@/lib/additionals/update-additional-proposal-status";
import { getAdditionalProposal } from "@/lib/additionals/get-additional-proposals";
import { runAdditionalProposalCuration } from "@/lib/additionals/curation";
import type {
  AdditionalProposalApprovalStatus,
  AdditionalProposalDocumentalState,
  AdditionalProposalExecutionStatus,
  AdditionalProposalFormalizationType,
  AdditionalProposalLinkRole,
  AdditionalProposalScheduleExtensionStatus,
  AdditionalProposalSourceType,
  AdditionalProposalStatus,
} from "@/lib/additionals/types";
import type {
  CreateAdditionalProposalState,
  LinkAdditionalProposalSourceState,
  MarkAdditionalProposalContractedState,
  RunAdditionalProposalCurationState,
  UpdateAdditionalProposalApprovalsState,
  UpdateAdditionalProposalStatusState,
} from "./actions-state";

function optionalField(formData: FormData, name: string): string | null {
  const value = String(formData.get(name) ?? "").trim();
  return value || null;
}

function requiredField(formData: FormData, name: string): string {
  const value = optionalField(formData, name);
  if (!value) throw new Error(`Campo obrigatório ausente: ${name}`);
  return value;
}

async function requireUser(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Sessão expirada. Faça login novamente.");
  return data.user;
}

// ---------------- Criar proposta ----------------

export async function createAdditionalProposalAction(
  _prevState: CreateAdditionalProposalState,
  formData: FormData
): Promise<CreateAdditionalProposalState> {
  const supabase = await createSupabaseServerClient();

  try {
    const user = await requireUser(supabase);
    const projectId = requiredField(formData, "projectId");
    const sourceType = requiredField(formData, "sourceType") as AdditionalProposalSourceType;

    // Origem DRIVE via "Selecionar proposta em ORÇAMENTOS": o navegador
    // só manda projectId + driveFolderId (o identificador canônico) —
    // número, escopo (nome completo da pasta) e preço/estimativa são
    // resolvidos de novo aqui, a partir do folderId contra a MESMA fonte
    // canônica do dropdown, nunca a partir de proposalNumber/description/
    // proposedValue que o cliente possa ter enviado junto (esses três
    // campos são SEMPRE ignorados/sobrescritos neste caminho — mesmo que
    // o navegador os tenha adulterado no DOM antes do submit).
    const driveFolderId = sourceType === "DRIVE" ? optionalField(formData, "driveFolderId") : null;

    let proposalNumber = requiredField(formData, "proposalNumber");
    let description = optionalField(formData, "description") ?? undefined;
    let proposedValue = optionalField(formData, "proposedValue") ? Number(optionalField(formData, "proposedValue")) : undefined;
    let resolvedDriveFolderId: string | null = null;

    if (driveFolderId) {
      const client = getProposalDriveLookupClient();

      // Fail-closed: bloqueio SERVIDOR, não só de interface — em
      // produção (sem cliente real configurado) esta origem é recusada
      // aqui, mesmo que driveFolderId tenha chegado por algum caminho
      // que ignorou a UI (form adulterado, chamada direta à action).
      if (!client) {
        throw new Error("Integração com Google Drive ainda não configurada — não é possível criar uma proposta com essa origem.");
      }

      const folders = await client.listOrcamentosSubfolders();
      const folder = folders.find((f) => f.id === driveFolderId);

      if (!folder) {
        throw new Error("A pasta selecionada não é uma subpasta direta de ORÇAMENTOS ou não foi encontrada.");
      }

      const resolved = await resolveAdditionalProposalFromDrive(client, folder.id, folder.name);
      proposalNumber = resolved.proposalNumber;
      description = resolved.folderName;
      proposedValue = resolved.salePrice ?? undefined;
      resolvedDriveFolderId = resolved.folderId;

      if (resolved.isEstimate) {
        // Sem coluna dedicada de "estimativa" no schema atual (nenhuma
        // migration criada nesta etapa) — sinalizado em texto, honesto e
        // visível, no campo já existente `note`, nunca inventado como
        // valor definitivo.
        const estimateNote = `[ESTIMATIVA — FECHAMENTO/B12, arquivo "${resolved.costFileName}"]`;
        const existingNote = optionalField(formData, "note");
        formData.set("note", existingNote ? `${estimateNote} ${existingNote}` : estimateNote);
      }
    }

    // Origem MANUAL com planilha de custo anexada — go-live com Google
    // Drive desabilitado (Bloco 7): reaproveita a MESMA regra de
    // estimativa do lookup do Drive (isSingleFechamentoWorkbook/
    // parseFechamentoCellValue via read-fechamento-estimate-from-buffer.ts),
    // nunca uma segunda implementação, nunca consulta o Drive real,
    // nunca usa a fixture do Drive em produção. Validação de
    // extensão/MIME sempre no servidor, nunca só confiando no
    // navegador. Quando o arquivo resolve um preço real, ele SEMPRE
    // prevalece sobre um valor digitado à mão (mesmo princípio já
    // aplicado ao ramo DRIVE acima) — nunca as duas fontes coexistindo
    // silenciosamente.
    const costFile = sourceType === "MANUAL" ? formData.get("costFile") : null;
    if (costFile instanceof File && costFile.size > 0) {
      const validation = validateProposalCostFile(costFile.name, costFile.type);
      if (!validation.valid) {
        throw new Error(validation.error ?? "Arquivo de planilha inválido.");
      }

      const buffer = await costFile.arrayBuffer();
      const estimate = await readFechamentoEstimateFromBuffer(buffer);

      if (estimate.isEstimate && estimate.salePrice !== null) {
        proposedValue = estimate.salePrice;
        const estimateNote = `[ESTIMATIVA — FECHAMENTO/B12, arquivo "${costFile.name}" (upload manual)]`;
        const existingNote = optionalField(formData, "note");
        formData.set("note", existingNote ? `${estimateNote} ${existingNote}` : estimateNote);
      } else if (estimate.warning) {
        const existingNote = optionalField(formData, "note");
        const warningNote = `[${estimate.warning}]`;
        formData.set("note", existingNote ? `${warningNote} ${existingNote}` : warningNote);
      }
    }

    const proposal = await createAdditionalProposal(supabase, {
      projectId,
      createdByUserId: user.id,
      proposalNumber,
      title: requiredField(formData, "title"),
      description,
      sourceType,
      driveUrl: driveFolderId ? null : optionalField(formData, "driveUrl"),
      driveFileId: driveFolderId ? resolvedDriveFolderId : optionalField(formData, "driveFileId"),
      proposalDate: optionalField(formData, "proposalDate"),
      proposedValue,
      note: optionalField(formData, "note"),
      origin:
        sourceType === "EXISTING"
          ? {
              documentVersionId: optionalField(formData, "originDocumentVersionId") ?? undefined,
              emailId: optionalField(formData, "originEmailId") ?? undefined,
              emailAttachmentId: optionalField(formData, "originEmailAttachmentId") ?? undefined,
              eventId: optionalField(formData, "originEventId") ?? undefined,
              note: optionalField(formData, "originNote") ?? undefined,
            }
          : undefined,
    });

    revalidatePath(`/${projectId}/adicionais`);
    return { error: null, success: true, proposalId: proposal.id };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao criar proposta de adicional.", success: false, proposalId: null };
  }
}

// ---------------- Atualizar status (não-CONTRATADO) ----------------

export async function updateAdditionalProposalStatusAction(
  _prevState: UpdateAdditionalProposalStatusState,
  formData: FormData
): Promise<UpdateAdditionalProposalStatusState> {
  const supabase = await createSupabaseServerClient();

  try {
    await requireUser(supabase);
    const projectId = requiredField(formData, "projectId");
    const proposalId = requiredField(formData, "proposalId");
    const status = requiredField(formData, "status") as Exclude<AdditionalProposalStatus, "CONTRACTED">;

    await updateAdditionalProposalStatus(supabase, { proposalId, status });

    revalidatePath(`/${projectId}/adicionais`);
    revalidatePath(`/${projectId}/adicionais/${proposalId}`);
    return { error: null, success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao atualizar status da proposta.", success: false };
  }
}

// ---------------- Atualizar aprovações independentes ----------------

export async function updateAdditionalProposalApprovalsAction(
  _prevState: UpdateAdditionalProposalApprovalsState,
  formData: FormData
): Promise<UpdateAdditionalProposalApprovalsState> {
  const supabase = await createSupabaseServerClient();

  try {
    await requireUser(supabase);
    const projectId = requiredField(formData, "projectId");
    const proposalId = requiredField(formData, "proposalId");

    await updateAdditionalProposalApprovals(supabase, {
      proposalId,
      scopeApprovalStatus: (optionalField(formData, "scopeApprovalStatus") as AdditionalProposalApprovalStatus | null) ?? undefined,
      commercialApprovalStatus:
        (optionalField(formData, "commercialApprovalStatus") as AdditionalProposalApprovalStatus | null) ?? undefined,
      scheduleExtensionStatus:
        (optionalField(formData, "scheduleExtensionStatus") as AdditionalProposalScheduleExtensionStatus | null) ?? undefined,
      executionStatus: (optionalField(formData, "executionStatus") as AdditionalProposalExecutionStatus | null) ?? undefined,
    });

    revalidatePath(`/${projectId}/adicionais/${proposalId}`);
    return { error: null, success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao atualizar aprovações da proposta.", success: false };
  }
}

// ---------------- Marcar como CONTRATADO ----------------

export async function markAdditionalProposalContractedAction(
  _prevState: MarkAdditionalProposalContractedState,
  formData: FormData
): Promise<MarkAdditionalProposalContractedState> {
  const supabase = await createSupabaseServerClient();

  try {
    await requireUser(supabase);
    const projectId = requiredField(formData, "projectId");
    const proposalId = requiredField(formData, "proposalId");

    await markAdditionalProposalContracted(supabase, {
      proposalId,
      contractedAt: requiredField(formData, "contractedAt"),
      contractedValue: optionalField(formData, "contractedValue") ? Number(optionalField(formData, "contractedValue")) : null,
      formalizationType: requiredField(formData, "formalizationType") as AdditionalProposalFormalizationType,
      approvalEvidenceNote: optionalField(formData, "approvalEvidenceNote"),
      executionStarted: formData.get("executionStarted") === "on",
      contractedNote: optionalField(formData, "contractedNote"),
      documentalState: requiredField(formData, "documentalState") as AdditionalProposalDocumentalState,
      reservationConflictingClause: optionalField(formData, "reservationConflictingClause"),
      reservationRisk: optionalField(formData, "reservationRisk"),
      reservationRecommendation: optionalField(formData, "reservationRecommendation"),
    });

    revalidatePath(`/${projectId}/adicionais`);
    revalidatePath(`/${projectId}/adicionais/${proposalId}`);
    return { error: null, success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao marcar proposta como contratada.", success: false };
  }
}

// ---------------- Vincular fonte/checklist ----------------

export async function linkAdditionalProposalSourceAction(
  _prevState: LinkAdditionalProposalSourceState,
  formData: FormData
): Promise<LinkAdditionalProposalSourceState> {
  const supabase = await createSupabaseServerClient();

  try {
    const user = await requireUser(supabase);
    const projectId = requiredField(formData, "projectId");
    const proposalId = requiredField(formData, "proposalId");
    const linkRole = requiredField(formData, "linkRole") as AdditionalProposalLinkRole;
    const notApplicable = formData.get("notApplicable") === "on";

    await linkAdditionalProposalSource(supabase, {
      proposalId,
      linkRole,
      createdByUserId: user.id,
      documentVersionId: optionalField(formData, "documentVersionId") ?? undefined,
      emailId: optionalField(formData, "emailId") ?? undefined,
      emailAttachmentId: optionalField(formData, "emailAttachmentId") ?? undefined,
      eventId: optionalField(formData, "eventId") ?? undefined,
      notApplicable,
      notApplicableJustification: optionalField(formData, "notApplicableJustification") ?? undefined,
      note: optionalField(formData, "note") ?? undefined,
    });

    revalidatePath(`/${projectId}/adicionais/${proposalId}`);
    return { error: null, success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao vincular fonte à proposta.", success: false };
  }
}

// ---------------- Curadoria multiagente (Comercial + Planejamento + Jurídico + CEO) ----------------

export async function runAdditionalProposalCurationAction(
  _prevState: RunAdditionalProposalCurationState,
  formData: FormData
): Promise<RunAdditionalProposalCurationState> {
  const supabase = await createSupabaseServerClient();

  try {
    await requireUser(supabase);
    const proposalId = requiredField(formData, "proposalId");

    const proposal = await getAdditionalProposal(supabase, proposalId);
    if (!proposal) throw new Error("Proposta não encontrada.");

    const result = await runAdditionalProposalCuration(supabase, proposal);
    return { error: null, result };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao executar a curadoria de Experts IA.", result: null };
  }
}
