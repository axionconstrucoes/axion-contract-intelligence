// Janela do lote semanal automático (BAIXA/MEDIA) — TODA quarta-feira às
// 08:00 no timezone do projeto (regra definitiva aprovada; substitui a
// primeira versão desta feature, que usava segunda-feira). Reaproveita
// `toLocalDateParts` de risk-alerts/digest-window.ts — o MESMO mecanismo
// ICU (Intl), nunca offset fixo, já usado pelo resumo semanal existente
// — em vez de reimplementar cálculo de fuso horário. Não importa
// `resolveDigestWindow` diretamente porque aquela função é fixa em
// DIGEST_WEEKDAY/DIGEST_HOUR_LOCAL (quarta 07:00, resumo de sla_actions);
// esta é a mesma lógica, parametrizada para quarta 08:00, com sua
// própria chave — nunca dois cálculos concorrentes escrevendo em cima
// do mesmo estado.
//
// Chave da janela = data local (YYYY-MM-DD) da quarta-feira do
// fechamento. Um evento elegível só entra no lote cuja chave é a
// quarta-feira em que o job efetivamente correu — nunca retroage a uma
// janela já fechada (requisito 8: "não alterar silenciosamente um lote
// já enviado").

import { toLocalDateParts } from "../risk-alerts/digest-window";
import { DEFAULT_PROJECT_TIMEZONE } from "../risk-alerts/types";

export { DEFAULT_PROJECT_TIMEZONE };

const CUTOFF_WEEKDAY = 3; // quarta-feira (0 = domingo)
const CUTOFF_HOUR_LOCAL = 8; // 08:00 local

export interface ContractAlertBatchWeeklyWindow {
  /** Data local (YYYY-MM-DD) da quarta-feira deste fechamento. */
  cutoffDate: string;
  /** true somente quando, no timezone do projeto, é quarta-feira e já passou das 08:00. */
  isOpen: boolean;
  timeZone: string;
}

export function resolveContractAlertBatchWeeklyWindow(
  nowIso: string,
  timeZone: string = DEFAULT_PROJECT_TIMEZONE
): ContractAlertBatchWeeklyWindow {
  const local = toLocalDateParts(nowIso, timeZone);
  const isOpen = local.weekday === CUTOFF_WEEKDAY && local.hour >= CUTOFF_HOUR_LOCAL;

  const offsetToWednesday = (CUTOFF_WEEKDAY - local.weekday + 7) % 7;
  const isPastThisWeekWindow =
    local.weekday > CUTOFF_WEEKDAY || (local.weekday === CUTOFF_WEEKDAY && local.hour >= CUTOFF_HOUR_LOCAL);
  const daysToKey = isOpen ? 0 : isPastThisWeekWindow ? offsetToWednesday || 7 : offsetToWednesday;

  const midnight = new Date(`${local.date}T00:00:00Z`);
  midnight.setUTCDate(midnight.getUTCDate() + daysToKey);

  return { cutoffDate: midnight.toISOString().slice(0, 10), isOpen, timeZone };
}

/** Próximo fechamento (data local + hora) para exibição na interface. */
export function describeNextContractAlertBatchWeeklyCutoff(
  nowIso: string,
  timeZone: string = DEFAULT_PROJECT_TIMEZONE
): string {
  const window = resolveContractAlertBatchWeeklyWindow(nowIso, timeZone);
  const [year, month, day] = window.cutoffDate.split("-");
  return `${day}/${month}/${year} 0${CUTOFF_HOUR_LOCAL}:00 (${timeZone})`;
}
