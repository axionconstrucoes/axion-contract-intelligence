// Identificação visual de campos pré-preenchidos pelo sistema —
// reutilizável por qualquer formulário do ACC que carregue configuração
// já salva (não só Integrações → Gmail/E-mails). Verde aqui significa
// SOMENTE "dado já preenchido/salvo" — nunca "validado"/"aprovado"/
// "sem risco". Nunca verde sólido forte (mesmo tom já usado em
// apps/web/app/[projectId]/documentos/page.tsx para cards de
// CONTRATO_BASE/ADITIVO: border-green-500/50 + bg-green-50 +
// dark:bg-green-950/30).

export const PREFILLED_FIELD_CLASSNAME =
  "border-green-400 bg-green-50 text-foreground dark:border-green-700 dark:bg-green-950/30";

export const PREFILLED_FIELD_TITLE = "Valor carregado do sistema (já salvo).";

export function resolvePrefilledFieldProps(isPrefilled: boolean): { className: string; title?: string } {
  return isPrefilled ? { className: PREFILLED_FIELD_CLASSNAME, title: PREFILLED_FIELD_TITLE } : { className: "" };
}

/**
 * Um campo escalar (texto/select/data) é "pré-preenchido" quando o
 * valor atual é igual ao valor salvo E o valor salvo não é vazio —
 * campo vazio nunca é verde, mesmo que "savedValue" também seja vazio
 * (nesse caso não há nada salvo para comparar).
 */
export function isFieldPrefilled(currentValue: string, savedValue: string | null | undefined): boolean {
  return Boolean(savedValue) && currentValue === savedValue;
}
