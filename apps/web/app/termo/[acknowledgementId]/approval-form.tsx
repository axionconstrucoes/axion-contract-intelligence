"use client";

import {
  useActionState,
  useState,
} from "react";

import {
  approvePolicyAcknowledgementAction,
  type PolicyApprovalState,
} from "./actions";

const initialState: PolicyApprovalState = {
  error: null,
  success: false,
  approvedAt: null,
};

export function PolicyApprovalForm({
  acknowledgementId,
  alreadyApproved,
}: {
  acknowledgementId: string;
  alreadyApproved: boolean;
}) {
  const [accepted, setAccepted] =
    useState(false);

  const [
    state,
    action,
    pending,
  ] = useActionState(
    approvePolicyAcknowledgementAction,
    initialState
  );

  if (alreadyApproved || state.success) {
    return (
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-5 text-emerald-900">
        <p className="font-semibold">
          Termo aprovado e ciência registrada.
        </p>

        {state.approvedAt && (
          <p className="mt-1 text-sm">
            Registro:{" "}
            {new Date(
              state.approvedAt
            ).toLocaleString("pt-BR")}
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      action={action}
      className="space-y-5 rounded-lg border bg-white p-5"
    >
      <input
        type="hidden"
        name="acknowledgementId"
        value={acknowledgementId}
      />

      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          name="accepted"
          checked={accepted}
          onChange={(event) =>
            setAccepted(event.target.checked)
          }
          className="mt-1 size-4"
        />

        <span className="text-sm leading-6">
          Declaro que li integralmente o Termo
          acima e estou ciente das condições de
          utilização do ACC e do tratamento de
          informações corporativas nele descritas.
        </span>
      </label>

      {state.error && (
        <p className="text-sm font-medium text-red-700">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={!accepted || pending}
        className="w-full rounded-md bg-red-800 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending
          ? "REGISTRANDO..."
          : "APROVAR E REGISTRAR CIÊNCIA"}
      </button>
    </form>
  );
}