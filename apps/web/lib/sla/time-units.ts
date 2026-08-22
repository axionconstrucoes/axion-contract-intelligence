// Conversão de prazos (seção 20 do requisito original + correção de
// timezone) — puro, sem I/O, determinístico. Usa `Intl.DateTimeFormat`
// (ICU, já disponível no runtime — nunca offset fixo manual) para
// converter corretamente entre o instante UTC armazenado e o horário de
// parede na timezone configurada, incluindo qualquer transição de
// horário de verão de uma timezone IANA real.
//
// LIMITAÇÃO CONHECIDA (documentada, nunca escondida — ver
// docs/sla-escalation.md "Limitações de calendário"): nesta versão,
// sábado e domingo não são dias úteis; feriados (nacionais, regionais ou
// municipais) NÃO são descontados. Isso é um comportamento mínimo
// seguro — uma evolução futura poderá usar um calendário corporativo/
// regional real, mas o sistema nunca finge considerá-lo hoje.

export interface SlaBusinessHoursConfig {
  /** IANA timezone identifier — ex.: "America/Sao_Paulo". */
  timeZone: string;
  businessDayStartHour: number;
  businessDayEndHour: number;
}

// Default institucional da AXION — nunca UTC como horário comercial.
export const AXION_DEFAULT_BUSINESS_HOURS_CONFIG: SlaBusinessHoursConfig = {
  timeZone: "America/Sao_Paulo",
  businessDayStartHour: 8,
  businessDayEndHour: 18,
};

function businessHoursPerDay(config: SlaBusinessHoursConfig): number {
  return config.businessDayEndHour - config.businessDayStartHour;
}

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** Componentes de data/hora "de parede" de um instante, na timezone informada. */
function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = getFormatter(timeZone).formatToParts(date);
  const map: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = Number(part.value);
    }
  }
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    second: map.second,
  };
}

/** Offset (minutos) tal que horário-local = horário-UTC + offset, no instante `date`, na timezone informada. */
function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtcIfLocalWereUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asUtcIfLocalWereUtc - date.getTime()) / 60_000;
}

/**
 * Converte um horário "de parede" (ano/mês/dia/hora/min/seg, na timezone
 * informada) para o instante UTC correspondente — corrige a transição de
 * DST com uma segunda iteração (o mesmo horário de parede pode
 * corresponder a offsets diferentes dependendo de qual lado da transição
 * o primeiro palpite cai).
 */
function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date {
  const guessUtcMillis = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset1 = getTimeZoneOffsetMinutes(new Date(guessUtcMillis), timeZone);
  const candidateMillis = guessUtcMillis - offset1 * 60_000;
  const offset2 = getTimeZoneOffsetMinutes(new Date(candidateMillis), timeZone);
  if (offset2 !== offset1) {
    return new Date(guessUtcMillis - offset2 * 60_000);
  }
  return new Date(candidateMillis);
}

function isWeekendYMD(year: number, month: number, day: number): boolean {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

function nextDayYMD(year: number, month: number, day: number): { year: number; month: number; day: number } {
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function businessWindowForDay(
  year: number,
  month: number,
  day: number,
  config: SlaBusinessHoursConfig
): { startUtc: Date; endUtc: Date } {
  return {
    startUtc: zonedWallTimeToUtc(year, month, day, config.businessDayStartHour, 0, 0, config.timeZone),
    endUtc: zonedWallTimeToUtc(year, month, day, config.businessDayEndHour, 0, 0, config.timeZone),
  };
}

function nextBusinessDayStart(
  ymd: { year: number; month: number; day: number },
  config: SlaBusinessHoursConfig
): Date {
  let { year, month, day } = ymd;
  while (isWeekendYMD(year, month, day)) {
    ({ year, month, day } = nextDayYMD(year, month, day));
  }
  return businessWindowForDay(year, month, day, config).startUtc;
}

function clampIntoBusinessWindow(date: Date, config: SlaBusinessHoursConfig): Date {
  const { year, month, day } = zonedParts(date, config.timeZone);

  if (isWeekendYMD(year, month, day)) {
    return nextBusinessDayStart(nextDayYMD(year, month, day), config);
  }

  const window = businessWindowForDay(year, month, day, config);
  if (date.getTime() < window.startUtc.getTime()) {
    return window.startUtc;
  }
  if (date.getTime() >= window.endUtc.getTime()) {
    return nextBusinessDayStart(nextDayYMD(year, month, day), config);
  }
  return date;
}

// ---------------- CLOCK_HOURS / CALENDAR_DAYS — independentes de horário comercial ----------------

export function addClockHours(start: Date, hours: number): Date {
  return new Date(start.getTime() + hours * 3_600_000);
}

export function addCalendarDays(start: Date, days: number): Date {
  return new Date(start.getTime() + days * 86_400_000);
}

// ---------------- BUSINESS_HOURS / BUSINESS_DAYS — respeitam timezone + expediente ----------------

export function addBusinessHours(
  start: Date,
  hours: number,
  config: SlaBusinessHoursConfig = AXION_DEFAULT_BUSINESS_HOURS_CONFIG
): Date {
  let remainingMinutes = hours * 60;
  let cursor = clampIntoBusinessWindow(start, config);

  while (remainingMinutes > 0) {
    const { year, month, day } = zonedParts(cursor, config.timeZone);
    const window = businessWindowForDay(year, month, day, config);
    const minutesLeftToday = (window.endUtc.getTime() - cursor.getTime()) / 60_000;

    if (remainingMinutes <= minutesLeftToday) {
      cursor = new Date(cursor.getTime() + remainingMinutes * 60_000);
      remainingMinutes = 0;
    } else {
      remainingMinutes -= minutesLeftToday;
      cursor = nextBusinessDayStart(nextDayYMD(year, month, day), config);
    }
  }

  return cursor;
}

export function addBusinessDays(
  start: Date,
  days: number,
  config: SlaBusinessHoursConfig = AXION_DEFAULT_BUSINESS_HOURS_CONFIG
): Date {
  const wholeDays = Math.trunc(days);
  const fractionalDays = days - wholeDays;

  const origParts = zonedParts(start, config.timeZone);
  let { year, month, day } = origParts;

  let remaining = wholeDays;
  while (remaining > 0) {
    ({ year, month, day } = nextDayYMD(year, month, day));
    if (!isWeekendYMD(year, month, day)) {
      remaining -= 1;
    }
  }

  let cursor = zonedWallTimeToUtc(year, month, day, origParts.hour, origParts.minute, origParts.second, config.timeZone);

  if (fractionalDays > 0) {
    cursor = addBusinessHours(cursor, fractionalDays * businessHoursPerDay(config), config);
  }

  return cursor;
}

export type SlaTimeUnitLike = "BUSINESS_HOURS" | "CLOCK_HOURS" | "BUSINESS_DAYS" | "CALENDAR_DAYS";

export function addTimeUnits(
  start: Date,
  value: number,
  unit: SlaTimeUnitLike,
  config: SlaBusinessHoursConfig = AXION_DEFAULT_BUSINESS_HOURS_CONFIG
): Date {
  switch (unit) {
    case "CLOCK_HOURS":
      return addClockHours(start, value);
    case "CALENDAR_DAYS":
      return addCalendarDays(start, value);
    case "BUSINESS_HOURS":
      return addBusinessHours(start, value, config);
    case "BUSINESS_DAYS":
      return addBusinessDays(start, value, config);
  }
}
