"use server";

// Server Actions de "Propostas de Adicionais". Toda escrita passa pelo
// client de sessão (createSupabaseServerClient) — nunca service-role —
// para que a RLS (EDITOR + auth.uid() como autor) seja a única
// autoridade real sobre quem pode criar/atualizar/marcar CONTRATADO.
// Nenhuma IA é chamada aqui exceto em runAdditionalProposalCurationAction,
// que é sempre somente-leitura (nunca escreve na proposta).

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@axion/db/server";
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

    const proposal = await createAdditionalProposal(supabase, {
      projectId,
      createdByUserId: user.id,
      proposalNumber: requiredField(formData, "proposalNumber"),
      title: requiredField(formData, "title"),
      description: optionalField(formData, "description") ?? undefined,
      sourceType,
      driveUrl: optionalField(formData, "driveUrl"),
      driveFileId: optionalField(formData, "driveFileId"),
      proposalDate: optionalField(formData, "proposalDate"),
      proposedValue: optionalField(formData, "proposedValue") ? Number(optionalField(formData, "proposedValue")) : undefined,
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
