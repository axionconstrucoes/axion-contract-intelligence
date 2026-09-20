// Semana e prazo-limite semanal no FUSO DO PROJETO — puro, sem
// dependências além de Intl (mesma técnica de
// apps/web/lib/email/run-weekly-alert-digests.ts, generalizada para
// qualquer fuso/dia/horário configurado por projeto).

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 1 = segunda … 7 = domingo (ISO). */
  isoWeekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function getZonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    hour: Number(value("hour")) % 24,
    minute: Number(value("minute")),
    second: Number(value("second")),
    isoWeekday: WEEKDAY_INDEX[value("weekday")] ?? 1,
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toDateOnly(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Converte data/hora LOCAL no fuso para o instante UTC (duas passagens para absorver o offset, inclusive DST). */
export function zonedDateTimeToUtc(dateOnly: string, time: string, timeZone: string): Date {
  const [hourText, minuteText = "0", secondText = "0"] = time.split(":");
  const localAsUtc = Date.UTC(
    Number(dateOnly.slice(0, 4)),
    Number(dateOnly.slice(5, 7)) - 1,
    Number(dateOnly.slice(8, 10)),
    Number(hourText),
    Number(minuteText),
    Number(secondText)
  );

  const offsetFor = (guess: number) => {
    const zoned = getZonedParts(new Date(guess), timeZone);
    const zonedAsUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);
    return zonedAsUtc - guess;
  };

  let utc = localAsUtc - offsetFor(localAsUtc);
  utc = localAsUtc - offsetFor(utc);
  return new Date(utc);
}

/** Segunda-feira (YYYY-MM-DD, no fuso) da semana que contém o instante. */
export function resolveWeekStart(instant: Date | string, timeZone: string): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  const zoned = getZonedParts(date, timeZone);
  const localMidnightUtc = new Date(Date.UTC(zoned.year, zoned.month - 1, zoned.day));
  localMidnightUtc.setUTCDate(localMidnightUtc.getUTCDate() - (zoned.isoWeekday - 1));
  return toDateOnly(localMidnightUtc.getUTCFullYear(), localMidnightUtc.getUTCMonth() + 1, localMidnightUtc.getUTCDate());
}

export interface WeeklyDeadlineInput {
  deadlineWeekday: number;
  deadlineTime: string;
  timezone: string;
}

/** Instante UTC do prazo-limite da semana iniciada em `weekStart`. */
export function resolveWeeklyDeadline(weekStart: string, input: WeeklyDeadlineInput): Date {
  const base = new Date(`${weekStart}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + (input.deadlineWeekday - 1));
  const dateOnly = toDateOnly(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate());
  return zonedDateTimeToUtc(dateOnly, input.deadlineTime, input.timezone);
}

export interface WeeklyDeadlineState {
  weekStart: string;
  deadlineAt: Date;
  isPastDeadline: boolean;
}

/** Semana corrente (no fuso) e se o prazo dela já passou em `now`. */
export function resolveCurrentWeekDeadline(now: Date, input: WeeklyDeadlineInput): WeeklyDeadlineState {
  const weekStart = resolveWeekStart(now, input.timezone);
  const deadlineAt = resolveWeeklyDeadline(weekStart, input);
  return { weekStart, deadlineAt, isPastDeadline: now.getTime() >= deadlineAt.getTime() };
}

/** Semana anterior (YYYY-MM-DD) a partir de uma segunda-feira. */
export function previousWeekStart(weekStart: string): string {
  const base = new Date(`${weekStart}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() - 7);
  return toDateOnly(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate());
}
