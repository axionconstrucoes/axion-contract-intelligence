// Leitura do KPI de clima e catastrofes do Diario de Obra, para a UI.
//
// So SELECT, pelo client de sessao: a RLS de `diario_de_obra_reports`
// (membros do projeto) restringe o resultado, e a view
// `diario_de_obra_climate_metrics` e' security_invoker — nao ha caminho
// por onde um projeto veja o RDO de outro.
//
// ZERO IA, ZERO ESCRITA. Esta leitura nunca chama RPC de achado, nunca
// grava sync run e nunca altera RDO: e' agregado sobre o que ja existe.

import type { SupabaseClient } from "@supabase/supabase-js";
import { calcularClimaKpi, type ClimaKpiDoPeriodo, type LinhaDeClimaDoRdo } from "./climate-kpi";

const CAMPOS_DA_VIEW =
  "report_id, reference_date, impracticable_shifts, has_weather_data, " +
  "has_dia_chuvoso, has_dia_parado, has_talude_danificado_chuva, has_catastrofe, " +
  "activity_count, labor_total";

type LinhaDaView = {
  report_id: string;
  reference_date: string | null;
  impracticable_shifts: number | null;
  has_weather_data: boolean | null;
  has_dia_chuvoso: boolean | null;
  has_dia_parado: boolean | null;
  has_talude_danificado_chuva: boolean | null;
  has_catastrofe: boolean | null;
  activity_count: number | null;
  labor_total: number | string | null;
};

export async function getDiarioDeObraClimateKpiOverview(
  supabase: SupabaseClient,
  projectId: string
): Promise<ClimaKpiDoPeriodo | null> {
  const { data, error } = await supabase
    .from("diario_de_obra_climate_metrics")
    .select(CAMPOS_DA_VIEW)
    .eq("project_id", projectId);

  if (error) return null;

  // `diario_de_obra_climate_metrics` e' uma view nova, ainda sem
  // typegen: o parser de select do postgrest-js nao reconhece a forma
  // da linha e cai em `GenericStringError`. O cast por `unknown` e' o
  // caminho que o proprio compilador sugere quando a forma real (a
  // mesma da view, documentada acima) e' conhecida por fora do typegen.
  const linhasDaView = (data as unknown as LinhaDaView[] | null) ?? [];
  if (linhasDaView.length === 0) return null;

  const linhas: LinhaDeClimaDoRdo[] = linhasDaView.map((linha) => ({
    reportId: linha.report_id,
    referenceDate: linha.reference_date,
    impracticableShifts: linha.impracticable_shifts ?? 0,
    hasWeatherData: linha.has_weather_data === true,
    hasDiaChuvoso: linha.has_dia_chuvoso === true,
    hasDiaParado: linha.has_dia_parado === true,
    hasTaludeDanificadoPorChuva: linha.has_talude_danificado_chuva === true,
    hasCatastrofe: linha.has_catastrofe === true,
    activityCount: linha.activity_count ?? 0,
    // `numeric` do Postgres chega como string no PostgREST. Converter
    // aqui, e nao no calculo, mantem `climate-kpi.ts` puro lidando so
    // com numero.
    laborTotal: linha.labor_total === null ? null : Number(linha.labor_total),
  }));

  return calcularClimaKpi(linhas);
}
