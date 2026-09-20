// Janela do consolidado semanal — quarta-feira 07:00 no timezone do
// projeto. Puro e determinístico (`now` sempre injetado). Como o cron
// roda em UTC de hora em hora, cada execução decide se a janela LOCAL
// está aberta: mesma data local (quarta) e hora local >= 07. A chave da
// janela é a DATA LOCAL da quarta-feira (YYYY-MM-DD) — idempotência por
// (projeto, janela, destinatário) na outbox. Horário de verão é
// resolvido pelo ICU (Intl), nunca por offset fixo.

import { DEFAULT_PROJECT_TIMEZONE, DIGEST_HOUR_LOCAL, DIGEST_WEEKDAY } from "./types";

export interface LocalDateParts {
  date: string; // YYYY-MM-DD
  weekday: number; // 0 = domingo
  hour: number;
  minute: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function toLocalDateParts(nowIso: string, timeZone: string = DEFAULT_PROJECT_TIMEZONE): LocalDateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(new Date(nowIso));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: WEEKDAYS.indexOf(get("weekday")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

export interface DigestWindow {
  /** Data local da quarta-feira desta janela (YYYY-MM-DD). */
  key: string;
  /** true somente quando, no timezone do projeto, é quarta-feira e já passou das 07:00. */
  isOpen: boolean;
  timeZone: string;
}

export function resolveDigestWindow(nowIso: string, timeZone: string = DEFAULT_PROJECT_TIMEZONE): DigestWindow {
  const local = toLocalDateParts(nowIso, timeZone);
  const isOpen = local.weekday === DIGEST_WEEKDAY && local.hour >= DIGEST_HOUR_LOCAL;
  // Chave = quarta-feira da semana local corrente (mesmo fora da janela,
  // para exibir "próximo consolidado" na interface).
  const offsetToWednesday = (DIGEST_WEEKDAY - local.weekday + 7) % 7;
  const midnight = new Date(`${local.date}T00:00:00Z`);
  const isPastThisWeekWindow = local.weekday > DIGEST_WEEKDAY || (local.weekday === DIGEST_WEEKDAY && local.hour >= DIGEST_HOUR_LOCAL);
  // Depois da quarta 07:00 a "próxima" janela é a quarta seguinte; mas a
  // chave da janela aberta continua sendo a quarta de hoje.
  const daysToKey = isOpen ? 0 : isPastThisWeekWindow ? offsetToWednesday || 7 : offsetToWednesday;
  midnight.setUTCDate(midnight.getUTCDate() + daysToKey);
  return { key: midnight.toISOString().slice(0, 10), isOpen, timeZone };
}

/** Próximo consolidado (data local + hora) para exibição na interface. */
export function describeNextDigest(nowIso: string, timeZone: string = DEFAULT_PROJECT_TIMEZONE): string {
  const window = resolveDigestWindow(nowIso, timeZone);
  const [year, month, day] = window.key.split("-");
  return `${day}/${month}/${year} 0${DIGEST_HOUR_LOCAL}:00 (${timeZone})`;
}
