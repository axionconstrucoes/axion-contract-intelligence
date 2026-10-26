// Aviso de MODO PILOTO para a interface de envio manual — decidido pela MESMA
// fonte do envio real (pilot-outbound-guard.ts); nunca lê ACC_OUTBOUND_MODE por
// conta própria. Sem I/O além de ler variáveis de ambiente (via o guard).

import { EmailSendError } from "./email-provider";
import { resolveEffectiveRecipient, resolveOutboundMode } from "./pilot-outbound-guard";
import { pilotNoticeBeforeSend } from "./send-outcome";

/** Texto do aviso quando o envio manual será redirecionado; null em produção. */
export function getPilotSendNotice(): string | null {
  if (resolveOutboundMode() !== "PILOT") return null;
  try {
    const resolved = resolveEffectiveRecipient("destinatario@exemplo.invalid");
    return pilotNoticeBeforeSend(resolved.effectiveRecipientEmail);
  } catch (error) {
    if (error instanceof EmailSendError) return "Modo piloto mal configurado — o envio será bloqueado.";
    throw error;
  }
}
