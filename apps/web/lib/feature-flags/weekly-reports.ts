// Feature flag ACC_WEEKLY_REPORTS_ENABLED — trava de deployment das
// funcionalidades novas de relatório semanal (registro documental por
// e-mail, ingestão do cronograma MPP, planilha Excel/Curva S, dashboard
// Financeiro, telas de revisão/linha de base e o workflow horário).
//
// Motivo: essas funcionalidades dependem da migration
// 20260920120000_weekly_schedule_email_ingestion_foundation. Enquanto ela
// não for aplicada no banco remoto, NENHUMA consulta às tabelas/funções
// novas pode acontecer — nem por página, nem por action, nem por worker.
//
// Regra fail-closed (mesmo padrão de ACC_OUTBOUND_MODE): só o valor EXATO
// "true" habilita. Ausente, vazio, "false", "1", "TRUE" ou qualquer outro
// valor mantém tudo desligado. Server-only por natureza (nunca
// NEXT_PUBLIC_*); este módulo é puro para poder ser importado por páginas,
// actions, loaders e scripts/testes sem `server-only`.
//
// Com a flag desligada as páginas antigas continuam funcionando
// normalmente: nada aqui altera Documentos, Cronograma, Experts, etc.

export const WEEKLY_REPORTS_FLAG_NAME = "ACC_WEEKLY_REPORTS_ENABLED";

export function isWeeklyReportsEnabled(rawValue: string | undefined = process.env[WEEKLY_REPORTS_FLAG_NAME]): boolean {
  return rawValue === "true";
}

export const WEEKLY_REPORTS_DISABLED_MESSAGE =
  "Funcionalidade de relatórios semanais desativada neste ambiente (ACC_WEEKLY_REPORTS_ENABLED).";

/** Para actions/loaders: lança se a flag estiver desligada. */
export function assertWeeklyReportsEnabled(rawValue?: string | undefined): void {
  if (!isWeeklyReportsEnabled(rawValue)) throw new Error(WEEKLY_REPORTS_DISABLED_MESSAGE);
}
