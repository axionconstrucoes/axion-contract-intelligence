// Context builder somente-leitura para o escopo PROJECT (consulta
// conversacional de nível de projeto, ver apps/web/lib/ai/query/).
// Deliberadamente mais leve que EventAnalysisContext: traz metadados do
// projeto e um resumo dos eventos mais recentes, sem evidências/cláusulas/
// e-mails por evento — isso evita "despejar todo o projeto no modelo".
// Perguntas que precisam de detalhe de um evento específico devem usar
// escopo EVENT (buildEventAnalysisContext), que já existe e não é
// duplicado aqui.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContextEsgObligationSummary, ProjectAnalysisContext, ProjectContextEventSummary } from "./types";

const MAX_EVENTS = 50;
const MAX_ESG_OBLIGATIONS = 100;

type ProjectRow = {
  id: string;
  name: string;
  client: string;
  status: string;
  contract_number: string | null;
};

type EventRow = {
  id: string;
  title: string;
  status: string;
  occurred_at: string;
};

type EventCategoryRow = {
  event_id: string;
  category: string;
};

type EsgObligationRow = {
  id: string;
  title: string;
  category: string;
  periodicity: string;
  required_evidence_description: string | null;
  penalty_description: string | null;
};

type EsgSubmissionRow = {
  id: string;
  obligation_id: string;
  status: string;
  due_date: string | null;
  risk_level: string | null;
  created_at: string;
};

// Contexto de obrigações ESG/SSMA para o Diretor de ESG IA (e qualquer
// outro Expert que precise): reutiliza exatamente as mesmas tabelas de
// apps/web/lib/esg/esg-obligations-data.ts, sem duplicar a lógica de
// leitura — aqui é uma versão deliberadamente mais leve (só o registro
// mais recente de cada obrigação), pensada para caber no contexto de um
// Expert, não para a UI completa.
async function buildEsgObligationsSummary(
  supabase: SupabaseClient,
  projectId: string
): Promise<{ obligations: ContextEsgObligationSummary[]; totalCount: number }> {
  const { count: totalCount, error: countError } = await supabase
    .from("esg_obligations")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("active", true);

  if (countError) {
    throw new Error(`Falha ao contar obrigações ESG/SSMA do contexto: ${countError.message}`);
  }

  const { data: obligationData, error: obligationError } = await supabase
    .from("esg_obligations")
    .select("id,title,category,periodicity,required_evidence_description,penalty_description")
    .eq("project_id", projectId)
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(MAX_ESG_OBLIGATIONS);

  if (obligationError) {
    throw new Error(`Falha ao carregar obrigações ESG/SSMA do contexto: ${obligationError.message}`);
  }

  const obligationRows = obligationData as unknown as EsgObligationRow[];
  if (obligationRows.length === 0) {
    return { obligations: [], totalCount: totalCount ?? 0 };
  }

  const obligationIds = obligationRows.map((r) => r.id);

  const { data: submissionData, error: submissionError } = await supabase
    .from("esg_obligation_submissions")
    .select("id,obligation_id,status,due_date,risk_level,created_at")
    .in("obligation_id", obligationIds)
    .order("created_at", { ascending: false });

  if (submissionError) {
    throw new Error(`Falha ao carregar comprovações ESG/SSMA do contexto: ${submissionError.message}`);
  }

  const latestSubmissionByObligationId = new Map<string, EsgSubmissionRow>();
  const submissionRows = submissionData as unknown as EsgSubmissionRow[];
  for (const row of submissionRows) {
    if (!latestSubmissionByObligationId.has(row.obligation_id)) {
      latestSubmissionByObligationId.set(row.obligation_id, row);
    }
  }

  const latestSubmissionIds = Array.from(latestSubmissionByObligationId.values())
    .map((row) => row.id)
    .filter((id): id is string => Boolean(id));

  const evidenceCountBySubmissionId = new Map<string, number>();
  if (latestSubmissionIds.length > 0) {
    const { data: evidenceData, error: evidenceError } = await supabase
      .from("esg_obligation_evidence")
      .select("submission_id")
      .in("submission_id", latestSubmissionIds);

    if (evidenceError) {
      throw new Error(`Falha ao contar evidências ESG/SSMA do contexto: ${evidenceError.message}`);
    }

    for (const row of evidenceData as unknown as Array<{ submission_id: string }>) {
      evidenceCountBySubmissionId.set(row.submission_id, (evidenceCountBySubmissionId.get(row.submission_id) ?? 0) + 1);
    }
  }

  const obligations: ContextEsgObligationSummary[] = obligationRows.map((row) => {
    const latest = latestSubmissionByObligationId.get(row.id) ?? null;
    return {
      id: row.id,
      title: row.title,
      category: row.category,
      periodicity: row.periodicity,
      requiredEvidenceDescription: row.required_evidence_description,
      penaltyDescription: row.penalty_description,
      latestSubmissionStatus: latest?.status ?? null,
      latestSubmissionDueDate: latest?.due_date ?? null,
      latestSubmissionRiskLevel: latest?.risk_level ?? null,
      latestSubmissionEvidenceCount: latest?.id ? (evidenceCountBySubmissionId.get(latest.id) ?? 0) : 0,
    };
  });

  return { obligations, totalCount: totalCount ?? obligations.length };
}

export interface BuildProjectAnalysisContextInput {
  projectId: string;
}

export async function buildProjectAnalysisContext(
  supabase: SupabaseClient,
  input: BuildProjectAnalysisContextInput
): Promise<ProjectAnalysisContext> {
  const { projectId } = input;

  const { data: projectData, error: projectError } = await supabase
    .from("projects")
    .select("id,name,client,status,contract_number")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError) {
    throw new Error(`Falha ao carregar projeto do contexto: ${projectError.message}`);
  }

  const projectRow = projectData as unknown as ProjectRow | null;
  if (!projectRow) {
    throw new Error(`Projeto (id=${projectId}) não encontrado.`);
  }

  const { count: eventsTotalCount, error: countError } = await supabase
    .from("contract_events")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);

  if (countError) {
    throw new Error(`Falha ao contar eventos do projeto no contexto: ${countError.message}`);
  }

  const { data: eventData, error: eventError } = await supabase
    .from("contract_events")
    .select("id,title,status,occurred_at")
    .eq("project_id", projectId)
    .order("occurred_at", { ascending: false })
    .limit(MAX_EVENTS);

  if (eventError) {
    throw new Error(`Falha ao carregar eventos do projeto no contexto: ${eventError.message}`);
  }

  const eventRows = eventData as unknown as EventRow[];
  const eventIds = eventRows.map((row) => row.id);

  const { data: categoryData, error: categoryError } =
    eventIds.length > 0
      ? await supabase.from("event_categories").select("event_id,category").in("event_id", eventIds)
      : { data: [] as EventCategoryRow[], error: null };

  if (categoryError) {
    throw new Error(`Falha ao carregar categorias dos eventos do contexto: ${categoryError.message}`);
  }

  const categoriesByEventId = new Map<string, string[]>();
  for (const row of categoryData as unknown as EventCategoryRow[]) {
    const list = categoriesByEventId.get(row.event_id) ?? [];
    list.push(row.category);
    categoriesByEventId.set(row.event_id, list);
  }

  const events: ProjectContextEventSummary[] = eventRows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    occurredAt: row.occurred_at,
    categories: categoriesByEventId.get(row.id) ?? [],
  }));

  const esgSummary = await buildEsgObligationsSummary(supabase, projectId);

  return {
    projectId,
    project: {
      id: projectRow.id,
      name: projectRow.name,
      client: projectRow.client,
      status: projectRow.status,
      contractNumber: projectRow.contract_number,
    },
    events,
    eventsTotalCount: eventsTotalCount ?? events.length,
    esgObligations: esgSummary.obligations,
    esgObligationsTotalCount: esgSummary.totalCount,
  };
}
