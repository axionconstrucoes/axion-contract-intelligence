// Gráfico de séries financeiras em SVG puro (mesma abordagem de
// s-curve-chart.tsx — nenhuma biblioteca nova). Pontos desconhecidos
// (null) NUNCA são ligados como zero: a linha é interrompida. Título,
// período, legenda, unidade, tooltip nativo por ponto, estado vazio,
// fonte, aria-label e formatação pt-BR.

import type { FinancialChart } from "@/lib/financial/build-financial-dashboard";
import { formatByUnit } from "@/lib/financial/format-br";

const WIDTH = 680;
const HEIGHT = 260;
const PAD = { top: 16, right: 16, bottom: 44, left: 72 };
const COLORS = ["#1d4ed8", "#059669", "#d97706", "#7c3aed", "#dc2626"];

export function FinancialSeriesChart({ chart, currencySymbol }: { chart: FinancialChart; currencySymbol: string | null }) {
  const periods: string[] = [];
  for (const series of chart.series) for (const point of series.points) if (!periods.includes(point.period)) periods.push(point.period);
  const values = chart.series.flatMap((series) => series.points.map((point) => point.value)).filter((value): value is number => value !== null);
  const unitLabel = chart.unit === "PERCENT" ? "%" : chart.unit === "CURRENCY" ? (currencySymbol ?? "moeda não identificada") : "quantidade";

  if (values.length === 0) {
    return (
      <figure className="rounded-md border p-3 text-xs" aria-label={chart.title}>
        <figcaption className="font-medium">{chart.title}</figcaption>
        <p className="text-muted-foreground">Sem valores disponíveis para este gráfico no relatório selecionado.</p>
      </figure>
    );
  }

  const min = Math.min(0, ...values);
  const max = Math.max(...values, 0);
  const span = max - min || 1;
  const xFor = (period: string) => PAD.left + (periods.indexOf(period) / Math.max(1, periods.length - 1)) * (WIDTH - PAD.left - PAD.right);
  const yFor = (value: number) => PAD.top + (1 - (value - min) / span) * (HEIGHT - PAD.top - PAD.bottom);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => min + fraction * span);
  const labelEvery = Math.max(1, Math.ceil(periods.length / 8));

  return (
    <figure className="rounded-md border p-3 text-xs" aria-label={`${chart.title} — ${chart.periodLabel} — unidade ${unitLabel}`}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{chart.title}</span>
        <span className="text-muted-foreground">Período {chart.periodLabel} · unidade: {unitLabel}</span>
      </figcaption>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={chart.title} className="h-auto w-full max-w-[680px]">
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={yFor(tick)} y2={yFor(tick)} stroke="currentColor" strokeOpacity={0.12} />
              <text x={PAD.left - 6} y={yFor(tick) + 4} textAnchor="end" fontSize={9} fill="currentColor" fillOpacity={0.7}>
                {formatByUnit(tick, chart.unit, null)}
              </text>
            </g>
          ))}
          {min < 0 ? <line x1={PAD.left} x2={WIDTH - PAD.right} y1={yFor(0)} y2={yFor(0)} stroke="currentColor" strokeOpacity={0.4} /> : null}
          {periods.map((period, index) =>
            index % labelEvery === 0 || index === periods.length - 1 ? (
              <text key={period} x={xFor(period)} y={HEIGHT - PAD.bottom + 14} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.7}>
                {period.length > 10 ? period.slice(0, 10) : period}
              </text>
            ) : null
          )}
          {chart.series.map((series, seriesIndex) => {
            const color = COLORS[seriesIndex % COLORS.length];
            // Segmentos separados: um null quebra a linha (nunca vira zero).
            const segments: string[] = [];
            let current: string[] = [];
            for (const point of series.points) {
              if (point.value === null) {
                if (current.length) segments.push(current.join(" "));
                current = [];
                continue;
              }
              current.push(`${current.length === 0 ? "M" : "L"}${xFor(point.period).toFixed(1)},${yFor(point.value).toFixed(1)}`);
            }
            if (current.length) segments.push(current.join(" "));
            return (
              <g key={series.key}>
                {segments.map((d, index) => (
                  <path key={index} d={d} fill="none" stroke={color} strokeWidth={2} />
                ))}
                {series.points.map((point) =>
                  point.value === null ? null : (
                    <circle key={point.period} cx={xFor(point.period)} cy={yFor(point.value)} r={3} fill={color}>
                      <title>{`${series.label} · ${point.period}: ${formatByUnit(point.value, chart.unit, currencySymbol)}`}</title>
                    </circle>
                  )
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="flex flex-wrap gap-3">
        {chart.series.map((series, index) => (
          <span key={series.key} className="inline-flex items-center gap-1">
            <span aria-hidden="true" className="inline-block h-2 w-4 rounded" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
            {series.label}
          </span>
        ))}
      </div>
      <p className="text-muted-foreground">Fonte: {chart.source}</p>
    </figure>
  );
}
