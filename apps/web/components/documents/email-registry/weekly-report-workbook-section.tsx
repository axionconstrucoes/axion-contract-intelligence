import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RegistryWorkbook, RegistryWorkbookSheet } from "@/lib/email/registry/email-document-registry-data";
import type { SCurveSeries } from "@/lib/schedule/s-curve/types";
import { RISK_LABELS, riskBadgeClassName } from "./email-registry-panel";
import { CurveValuesValidationForm, SheetMappingForm } from "./email-registry-review-forms";
import { SCurveChart } from "./s-curve-chart";

// Planilha do RELATÓRIO SEMANAL (unidade documental): Resumo, Curva S,
// Linha de Base, Financeiro, Histograma, SSMA, Dados de origem e Arquivo
// original. Cada seção mostra nome original da aba, dados, gráfico/tabela,
// data de corte, status, confiança, alertas, Expert responsável e link ao
// arquivo. Aba ausente => "Aba não localizada" + mapeamento humano.

const CATEGORY_LABELS: Record<RegistryWorkbookSheet["category"], string> = {
  CURVA_S: "Curva S",
  LINHA_BASE: "Linha de Base (aba do relatório — não é a baseline oficial do MPP)",
  FINANCEIRO: "Financeiro",
  HISTOGRAMA: "Histograma",
  SSMA: "SSMA",
};

const EXPERT_LABELS: Record<string, string> = {
  "planning-director": "Expert de Planejamento",
  "commercial-director": "Expert Comercial/Financeiro",
  "esg-director": "Expert ESG/SSMA",
  ceo: "CEO IA (consolidador)",
};

const SHEET_STATUS_LABELS: Record<string, string> = {
  EXTRACTED: "Extraída",
  MISSING_SHEET: "Aba não localizada",
  AMBIGUOUS_SHEET: "Ambígua — revisão humana",
  PENDING_HUMAN_REVIEW: "Pendente de revisão humana",
  HUMAN_MAPPED: "Mapeada manualmente",
  HUMAN_VALIDATED: "Valores validados por humano",
  FAILED: "Falha",
};

const WORKBOOK_STATUS_LABELS: Record<string, string> = {
  EXTRACTED: "Todas as abas extraídas",
  PARTIAL: "Extração parcial",
  PENDING_HUMAN_REVIEW: "Pendente de revisão humana",
  LEGACY_FORMAT_REVIEW_REQUIRED: "XLS legado — revisão segura necessária",
  INVALID_FILE: "Arquivo inválido",
  FAILED: "Falha",
};

function v(value: unknown, suffix = ""): string {
  if (value === null || value === undefined || value === "") return "—";
  return `${value}${suffix}`;
}

function SheetHeader({ sheet, fileHref }: { sheet: RegistryWorkbookSheet; fileHref: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <strong>{CATEGORY_LABELS[sheet.category]}</strong>
        <Badge variant="outline">{SHEET_STATUS_LABELS[sheet.status] ?? sheet.status}</Badge>
        {sheet.riskClassification ? <Badge variant="outline" className={riskBadgeClassName(sheet.riskClassification)}>{RISK_LABELS[sheet.riskClassification] ?? sheet.riskClassification}</Badge> : null}
      </div>
      <span className="text-muted-foreground">
        Aba original: {sheet.originalSheetName ? <code>{sheet.originalSheetName}</code> : "—"}{sheet.sheetIndex !== null ? ` (#${sheet.sheetIndex + 1})` : ""} · corte {v(sheet.cutoffDate)} · confiança {sheet.confidence !== null ? `${Math.round(sheet.confidence * 100)}%` : "—"} · {EXPERT_LABELS[sheet.expertId] ?? sheet.expertId} ·{" "}
        <Link href={fileHref} className="underline">arquivo original</Link>
      </span>
    </div>
  );
}

function AlertsList({ sheet }: { sheet: RegistryWorkbookSheet }) {
  if (sheet.alerts.length === 0 && sheet.riskReasons.length === 0) return null;
  return (
    <ul className="list-disc pl-4 text-xs">
      {sheet.alerts.map((alert, index) => (
        <li key={`${alert.code}-${index}`} className={alert.severity === "CRITICAL" ? "text-red-700" : alert.severity === "WARNING" ? "text-amber-800" : "text-muted-foreground"}>
          {alert.detail}
        </li>
      ))}
      {sheet.riskReasons.slice(0, 6).map((reason, index) => (
        <li key={`r-${index}`} className="text-muted-foreground">{reason}</li>
      ))}
    </ul>
  );
}

function MissingOrReview({ sheet, projectId, emailId, sheetNames, canEdit }: { sheet: RegistryWorkbookSheet; projectId: string; emailId: string; sheetNames: string[]; canEdit: boolean }) {
  if (!["MISSING_SHEET", "AMBIGUOUS_SHEET", "PENDING_HUMAN_REVIEW", "FAILED"].includes(sheet.status)) return null;
  return (
    <div className="flex flex-col gap-2 text-xs">
      <p className="text-amber-800">
        {sheet.status === "MISSING_SHEET" ? "Aba não localizada no arquivo." : sheet.status === "AMBIGUOUS_SHEET" ? `Mais de uma aba candidata: ${sheet.candidateSheetNames.join(", ")}.` : sheet.status === "FAILED" ? `Falha: ${sheet.errorMessage}` : "Aba localizada, mas a tabela não foi reconhecida com segurança."}
      </p>
      {canEdit && sheetNames.length > 0 ? <SheetMappingForm projectId={projectId} emailId={emailId} sheetId={sheet.id} category={sheet.category} sheetNames={sheetNames} current={sheet.originalSheetName} /> : null}
    </div>
  );
}

function CurvaSBody({ sheet, projectId, emailId, canEdit }: { sheet: RegistryWorkbookSheet; projectId: string; emailId: string; canEdit: boolean }) {
  const series = ((sheet.data as { series?: SCurveSeries[] }).series ?? []) as SCurveSeries[];
  const m = (sheet.metrics ?? {}) as Record<string, unknown>;
  const cross = (m.mppCrossCheck ?? sheet.crossCheck ?? {}) as Record<string, unknown>;
  return (
    <>
      {series.length > 0 ? <SCurveChart series={series} cutoffPeriod={(m.cutoffPeriod as string | null) ?? sheet.cutoffDate} /> : null}
      {sheet.metrics ? (
        <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs md:grid-cols-4">
          <li>Planejado acum.: {v(m.plannedCumulative, "%")}</li>
          <li>Realizado acum.: {v(m.actualCumulative, "%")}</li>
          <li>Projetado: {v(m.forecastCumulative, "%")}</li>
          <li>Desvio: {v(m.deviationPp, " p.p.")}</li>
          <li>Cumprimento: {v(m.fulfillmentPercent, "%")}</li>
          <li>Semana (prev./real.): {v(m.plannedWeekProgress, " p.p.")} / {v(m.actualWeekProgress, " p.p.")}</li>
          <li>Tendência: {v(m.trend)} ({v(m.deviationTrendPp, " p.p.")})</li>
          <li>Velocidade: {v(m.velocityPerPeriod, " p.p./período")}</li>
          <li>Projeção de conclusão: {v(m.projectedCompletionPeriod)}</li>
          <li>MPP atual (avanço): {v(cross.mppProgressPercent, "%")} · Δ {v(cross.divergencePp, " p.p.")}</li>
          <li>Corte coincide com MPP: {cross.cutoffMatches === null || cross.cutoffMatches === undefined ? "—" : cross.cutoffMatches ? "sim" : "não"}</li>
        </ul>
      ) : null}
      {canEdit && (sheet.status === "PENDING_HUMAN_REVIEW" || sheet.riskClassification === "REVIEW_REQUIRED") && sheet.originalSheetName ? (
        <CurveValuesValidationForm projectId={projectId} emailId={emailId} sheetId={sheet.id} defaults={{ cutoffDate: sheet.cutoffDate, planned: (m.plannedCumulative as number | null) ?? null, actual: (m.actualCumulative as number | null) ?? null, forecast: (m.forecastCumulative as number | null) ?? null }} />
      ) : null}
    </>
  );
}

function BaselineBody({ sheet }: { sheet: RegistryWorkbookSheet }) {
  const data = sheet.data as { rows?: Array<{ label: string; plannedStart: string | null; plannedEnd: string | null; plannedPercent: number | null; isMilestone: boolean }>; finalPlannedDate?: string | null };
  const m = (sheet.metrics ?? {}) as Record<string, unknown>;
  const divergences = ((m.divergences as Array<{ code: string; detail: string }> | undefined) ?? []);
  return (
    <div className="flex flex-col gap-2 text-xs">
      <p className="text-muted-foreground">
        WEEKLY_REPORT_BASELINE_SHEET — comparada com a OFFICIAL_SCHEDULE_BASELINE do MPP ({v(m.officialBaselineScheduleVersionId)}); nunca a substitui. Data final na aba: {v(data.finalPlannedDate)} · {v(m.rowCount)} linha(s) · {v(m.milestoneCount)} marco(s).
      </p>
      {divergences.length > 0 ? (
        <ul className="list-disc pl-4 text-amber-800">
          {divergences.map((item, index) => (
            <li key={index}>{item.detail}</li>
          ))}
        </ul>
      ) : m.officialBaselineScheduleVersionId ? <p className="text-emerald-700">Sem divergências detectadas em relação à baseline oficial.</p> : null}
      {(data.rows ?? []).length > 0 ? (
        <div className="max-h-64 overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Início</TableHead>
                <TableHead>Término</TableHead>
                <TableHead>% planejado</TableHead>
                <TableHead>Marco</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data.rows ?? []).slice(0, 100).map((row, index) => (
                <TableRow key={index}>
                  <TableCell className="text-xs">{row.label}</TableCell>
                  <TableCell className="text-xs">{v(row.plannedStart)}</TableCell>
                  <TableCell className="text-xs">{v(row.plannedEnd)}</TableCell>
                  <TableCell className="text-xs">{v(row.plannedPercent, "%")}</TableCell>
                  <TableCell className="text-xs">{row.isMilestone ? "sim" : ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}

function FinancialBody({ sheet }: { sheet: RegistryWorkbookSheet }) {
  const m = (sheet.metrics ?? {}) as Record<string, unknown>;
  const data = sheet.data as { unit?: string; columns?: Record<string, string>; rows?: Array<{ period: string; values: Record<string, number | null> }> };
  const keys = Object.keys(data.columns ?? {});
  return (
    <div className="flex flex-col gap-2 text-xs">
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1 md:grid-cols-4">
        <li>Unidade: {v(data.unit)}</li>
        <li>Previsto (total/acum.): {v(m.plannedTotal)}</li>
        <li>Realizado (total/acum.): {v(m.actualTotal)}</li>
        <li>Desvio: {v(m.deviationAbsolute)} ({v(m.deviationPercent, "%")})</li>
        <li>Tendência: {v(m.trend)}</li>
        <li>Medido: {v(m.medido)}</li>
        <li>Faturado: {v(m.faturado)}</li>
        <li>Recebido: {v(m.recebido)}</li>
        <li>Custo: {v(m.custo)}</li>
        <li>Receita: {v(m.receita)}</li>
        <li>Desembolso: {v(m.desembolso)}</li>
        <li>Colunas mapeadas: {keys.length ? keys.join(", ") : "—"}</li>
      </ul>
      <p className="text-muted-foreground">Valores financeiros mantidos separados do avanço físico (Curva S).</p>
      {(data.rows ?? []).length > 0 ? (
        <div className="max-h-64 overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Período</TableHead>
                {keys.map((key) => (
                  <TableHead key={key}>{data.columns?.[key] ?? key}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data.rows ?? []).slice(0, 100).map((row, index) => (
                <TableRow key={index}>
                  <TableCell className="text-xs">{row.period}</TableCell>
                  {keys.map((key) => (
                    <TableCell key={key} className="text-xs">{v(row.values[key])}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}

function HistogramBody({ sheet }: { sheet: RegistryWorkbookSheet }) {
  const m = (sheet.metrics ?? {}) as Record<string, unknown>;
  const data = sheet.data as { resourceType?: string; resourceEvidence?: string | null; unit?: string | null; rows?: Array<{ period: string; category: string | null; planned: number | null; actual: number | null; quantity: number | null }> };
  const rows = (data.rows ?? []).slice(0, 60);
  const max = Math.max(1, ...rows.map((row) => Math.max(row.planned ?? 0, row.actual ?? 0, row.quantity ?? 0)));
  return (
    <div className="flex flex-col gap-2 text-xs">
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1 md:grid-cols-4">
        <li>Recurso: {v(data.resourceType)} {data.resourceEvidence ? `(evidência: ${data.resourceEvidence})` : "(não presumido)"}</li>
        <li>Unidade: {v(data.unit)}</li>
        <li>Previsto total: {v(m.plannedTotal)}</li>
        <li>Realizado total: {v(m.actualTotal)}</li>
        <li>Falta/excesso: {v(m.shortfallPercent, "%")}</li>
        <li>Tendência: {v(m.trend)}</li>
      </ul>
      {rows.length > 0 ? (
        <svg viewBox={`0 0 ${Math.max(320, rows.length * 18)} 120`} role="img" aria-label="Histograma previsto × realizado" className="h-28 w-full max-w-[720px]">
          {rows.map((row, index) => {
            const x = index * 18 + 4;
            const planned = ((row.planned ?? 0) / max) * 100;
            const actual = ((row.actual ?? row.quantity ?? 0) / max) * 100;
            return (
              <g key={index}>
                <rect x={x} y={110 - planned} width={6} height={planned} fill="#1d4ed8" opacity={0.7} />
                <rect x={x + 7} y={110 - actual} width={6} height={actual} fill="#059669" opacity={0.8} />
              </g>
            );
          })}
        </svg>
      ) : null}
      <span className="text-muted-foreground">Azul = previsto · verde = realizado/quantidade (primeiros {rows.length} períodos/categorias).</span>
    </div>
  );
}

function SsmaBody({ sheet }: { sheet: RegistryWorkbookSheet }) {
  const m = (sheet.metrics ?? {}) as { indicators?: Array<{ key: string; label: string; latest: number | null; latestPeriod: string | null; previous: number | null; trend: string }> };
  return (
    <div className="flex flex-col gap-2 text-xs">
      <p className="text-muted-foreground">Componente do relatório semanal (não é RELATORIO_DIARIO_SSMA_ESG). Só indicadores identificados pelos cabeçalhos reais; nada é inventado.</p>
      {(m.indicators ?? []).length > 0 ? (
        <div className="overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Indicador (cabeçalho original)</TableHead>
                <TableHead>Último valor</TableHead>
                <TableHead>Período</TableHead>
                <TableHead>Anterior</TableHead>
                <TableHead>Tendência</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(m.indicators ?? []).map((item) => (
                <TableRow key={item.key + item.label}>
                  <TableCell className="text-xs">{item.label} <span className="text-muted-foreground">({item.key})</span></TableCell>
                  <TableCell className="text-xs">{v(item.latest)}</TableCell>
                  <TableCell className="text-xs">{v(item.latestPeriod)}</TableCell>
                  <TableCell className="text-xs">{v(item.previous)}</TableCell>
                  <TableCell className="text-xs">{v(item.trend)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}

export function WeeklyReportWorkbookSection({ workbook, projectId, emailId, canEdit }: { workbook: RegistryWorkbook; projectId: string; emailId: string; canEdit: boolean }) {
  const fileHref = `/${projectId}/documentos/emails/${emailId}/anexos/${workbook.emailAttachmentId}`;
  const sheetNames = workbook.sheetIndex.map((entry) => entry.name);
  const byCategory = new Map(workbook.sheets.map((sheet) => [sheet.category, sheet]));
  const ordered = (["CURVA_S", "LINHA_BASE", "FINANCEIRO", "HISTOGRAMA", "SSMA"] as const).map((category) => byCategory.get(category)).filter((sheet): sheet is RegistryWorkbookSheet => Boolean(sheet));
  const safety = workbook.safetyReport as Record<string, unknown>;
  const summary = (workbook.summary ?? {}) as Record<string, unknown>;

  return (
    <Card data-testid="weekly-report-workbook-section">
      <CardHeader>
        <CardTitle>Relatório Semanal (Excel) — {workbook.fileName}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Resumo */}
        <section className="flex flex-col gap-1 text-xs" aria-label="Resumo">
          <strong>Resumo</strong>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{WORKBOOK_STATUS_LABELS[workbook.status] ?? workbook.status}</Badge>
            <span>{workbook.sheetIndex.length} aba(s) no arquivo · {ordered.filter((sheet) => ["EXTRACTED", "HUMAN_MAPPED", "HUMAN_VALIDATED"].includes(sheet.status)).length}/5 categorias extraídas · formato {workbook.detectedFormat} · SHA-256 <code>{workbook.fileSha256.slice(0, 16)}…</code></span>
          </div>
          {workbook.status === "LEGACY_FORMAT_REVIEW_REQUIRED" ? <p className="text-amber-800">XLS legado: o leitor atual não suporta este formato com segurança. O arquivo está preservado e disponível para download; nenhuma aba foi lida.</p> : null}
          {workbook.errorMessage ? <p className="text-destructive">Erro: {workbook.errorMessage}</p> : null}
          <p className="text-muted-foreground">
            Roteamento: Curva S, Linha de Base e Histograma → Expert de Planejamento · Financeiro → Expert Comercial/Financeiro · SSMA → Expert ESG/SSMA · síntese → CEO IA (consolidador; não substitui decisão humana).
            {summary.curvaS ? ` Curva S: desvio ${v((summary.curvaS as Record<string, unknown>).deviationPp, " p.p.")}, risco ${v((summary.curvaS as Record<string, unknown>).risk)}.` : ""}
          </p>
        </section>

        {ordered.map((sheet) => (
          <section key={sheet.id} className="flex flex-col gap-2 rounded-md border p-3" aria-label={CATEGORY_LABELS[sheet.category]} data-testid={`sheet-${sheet.category}`}>
            <SheetHeader sheet={sheet} fileHref={fileHref} />
            <MissingOrReview sheet={sheet} projectId={projectId} emailId={emailId} sheetNames={sheetNames} canEdit={canEdit} />
            {sheet.category === "CURVA_S" && sheet.originalSheetName ? <CurvaSBody sheet={sheet} projectId={projectId} emailId={emailId} canEdit={canEdit} /> : null}
            {sheet.category === "LINHA_BASE" && sheet.originalSheetName ? <BaselineBody sheet={sheet} /> : null}
            {sheet.category === "FINANCEIRO" && sheet.originalSheetName ? <FinancialBody sheet={sheet} /> : null}
            {sheet.category === "HISTOGRAMA" && sheet.originalSheetName ? <HistogramBody sheet={sheet} /> : null}
            {sheet.category === "SSMA" && sheet.originalSheetName ? <SsmaBody sheet={sheet} /> : null}
            <AlertsList sheet={sheet} />
          </section>
        ))}

        {/* Dados de origem */}
        <section className="flex flex-col gap-1 text-xs" aria-label="Dados de origem">
          <strong>Dados de origem</strong>
          <p className="text-muted-foreground">
            Método {workbook.extractionMethod} · lido em {v(workbook.extractedAt)} · somente valores armazenados (macros: {safety.macrosDetected ? "detectadas e ignoradas" : "não detectadas"}; links externos: {v(safety.externalLinksDetected)}; conexões de dados: {v(safety.dataConnectionsDetected)}; fórmulas preservadas: {v(safety.formulasPreserved)}; sem valor armazenado: {v(safety.formulasWithoutCachedValue)}).
          </p>
          <ul className="list-disc pl-4 text-muted-foreground">
            {workbook.sheetIndex.map((entry) => (
              <li key={entry.index}>
                #{entry.index + 1} <code>{entry.name}</code> ({entry.rowCount} linhas{entry.hidden ? ", oculta" : ""})
              </li>
            ))}
          </ul>
          <ul className="list-disc pl-4 text-muted-foreground">
            {ordered.filter((sheet) => sheet.sourceLocator.range).map((sheet) => (
              <li key={sheet.id}>
                {sheet.category}: aba <code>{String(sheet.sourceLocator.sheet)}</code>, cabeçalho linha {String(sheet.sourceLocator.headerRow)}, faixa <code>{String(sheet.sourceLocator.range)}</code>
                {sheet.sourceLocator.columns ? ` · colunas ${Object.entries(sheet.sourceLocator.columns as Record<string, string>).map(([key, col]) => `${key}=${col}`).join(", ")}` : ""}
              </li>
            ))}
          </ul>
        </section>

        {/* Arquivo original */}
        <section className="text-xs" aria-label="Arquivo original">
          <strong>Arquivo original</strong>: <Link href={fileHref} className="underline">{workbook.fileName}</Link> (preservado no Storage; SHA-256 <code>{workbook.fileSha256}</code>).
        </section>
      </CardContent>
    </Card>
  );
}
