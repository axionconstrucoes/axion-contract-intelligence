// Puro, sem I/O — descreve, para a interface, o RESULTADO REAL de um envio
// manual de alerta: modo de saída, destinatário escolhido (pretendido) e
// destino efetivo decidido pelo guard do piloto
// (pilot-outbound-guard.ts: resolveEffectiveRecipient).
//
// Regras de honestidade:
//  - em modo piloto o destino efetivo NÃO é o colaborador escolhido — a
//    mensagem diz isso explicitamente e nunca confirma "enviado para <pessoa>";
//  - o provedor só ACEITA a mensagem; aceite não é confirmação de entrega, e o
//    texto nunca afirma entrega;
//  - endereços aparecem parcialmente ocultos.

export type OutboundMode = "PILOT" | "PRODUCTION";

export function maskEmailAddress(email: string): string {
  const [local = "", domain = ""] = email.trim().split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}***@${domain}`;
}

export interface AlertSendOutcomeInput {
  mode: OutboundMode;
  intendedRecipientEmail: string;
  effectiveRecipientEmail: string;
}

export interface AlertSendOutcome {
  mode: OutboundMode;
  redirected: boolean;
  /** Texto para a tela, baseado no resultado real devolvido pelo servidor. */
  message: string;
}

export function describeAlertSendOutcome(input: AlertSendOutcomeInput): AlertSendOutcome {
  const intended = maskEmailAddress(input.intendedRecipientEmail);
  const effective = maskEmailAddress(input.effectiveRecipientEmail);
  const redirected =
    input.mode === "PILOT" &&
    input.intendedRecipientEmail.trim().toLowerCase() !== input.effectiveRecipientEmail.trim().toLowerCase();

  if (input.mode === "PILOT") {
    return {
      mode: input.mode,
      redirected,
      message: redirected
        ? `MODO PILOTO: o provedor aceitou a mensagem, mas ela foi redirecionada para a caixa de teste (${effective}). ` +
          `O colaborador selecionado (${intended}) NÃO recebeu este e-mail. Aceite do provedor não é confirmação de entrega.`
        : `MODO PILOTO: o provedor aceitou a mensagem para ${effective} (caixa de teste). Aceite do provedor não é confirmação de entrega.`,
    };
  }

  return {
    mode: input.mode,
    redirected: false,
    message: `O provedor aceitou a mensagem para ${effective}. Aceite do provedor não é confirmação de entrega.`,
  };
}

/** Aviso exibido ANTES do envio quando o ambiente está em modo piloto. */
export function pilotNoticeBeforeSend(effectiveRecipientEmail: string): string {
  return (
    `Modo piloto ativo: qualquer envio manual é redirecionado para a caixa de teste (${maskEmailAddress(effectiveRecipientEmail)}) ` +
    `— o colaborador selecionado não receberá a mensagem.`
  );
}
