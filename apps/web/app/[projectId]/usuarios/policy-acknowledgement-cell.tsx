"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";

import {
  sendPolicyAcknowledgementRequestAction,
  type PolicyAcknowledgementSendState,
} from "./actions";

export type PolicyAcknowledgementView = {
  id: string;
  status: string;
  firstSentAt: string | null;
  lastSentAt: string | null;
  resendAvailableAt: string | null;
  reminderCount: number;
  approvedAt: string | null;
};

const initialState: PolicyAcknowledgementSendState = {
  error: null,
  success: false,
};

function formatDateTime(value: string | null): string {
  if (!value) return "—";

  return new Date(value).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function PolicyAcknowledgementCell({
  projectId,
  userId,
  acknowledgement,
  termVersion,
  isAdmin,
  isSelf,
}: {
  projectId: string;
  userId: string;
  acknowledgement: PolicyAcknowledgementView | null;
  termVersion: string | null;
  isAdmin: boolean;
  isSelf: boolean;
}) {
  const [state, action, pending] = useActionState(
    sendPolicyAcknowledgementRequestAction,
    initialState
  );

  const approved =
    acknowledgement?.status === "APROVADO";

  const awaiting =
    acknowledgement?.status ===
    "AGUARDANDO_APROVACAO";

  const resendAvailableAt =
    acknowledgement?.resendAvailableAt ?? null;

  const [
    enabledResendAt,
    setEnabledResendAt,
  ] = useState<string | null>(null);

  useEffect(() => {
    if (
      !awaiting ||
      !acknowledgement?.firstSentAt ||
      !resendAvailableAt
    ) {
      return;
    }

    const delay = Math.max(
      0,
      new Date(resendAvailableAt).getTime() -
        Date.now()
    );

    const timer = window.setTimeout(() => {
      setEnabledResendAt(resendAvailableAt);
    }, delay);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    awaiting,
    acknowledgement?.firstSentAt,
    resendAvailableAt,
  ]);

  const firstSendPending =
    !acknowledgement ||
    (awaiting &&
      !acknowledgement.firstSentAt);

  const canResend =
    Boolean(
      awaiting &&
        acknowledgement?.firstSentAt &&
        resendAvailableAt &&
        enabledResendAt === resendAvailableAt
    );

  const statusText = approved
    ? "APROVADO"
    : awaiting
      ? "AGUARDANDO APROVAÇÃO"
      : "NÃO EMITIDO";

  const badgeClass = approved
    ? "border-emerald-300 bg-emerald-50 text-emerald-800"
    : awaiting
      ? "border-amber-300 bg-amber-50 text-amber-800"
      : "border-slate-300 bg-slate-50 text-slate-700";

  const tooltip = [
    `Termo ACC/LGPD — versão ${termVersion ?? "—"}`,
    `Status: ${statusText}`,
    acknowledgement
      ? `Primeiro envio: ${formatDateTime(
          acknowledgement.firstSentAt
        )}`
      : null,
    acknowledgement
      ? `Último envio: ${formatDateTime(
          acknowledgement.lastSentAt
        )}`
      : null,
    acknowledgement
      ? `Reenvios: ${acknowledgement.reminderCount}`
      : null,
    awaiting &&
    acknowledgement?.resendAvailableAt
      ? `Reenvio disponível em: ${formatDateTime(
          acknowledgement.resendAvailableAt
        )}`
      : null,
    approved
      ? `Aprovado em: ${formatDateTime(
          acknowledgement.approvedAt
        )}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const badge = (
    <span
      title={tooltip}
      className={
        "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold " +
        badgeClass
      }
    >
      {statusText}
    </span>
  );

  return (
    <div className="flex min-w-[170px] flex-col items-start gap-1.5">
      {isSelf && acknowledgement ? (
        <Link
          href={`/termo/${acknowledgement.id}`}
          className="hover:underline"
          title="Abrir Termo"
        >
          {badge}
        </Link>
      ) : (
        badge
      )}

      {isAdmin &&
        !approved &&
        (firstSendPending || canResend) && (
          <form action={action}>
            <input
              type="hidden"
              name="projectId"
              value={projectId}
            />
            <input
              type="hidden"
              name="userId"
              value={userId}
            />

            <button
              type="submit"
              disabled={pending}
              className="text-xs font-semibold text-red-800 underline underline-offset-2 disabled:opacity-50"
            >
              {pending
                ? "ENVIANDO..."
                : firstSendPending
                  ? "ENVIAR TERMO"
                  : "REENVIAR SOLICITAÇÃO"}
            </button>
          </form>
        )}

      {isAdmin &&
        awaiting &&
        !canResend &&
        !firstSendPending &&
        acknowledgement?.resendAvailableAt && (
          <span className="text-[11px] text-muted-foreground">
            Reenvio em{" "}
            {formatDateTime(
              acknowledgement.resendAvailableAt
            )}
          </span>
        )}

      {state.error && (
        <span className="max-w-[220px] text-[11px] text-destructive">
          {state.error}
        </span>
      )}

      {state.success && !approved && (
        <span className="text-[11px] text-emerald-700">
          Solicitação enviada.
        </span>
      )}
    </div>
  );
}