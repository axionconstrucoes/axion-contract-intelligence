// Puro, sem I/O — política ÚNICA de repetição dos alertas de contrato por
// grau de risco. Usada pelos e-mails (texto "Repete: …"), pelas páginas de
// confirmação (EM ANDAMENTO / ENVIADO P/) e pelo motor de lembretes, para
// nunca haver duas fontes de verdade sobre o intervalo.
//
// Dias CORRIDOS (calendário), nunca dias úteis.

import type { AlertSeverity } from "@axion/types";

export const REPEAT_INTERVAL_DAYS: Record<AlertSeverity, number> = {
  CRITICA: 1,
  ALTA: 2,
  MEDIA: 4,
  BAIXA: 7,
};

export const REPEAT_INTERVAL_HOURS: Record<AlertSeverity, number> = {
  CRITICA: 24,
  ALTA: 48,
  MEDIA: 96,
  BAIXA: 168,
};

const MS_PER_HOUR = 60 * 60 * 1000;

export function repeatIntervalMs(severity: AlertSeverity): number {
  return REPEAT_INTERVAL_HOURS[severity] * MS_PER_HOUR;
}

// "a cada 1 dia" / "a cada 2 dias" — singular só para 1.
export function repeatIntervalPhrase(severity: AlertSeverity): string {
  const days = REPEAT_INTERVAL_DAYS[severity];
  return `a cada ${days} ${days === 1 ? "dia" : "dias"}`;
}

// Texto visível nos alertas (e-mail individual e de lote).
export function repeatNoticeText(severity: AlertSeverity): string {
  return `Repete: ${repeatIntervalPhrase(severity)} até a conclusão.`;
}

// Mensagens exibidas ANTES da confirmação nas páginas de ação.
export function inProgressConfirmationNotice(severity: AlertSeverity): string {
  return `Este alerta será repetido ${repeatIntervalPhrase(severity)} até a conclusão.`;
}

export function resolvedConfirmationNotice(): string {
  return "Ao confirmar, este alerta será encerrado e os lembretes futuros serão interrompidos.";
}

export function forwardConfirmationNotice(severity: AlertSeverity): string {
  return `O destinatário receberá este alerta ${repeatIntervalPhrase(severity)} até a conclusão.`;
}
