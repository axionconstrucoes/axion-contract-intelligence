// Leitura do estado de monitoramento do Diario de Obra para a UI.
//
// So SELECT, e sempre pelo client de sessao: a RLS de
// `diario_de_obra_*` restringe a membros do projeto. Nenhuma
// credencial, nenhuma chamada a API do Diario de Obra e nenhuma escrita
// acontecem aqui.
//
// ZERO IA. Nenhum token de LLM e' consumido nesta leitura, e nao ha
// caminho deste arquivo para um provedor de IA. O painel afirma isso na
// tela porque a afirmacao precisa ser verificavel por quem le.
//
// ZERO CONTEUDO. Os RDOs sao lidos pela view
// `diario_de_obra_report_metrics`, que ja converteu ocorrencias e
// atividades em CONTAGEM dentro do banco. O que ainda chega em forma de
// documento — `clima` e `maoDeObra` — e' reduzido a numero por
// `calcularAgregados` e NAO aparece no resultado. Nenhum campo desta
// interface e' texto livre.
//
// DUAS EXECUCOES, NAO UMA
//
// A execucao MAIS RECENTE da status e erro; a ultima CONFIRMADA
// (SUCESSO ou PARCIAL) da os contadores de novos e alterados. Uma falha
// nao pode zerar numeros que continuam valendo: zero de falha nao e'
// zero de resultado.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  calcularAgregados,
  type AgregadosDoDiario,
  type LinhaDeMetricaDoRdo,
} from "./report-metrics";
import type { SeveridadeDeAchado, StatusDeAchado } from "./finding-rules";

export type StatusDeExecucao = "EM_ANDAMENTO" | "SUCESSO" | "PARCIAL" | "ERRO";

export interface ContagemDeAchados {
  abertosPorSeveridade: Record<SeveridadeDeAchado, number>;
  totalAbertos: number;
  reconhecidos: number;
  resolvidos: number;
  aguardandoRevisaoHumana: number;
}

export interface DiarioDeObraMonitoringOverview {
  /** Conexao: a integracao existe e qual o estado declarado dela. */
  conectado: boolean;
  statusDaIntegracao: string | null;

  /** Ultima tentativa, tenha ela concluido ou nao. */
  ultimaSincronizacaoAt: string | null;
  ultimaSincronizacaoStatus: StatusDeExecucao | null;
  ultimaSincronizacaoModo: string | null;
  ultimaSincronizacaoErro: string | null;

  /** Quando os contadores abaixo foram efetivamente medidos. */
  ultimaConfirmadaAt: string | null;
  mostrandoTotaisAnteriores: boolean;

  /** Novos e alterados da ultima execucao confirmada. */
  novos: number;
  alterados: number;

  agregados: AgregadosDoDiario;
  achados: ContagemDeAchados;
}

type LinhaDeExecucao = {
  id: string;
  mode: string | null;
  status: string | null;
  started_at: string;
  completed_at: string | null;
  created_count: number | null;
  updated_count: number | null;
  sanitized_error: string | null;
};

const CAMPOS_DA_EXECUCAO =
  "id, mode, status, started_at, completed_at, created_count, updated_count, sanitized_error";

const CAMPOS_DA_METRICA =
  "report_id, report_number, reference_date, source_created_at, source_modified_at, " +
  "baseline_imported, photo_count, occurrence_count, activity_count, weather, labor";

type LinhaDaView = {
  report_id: string;
  report_number: number | null;
  reference_date: string | null;
  source_created_at: string | null;
  source_modified_at: string | null;
  baseline_imported: boolean | null;
  photo_count: number | null;
  occurrence_count: number | null;
  activity_count: number | null;
  weather: unknown;
  labor: unknown;
};

type LinhaDeAchado = {
  severity: string | null;
  status: string | null;
  requires_human_review: boolean | null;
};

function normalizarStatusDeExecucao(valor: string | null | undefined): StatusDeExecucao | null {
  return valor === "EM_ANDAMENTO" || valor === "SUCESSO" || valor === "PARCIAL" || valor === "ERRO"
    ? valor
    : null;
}

function contarAchados(linhas: readonly LinhaDeAchado[]): ContagemDeAchados {
  const abertosPorSeveridade: Record<SeveridadeDeAchado, number> = {
    ALTO: 0,
    MEDIO: 0,
    BAIXO: 0,
  };

  let totalAbertos = 0;
  let reconhecidos = 0;
  let resolvidos = 0;
  let aguardandoRevisaoHumana = 0;

  for (const linha of linhas) {
    const status = linha.status as StatusDeAchado | null;

    if (status === "RESOLVED") {
      resolvidos += 1;
      continue;
    }

    if (status === "ACKNOWLEDGED") reconhecidos += 1;

    // OPEN e ACKNOWLEDGED contam como abertos: reconhecer nao e'
    // resolver. Um achado assumido por alguem continua sendo um fato
    // pendente da obra.
    totalAbertos += 1;

    const severidade = linha.severity as SeveridadeDeAchado | null;
    if (severidade && severidade in abertosPorSeveridade) {
      abertosPorSeveridade[severidade] += 1;
    }

    if (linha.requires_human_review === true) aguardandoRevisaoHumana += 1;
  }

  return {
    abertosPorSeveridade,
    totalAbertos,
    reconhecidos,
    resolvidos,
    aguardandoRevisaoHumana,
  };
}

export async function getDiarioDeObraMonitoringOverview(
  supabase: SupabaseClient,
  projectId: string
): Promise<DiarioDeObraMonitoringOverview | null> {
  const [integracaoResult, ultimaResult, confirmadaResult, metricasResult, achadosResult] =
    await Promise.all([
      supabase
        .from("project_integrations")
        .select("status")
        .eq("project_id", projectId)
        .eq("source_type", "DIARIO_OBRA")
        .maybeSingle(),
      supabase
        .from("diario_de_obra_sync_runs")
        .select(CAMPOS_DA_EXECUCAO)
        .eq("project_id", projectId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("diario_de_obra_sync_runs")
        .select(CAMPOS_DA_EXECUCAO)
        .eq("project_id", projectId)
        .in("status", ["SUCESSO", "PARCIAL"])
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("diario_de_obra_report_metrics")
        .select(CAMPOS_DA_METRICA)
        .eq("project_id", projectId),
      supabase
        .from("diario_de_obra_findings")
        .select("severity, status, requires_human_review")
        .eq("project_id", projectId),
    ]);

  const integracao = (integracaoResult.data as { status: string | null } | null) ?? null;
  const ultima = (ultimaResult.data as LinhaDeExecucao | null) ?? null;
  const confirmada = (confirmadaResult.data as LinhaDeExecucao | null) ?? null;
  const linhasDaView = (metricasResult.data as LinhaDaView[] | null) ?? [];

  // Sem integracao, sem execucao e sem RDO: a tela diz "ainda nao
  // sincronizado" em vez de exibir zeros que parecem medicao.
  if (!integracao && !ultima && linhasDaView.length === 0) return null;

  const linhas: LinhaDeMetricaDoRdo[] = linhasDaView.map((linha) => ({
    reportId: linha.report_id,
    reportNumber: linha.report_number,
    referenceDate: linha.reference_date,
    sourceCreatedAt: linha.source_created_at,
    sourceModifiedAt: linha.source_modified_at,
    baselineImported: linha.baseline_imported === true,
    photoCount: linha.photo_count ?? 0,
    occurrenceCount: linha.occurrence_count ?? 0,
    activityCount: linha.activity_count ?? 0,
    weather: linha.weather,
    labor: linha.labor,
  }));

  const status = normalizarStatusDeExecucao(ultima?.status);

  return {
    conectado: integracao !== null,
    statusDaIntegracao: integracao?.status ?? null,

    ultimaSincronizacaoAt: ultima?.completed_at ?? ultima?.started_at ?? null,
    ultimaSincronizacaoStatus: status,
    ultimaSincronizacaoModo: ultima?.mode ?? null,
    ultimaSincronizacaoErro: ultima?.sanitized_error ?? null,

    ultimaConfirmadaAt: confirmada?.completed_at ?? confirmada?.started_at ?? null,
    mostrandoTotaisAnteriores:
      status === "ERRO" && confirmada !== null && confirmada.id !== ultima?.id,

    novos: confirmada?.created_count ?? 0,
    alterados: confirmada?.updated_count ?? 0,

    agregados: calcularAgregados(linhas),
    achados: contarAchados((achadosResult.data as LinhaDeAchado[] | null) ?? []),
  };
}
