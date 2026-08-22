// Puro, sem I/O — deliberadamente sem "server-only" para ser testável
// tanto pelo bundler do Next.js quanto por um script Node standalone.

import type { AlertSeverity } from "@axion/types";

// Metadados de contexto embutidos no link "RESPONDER AO ACC" — nunca uma
// prova de identidade/autoridade por si só (isso continua vindo da sessão
// autenticada real ao abrir o link: RLS/is_project_member decide o que o
// usuário pode fazer, não a query string). Usados só para que a página já
// abra no evento/projeto certo e com o contexto do alerta visível.
export interface RespondToAccMetadata {
  projectId: string;
  eventId: string;
  alertId?: string | null;
  riskLevel: AlertSeverity;
  messageIdHeader?: string | null;
  providerThreadId?: string | null;
}

// baseUrl deve incluir protocolo+host (ex.: "https://app.axion.com.br" ou
// "http://localhost:3000" em dev) — nunca inventado aqui, sempre passado
// pelo caller a partir de configuração real do ambiente.
export function buildRespondToAccUrl(baseUrl: string, metadata: RespondToAccMetadata): string {
  const url = new URL(`/${metadata.projectId}/ledger/${metadata.eventId}`, baseUrl);
  url.searchParams.set("respond", "acc");
  url.searchParams.set("riskLevel", metadata.riskLevel);
  if (metadata.alertId) url.searchParams.set("alertId", metadata.alertId);
  if (metadata.messageIdHeader) url.searchParams.set("msgId", metadata.messageIdHeader);
  if (metadata.providerThreadId) url.searchParams.set("threadId", metadata.providerThreadId);
  url.hash = "responder-ao-acc";
  return url.toString();
}
