// Marco operacional PADRÃO do ACC (AXION Acompanhamento de Contratos) —
// nunca uma regra eterna hardcoded. Fonte única de verdade da data
// oficial de startup/go-live/assembleia geral/liberação de usuários
// (quarta-feira, 02/09/2026, America/Sao_Paulo — atualizado nesta
// rodada a partir de 24/08/2026; ver docs/product-go-live.md para o
// histórico). O ambiente de teste/validação segue até o fim de
// 01/09/2026; a remoção da etiqueta "SISTEMA EM TESTE" continua sendo
// SEMPRE manual (ver lib/test-mode.ts — deliberadamente sem
// desligamento automático por data/relógio), nunca amarrada
// automaticamente a este marco.
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
// Esta constante continua útil só como fallback/apresentação — nunca
// usar em vez do valor real de acc_operational_start_date do projeto
// quando ele já está disponível.
//
// NUNCA usar para alterar/reinterpretar: created_at de registros,
// migrations, trilha de auditoria, datas de documentos, eventos
// históricos ou e-mails históricos — todos esses continuam com suas
// datas reais, sempre. Este marco é só um corte de referência do
// produto, puramente informativo/de filtro.
//
// Ver docs/product-go-live.md.

export const ACC_GO_LIVE_DATE = "2026-09-02" as const;

/** Meia-noite UTC do dia de início operacional, como Date — para comparações/filtros. */
export function getAccGoLiveDate(): Date {
  return new Date(`${ACC_GO_LIVE_DATE}T00:00:00.000Z`);
}

/** true quando `date` é anterior ao início operacional oficial do ACC. */
export function isBeforeAccGoLive(date: Date): boolean {
  return date.getTime() < getAccGoLiveDate().getTime();
}
