// Marco operacional PADRÃO do ACC (AXION Acompanhamento de Contratos) —
// nunca uma regra eterna hardcoded. Fonte única de verdade do instante
// oficial de startup/go-live/liberação de usuários: 07/09/2026, 09:00,
// America/Sao_Paulo (atualizado nesta rodada a partir de 02/09/2026
// 00:00 UTC; ver docs/product-go-live.md para o histórico completo).
//
// A partir deste instante:
//   - início oficial da operação;
//   - a etiqueta global "SISTEMA EM TESTE" (lib/test-mode.ts) deixa de
//     ser exibida automaticamente e incondicionalmente — ver
//     hasAccGoLiveOccurred() abaixo e o uso em lib/test-mode.ts.
//
// A conversão do horário de parede (09:00, America/Sao_Paulo) para o
// instante UTC usa Intl.DateTimeFormat (ICU, já disponível no runtime)
// — nunca um offset fixo manual (ex.: "-03:00" hardcoded) e nunca o
// timezone local do servidor/processo. Mesma técnica já usada em
// lib/sla/time-units.ts (duplicada aqui deliberadamente para manter
// este módulo "puro, sem I/O" e sem depender do domínio de SLA).
//
// project.acc_operational_start_date (migration já aplicada, ver
// supabase/migrations/20260823090000_startup_historical_review.sql) é
// um campo DIFERENTE e configurável POR PROJETO (cada obra escolhe sua
// própria data de início operacional prospectivo no Start-up) — o
// default '2026-08-24' gravado naquela migration é só o valor inicial
// de um campo de negócio por contrato, nunca o marco global do
// PRODUTO ACC descrito aqui, e a migration já aplicada nunca é alterada
// retroativamente por causa deste marco.
//
// NUNCA usar para alterar/reinterpretar: created_at de registros,
// migrations, trilha de auditoria, datas de documentos, eventos
// históricos ou e-mails históricos — todos esses continuam com suas
// datas reais, sempre. Este marco é só um corte de referência do
// produto, puramente informativo/de filtro.
//
// Ver docs/product-go-live.md.

export const ACC_GO_LIVE_DATE = "2026-09-07" as const;
export const ACC_GO_LIVE_TIME = "09:00:00" as const;
export const ACC_GO_LIVE_TIMEZONE = "America/Sao_Paulo" as const;

/** Offset (minutos) tal que horário-local = horário-UTC + offset, no instante `date`, na timezone informada. */
function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, number> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = Number(part.value);
  }
  const asUtcIfLocalWereUtc = Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute, map.second);
  return (asUtcIfLocalWereUtc - date.getTime()) / 60_000;
}

/**
 * Converte um horário "de parede" (ano/mês/dia/hora/min/seg, na timezone
 * informada) para o instante UTC correspondente — corrige transição de
 * DST com uma segunda iteração (o mesmo horário de parede pode
 * corresponder a offsets diferentes dependendo de qual lado da transição
 * o primeiro palpite cai). America/Sao_Paulo não observa DST desde 2019,
 * mas o cálculo nunca presume isso — sempre pergunta ao ICU.
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

/** Instante UTC exato do marco de startup/go-live (07/09/2026 09:00, America/Sao_Paulo), como Date. */
export function getAccGoLiveDate(): Date {
  return zonedWallTimeToUtc(2026, 9, 7, 9, 0, 0, ACC_GO_LIVE_TIMEZONE);
}

/** true quando `date` é anterior ao início operacional oficial do ACC. */
export function isBeforeAccGoLive(date: Date): boolean {
  return date.getTime() < getAccGoLiveDate().getTime();
}

/** true quando o marco de startup/go-live já ocorreu (instante `date` é igual ou posterior). */
export function hasAccGoLiveOccurred(date: Date = new Date()): boolean {
  return !isBeforeAccGoLive(date);
}
