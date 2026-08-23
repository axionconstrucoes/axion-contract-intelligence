// Tipos puros da "Ingestão Controlada de E-mails" (Integrações). Sem
// I/O, dual-runtime (bundler do Next.js + scripts Node standalone),
// mesmo padrão de apps/web/lib/ui/feature-help.ts e
// apps/web/lib/email/attachments/registry/types.ts.

export type EmailAccountStatus = "NOT_CONNECTED" | "CONNECTED" | "SYNCING" | "AUTH_EXPIRED" | "ERROR";

export interface EmailAccount {
  id: string;
  emailAddress: string;
  displayName: string | null;
  status: EmailAccountStatus;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  connectedAt: string | null;
  connectedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type EmailIngestionWindowMode = "FROM_PROJECT_START" | "FROM_NOW" | "CUSTOM";

export interface EmailIngestionMailbox {
  id: string;
  mailboxAddress: string;
  enabled: boolean;
}

export interface EmailIngestionDomain {
  id: string;
  domain: string;
  domainRole: "AXION" | "CLIENT" | "OTHER_AUTHORIZED";
  enabled: boolean;
}

export interface EmailIngestionParticipant {
  id: string;
  emailAddress: string;
  roleNote: string | null;
  enabled: boolean;
}

export interface ProjectEmailIngestionConfig {
  id: string;
  projectId: string;
  enabled: boolean;
  windowMode: EmailIngestionWindowMode;
  customStartAt: string | null;
  customEndAt: string | null;
  monitoringStartedAt: string | null;
  lastSyncAt: string | null;
  includeAttachments: boolean;
  emailAccountId: string | null;
  mailboxes: EmailIngestionMailbox[];
  domains: EmailIngestionDomain[];
  participants: EmailIngestionParticipant[];
}

export type EmailSyncRunStatus = "PREPARING" | "RUNNING" | "COMPLETED" | "FAILED";

export interface EmailSyncRun {
  id: string;
  configId: string;
  projectId: string;
  status: EmailSyncRunStatus;
  emailsFound: number | null;
  emailsImported: number;
  attachmentsFound: number;
  attachmentsProcessed: number;
  findingsGenerated: number;
  failuresCount: number;
  errorMessage: string | null;
  startedByUserId: string;
  startedAt: string;
  completedAt: string | null;
}

export type CommunicationScope = "CLIENT_COMMUNICATION" | "INTERNAL_AXION_COMMUNICATION";
