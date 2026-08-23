import type { ActionRequestStatus, AlertSeverity, EventStatus, ImplicationCategory, IntegrationStatus } from "@axion/types";
import { Badge } from "@/components/ui/badge";
import {
  actionRequestStatusLabels,
  additionalProposalStatusLabels,
  categoryLabels,
  confrontationCandidateStatusLabels,
  eventStatusLabels,
  integrationStatusLabels,
  severityLabels,
  type ConfrontationCandidateStatus,
} from "@/lib/labels";
import type { AdditionalProposalStatus } from "@/lib/additionals/types";
import { FeatureInfo } from "@/components/shared/feature-info";
import { cn } from "@/lib/utils";

// ALTA/CRÍTICA usam caixa sólida + fonte branca + bold (forte contraste
// proposital, distinto de BAIXA/MÉDIA) — mesmo token de cor já usado em
// toda a base (--severity-alta/--severity-critica), só a opacidade/peso
// mudam. Único componente compartilhado de severidade do ACC — nunca
// duplicar esta paleta em Dashboard/Timeline/Event Ledger/Ações/ESG/
// Experts IA/Adicionais.
const severityClasses: Record<AlertSeverity, string> = {
  BAIXA: "border-transparent bg-severity-baixa/15 text-severity-baixa",
  MEDIA: "border-transparent bg-severity-media/15 text-severity-media",
  ALTA: "border-transparent bg-severity-alta text-white font-bold",
  CRITICA: "border-transparent bg-severity-critica text-white font-bold",
};

const SEVERITY_HELP_ID: Record<AlertSeverity, string> = {
  BAIXA: "risco-baixo",
  MEDIA: "risco-medio",
  ALTA: "risco-alto",
  CRITICA: "risco-critico",
};

/**
 * `withInfo` é opcional e default false: onde houver muitos badges numa
 * tela densa (tabelas/listas), manter a UI limpa (seção 11 — "sem
 * poluir a tela") — usar `withInfo` só em legendas/explicações
 * pontuais.
 */
export function SeverityBadge({ severity, withInfo = false }: { severity: AlertSeverity; withInfo?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Badge className={cn(severityClasses[severity])}>{severityLabels[severity]}</Badge>
      {withInfo ? <FeatureInfo helpId={SEVERITY_HELP_ID[severity]} /> : null}
    </span>
  );
}

const statusClasses: Record<EventStatus, string> = {
  NOVO: "border-transparent bg-accent text-accent-foreground",
  EM_ANALISE: "border-transparent bg-severity-media/15 text-severity-media",
  CONFRONTADO: "border-transparent bg-severity-alta/15 text-severity-alta",
  RESOLVIDO: "border-transparent bg-severity-baixa/15 text-severity-baixa",
};

export function StatusBadge({ status }: { status: EventStatus }) {
  return <Badge className={cn(statusClasses[status])}>{eventStatusLabels[status]}</Badge>;
}

export function CategoryBadge({ category }: { category: ImplicationCategory }) {
  return <Badge variant="outline">{categoryLabels[category]}</Badge>;
}

const integrationClasses: Record<IntegrationStatus, string> = {
  CONECTADO: "border-transparent bg-severity-baixa/15 text-severity-baixa",
  PENDENTE: "border-transparent bg-severity-media/15 text-severity-media",
  ERRO: "border-transparent bg-severity-critica/15 text-severity-critica",
};

export function IntegrationStatusBadge({ status }: { status: IntegrationStatus }) {
  return <Badge className={cn(integrationClasses[status])}>{integrationStatusLabels[status]}</Badge>;
}

const actionRequestStatusClasses: Record<ActionRequestStatus, string> = {
  OPEN: "border-transparent bg-accent text-accent-foreground",
  CLOSED: "border-transparent bg-severity-baixa/15 text-severity-baixa",
  CANCELLED: "border-transparent bg-muted text-muted-foreground",
};

export function ActionRequestStatusBadge({ status }: { status: ActionRequestStatus }) {
  return <Badge className={cn(actionRequestStatusClasses[status])}>{actionRequestStatusLabels[status]}</Badge>;
}

const confrontationCandidateStatusClasses: Record<ConfrontationCandidateStatus, string> = {
  PENDING_REVIEW: "border-transparent bg-severity-media/15 text-severity-media",
  APPROVED: "border-transparent bg-severity-baixa/15 text-severity-baixa",
  REJECTED: "border-transparent bg-severity-critica/15 text-severity-critica",
};

export function ConfrontationCandidateStatusBadge({ status }: { status: ConfrontationCandidateStatus }) {
  return (
    <Badge className={cn(confrontationCandidateStatusClasses[status])}>
      {confrontationCandidateStatusLabels[status]}
    </Badge>
  );
}

const additionalProposalStatusClasses: Record<AdditionalProposalStatus, string> = {
  POSSIBLE_ADDITIONAL: "border-transparent bg-muted text-muted-foreground",
  UNDER_ANALYSIS: "border-transparent bg-severity-media/15 text-severity-media",
  IN_NEGOTIATION: "border-transparent bg-accent text-accent-foreground",
  CONTRACTED: "border-transparent bg-severity-baixa/15 text-severity-baixa",
  NOT_CONTRACTED: "border-transparent bg-muted text-muted-foreground",
  CANCELLED: "border-transparent bg-muted text-muted-foreground line-through",
};

export function AdditionalProposalStatusBadge({ status }: { status: AdditionalProposalStatus }) {
  return <Badge className={cn(additionalProposalStatusClasses[status])}>{additionalProposalStatusLabels[status]}</Badge>;
}
