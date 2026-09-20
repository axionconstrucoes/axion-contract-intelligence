import type { SupabaseClient } from "@supabase/supabase-js";
import { withActiveDocumentFilter } from "../../../documents/active-document-filter";

export type ScheduleSourceStatus =
  | "MISSING_MPP"
  | "MPP_PRESENT_NOT_EXTRACTED"
  | "MPP_EXTRACTED";

const DIRECT_ASSESSMENT_TERMS = [
  "atraso",
  "caminho critico",
  "critical path",
  "folga",
  "replanejamento",
  "reprogramacao",
  "recuperacao de prazo",
  "plano de recuperacao",
  "desvio de prazo",
  "impacto no prazo",
  "projecao de termino",
  "projecao de conclusao",
  "data projetada de termino",
  "data projetada de conclusao",
];

const SCHEDULE_NOUNS = ["prazo", "cronograma", "baseline", "linha de base"];

const ANALYTICAL_TERMS = [
  "analisar",
  "analise",
  "avaliar",
  "avaliacao",
  "impacto",
  "desvio",
  "projetar",
  "projecao",
  "recuperar",
  "recuperacao",
  "risco",
  "comprometer",
  "comprometimento",
];

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Identifica pedido de avaliação FORMAL de cronograma/prazo. Consultas
 * meramente administrativas/informativas, como "existe cronograma cadastrado?"
 * ou "qual é o prazo contratual?", deliberadamente não entram aqui.
 */
export function isFormalScheduleAssessmentQuestion(question: string): boolean {
  const normalized = normalizeText(question);

  if (DIRECT_ASSESSMENT_TERMS.some((term) => normalized.includes(term))) {
    return true;
  }

  return (
    SCHEDULE_NOUNS.some((term) => normalized.includes(term)) &&
    ANALYTICAL_TERMS.some((term) => normalized.includes(term))
  );
}

function isMppFileName(fileName: string | null): boolean {
  return Boolean(fileName?.trim().toLowerCase().endsWith(".mpp"));
}

/**
 * Regra de fonte oficial para avaliação de prazo:
 * - só considera documentos ATIVOS do projeto;
 * - valida a extensão do arquivo original, nunca apenas documents.kind;
 * - nesta fase, mesmo com .mpp armazenado, a extração estruturada do
 *   Microsoft Project ainda não existe, portanto a análise formal permanece
 *   bloqueada em vez de inferir dados de cronograma.
 */
export async function resolveScheduleSourceStatus(
  supabase: SupabaseClient,
  projectId: string
): Promise<ScheduleSourceStatus> {
  const { data: documentsData, error: documentsError } = await withActiveDocumentFilter(
    (filterActive) => {
      let query = supabase.from("documents").select("id").eq("project_id", projectId);
      if (filterActive) query = query.is("deleted_at", null);
      return query;
    }
  );

  if (documentsError) {
    throw new Error(`Falha ao verificar cronogramas do projeto: ${documentsError.message}`);
  }

  const documentIds = ((documentsData ?? []) as unknown as Array<{ id: string }>).map(
    (row) => row.id
  );

  if (documentIds.length === 0) {
    return "MISSING_MPP";
  }

  const { data: versionsData, error: versionsError } = await supabase
    .from("document_versions")
    .select("id,document_id,original_file_name,version_index,processing_status")
    .in("document_id", documentIds)
    .order("version_index", { ascending: false });

  if (versionsError) {
    throw new Error(`Falha ao verificar arquivos de cronograma: ${versionsError.message}`);
  }

  const rows = (versionsData ?? []) as unknown as Array<{
    id: string;
    document_id: string;
    original_file_name: string | null;
    version_index: number;
    processing_status: string | null;
  }>;

  // Só a versão vigente (maior version_index, primeira após o order desc)
  // de cada documento conta como fonte atual. Um .mpp histórico substituído
  // por outro formato não mantém artificialmente a análise habilitada.
  const currentByDocumentId = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!currentByDocumentId.has(row.document_id)) {
      currentByDocumentId.set(row.document_id, row);
    }
  }

  const currentMppVersions = Array.from(currentByDocumentId.values()).filter(
    (row) => isMppFileName(row.original_file_name)
  );

  if (currentMppVersions.length === 0) {
    return "MISSING_MPP";
  }

  const { data: schedulesData, error: schedulesError } = await supabase
    .from("schedule_versions")
    .select("document_version_id,extraction_status")
    .in("document_version_id", currentMppVersions.map((row) => row.id));

  if (schedulesError) {
    throw new Error(
      `Falha ao verificar extracao estruturada do cronograma: ${schedulesError.message}`
    );
  }

  const extractedVersionIds = new Set(
    (schedulesData ?? [])
      .filter((row) => row.extraction_status === "EXTRACTED")
      .map((row) => row.document_version_id)
  );

  return currentMppVersions.some(
    (row) =>
      row.processing_status === "PROCESSED" &&
      extractedVersionIds.has(row.id)
  )
    ? "MPP_EXTRACTED"
    : "MPP_PRESENT_NOT_EXTRACTED";
}

export function scheduleSourceBlockingMessage(status: ScheduleSourceStatus): string {
  return status === "MISSING_MPP"
    ? "Análise formal de prazo indisponível — cronograma Microsoft Project (.mpp) não localizado entre os documentos ativos do projeto. PDF, XLSX, DOCX e imagens podem ser evidência complementar, mas não substituem o arquivo .mpp como fonte oficial de prazo."
    : "Cronograma Microsoft Project (.mpp) localizado, porém a extração estruturada do arquivo MPP ainda não está disponível nesta fase. A análise formal de prazo permanece bloqueada para não inferir atividades, vínculos, folgas ou caminho crítico sem leitura real do cronograma.";
}
