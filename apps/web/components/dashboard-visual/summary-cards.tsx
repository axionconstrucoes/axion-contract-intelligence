// Cards de indicadores do Dashboard Visual (seções 6-13) — cada card
// reaproveita SeverityBadge (components/shared/badges.tsx) para
// qualquer contagem por risco, nunca uma paleta de cor própria: garante
// PT-BR (Baixo/Médio/Alto/Crítico) e as cores exigidas (verde/âmbar/
// laranja-branco/vermelho-branco) automaticamente, sem duplicar regra.

import { SeverityBadge } from "@/components/shared/badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FeatureInfo } from "@/components/shared/feature-info";
import { formatDateTime } from "@/lib/labels";
import type { AlertSeverity } from "@axion/types";
import type { EmailSummary } from "@/lib/dashboard-visual/compute-email-summary";
import type { ActiveFindingsSummary, GeneralSituation } from "@/lib/dashboard-visual/resolve-active-findings-summary";
import type { AdditionalProposalsSummary } from "@/lib/dashboard-visual/compute-additional-proposals-summary";
import type { AditivosContratuaisSummary } from "@/lib/dashboard-visual/compute-contract-value";
import type { EsgSummary } from "@/lib/dashboard-visual/compute-esg-summary";
import type { SlaActionsSummary } from "@/lib/dashboard-visual/compute-sla-summary";
import { ValuePlaceholder } from "./value-placeholder";

// `hint`: ajuda via hover/focus no próprio rótulo (title nativo) — sem
// poluir cada indicador com um ⓘ separado (preferência aprovada:
// hover/focus). `cursor-help` sinaliza visualmente que há uma explicação.
function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={hint ? "text-xs text-muted-foreground underline decoration-dotted decoration-muted-foreground/50 cursor-help" : "text-xs text-muted-foreground"} title={hint}>
        {label}
      </span>
      <span className="text-lg font-semibold">{value}</span>
    </div>
  );
}

export function EmailSummaryCard({ summary }: { summary: EmailSummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          E-mails
          <FeatureInfo helpId="dashboard-visual-emails" />
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Recebidos" value={summary.received} />
        <Stat label="Enviados" value={summary.sent} />
        <Stat label="Lidos pelo ACC" value={summary.processedByAcc} hint="E-mails persistidos e processados pelo ACC." />
        <Stat label="Considerados em análises" value={summary.consideredInAnalyses} hint="Itens efetivamente utilizados como fonte, contexto ou evidência." />
      </CardContent>
    </Card>
  );
}

const SEVERITY_ORDER: AlertSeverity[] = ["BAIXA", "MEDIA", "ALTA", "CRITICA"];

export function AlertsSummaryCard({ summary }: { summary: ActiveFindingsSummary }) {
  return (
    <Card className={summary.totalActive > 0 ? "border-severity-critica/30" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          Alertas
          <FeatureInfo helpId="dashboard-visual-alerts" />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-4">
        {SEVERITY_ORDER.map((severity) => (
          <div key={severity} className="flex items-center gap-2">
            <SeverityBadge severity={severity} />
            <span className="text-lg font-semibold">{summary.countsBySeverity[severity]}</span>
          </div>
        ))}
        <div className="ml-auto flex flex-col items-end">
          <span className="text-xs text-muted-foreground">Total ativos</span>
          <span className="text-3xl font-bold tracking-tight">{summary.totalActive}</span>
        </div>
      </CardContent>
    </Card>
  );
}

export function GeneralSituationCard({ situation }: { situation: GeneralSituation }) {
  return (
    <Card className={situation === "SEM_RISCO_ATIVO" ? undefined : "border-severity-critica/30"}>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          Situação geral do contrato
          <FeatureInfo helpId="dashboard-visual-general-situation" />
        </CardTitle>
      </CardHeader>
      <CardContent>
        {situation === "SEM_RISCO_ATIVO" ? (
          <span className="text-base font-semibold text-severity-baixa">Nenhum risco ativo identificado</span>
        ) : (
          <SeverityBadge severity={situation} />
        )}
      </CardContent>
    </Card>
  );
}

export function PhysicalProgressCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          Avanço físico
          <FeatureInfo helpId="dashboard-visual-physical-progress" />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ValuePlaceholder note="Fonte de avanço físico ainda não configurada." />
      </CardContent>
    </Card>
  );
}

export function FinancialProgressCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          Avanço financeiro
          <FeatureInfo helpId="dashboard-visual-financial-progress" />
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Valor contratual vigente" value={<ValuePlaceholder kind="AGUARDANDO_FONTE" />} />
        <Stat label="Valor medido acumulado" value={<ValuePlaceholder kind="AGUARDANDO_FONTE" />} />
        <Stat label="Valor faturado" value={<ValuePlaceholder kind="AGUARDANDO_FONTE" />} />
        <Stat label="Valor recebido/pago" value={<ValuePlaceholder kind="AGUARDANDO_FONTE" />} />
      </CardContent>
    </Card>
  );
}

export function AditivosCard({ summary, formatCurrency }: { summary: AditivosContratuaisSummary; formatCurrency: (v: number) => string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Aditivos contratuais</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Quantidade" value={summary.quantity} />
        <Stat label="Valor líquido" value={formatCurrency(summary.netValue)} />
        <Stat
          label="Último aditivo"
          value={summary.lastAditivo ? `${summary.lastAditivo.proposalNumber} — ${formatDateTime(summary.lastAditivo.contractedAt)}` : "Nenhum aditivo formalizado"}
        />
      </CardContent>
    </Card>
  );
}

export function AdditionalProposalsCard({ summary }: { summary: AdditionalProposalsSummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Adicionais</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Possíveis" value={summary.possible} />
        <Stat label="Em análise" value={summary.underAnalysis} />
        <Stat label="Em negociação" value={summary.inNegotiation} />
        <Stat label="Contratados" value={summary.contracted} />
        <Stat label="Contratados — formalização pendente" value={summary.contractedWithPendingFormalization} />
      </CardContent>
    </Card>
  );
}

const ESG_RISK_TO_ALERT: Record<keyof EsgSummary["countsByRisk"], AlertSeverity> = {
  LOW: "BAIXA",
  MEDIUM: "MEDIA",
  HIGH: "ALTA",
  CRITICAL: "CRITICA",
};

export function EsgCard({ summary }: { summary: EsgSummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          ESG / SSMA
          <FeatureInfo helpId="dashboard-visual-esg" />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Ocorrências" value={summary.occurrences} />
          <Stat label="Abertas" value={summary.open} />
          <Stat label="Evidências pendentes" value={summary.evidencePending} />
          <Stat label="Última atualização" value={summary.lastUpdatedAt ? formatDateTime(summary.lastUpdatedAt) : "Ainda sem registro"} />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {(Object.keys(ESG_RISK_TO_ALERT) as Array<keyof EsgSummary["countsByRisk"]>).map((risk) => (
            <div key={risk} className="flex items-center gap-2">
              <SeverityBadge severity={ESG_RISK_TO_ALERT[risk]} />
              <span className="text-sm font-semibold">{summary.countsByRisk[risk]}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function SlaActionsCard({ summary }: { summary: SlaActionsSummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          Ações e escalonamentos
          <FeatureInfo helpId="dashboard-visual-sla" />
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Pendentes" value={summary.pending} />
        <Stat label="Vencidas" value={summary.overdue} />
        <Stat label="Vencem hoje" value={summary.dueToday} />
        <Stat label="Escalonadas" value={summary.escalated} />
      </CardContent>
    </Card>
  );
}
