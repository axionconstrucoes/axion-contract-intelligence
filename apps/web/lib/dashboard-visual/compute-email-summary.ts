// Card E-MAILS (seção 6) — recebidos/enviados vêm de `direction`
// (INBOUND/OUTBOUND) da própria tabela emails; "lido pelo ACC" e
// "considerado" vêm de resolve-email-processing-sets.ts. Sujeito ao
// filtro temporal (seção 17 — métrica de fluxo).
//
// Puro, sem I/O.

import type { ResolvedTimeRange } from "./resolve-time-range";
import { isWithinTimeRange } from "./resolve-time-range";
import type { EmailProcessingSets } from "./resolve-email-processing-sets";

export interface EmailVolumeRow {
  id: string;
  mailboxAddress: string | null;
  direction: "INBOUND" | "OUTBOUND" | null;
  providerMessageId: string | null;
  sentAt: string;
}

export interface EmailSummary {
  received: number;
  sent: number;
  processedByAcc: number;
  consideredInAnalyses: number;
}

export function computeEmailSummary(rows: EmailVolumeRow[], sets: EmailProcessingSets, range: ResolvedTimeRange): EmailSummary {
  let received = 0;
  let sent = 0;
  let processedByAcc = 0;
  let consideredInAnalyses = 0;

  for (const row of rows) {
    if (!isWithinTimeRange(row.sentAt, range)) continue;
    if (row.direction === "INBOUND") received += 1;
    else if (row.direction === "OUTBOUND") sent += 1;
    if (sets.processedEmailIds.has(row.id)) processedByAcc += 1;
    if (sets.consideredEmailIds.has(row.id)) consideredInAnalyses += 1;
  }

  return { received, sent, processedByAcc, consideredInAnalyses };
}
