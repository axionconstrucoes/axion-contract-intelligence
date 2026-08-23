export type {
  CommunicationScope,
  EmailAccount,
  EmailAccountStatus,
  EmailIngestionDomain,
  EmailIngestionMailbox,
  EmailIngestionParticipant,
  EmailIngestionWindowMode,
  EmailSyncRun,
  EmailSyncRunStatus,
  ProjectEmailIngestionConfig,
} from "./types";
export { classifyCommunicationScope } from "./classify-communication-scope";
export { computeSyncProgress } from "./compute-sync-progress";
export type { SyncProgressView } from "./compute-sync-progress";
export { getEmailAccounts } from "./get-email-accounts";
export { getProjectEmailIngestionConfig } from "./get-project-email-ingestion-config";
export { getEmailSyncRunsForProject, getLatestEmailSyncRun } from "./get-sync-runs";
export { estimateEligibleEmailCount } from "./estimate-eligible-email-count";
