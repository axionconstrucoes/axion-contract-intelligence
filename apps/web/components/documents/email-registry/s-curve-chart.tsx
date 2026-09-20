// Gráfico da Curva S (planejado × realizado × projetado) em SVG puro,
// renderizado no servidor — sem biblioteca externa. Só desenha o que
// existe nas séries persistidas (nunca interpola valores ausentes).

import type { SCurveSeries } from "@/lib/schedule/s-curve/types";

const WIDTH = 640;
const HEIGHT = 260;
const PAD = { top: 16, right: 16, bottom: 40, left: 44 };

const SERIES_STYLE: Record<string, { color: string; label: string; dash?: string }> = {
  PHYSICAL_PLANNED: { color: "#1d4ed8", label: "Planejado" },
  PHYSICAL_ACTUAL: { color: "#059669", label: "Realizado" },
  PHYSICAL_FORECAST: { color: "#d97706", label: "Projetado", dash: "6 4" },
  PHYSICAL_RECOVERY: { color: "#7c3aed", label: "Recuperação", dash: "2 4" },
};

function toCumulative(series: SCurveSeries): Array<{ period: string; value: number }> {
  const points = series.points.map((point) => ({ period: point.period, value: point.value }));
  const max = Math.max(...points.map((point) => Math.abs(point.value)), 0);
  const normalized = max > 0 && max <= 1.0001 ? points.map((point) => ({ ...point, value: point.value * 100 })) : points;
  if (series.scale === "CUMULATIVE") return normalized;
  let acc = 0;
  return normalized.map((point) => {
    acc += point.value;
    return { ...point, value: acc };
  });
}

export function SCurveChart({ series, cutoffPeriod }: { series: SCurveSeries[]; cutoffPeriod: string | null }) {
  const physical = series.filter((item) => item.type in SERIES_STYLE && (item.unit === "PERCENT" || item.unit === "UNKNOWN"));
  if (physical.length === 0) {
    return <p className="text-xs text-muted-foreground">Sem séries físicas em percentual para desenhar.</p>;
  }

  const periods: string[] = [];
  for (const item of physical) for (const point of item.points) if (!periods.includes(point.period)) periods.push(point.period);
  const xFor = (period: string) => {
    const index = periods.indexOf(period);
    const span = Math.max(1, periods.length - 1);
    return PAD.left + (index / span) * (WIDTH - PAD.left - PAD.right);
  };
  const yFor = (value: number) => PAD.top + (1 - Math.min(100, Math.max(0, value)) / 100) * (HEIGHT - PAD.top - PAD.bottom);

  const ticks = [0, 25, 50, 75, 100];
  const labelEvery = Math.max(1, Math.ceil(periods.length / 8));

  return (
    <figure className="overflow-x-auto">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Curva S: planejado, realizado e projetado acumulados em percentual" className="h-auto w-full max-w-[640px]">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={yFor(tick)} y2={yFor(tick)} stroke="currentColor" strokeOpacity={0.12} />
            <text x={PAD.left - 6} y={yFor(tick) + 4} textAnchor="end" fontSize={10} fill="currentColor" fillOpacity={0.7}>
              {tick}%
            </text>
          </g>
        ))}
        {periods.map((period, index) =>
          index % labelEvery === 0 || index === periods.length - 1 ? (
            <text key={period} x={xFor(period)} y={HEIGHT - PAD.bottom + 14} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.7}>
              {period.length > 10 ? period.slice(0, 10) : period}
            </text>
          ) : null
        )}
        {cutoffPeriod && periods.includes(cutoffPeriod) ? (
          <line x1={xFor(cutoffPeriod)} x2={xFor(cutoffPeriod)} y1={PAD.top} y2={HEIGHT - PAD.bottom} stroke="#dc2626" strokeDasharray="3 3" />
        ) : null}
        {physical.map((item) => {
          const style = SERIES_STYLE[item.type];
          const points = toCumulative(item);
          const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${xFor(point.period).toFixed(1)},${yFor(point.value).toFixed(1)}`).join(" ");
          return <path key={item.type + item.sourceLabel} d={path} fill="none" stroke={style.color} strokeWidth={2} strokeDasharray={style.dash} />;
        })}
      </svg>
      <figcaption className="flex flex-wrap gap-3 text-xs">
        {physical.map((item) => (
          <span key={item.type + item.sourceLabel} className="inline-flex items-center gap-1">
            <span aria-hidden="true" className="inline-block h-2 w-4 rounded" style={{ backgroundColor: SERIES_STYLE[item.type].color }} />
            {SERIES_STYLE[item.type].label} <span className="text-muted-foreground">({item.sourceLabel})</span>
          </span>
        ))}
        {cutoffPeriod ? <span className="text-muted-foreground">Linha vermelha: data de corte {cutoffPeriod}</span> : null}
      </figcaption>
    </figure>
  );
}
