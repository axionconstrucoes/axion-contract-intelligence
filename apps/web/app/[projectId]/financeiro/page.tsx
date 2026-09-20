import type { Metadata } from "next";
import Link from "next/link";
import { FinancialCorrectionForm } from "@/components/financial/financial-correction-form";
import { FinancialSeriesChart } from "@/components/financial/financial-series-chart";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getProject } from "@/lib/data";
import { loadFinancialDashboard, parseFinancialDashboardParams } from "@/lib/financial/financial-dashboard-data";
import { NOT_AVAILABLE, detectCurrencySymbol, formatByUnit, formatDateBR, formatDateTimeBR, formatPercentBR } from "@/lib/financial/format-br";
import type { FinancialSheetData } from "@/lib/schedule/weekly-report/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Financeiro" };

// Dashboard FINANCEIRO — fonte única: aba FINANCEIRO da planilha do
// relatório semanal (weekly_report_sheets). Acesso: canViewProjectFinancial
// Dashboard (mesma regra do item de menu, do loader, das actions e da RLS).

const COLUMN_LABELS: Record<string, string> = {
  previsto: "Previsto",
  realizado: "Realizado",
  acumulado_previsto: "Acumulado previsto",
  acumulado_realizado: "Acumulado realizado",
  medido: "Medido",
  faturado: "Faturado",
  recebido: "Recebido",
  custo: "Custo",
  receita: "Receita",
  desembolso: "Desembolso",
  variacao: "Variação",
};

const SHEET_STATUS_LABELS: Record<string, string> = {
  EXTRACTED: "Extraída",
  MISSING_SHEET: "Aba Financeiro ausente",
  AMBIGUOUS_SHEET: "Aba ambígua — revisão humana",
  PENDING_HUMAN_REVIEW: "Extração pendente de revisão",
  HUMAN_MAPPED: "Mapeada manualmente",
  HUMAN_VALIDATED: "Dados validados/corrigidos por humano",
  FAILED: "Falha na extração",
};

const CHANGE_LABELS: Record<string, string> = { LOW: "Baixo", MEDIUM: "Médio", HIGH: "Alto", REVIEW_REQUIRED: "Revisão necessária" };

function buildHref(projectId: string, params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined && value !== "") search.set(key, String(value));
  const text = search.toString();
  return `/${projectId}/financeiro${text ? `?${text}` : ""}`;
}

export default async function FinanceiroPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { projectId } = await params;
  const query = parseFinancialDashboardParams((await searchParams) ?? {});
  const [model, project] = await Promise.all([loadFinancialDashboard(projectId, query), getProject(projectId)]);

  if (!model.access) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Financeiro" description="Dashboard financeiro do relatório semanal." />
        <Card>
          <CardContent className="pt-6 text-sm" role="alert" data-testid="financial-access-denied">
            <strong>Acesso negado.</strong> Dados financeiros são restritos a membros ativos do projeto com papel Administrador ou Gerente, ou das áreas Diretoria e Financeiro. Solicite acesso ao administrador do projeto.
          </CardContent>
        </Card>
      </div>
    );
  }

  const { selected, previous, versions, cards, charts, table, changes, crossChecks, workbookSheetsSummary, canEdit } = model;
  const data = (selected?.data ?? {}) as Partial<FinancialSheetData>;
  const currencySymbol = detectCurrencySymbol(data.headers ?? []);
  const unitLabel = data.unit === "CURRENCY" ? (currencySymbol ?? "moeda não identificada") : data.unit === "PERCENT" ? "%" : data.unit ? "unidade não identificada" : "—";
  const weekOptions = [...new Map(versions.filter((v) => v.workWeekNumber !== null).map((v) => [v.workWeekNumber, v])).values()];
  const sameWeekVersions = selected ? versions.filter((v) => v.workWeekLabel === selected.workWeekLabel) : [];
  const originHref = selected?.emailId ? `/${projectId}/documentos/emails/${selected.emailId}` : null;
  const selectedVersion = selected ? versions.find((v) => v.workbookId === selected.workbookId) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Financeiro"
        description="Dashboard alimentado exclusivamente pela aba Financeiro da planilha Excel do relatório semanal — nunca por PDF nem por valores digitados."
        actions={originHref ? <Link href={originHref} className={cn(buttonVariants({ size: "sm" }))}>ABRIR RELATÓRIO DE ORIGEM</Link> : null}
      />

      {/* Cabeçalho compacto */}
      <Card>
        <CardContent className="grid gap-2 pt-4 text-xs sm:grid-cols-4" data-testid="financial-header">
          <div><span className="text-muted-foreground">Projeto:</span> {project ? `${project.code} — ${project.name}` : projectId}</div>
          <div><span className="text-muted-foreground">Semana WNN:</span> {selected?.workWeekLabel ?? NOT_AVAILABLE}{selectedVersion?.superseded ? <Badge variant="outline" className="ml-1 border-amber-600 text-amber-800">versão substituída</Badge> : null}</div>
          <div><span className="text-muted-foreground">Data de corte:</span> {formatDateBR(selected?.cutoffDate)}</div>
          <div><span className="text-muted-foreground">E-mail:</span> {formatDateTimeBR(selected?.emailSentAt)}</div>
          <div className="sm:col-span-2 truncate"><span className="text-muted-foreground">Arquivo de origem:</span> {selected ? `${selected.fileName} · aba "${selected.originalSheetName ?? "?"}" · ${String(selected.locator.range ?? "")}` : NOT_AVAILABLE}</div>
          <div><span className="text-muted-foreground">Status:</span> {selected ? (SHEET_STATUS_LABELS[selected.sheetStatus] ?? selected.sheetStatus) : "Sem relatório semanal"}{selected?.humanCorrected ? <Badge variant="outline" className="ml-1">corrigido</Badge> : null}</div>
          <div><span className="text-muted-foreground">Confiança:</span> {selected?.confidence !== null && selected?.confidence !== undefined ? formatPercentBR(selected.confidence * 100, 0) : NOT_AVAILABLE}</div>
          <div><span className="text-muted-foreground">Última atualização:</span> {formatDateTimeBR(selected?.validatedAt ?? selected?.extractedAt)}</div>
          <div><span className="text-muted-foreground">Versão:</span> {selected ? `${sameWeekVersions.length > 1 ? `${sameWeekVersions.findIndex((v) => v.workbookId === selected.workbookId) === 0 ? "mais recente" : "anterior"} de ${sameWeekVersions.length}` : "única"} · SHA ${selected.fileSha256.slice(0, 8)}…` : NOT_AVAILABLE}</div>
          <div><span className="text-muted-foreground">Unidade/moeda:</span> {unitLabel}</div>
          <div><span className="text-muted-foreground">Expert:</span> {selected?.expertId === "commercial-director" ? "Expert Comercial/Financeiro (commercial-director) · consolidação CEO IA" : (selected?.expertId ?? "—")}</div>
        </CardContent>
      </Card>

      {/* Filtros: semana, versão, período, série */}
      <form method="get" action={`/${projectId}/financeiro`} className="grid gap-2 rounded-md border bg-card p-3 text-xs sm:grid-cols-6" role="search" aria-label="Selecionar semana, versão e período">
        <label className="flex flex-col gap-1">
          Semana da obra
          <Select name="semana" defaultValue={query.workWeekNumber ?? ""} aria-label="Semana da obra">
            <option value="">Mais recente</option>
            {weekOptions.map((v) => (
              <option key={v.workbookId} value={v.workWeekNumber ?? ""}>
                {v.workWeekLabel}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          Versão do envio
          <Select name="versao" defaultValue={query.workbookId ?? ""} aria-label="Versão do envio">
            <option value="">Válida mais recente</option>
            {versions.map((v) => (
              <option key={v.workbookId} value={v.workbookId}>
                {v.workWeekLabel ?? "sem WNN"} · {formatDateTimeBR(v.emailSentAt)} · {v.isLatestOfWeek ? "válida" : v.superseded ? "substituída" : SHEET_STATUS_LABELS[v.sheetStatus] ?? v.sheetStatus}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          De
          <Input type="date" name="de" defaultValue={query.from ?? ""} aria-label="Período inicial" />
        </label>
        <label className="flex flex-col gap-1">
          Até
          <Input type="date" name="ate" defaultValue={query.to ?? ""} aria-label="Período final" />
        </label>
        <label className="flex flex-col gap-1">
          Série
          <Select name="serie" defaultValue={query.series ?? ""} aria-label="Série financeira">
            <option value="">Todas</option>
            {charts.map((chart) => (
              <option key={chart.key} value={chart.key}>
                {chart.title}
              </option>
            ))}
          </Select>
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className={cn(buttonVariants({ size: "sm" }))}>Aplicar</button>
          <Link href={`/${projectId}/financeiro`} className={cn(buttonVariants({ size: "sm", variant: "outline" }))}>Limpar</Link>
        </div>
      </form>

      {!selected ? (
        <EmptyState message={versions.length === 0 ? "Nenhum relatório semanal com aba Financeiro lida para este projeto (sem relatório, sem planilha ou aba ainda não processada)." : "Nenhuma versão válida corresponde à seleção. Escolha outra semana/versão."} />
      ) : (
        <>
          {selected.sheetStatus === "MISSING_SHEET" || selected.sheetStatus === "AMBIGUOUS_SHEET" || selected.sheetStatus === "PENDING_HUMAN_REVIEW" || selected.sheetStatus === "FAILED" ? (
            <Card>
              <CardContent className="pt-4 text-xs text-amber-800" role="status">
                {SHEET_STATUS_LABELS[selected.sheetStatus]} — {selected.alerts.map((alert) => alert.detail).join(" ") || "sem valores financeiros disponíveis nesta versão."}{" "}
                {originHref ? <Link href={originHref} className="underline">Revisar/mapear no relatório de origem</Link> : null}
              </CardContent>
            </Card>
          ) : null}
          {selected.alerts.filter((alert) => alert.severity !== "INFO").length > 0 && selected.sheetStatus === "EXTRACTED" ? (
            <p className="text-xs text-amber-800">{selected.alerts.filter((alert) => alert.severity !== "INFO").map((alert) => alert.detail).join(" ")}</p>
          ) : null}

          {/* Cards */}
          {cards.length === 0 ? (
            <EmptyState message="Semana sem valores financeiros disponíveis (nenhuma coluna reconhecida com valor armazenado)." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="financial-cards">
              {cards.map((card) => (
                <Card key={card.key}>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-xs font-medium text-muted-foreground" title={card.note ?? undefined}>
                      {card.label} <span className="font-normal">({card.scope === "PERIOD" ? "período" : card.scope === "CUMULATIVE" ? "acumulado" : "derivado"})</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-lg font-semibold">
                    {formatByUnit(card.value, card.unit, currencySymbol)}
                    {card.note ? <p className="text-xs font-normal text-muted-foreground">{card.note}</p> : null}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Gráficos */}
          <div className="grid gap-3 lg:grid-cols-2" data-testid="financial-charts">
            {charts.filter((chart) => !query.series || chart.key === query.series).map((chart) => (
              <FinancialSeriesChart key={chart.key} chart={chart} currencySymbol={currencySymbol} />
            ))}
            {charts.length === 0 ? <EmptyState message="Nenhuma série financeira compatível para gráfico nesta versão." /> : null}
          </div>

          {/* Alterações desde o relatório anterior */}
          <Card>
            <CardHeader>
              <CardTitle>ALTERAÇÕES DESDE O RELATÓRIO ANTERIOR {previous ? `(${previous.workWeekLabel ?? "anterior"} → ${selected.workWeekLabel ?? "atual"})` : ""}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs">
              {!previous ? (
                <p className="text-muted-foreground">Não há relatório válido anterior para comparar.</p>
              ) : changes.length === 0 ? (
                <p className="text-emerald-700">Nenhuma alteração detectada entre os períodos já reportados.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Métrica</TableHead>
                        <TableHead>Período</TableHead>
                        <TableHead>Anterior</TableHead>
                        <TableHead>Atual</TableHead>
                        <TableHead>Diferença</TableHead>
                        <TableHead>Classificação</TableHead>
                        <TableHead>Fonte anterior → atual</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {changes.map((change, index) => (
                        <TableRow key={index}>
                          <TableCell className="text-xs" title={change.detail}>{COLUMN_LABELS[change.metric] ?? change.metric} <span className="text-muted-foreground">({change.code})</span></TableCell>
                          <TableCell className="text-xs">{change.period ?? "—"}</TableCell>
                          <TableCell className="text-xs">{typeof change.previousValue === "number" ? formatByUnit(change.previousValue, data.unit === "PERCENT" ? "PERCENT" : "CURRENCY", currencySymbol) : (change.previousValue ?? "—")}</TableCell>
                          <TableCell className="text-xs">{typeof change.currentValue === "number" ? formatByUnit(change.currentValue, data.unit === "PERCENT" ? "PERCENT" : "CURRENCY", currencySymbol) : (change.currentValue ?? "—")}</TableCell>
                          <TableCell className="text-xs">{change.difference === null ? "—" : formatByUnit(change.difference, data.unit === "PERCENT" ? "PERCENT" : "CURRENCY", currencySymbol)}</TableCell>
                          <TableCell className="text-xs"><Badge variant="outline" className={change.classification === "REVIEW_REQUIRED" ? "border-violet-600 text-violet-700" : change.classification === "HIGH" ? "border-orange-600 text-orange-700" : ""}>{CHANGE_LABELS[change.classification]}</Badge></TableCell>
                          <TableCell className="max-w-[260px] truncate text-xs" title={`${change.previousSource} → ${change.currentSource}`}>{change.previousSource} → {change.currentSource}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Cruzamento Financeiro × Curva S × MPP */}
          <Card>
            <CardHeader>
              <CardTitle>Cruzamento Financeiro × Curva S × MPP</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-xs">
              <p className="text-muted-foreground">
                Abas do mesmo relatório: {workbookSheetsSummary.map((sheet) => `${sheet.category}=${sheet.status}`).join(" · ") || "—"}. Fatos e diferenças vêm dos dados extraídos; interpretações são hipóteses — sem conclusão automática de causalidade.
              </p>
              {crossChecks.length === 0 ? (
                <p className="text-muted-foreground">Sem Curva S/MPP disponíveis para cruzar nesta versão.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {crossChecks.map((finding) => (
                    <li key={finding.code} className="rounded-md border p-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{finding.domain}</Badge>
                        <Badge variant="outline" className={finding.severity === "CRITICAL" ? "border-red-700 text-red-700" : finding.severity === "WARNING" ? "border-amber-600 text-amber-800" : ""}>{finding.severity}</Badge>
                        {finding.humanReviewRequired ? <Badge variant="outline" className="border-violet-600 text-violet-700">revisão humana</Badge> : null}
                      </div>
                      <div><strong>Fato:</strong> {finding.fact}</div>
                      {finding.difference ? <div><strong>Diferença:</strong> {finding.difference}</div> : null}
                      <div className="text-muted-foreground"><strong>Possível interpretação:</strong> {finding.interpretation}</div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Tabela detalhada */}
          <Card>
            <CardHeader>
              <CardTitle>Tabela detalhada ({table.total} período(s))</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-xs">
              <form method="get" action={`/${projectId}/financeiro`} className="flex flex-wrap items-end gap-2" aria-label="Pesquisar e ordenar a tabela">
                <input type="hidden" name="semana" value={query.workWeekNumber ?? ""} />
                <input type="hidden" name="versao" value={query.workbookId ?? ""} />
                <input type="hidden" name="de" value={query.from ?? ""} />
                <input type="hidden" name="ate" value={query.to ?? ""} />
                <label className="flex flex-col gap-1">
                  Pesquisar período
                  <Input name="q" defaultValue={query.query} placeholder="W37 ou 2026-09" aria-label="Pesquisar período" />
                </label>
                <label className="flex flex-col gap-1">
                  Ordenar
                  <Select name="ordem" defaultValue={query.sort} aria-label="Ordenar">
                    <option value="period_asc">Período (crescente)</option>
                    <option value="period_desc">Período (decrescente)</option>
                    <option value="deviation_desc">Maior desvio</option>
                  </Select>
                </label>
                <button type="submit" className={cn(buttonVariants({ size: "sm", variant: "outline" }))}>Filtrar</button>
              </form>
              {table.rows.length === 0 ? (
                <EmptyState message="Nenhum período corresponde à pesquisa." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Período</TableHead>
                        <TableHead>Data</TableHead>
                        {table.columns.map((column) => (
                          <TableHead key={column}>{COLUMN_LABELS[column] ?? column}</TableHead>
                        ))}
                        <TableHead>Desvio abs.</TableHead>
                        <TableHead>Desvio %</TableHead>
                        <TableHead>Unidade</TableHead>
                        <TableHead>Confiança</TableHead>
                        <TableHead>Origem</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {table.rows.map((row) => (
                        <TableRow key={row.period}>
                          <TableCell className="text-xs">{row.period}</TableCell>
                          <TableCell className="text-xs">{formatDateBR(row.date)}</TableCell>
                          {table.columns.map((column) => (
                            <TableCell key={column} className="text-xs">{formatByUnit(row.values[column] ?? null, row.unit, currencySymbol)}</TableCell>
                          ))}
                          <TableCell className="text-xs">{formatByUnit(row.deviationAbsolute, row.unit, currencySymbol)}</TableCell>
                          <TableCell className="text-xs">{formatPercentBR(row.deviationPercent)}</TableCell>
                          <TableCell className="text-xs">{row.unit === "CURRENCY" ? (currencySymbol ?? "moeda não identificada") : row.unit === "PERCENT" ? "%" : row.unit}</TableCell>
                          <TableCell className="text-xs">{row.confidence !== null ? formatPercentBR(row.confidence * 100, 0) : NOT_AVAILABLE}</TableCell>
                          <TableCell className="text-xs">{originHref ? <Link href={originHref} className="underline" title={row.source}>{row.source}</Link> : row.source}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {table.total > table.pageSize ? (
                <nav className="flex items-center justify-between" aria-label="Paginação da tabela">
                  {table.page > 1 ? <Link href={buildHref(projectId, { semana: query.workWeekNumber, versao: query.workbookId, de: query.from, ate: query.to, q: query.query, ordem: query.sort, pagina: table.page - 1 })} className={cn(buttonVariants({ size: "sm", variant: "outline" }))}>← Anterior</Link> : <span />}
                  <span>página {table.page} de {Math.ceil(table.total / table.pageSize)}</span>
                  {table.page * table.pageSize < table.total ? <Link href={buildHref(projectId, { semana: query.workWeekNumber, versao: query.workbookId, de: query.from, ate: query.to, q: query.query, ordem: query.sort, pagina: table.page + 1 })} className={cn(buttonVariants({ size: "sm", variant: "outline" }))}>Próxima →</Link> : <span />}
                </nav>
              ) : null}
              {sameWeekVersions.length > 1 ? (
                <p className="text-muted-foreground">
                  Versões anteriores desta semana:{" "}
                  {sameWeekVersions.filter((v) => v.workbookId !== selected.workbookId).map((v) => (
                    <Link key={v.workbookId} href={buildHref(projectId, { versao: v.workbookId })} className="underline">{formatDateTimeBR(v.emailSentAt)}</Link>
                  )).reduce<React.ReactNode[]>((acc, node, index) => (index === 0 ? [node] : [...acc, " · ", node]), [])}
                  {" "}— versões da mesma semana nunca são somadas.
                </p>
              ) : null}
            </CardContent>
          </Card>

          {/* Validação humana */}
          {canEdit && Array.isArray(data.rows) && data.rows.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Correção humana de valores</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-xs">
                <p className="text-muted-foreground">O valor original extraído é preservado (evento de revisão + cópia em <code>data.original</code>); a correção fica sinalizada, auditada (usuário/data/justificativa) e as métricas são recalculadas pelo worker de forma idempotente.</p>
                <FinancialCorrectionForm projectId={projectId} sheetId={selected.sheetId} periods={data.rows.map((row) => row.period)} columns={Object.keys(data.columns ?? {}).map((key) => ({ key, label: COLUMN_LABELS[key] ?? key }))} />
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
