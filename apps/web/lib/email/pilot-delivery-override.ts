// Override de ENTREGA do piloto — puro, sem I/O.
//
// Durante o piloto, TODOS os e-mails de alerta de risco de um projeto
// podem ser entregues exclusivamente em uma caixa institucional do ACC
// (ex.: axion@axion.com.br), configurada POR PROJETO em
// project_weekly_schedule_ingestion_configs.pilot_delivery_override_email.
// O override muda somente o endereço de ENTREGA: o destinatário lógico
// (user_id calculado pela Matriz + allowlist), o responsável, as ações,
// as permissões e a auditoria continuam sendo da pessoa. Nenhum CC/BCC;
// mensagens com o mesmo evento e o mesmo endereço efetivo são
// deduplicadas pelo e-mail normalizado. Sem override => entrega normal.

const EMAIL_PATTERN = /^[a-z0-9][a-z0-9._+-]{0,63}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Endereço normalizado (trim + lowercase) ou null quando ausente/inválido (nunca aceita CR/LF, espaços ou vírgulas). */
export function normalizeDeliveryOverrideEmail(value: string | null | undefined): string | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized || /[\r\n,;<>\s]/.test(normalized)) return null;
  return EMAIL_PATTERN.test(normalized) ? normalized : null;
}

export interface DeliveryResolution {
  /** Endereço efetivamente usado no To (único; nunca CC/BCC). */
  deliveryEmail: string;
  /** E-mail lógico do destinatário calculado (preservado na auditoria). */
  logicalEmail: string;
  overridden: boolean;
  /** Chave de deduplicação por evento × endereço efetivo normalizado. */
  dedupKey: string;
}

export function resolveDeliveryAddress(input: { logicalEmail: string; overrideEmail: string | null | undefined; eventKey: string }): DeliveryResolution {
  const logical = input.logicalEmail.trim().toLowerCase();
  const override = normalizeDeliveryOverrideEmail(input.overrideEmail);
  const deliveryEmail = override ?? logical;
  return { deliveryEmail, logicalEmail: logical, overridden: override !== null && override !== logical, dedupKey: `${input.eventKey}:${deliveryEmail}` };
}
