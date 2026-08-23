// Estado dirty/saved do formulário de configuração de ingestão — função
// pura, sem I/O. Decide se o botão [Salvar configuração] deve aparecer
// (seção "ESTADO DO BOTÃO SALVAR CONFIGURAÇÃO"): oculto quando o valor
// atual da tela é idêntico ao valor salvo E existe uma configuração
// persistida; visível quando há qualquer diferença, ou quando ainda não
// existe nenhuma configuração salva para este projeto.

export interface EmailIngestionConfigFormValues {
  emailAccountId: string;
  windowMode: string;
  customStartAt: string;
  customEndAt: string;
  includeAttachments: boolean;
  domains: { domain: string; domainRole: string; enabled: boolean }[];
  participants: { emailAddress: string; roleNote: string; enabled: boolean }[];
}

export function isEmailIngestionConfigDirty(
  current: EmailIngestionConfigFormValues,
  saved: EmailIngestionConfigFormValues,
  hasSavedConfig: boolean
): boolean {
  if (!hasSavedConfig) return true;

  if (current.emailAccountId !== saved.emailAccountId) return true;
  if (current.windowMode !== saved.windowMode) return true;
  if (current.windowMode === "CUSTOM" && (current.customStartAt !== saved.customStartAt || current.customEndAt !== saved.customEndAt)) {
    return true;
  }
  if (current.includeAttachments !== saved.includeAttachments) return true;
  if (JSON.stringify(current.domains) !== JSON.stringify(saved.domains)) return true;
  if (JSON.stringify(current.participants) !== JSON.stringify(saved.participants)) return true;

  return false;
}
