import { AlertTriangle, Circle, Diamond, OctagonAlert } from "lucide-react";
import type {
  ActionRequestStatus,
  AlertSeverity,
  EventStatus,
  ImplicationCategory,
  IntegrationStatus,
  ProjectMembershipStatus,
  ProjectPermission,
} from "@axion/types";
import { Badge } from "@/components/ui/badge";
import {
  actionRequestStatusLabels,
  additionalProposalStatusLabels,
  categoryLabels,
  confrontationCandidateStatusLabels,
  emailAccountStatusLabels,
  eventStatusLabels,
  integrationStatusLabels,
  membershipStatusLabels,
  permissionLabels,
  severityLabels,
  type ConfrontationCandidateStatus,
} from "@/lib/labels";
import type { AdditionalProposalStatus } from "@/lib/additionals/types";
import type { AttachmentDisplayStatus } from "@/lib/email/attachments/registry/types";
import type { EmailAccountStatus } from "@/lib/email/inbound/ingestion-controls/types";
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

// Forma distinta por nível (seção 10 do redesign — "nunca depender
// apenas da cor"): número de lados cresce com a severidade
// (círculo → losango → triângulo → octógono), reforço perceptível
// mesmo em escala de cinza/daltonismo.
const SEVERITY_ICON: Record<AlertSeverity, typeof Circle> = {
  BAIXA: Circle,
  MEDIA: Diamond,
  ALTA: AlertTriangle,
  CRITICA: OctagonAlert,
};

/**
 * `withInfo` é opcional e default false: onde houver muitos badges numa
 * tela densa (tabelas/listas), manter a UI limpa (seção 11 — "sem
 * poluir a tela") — usar `withInfo` só em legendas/explicações
 * pontuais.
 */
export function SeverityBadge({ severity, withInfo = false }: { severity: AlertSeverity; withInfo?: boolean }) {
  const Icon = SEVERITY_ICON[severity];
  return (
    <span className="inline-flex items-center gap-1">
      <Badge className={cn(severityClasses[severity])}>
        <Icon className="size-3" aria-hidden="true" />
        {severityLabels[severity]}
      </Badge>
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

// ATENCAO (seção 22 do requisito de Integrações) é sempre distinto de
// ERRO — autorização expirada/retry/falha não bloqueante, nunca "não
// consegue operar". A cor do badge identifica o ESTADO, nunca a FONTE
// (a cor da fonte vive em integration-visual-identity.ts).
// ERRO usa cinza neutro (não vermelho) — pedido explícito do usuário: o
// vermelho do farol de risco (severity-critica) fica reservado a
// severidade contratual real, nunca reaproveitado para estado técnico
// de integração.
const integrationClasses: Record<IntegrationStatus, string> = {
  CONECTADO: "border-transparent bg-severity-baixa/15 text-severity-baixa",
  PENDENTE: "border-transparent bg-severity-media/15 text-severity-media",
  ATENCAO: "border-transparent bg-orange-500/15 text-orange-600 dark:text-orange-400",
  ERRO: "border-transparent bg-secondary text-foreground font-semibold",
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

const attachmentStatusToneClasses: Record<AttachmentDisplayStatus["tone"], string> = {
  pending: "border-transparent bg-severity-media/15 text-severity-media",
  processing: "border-transparent bg-accent text-accent-foreground",
  processed: "border-transparent bg-severity-baixa/15 text-severity-baixa",
  failed: "border-transparent bg-severity-critica/15 text-severity-critica",
};

export function AttachmentStatusBadge({ status }: { status: AttachmentDisplayStatus }) {
  return <Badge className={cn(attachmentStatusToneClasses[status.tone])}>{status.label}</Badge>;
}

const emailAccountStatusClasses: Record<EmailAccountStatus, string> = {
  NOT_CONNECTED: "border-transparent bg-muted text-muted-foreground",
  CONNECTED: "border-transparent bg-severity-baixa/15 text-severity-baixa",
  SYNCING: "border-transparent bg-accent text-accent-foreground",
  AUTH_EXPIRED: "border-transparent bg-severity-media/15 text-severity-media",
  // Cinza neutro, mesma razão do ERRO de IntegrationStatusBadge acima —
  // consistência dentro da própria tela de Integrações.
  ERROR: "border-transparent bg-secondary text-foreground font-semibold",
};

export function EmailAccountStatusBadge({ status }: { status: EmailAccountStatus }) {
  return <Badge className={cn(emailAccountStatusClasses[status])}>{emailAccountStatusLabels[status]}</Badge>;
}

const membershipStatusClasses: Record<ProjectMembershipStatus, string> = {
  ACTIVE: "border-transparent bg-severity-baixa/15 text-severity-baixa",
  INACTIVE: "border-transparent bg-muted text-muted-foreground",
};

export function MembershipStatusBadge({ status }: { status: ProjectMembershipStatus }) {
  return <Badge className={cn(membershipStatusClasses[status])}>{membershipStatusLabels[status]}</Badge>;
}

// Administrador em destaque sólido (mesma lógica de ALTA/CRÍTICA em
// SeverityBadge — é o papel que concentra poder de gestão de usuários,
// deve ser reconhecível à distância numa tabela densa).
const permissionClasses: Record<ProjectPermission, string> = {
  ADMINISTRADOR: "border-transparent bg-primary text-primary-foreground font-semibold",
  GESTOR: "border-transparent bg-accent text-accent-foreground",
  COLABORADOR: "border-border text-foreground",
  LEITURA: "border-transparent bg-muted text-muted-foreground",
};

export function ProjectPermissionBadge({ permission }: { permission: ProjectPermission }) {
  return <Badge className={cn(permissionClasses[permission])}>{permissionLabels[permission]}</Badge>;
}
