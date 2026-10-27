import type { AlertSeverity } from "@axion/types";

import {
  forwardConfirmationNotice,
  inProgressConfirmationNotice,
  resolvedConfirmationNotice,
} from "@/lib/alerts/repeat-policy";

// Aviso exibido ANTES da confirmação de uma ação sobre um alerta. Texto vem de uma única fonte
// (repeat-policy.ts), com o intervalo do grau de risco do alerta.
export function alertActionNoticeText(action: string | null | undefined, severity: AlertSeverity): string | null {
  if (action === "EM_ANDAMENTO") return inProgressConfirmationNotice(severity);
  if (action === "ENVIADO_PARA") return forwardConfirmationNotice(severity);
  if (action === "RESOLVIDO") return resolvedConfirmationNotice();
  return null;
}

export function AlertActionNotice({ action, severity }: { action: string | null | undefined; severity: AlertSeverity }) {
  const text = alertActionNoticeText(action, severity);
  if (!text) return null;
  return (
    <p role="note" className="rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs text-sky-900">
      {text}
    </p>
  );
}
