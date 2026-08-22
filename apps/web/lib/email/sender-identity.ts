// Puro, sem I/O/secrets — deliberadamente sem "server-only" para poder
// ser testado tanto pelo bundler do Next.js quanto por um script Node
// standalone (mesmo padrão de apps/web/lib/timeline-export/**).
//
// Identidade institucional visível do remetente ACC — separada de QUAL
// mailbox realmente autentica/envia (isso continua vindo de
// GOOGLE_GMAIL_SENDER_EMAIL via gmail-auth.ts). Trocar o nome de exibição
// nunca troca nem quebra o remetente atualmente funcional.
export const ACC_SENDER_DISPLAY_NAME = "ACC AXION CONTROLE DE CONTRATOS";

// Endereço institucional-alvo, ainda não autorizado no Google Workspace
// nesta fase — ver docs/email-branding.md para a configuração exata
// necessária antes de trocar GOOGLE_GMAIL_SENDER_EMAIL para este valor.
// NUNCA usado para autenticar/enviar enquanto não estiver configurado —
// só para comparação/diagnóstico.
export const ACC_INSTITUTIONAL_TARGET_EMAIL = "acc_ia@axion.com.br";

// Formata o header MIME "From" com nome de exibição — nunca altera o
// endereço que efetivamente envia (isso é responsabilidade exclusiva de
// GmailConfig.senderEmail). O address-spec RFC 5322 não permite aspas
// duplas cruas dentro do display-name; escapamos por segurança mesmo que
// a constante acima nunca as contenha.
export function formatSenderHeader(senderEmail: string): string {
  const escapedDisplayName = ACC_SENDER_DISPLAY_NAME.replace(/"/g, '\\"');
  return `"${escapedDisplayName}" <${senderEmail}>`;
}

// true somente quando o remetente institucional-alvo já está configurado
// como a mailbox real de envio — nunca assumido, sempre verificado.
export function isInstitutionalSenderConfigured(senderEmail: string): boolean {
  return senderEmail.trim().toLowerCase() === ACC_INSTITUTIONAL_TARGET_EMAIL.toLowerCase();
}
