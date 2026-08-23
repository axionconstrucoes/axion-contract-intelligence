// Marco operacional PADRÃO do ACC (AXION Acompanhamento de Contratos) —
// nunca uma regra eterna hardcoded. Desde o pacote de Start-up ACC
// (ver apps/web/lib/startup/), a data efetivamente autoritativa é
// projects.acc_operational_start_date (configurável por projeto,
// default '2026-08-24' — o mesmo valor de ACC_GO_LIVE_DATE abaixo).
// Esta constante continua útil só como fallback/apresentação quando o
// projeto ainda não foi carregado — nunca usar em vez do valor real do
// projeto quando ele já está disponível.
//
// NUNCA usar para alterar/reinterpretar: created_at de registros,
// migrations, trilha de auditoria, datas de documentos, eventos
// históricos ou e-mails históricos — todos esses continuam com suas
// datas reais, sempre. Este marco é só um corte de referência do
// produto, puramente informativo/de filtro.
//
// Ver docs/product-go-live.md.

export const ACC_GO_LIVE_DATE = "2026-08-24" as const;

/** Meia-noite UTC do dia de início operacional, como Date — para comparações/filtros. */
export function getAccGoLiveDate(): Date {
  return new Date(`${ACC_GO_LIVE_DATE}T00:00:00.000Z`);
}

/** true quando `date` é anterior ao início operacional oficial do ACC. */
export function isBeforeAccGoLive(date: Date): boolean {
  return date.getTime() < getAccGoLiveDate().getTime();
}
