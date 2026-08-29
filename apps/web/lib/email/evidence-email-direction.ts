// Puro, sem I/O — deliberadamente sem "server-only" para ser testável
// tanto pelo bundler do Next.js quanto por um script Node standalone.
//
// RECEBIDA/ENVIADA/DIREÇÃO NÃO IDENTIFICADA para o e-mail de alerta —
// nunca adivinhado aqui: só traduz para exibição o que a ingestão Gmail já
// classificou e gravou em emails.direction (evaluateGmailMessagePolicy,
// mailboxIsSender ? "OUTBOUND" : "INBOUND" — mailbox monitorada é a
// referência, nunca o domínio @axion.com.br isoladamente; comunicação
// interna AXION<->AXION também passa por essa mesma classificação). Um
// e-mail sem direction (nunca ingerido pelo pipeline Gmail — ex.: registro
// histórico/manual) vira "UNKNOWN": nunca um valor inventado.

export type EvidenceEmailDirection = "RECEIVED" | "SENT" | "UNKNOWN";

export function toEvidenceEmailDirection(direction: "INBOUND" | "OUTBOUND" | null | undefined): EvidenceEmailDirection {
  if (direction === "INBOUND") return "RECEIVED";
  if (direction === "OUTBOUND") return "SENT";
  return "UNKNOWN";
}

export const EVIDENCE_EMAIL_DIRECTION_LABELS: Record<EvidenceEmailDirection, string> = {
  RECEIVED: "RECEBIDA",
  SENT: "ENVIADA",
  UNKNOWN: "DIREÇÃO NÃO IDENTIFICADA",
};
