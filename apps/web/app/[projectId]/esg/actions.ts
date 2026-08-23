"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@axion/db/server";

import { computeObligationRisk } from "@/lib/esg/compute-obligation-risk";
import type { EsgRiskLevel } from "@/lib/esg/types";
import type { CreateEsgObligationState, CreateEsgSubmissionState, ReviewEsgSubmissionState } from "./actions-state";

// Este módulo é "use server" — só pode exportar funções async (Server
// Actions). Tipos e estados iniciais vivem em ./actions-state.ts.

function optionalField(formData: FormData, name: string): string | null {
  const value = String(formData.get(name) ?? "").trim();
  return value || null;
}

function requiredField(formData: FormData, name: string): string {
  const value = optionalField(formData, name);
  if (!value) throw new Error(`Campo obrigatório ausente: ${name}`);
  return value;
}

// ---------------- Criar obrigação (checklist configurável) ----------------

// Configurar o checklist exige EDITOR/ADMIN — a policy RLS
// "esg_obligations_insert_editor" (identidade + permissão) é a única
// autoridade; esta action só encaminha o INSERT e traduz erro em estado.
export async function createEsgObligationAction(
  _prevState: CreateEsgObligationState,
  formData: FormData
): Promise<CreateEsgObligationState> {
  const supabase = await createSupabaseServerClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return { error: "Sessão expirada. Faça login novamente.", success: false };
  }

  try {
    const projectId = requiredField(formData, "projectId");
    const title = requiredField(formData, "title");
    const category = requiredField(formData, "category");
    const periodicity = requiredField(formData, "periodicity");
    const description = optionalField(formData, "description");
    const sourceReference = optionalField(formData, "sourceReference");
    const requiredEvidenceDescription = optionalField(formData, "requiredEvidenceDescription");
    const penaltyDescription = optionalField(formData, "penaltyDescription");
    const responsibleLabel = optionalField(formData, "responsibleLabel");
    const clauseId = optionalField(formData, "clauseId");
    const sourceDocumentVersionId = optionalField(formData, "sourceDocumentVersionId");

    const { error } = await supabase.from("esg_obligations").insert({
      project_id: projectId,
      title,
      category,
      periodicity,
      description,
      source_reference: sourceReference,
      required_evidence_description: requiredEvidenceDescription,
      penalty_description: penaltyDescription,
      responsible_label: responsibleLabel,
      clause_id: clauseId,
      source_document_version_id: sourceDocumentVersionId,
      created_by_user_id: authData.user.id,
    });

    if (error) {
      return { error: error.message, success: false };
    }

    revalidatePath(`/${projectId}/esg`);
    return { error: null, success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao criar obrigação.", success: false };
  }
}

// ---------------- Registrar comprovação (submission) ----------------

// O cálculo de risco (seção 12/13) é sempre determinístico e feito aqui,
// nunca pela IA — computeObligationRisk é puro e testado isoladamente.
export async function createEsgObligationSubmissionAction(
  _prevState: CreateEsgSubmissionState,
  formData: FormData
): Promise<CreateEsgSubmissionState> {
  const supabase = await createSupabaseServerClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return { error: "Sessão expirada. Faça login novamente.", submissionId: null };
  }

  try {
    const projectId = requiredField(formData, "projectId");
    const obligationId = requiredField(formData, "obligationId");
    const referenceDate = requiredField(formData, "referenceDate");
    const status = requiredField(formData, "status");
    const referencePeriodLabel = optionalField(formData, "referencePeriodLabel");
    const dueDate = optionalField(formData, "dueDate");
    const description = optionalField(formData, "description");
    const observation = optionalField(formData, "observation");
    const justification = optionalField(formData, "justification");

    if ((status === "NAO_APLICAVEL" || status === "DISPENSADO") && !justification) {
      return { error: "Justificativa é obrigatória para NAO_APLICAVEL/DISPENSADO.", submissionId: null };
    }

    let ddsDetails: { tema: string; publico: string | null; numeroParticipantes: number | null } | null = null;
    const ddsTema = optionalField(formData, "ddsTema");
    if (ddsTema) {
      const numeroParticipantesRaw = optionalField(formData, "ddsNumeroParticipantes");
      ddsDetails = {
        tema: ddsTema,
        publico: optionalField(formData, "ddsPublico"),
        numeroParticipantes: numeroParticipantesRaw ? Number(numeroParticipantesRaw) : null,
      };
    }

    const { data: obligationData, error: obligationError } = await supabase
      .from("esg_obligations")
      .select("required_evidence_description,penalty_description")
      .eq("id", obligationId)
      .maybeSingle();

    if (obligationError) {
      return { error: obligationError.message, submissionId: null };
    }
    if (!obligationData) {
      return { error: "Obrigação não encontrada.", submissionId: null };
    }

    const { data: previousSubmission, error: previousError } = await supabase
      .from("esg_obligation_submissions")
      .select("risk_level")
      .eq("obligation_id", obligationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (previousError) {
      return { error: previousError.message, submissionId: null };
    }

    // Nesta submissão inicial, evidenceCount ainda é 0 — o upload de
    // evidências acontece em seguida, client-side (ver
    // EsgSubmissionForm). O risco é recalculado na revisão (ADMIN), que já
    // tem acesso à contagem real de evidências anexadas.
    const risk = computeObligationRisk({
      status: status as never,
      dueDate,
      today: new Date().toISOString().slice(0, 10),
      requiresEvidence: Boolean(obligationData.required_evidence_description),
      evidenceCount: 0,
      hasPenaltyDescribed: Boolean(obligationData.penalty_description),
      previousRiskLevel: (previousSubmission?.risk_level as EsgRiskLevel | null) ?? null,
    });

    const { data: submissionRow, error: submissionError } = await supabase
      .from("esg_obligation_submissions")
      .insert({
        project_id: projectId,
        obligation_id: obligationId,
        reference_date: referenceDate,
        reference_period_label: referencePeriodLabel,
        due_date: dueDate,
        filled_by_user_id: authData.user.id,
        status,
        description,
        observation,
        justification,
        risk_level: risk.riskLevel,
        dds_details: ddsDetails,
      })
      .select("id")
      .single();

    if (submissionError) {
      return { error: submissionError.message, submissionId: null };
    }

    revalidatePath(`/${projectId}/esg`);
    return { error: null, submissionId: submissionRow.id as string };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Falha ao registrar comprovação.",
      submissionId: null,
    };
  }
}

// ---------------- Revisão (ADMIN) ----------------

export async function reviewEsgObligationSubmissionAction(
  _prevState: ReviewEsgSubmissionState,
  formData: FormData
): Promise<ReviewEsgSubmissionState> {
  const supabase = await createSupabaseServerClient();

  try {
    const projectId = requiredField(formData, "projectId");
    const submissionId = requiredField(formData, "submissionId");
    const newStatus = requiredField(formData, "newStatus");
    const reviewNote = optionalField(formData, "reviewNote");

    const { error } = await supabase.rpc("review_esg_obligation_submission", {
      p_submission_id: submissionId,
      p_new_status: newStatus,
      p_review_note: reviewNote,
    });

    if (error) {
      return { error: error.message, success: false };
    }

    revalidatePath(`/${projectId}/esg`);
    return { error: null, success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao revisar comprovação.", success: false };
  }
}
