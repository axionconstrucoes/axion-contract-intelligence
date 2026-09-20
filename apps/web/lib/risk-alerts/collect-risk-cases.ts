// Normaliza as FONTES do módulo semanal em casos de risco — puro, sem I/O.
//   - schedule_version_comparisons (risco do cronograma MPP vs anterior/baseline)
//   - weekly_report_sheets (risco por aba da planilha do relatório semanal)
//   - weekly_schedule_ingestion_alerts (ausência/divergência)
// Só a comparação/aba MAIS RECENTE por (projeto, tipo/categoria) fica
// aberta; as anteriores encerram o caso correspondente (evita alertar
// versões já superadas). O fingerprint captura nível + motivos + métricas
// relevantes: qualquer mudança real gera "risco alterado".

import { createHash } from "node:crypto";

import type { SlaArea } from "@/lib/sla/types";

import type { IngestionAlertSeverityMap, RiskCaseInput, RiskCaseLevel } from "./types";

export interface ComparisonSourceRow {
  id: string;
  project_id: string;
  comparison_type: "PREVIOUS_WEEKLY" | "OFFICIAL_BASELINE" | string;
  status: string;
  risk_classification: string | null;
  risk_reasons: unknown;
  metrics: unknown;
  computed_at: string | null;
  created_at: string;
  current_schedule_version_id: string;
  /** Rótulo humano da semana (WNN) quando conhecido. */
  work_week_label?: string | null;
  email_id?: string | null;
}

export interface SheetSourceRow {
  id: string;
  project_id: string;
  category: string;
  status: string;
  risk_classification: string | null;
  risk_reasons: unknown;
  alerts: unknown;
  cutoff_date: string | null;
  created_at: string;
  work_week_label?: string | null;
  email_id?: string | null;
}

export interface IngestionAlertSourceRow {
  id: string;
  project_id: string;
  kind: string;
  week_start: string;
  deadline_at: string;
  detail: string;
  resolved_at: string | null;
  created_at: string;
}

const LEVELS: RiskCaseLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL", "REVIEW_REQUIRED"];

export function toRiskLevel(value: string | null | undefined): RiskCaseLevel | null {
  return value && (LEVELS as string[]).includes(value) ? (value as RiskCaseLevel) : null;
}

/**
 * Severidade dos alertas de ausência/divergência: CONFIGURÁVEL POR PROJETO
 * (project_weekly_schedule_ingestion_configs.risk_alert_severity_map).
 * Sem configuração para o tipo => REVIEW_REQUIRED (nunca um default ativo;
 * a sugestão fica em pilot-readiness.ts e só vale quando gravada).
 */
// Tipos cuja severidade pertence ao MOTOR (comparações/abas classificadas
// por thresholds). Um alerta de ausência com um desses nomes não tem
// produtor hoje; se algum dia aparecer, o mapa do projeto NÃO pode
// classificá-lo (nem rebaixar nem elevar): REVIEW_REQUIRED, revisão humana.
const ENGINE_CLASSIFIED_ALERT_KINDS: ReadonlySet<string> = new Set(["S_CURVE_MPP_DIVERGENCE", "BASELINE_SHEET_DIVERGENCE"]);

/**
 * Severidade de um ALERTA DE AUSÊNCIA: exclusivamente o mapa do projeto.
 * Sem configuração => REVIEW_REQUIRED (fail-safe; nunca um default
 * silencioso). Casos de comparação/aba nunca passam por aqui — usam a
 * classificação do motor (collectComparisonCases / collectSheetCases).
 */
export function resolveIngestionAlertSeverity(map: IngestionAlertSeverityMap | null | undefined, kind: string): RiskCaseLevel {
  if (ENGINE_CLASSIFIED_ALERT_KINDS.has(kind)) return "REVIEW_REQUIRED";
  const level = map?.[kind];
  return level && ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(level) ? level : "REVIEW_REQUIRED";
}

/** Origem rastreável da severidade de um caso (auditoria/interface). */
export function severitySourceOf(sourceType: "SCHEDULE_COMPARISON" | "WEEKLY_REPORT_SHEET" | "INGESTION_ALERT"): "ENGINE" | "PROJECT_SEVERITY_MAP" {
  return sourceType === "INGESTION_ALERT" ? "PROJECT_SEVERITY_MAP" : "ENGINE";
}

const SHEET_AREA: Record<string, SlaArea> = {
  CURVA_S: "PLANEJAMENTO",
  LINHA_BASE: "PLANEJAMENTO",
  HISTOGRAMA: "PLANEJAMENTO",
  FINANCEIRO: "FINANCEIRO",
  SSMA: "ESG_SSMA",
};

const SHEET_LABEL: Record<string, string> = {
  CURVA_S: "Curva S",
  LINHA_BASE: "Linha de Base",
  HISTOGRAMA: "Histograma",
  FINANCEIRO: "Financeiro",
  SSMA: "SSMA",
};

const COMPARISON_LABEL: Record<string, string> = {
  PREVIOUS_WEEKLY: "vs semana anterior",
  OFFICIAL_BASELINE: "vs baseline oficial",
};

export function fingerprintOf(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

function reasonsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).slice(0, 12);
}

function pick(obj: unknown, path: string[]): unknown {
  let cursor: unknown = obj;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return null;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor ?? null;
}

/** Fica aberta só a linha mais recente por chave; as demais encerram. */
function latestByKey<T>(rows: T[], keyOf: (row: T) => string, timeOf: (row: T) => string): Map<string, T> {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    const current = latest.get(key);
    if (!current || timeOf(row) > timeOf(current)) latest.set(key, row);
  }
  return latest;
}

export function collectComparisonCases(rows: ComparisonSourceRow[]): RiskCaseInput[] {
  const computed = rows.filter((row) => row.status === "COMPUTED" && toRiskLevel(row.risk_classification));
  const latest = latestByKey(computed, (row) => `${row.project_id}:${row.comparison_type}`, (row) => row.computed_at ?? row.created_at);
  return computed.map((row) => {
    const level = toRiskLevel(row.risk_classification)!;
    const reasons = reasonsOf(row.risk_reasons);
    const slipDays = pick(row.metrics, ["finalDate", "slipDays"]);
    const trendDays = pick(row.metrics, ["delay", "trendDays"]);
    const overdue = pick(row.metrics, ["overdue", "currentCount"]);
    const milestones = pick(row.metrics, ["milestones", "slippedCount"]);
    const week = row.work_week_label ? ` (${row.work_week_label})` : "";
    const label = COMPARISON_LABEL[row.comparison_type] ?? row.comparison_type;
    return {
      sourceType: "SCHEDULE_COMPARISON",
      sourceId: row.id,
      area: "PLANEJAMENTO",
      riskLevel: level,
      title: `Cronograma semanal ${label}${week}`,
      summary: reasons[0] ?? `Classificação ${level} na comparação ${label}.`,
      impact: [
        slipDays !== null ? `Deslocamento da data final: ${slipDays} dia(s)` : null,
        trendDays !== null ? `Tendência de atraso: ${trendDays} dia(s)` : null,
        milestones !== null ? `Marcos deslocados: ${milestones}` : null,
        overdue !== null ? `Atividades atrasadas: ${overdue}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      recommendation: reasons.length > 1 ? reasons.slice(1).join(" ") : null,
      fingerprint: fingerprintOf({ level, reasons, slipDays, trendDays, overdue, milestones }),
      originPath: row.email_id ? `documentos/emails/${row.email_id}` : "documentos?tab=registro-email",
      closed: latest.get(`${row.project_id}:${row.comparison_type}`)?.id !== row.id,
      reference: `${row.work_week_label ?? "MPP"} · ${label}`,
    };
  });
}

export function collectSheetCases(rows: SheetSourceRow[]): RiskCaseInput[] {
  const classified = rows.filter((row) => toRiskLevel(row.risk_classification));
  const latest = latestByKey(classified, (row) => `${row.project_id}:${row.category}`, (row) => row.created_at);
  return classified.map((row) => {
    const level = toRiskLevel(row.risk_classification)!;
    const reasons = reasonsOf(row.risk_reasons);
    const alerts = Array.isArray(row.alerts)
      ? (row.alerts as Array<{ code?: string; detail?: string; severity?: string }>).filter((a) => a && a.severity !== "INFO")
      : [];
    const week = row.work_week_label ? ` (${row.work_week_label})` : "";
    const label = SHEET_LABEL[row.category] ?? row.category;
    return {
      sourceType: "WEEKLY_REPORT_SHEET",
      sourceId: row.id,
      area: SHEET_AREA[row.category] ?? "PLANEJAMENTO",
      riskLevel: level,
      title: `Relatório semanal — aba ${label}${week}`,
      summary: reasons[0] ?? alerts[0]?.detail ?? `Classificação ${level} na aba ${label}.`,
      impact: alerts.map((a) => `${a.code ?? "ALERTA"}: ${a.detail ?? ""}`.trim()).slice(0, 4).join(" · "),
      recommendation: reasons.length > 1 ? reasons.slice(1).join(" ") : null,
      fingerprint: fingerprintOf({ level, reasons, alerts: alerts.map((a) => [a.code, a.severity]) }),
      originPath: row.email_id ? `documentos/emails/${row.email_id}` : "documentos?tab=registro-email",
      closed: latest.get(`${row.project_id}:${row.category}`)?.id !== row.id,
      reference: `${row.work_week_label ?? "RS"} · ${label}`,
    };
  });
}

export function collectIngestionAlertCases(rows: IngestionAlertSourceRow[], severityMap: IngestionAlertSeverityMap | null | undefined): RiskCaseInput[] {
  return rows.map((row) => {
    const level = resolveIngestionAlertSeverity(severityMap, row.kind);
    return {
      sourceType: "INGESTION_ALERT",
      sourceId: row.id,
      area: "PLANEJAMENTO",
      riskLevel: level,
      title: `Alerta semanal: ${row.kind.replace(/_/g, " ").toLowerCase()} (semana de ${row.week_start})`,
      summary: row.detail,
      impact: `Prazo semanal: ${row.deadline_at}`,
      recommendation: null,
      fingerprint: fingerprintOf({ level, kind: row.kind, week: row.week_start, resolved: Boolean(row.resolved_at) }),
      originPath: "documentos?tab=registro-email",
      closed: Boolean(row.resolved_at),
      reference: `${row.week_start} · ${row.kind}`,
    };
  });
}

export function caseKeyOf(input: Pick<RiskCaseInput, "sourceType" | "sourceId">): string {
  return `${input.sourceType}:${input.sourceId}`;
}
