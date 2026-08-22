// Context builder somente-leitura para o escopo PROJECT (consulta
// conversacional de nível de projeto, ver apps/web/lib/ai/query/).
// Deliberadamente mais leve que EventAnalysisContext: traz metadados do
// projeto e um resumo dos eventos mais recentes, sem evidências/cláusulas/
// e-mails por evento — isso evita "despejar todo o projeto no modelo".
// Perguntas que precisam de detalhe de um evento específico devem usar
// escopo EVENT (buildEventAnalysisContext), que já existe e não é
// duplicado aqui.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectAnalysisContext, ProjectContextEventSummary } from "./types";

const MAX_EVENTS = 50;

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
  };
}
