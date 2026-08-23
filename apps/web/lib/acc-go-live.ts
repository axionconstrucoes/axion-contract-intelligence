// Marco operacional oficial do ACC (AXION Acompanhamento de Contratos)
// — a data de início operacional do PRODUTO, não de nenhum dado real do
// sistema. Fonte única de verdade: reutilizar esta constante/estas
// funções (Dashboard, relatórios, filtros, Manual, métricas "desde o
// início operacional") em vez de hardcodar a data em vários lugares.
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
