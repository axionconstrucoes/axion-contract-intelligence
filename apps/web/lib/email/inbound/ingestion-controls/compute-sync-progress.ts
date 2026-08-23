// Progresso REAL de sincronização (seção 13/14) — nunca timer/elapsed
// time como indicador principal, nunca percentual fake. Enquanto o
// denominador (emailsFound) ainda não é conhecido, o estado é
// "Preparando..." — só depois de obtido um denominador real o
// percentual determinístico é exibido. Função pura.

import type { EmailSyncRun } from "./types";

export interface SyncProgressView {
  phase: "PREPARING" | "RUNNING" | "COMPLETED" | "FAILED";
  /** null enquanto o denominador (emailsFound) ainda não é conhecido — nunca 0% fake. */
  percent: number | null;
  label: string;
}

export function computeSyncProgress(run: EmailSyncRun): SyncProgressView {
  if (run.status === "FAILED") {
    return { phase: "FAILED", percent: null, label: "Falha na sincronização" };
  }

  if (run.status === "COMPLETED") {
    return { phase: "COMPLETED", percent: 100, label: "Sincronização concluída" };
  }

  if (run.emailsFound === null || run.emailsFound === undefined) {
    return { phase: "PREPARING", percent: null, label: "Preparando..." };
  }

  if (run.emailsFound === 0) {
    return { phase: "RUNNING", percent: 100, label: "Nenhuma mensagem elegível encontrada" };
  }

  const rawPercent = (run.emailsImported / run.emailsFound) * 100;
  const percent = Math.max(0, Math.min(100, Math.round(rawPercent)));

  return { phase: "RUNNING", percent, label: `Sincronizando e-mails — ${percent}%` };
}
