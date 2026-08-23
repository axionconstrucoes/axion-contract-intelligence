// Filtro temporal do Dashboard Visual (seção 17) — aplicado só às
// métricas de FLUXO (emails, findings, ocorrências ESG, ações,
// volume por fonte). Nunca aplicado à posição ATUAL (avanço físico/
// financeiro, valor contratual vigente, prazo vigente) — esses cards
// não recebem `range` nenhum.
//
// Puro, sem I/O — `now` é sempre injetado pelo caller (nunca `new
// Date()` aqui dentro), para o cálculo ser determinístico e testável.

export type TimeRangeOption = "HOJE" | "7D" | "30D" | "DESDE_INICIO" | "PERSONALIZADO";

export interface ResolvedTimeRange {
  option: TimeRangeOption;
  /** ISO datetime — null quando "desde o início" e o projeto ainda não tem project_start_date. */
  from: string | null;
  to: string;
  label: string;
}

const OPTION_LABELS: Record<TimeRangeOption, string> = {
  HOJE: "Hoje",
  "7D": "Últimos 7 dias",
  "30D": "Últimos 30 dias",
  DESDE_INICIO: "Desde o início do projeto",
  PERSONALIZADO: "Personalizado",
};

export { OPTION_LABELS as TIME_RANGE_OPTION_LABELS };

function startOfDayIso(date: Date): string {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  return start.toISOString();
}

export function resolveTimeRange(
  searchParams: { range?: string; from?: string; to?: string },
  now: Date,
  projectStartDate: string | null
): ResolvedTimeRange {
  const to = now.toISOString();
  const option: TimeRangeOption =
    searchParams.range === "HOJE" ||
    searchParams.range === "7D" ||
    searchParams.range === "30D" ||
    searchParams.range === "DESDE_INICIO" ||
    searchParams.range === "PERSONALIZADO"
      ? searchParams.range
      : "30D";

  if (option === "HOJE") return { option, from: startOfDayIso(now), to, label: OPTION_LABELS.HOJE };

  if (option === "7D") {
    const from = new Date(now);
    from.setUTCDate(from.getUTCDate() - 7);
    return { option, from: from.toISOString(), to, label: OPTION_LABELS["7D"] };
  }

  if (option === "30D") {
    const from = new Date(now);
    from.setUTCDate(from.getUTCDate() - 30);
    return { option, from: from.toISOString(), to, label: OPTION_LABELS["30D"] };
  }

  if (option === "DESDE_INICIO") {
    return { option, from: projectStartDate, to, label: OPTION_LABELS.DESDE_INICIO };
  }

  // PERSONALIZADO: intervalo inválido/incompleto cai para "sem filtro de início" (nunca inventa uma data).
  const customFrom = searchParams.from ? new Date(searchParams.from) : null;
  const customTo = searchParams.to ? new Date(searchParams.to) : now;
  return {
    option,
    from: customFrom && !Number.isNaN(customFrom.getTime()) ? customFrom.toISOString() : null,
    to: !Number.isNaN(customTo.getTime()) ? customTo.toISOString() : to,
    label: OPTION_LABELS.PERSONALIZADO,
  };
}

export function isWithinTimeRange(isoDate: string, range: ResolvedTimeRange): boolean {
  const time = new Date(isoDate).getTime();
  if (Number.isNaN(time)) return false;
  if (range.from && time < new Date(range.from).getTime()) return false;
  if (time > new Date(range.to).getTime()) return false;
  return true;
}
