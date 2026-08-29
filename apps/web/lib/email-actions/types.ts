// Tipos compartilhados do e-mail acionável (MVP). "Alerta" é polimórfico
// de propósito — os três fluxos existentes (alerta de contrato,
// escalonamento SLA, solicitação de ação) apontam para entidades
// diferentes (contract_events/sla_actions/action_requests), nunca uma FK
// tipada só (mesmo espírito de audit_log_entries.entity_type/entity_id).

export type EmailAlertKind = "CONTRACT_EVENT" | "SLA_ACTION" | "ACTION_REQUEST";

export type EmailAlertActionType =
  | "ACKNOWLEDGE"
  | "ASSUME_RESPONSIBILITY"
  | "SET_DEADLINE"
  | "RESPOND";

export const EMAIL_ALERT_ACTION_TYPES: readonly EmailAlertActionType[] = [
  "ACKNOWLEDGE",
  "ASSUME_RESPONSIBILITY",
  "SET_DEADLINE",
  "RESPOND",
];

// Rótulo exibido nos botões do e-mail e na tela de confirmação — nunca
// duplicado em cada template (ver render-buttons.ts).
export const EMAIL_ALERT_ACTION_LABELS: Record<EmailAlertActionType, string> = {
  ACKNOWLEDGE: "DAR CIÊNCIA",
  ASSUME_RESPONSIBILITY: "ASSUMIR RESPONSABILIDADE",
  SET_DEADLINE: "DEFINIR PRAZO",
  RESPOND: "RESPONDER AO ACC",
};

// Explicação curta de cada botão, usada em title/aria-label e como legenda
// sempre visível sob o rótulo no HTML do e-mail — Gmail/Outlook não
// garantem suporte uniforme a tooltip/hover, então a explicação nunca pode
// depender só do hover para ser lida (ver render-buttons.ts).
export const EMAIL_ALERT_ACTION_DESCRIPTIONS: Record<EmailAlertActionType, string> = {
  ACKNOWLEDGE: "Confirma que você tomou conhecimento deste alerta.",
  ASSUME_RESPONSIBILITY: "Assume a responsabilidade por tratar este item.",
  SET_DEADLINE: "Define ou ajusta o prazo de resposta para este item.",
  RESPOND: "Abre o campo para registrar sua resposta diretamente no ACC.",
};

export const EMAIL_ALERT_KIND_LABELS: Record<EmailAlertKind, string> = {
  CONTRACT_EVENT: "Alerta de contrato",
  SLA_ACTION: "Ação de SLA",
  ACTION_REQUEST: "Solicitação de ação",
};

export interface IssuedEmailAlertActionToken {
  action: EmailAlertActionType;
  token: string;
  expiresAt: string;
}
