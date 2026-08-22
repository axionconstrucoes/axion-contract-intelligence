import "server-only";

import { createSupabaseServerClient } from "@axion/db/server";

import type {
  EsgDdsDetails,
  EsgObligation,
  EsgObligationEvidence,
  EsgObligationSubmission,
} from "./types";

type ObligationRow = {
  id: string;
  project_id: string;
  title: string;
  category: string;
  description: string | null;
  source_document_version_id: string | null;
  clause_id: string | null;
  source_reference: string | null;
  responsible_user_id: string | null;
  responsible_label: string | null;
  periodicity: string;
  required_evidence_description: string | null;
  penalty_description: string | null;
  active: boolean;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
};

type SubmissionRow = {
  id: string;
  project_id: string;
  obligation_id: string;
  reference_date: string;
  reference_period_label: string | null;
  due_date: string | null;
  filled_by_user_id: string;
  status: string;
  description: string | null;
  observation: string | null;
  justification: string | null;
  risk_level: string | null;
  dds_details: EsgDdsDetails | null;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
};

type EvidenceRow = {
  id: string;
  project_id: string;
  submission_id: string;
  obligation_id: string;
  evidence_kind: string;
  storage_bucket: string;
  file_path: string;
  original_file_name: string;
  mime_type: string;
  file_size_bytes: number;
  replaces_evidence_id: string | null;
  uploaded_by_user_id: string;
  uploaded_at: string;
};

type ProfileRow = { id: string; name: string };
type ClauseRow = { id: string; clause_number: string };
type DocumentVersionRow = { id: string; document_id: string };
type DocumentRow = { id: string; title: string };

async function resolveProfileNames(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userIds: Array<string | null>
): Promise<Map<string, string>> {
  const ids = Array.from(new Set(userIds.filter((id): id is string => Boolean(id))));
  if (ids.length === 0) return new Map();

  const { data, error } = await supabase.from("profiles").select("id,name").in("id", ids);
  if (error) throw new Error(`Falha ao carregar responsáveis: ${error.message}`);

  return new Map((data as unknown as ProfileRow[]).map((p) => [p.id, p.name]));
}

function mapObligationRow(
  row: ObligationRow,
  namesByUserId: Map<string, string>,
  clauseNumberById: Map<string, string>,
  documentTitleByVersionId: Map<string, string>
): EsgObligation {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    category: row.category as EsgObligation["category"],
    description: row.description,
    sourceDocumentVersionId: row.source_document_version_id,
    sourceDocumentTitle: row.source_document_version_id
      ? (documentTitleByVersionId.get(row.source_document_version_id) ?? null)
      : null,
    clauseId: row.clause_id,
    clauseNumber: row.clause_id ? (clauseNumberById.get(row.clause_id) ?? null) : null,
    sourceReference: row.source_reference,
    responsibleUserId: row.responsible_user_id,
    responsibleName: row.responsible_user_id ? (namesByUserId.get(row.responsible_user_id) ?? null) : null,
    responsibleLabel: row.responsible_label,
    periodicity: row.periodicity as EsgObligation["periodicity"],
    requiredEvidenceDescription: row.required_evidence_description,
    penaltyDescription: row.penalty_description,
    active: row.active,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getEsgObligations(projectId: string): Promise<EsgObligation[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("esg_obligations")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (error) {
    if (error.code === "22P02") return [];
    throw new Error(`Falha ao carregar obrigações ESG/SSMA: ${error.message}`);
  }

  const rows = data as unknown as ObligationRow[];
  if (rows.length === 0) return [];

  const clauseIds = rows.map((r) => r.clause_id).filter((v): v is string => Boolean(v));
  const documentVersionIds = rows.map((r) => r.source_document_version_id).filter((v): v is string => Boolean(v));

  const [namesByUserId, clauseData, documentVersionData] = await Promise.all([
    resolveProfileNames(supabase, rows.map((r) => r.responsible_user_id)),
    clauseIds.length > 0
      ? supabase.from("clauses").select("id,clause_number").in("id", clauseIds)
      : Promise.resolve({ data: [] as ClauseRow[], error: null }),
    documentVersionIds.length > 0
      ? supabase.from("document_versions").select("id,document_id").in("id", documentVersionIds)
      : Promise.resolve({ data: [] as DocumentVersionRow[], error: null }),
  ]);

  if (clauseData.error) throw new Error(`Falha ao carregar cláusulas vinculadas: ${clauseData.error.message}`);
  if (documentVersionData.error)
    throw new Error(`Falha ao carregar versões de documento vinculadas: ${documentVersionData.error.message}`);

  const clauseNumberById = new Map(
    (clauseData.data as unknown as ClauseRow[]).map((c) => [c.id, c.clause_number])
  );

  const documentVersionRows = documentVersionData.data as unknown as DocumentVersionRow[];
  const documentIds = Array.from(new Set(documentVersionRows.map((v) => v.document_id)));

  const { data: documentData, error: documentError } =
    documentIds.length > 0
      ? await supabase.from("documents").select("id,title").in("id", documentIds)
      : { data: [] as DocumentRow[], error: null };

  if (documentError) throw new Error(`Falha ao carregar documentos vinculados: ${documentError.message}`);

  const titleByDocumentId = new Map((documentData as unknown as DocumentRow[]).map((d) => [d.id, d.title]));
  const documentTitleByVersionId = new Map(
    documentVersionRows.map((v) => [v.id, titleByDocumentId.get(v.document_id) ?? "Documento não disponível"])
  );

  return rows.map((row) => mapObligationRow(row, namesByUserId, clauseNumberById, documentTitleByVersionId));
}

function mapSubmissionRow(row: SubmissionRow, namesByUserId: Map<string, string>): EsgObligationSubmission {
  return {
    id: row.id,
    projectId: row.project_id,
    obligationId: row.obligation_id,
    referenceDate: row.reference_date,
    referencePeriodLabel: row.reference_period_label,
    dueDate: row.due_date,
    filledByUserId: row.filled_by_user_id,
    filledByName: namesByUserId.get(row.filled_by_user_id) ?? null,
    status: row.status as EsgObligationSubmission["status"],
    description: row.description,
    observation: row.observation,
    justification: row.justification,
    riskLevel: row.risk_level as EsgObligationSubmission["riskLevel"],
    ddsDetails: row.dds_details,
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedByName: row.reviewed_by_user_id ? (namesByUserId.get(row.reviewed_by_user_id) ?? null) : null,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getEsgObligationSubmissionsForProject(projectId: string): Promise<EsgObligationSubmission[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("esg_obligation_submissions")
    .select("*")
    .eq("project_id", projectId)
    .order("reference_date", { ascending: false });

  if (error) {
    if (error.code === "22P02") return [];
    throw new Error(`Falha ao carregar comprovações ESG/SSMA: ${error.message}`);
  }

  const rows = data as unknown as SubmissionRow[];
  if (rows.length === 0) return [];

  const namesByUserId = await resolveProfileNames(supabase, [
    ...rows.map((r) => r.filled_by_user_id),
    ...rows.map((r) => r.reviewed_by_user_id),
  ]);

  return rows.map((row) => mapSubmissionRow(row, namesByUserId));
}

export async function getEsgObligationSubmissions(obligationId: string): Promise<EsgObligationSubmission[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("esg_obligation_submissions")
    .select("*")
    .eq("obligation_id", obligationId)
    .order("reference_date", { ascending: false });

  if (error) {
    if (error.code === "22P02") return [];
    throw new Error(`Falha ao carregar comprovações da obrigação: ${error.message}`);
  }

  const rows = data as unknown as SubmissionRow[];
  if (rows.length === 0) return [];

  const namesByUserId = await resolveProfileNames(supabase, [
    ...rows.map((r) => r.filled_by_user_id),
    ...rows.map((r) => r.reviewed_by_user_id),
  ]);

  return rows.map((row) => mapSubmissionRow(row, namesByUserId));
}

function mapEvidenceRow(row: EvidenceRow, namesByUserId: Map<string, string>): EsgObligationEvidence {
  return {
    id: row.id,
    projectId: row.project_id,
    submissionId: row.submission_id,
    obligationId: row.obligation_id,
    evidenceKind: row.evidence_kind as EsgObligationEvidence["evidenceKind"],
    storageBucket: row.storage_bucket,
    filePath: row.file_path,
    originalFileName: row.original_file_name,
    mimeType: row.mime_type,
    fileSizeBytes: row.file_size_bytes,
    replacesEvidenceId: row.replaces_evidence_id,
    uploadedByUserId: row.uploaded_by_user_id,
    uploadedByName: namesByUserId.get(row.uploaded_by_user_id) ?? null,
    uploadedAt: row.uploaded_at,
  };
}

export async function getEsgObligationEvidenceForProject(projectId: string): Promise<EsgObligationEvidence[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("esg_obligation_evidence")
    .select("*")
    .eq("project_id", projectId)
    .order("uploaded_at", { ascending: false });

  if (error) {
    if (error.code === "22P02") return [];
    throw new Error(`Falha ao carregar evidências ESG/SSMA: ${error.message}`);
  }

  const rows = data as unknown as EvidenceRow[];
  if (rows.length === 0) return [];

  const namesByUserId = await resolveProfileNames(supabase, rows.map((r) => r.uploaded_by_user_id));

  return rows.map((row) => mapEvidenceRow(row, namesByUserId));
}

export async function getEsgObligationEvidence(submissionId: string): Promise<EsgObligationEvidence[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("esg_obligation_evidence")
    .select("*")
    .eq("submission_id", submissionId)
    .order("uploaded_at", { ascending: true });

  if (error) {
    if (error.code === "22P02") return [];
    throw new Error(`Falha ao carregar evidências da comprovação: ${error.message}`);
  }

  const rows = data as unknown as EvidenceRow[];
  if (rows.length === 0) return [];

  const namesByUserId = await resolveProfileNames(supabase, rows.map((r) => r.uploaded_by_user_id));

  return rows.map((row) => mapEvidenceRow(row, namesByUserId));
}
