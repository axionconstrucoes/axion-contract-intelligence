import type { ActionRequestStatus, AlertSeverity, EventStatus, ImplicationCategory, IntegrationStatus } from "@axion/types";
import { Badge } from "@/components/ui/badge";
import {
  actionRequestStatusLabels,
  categoryLabels,
  eventStatusLabels,
  integrationStatusLabels,
  severityLabels,
} from "@/lib/labels";
import { cn } from "@/lib/utils";

const severityClasses: Record<AlertSeverity, string> = {
  BAIXA: "border-transparent bg-severity-baixa/15 text-severity-baixa",
  MEDIA: "border-transparent bg-severity-media/15 text-severity-media",
  ALTA: "border-transparent bg-severity-alta/15 text-severity-alta",
  CRITICA: "border-transparent bg-severity-critica/15 text-severity-critica",
};

export function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  return <Badge className={cn(severityClasses[severity])}>{severityLabels[severity]}</Badge>;
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
