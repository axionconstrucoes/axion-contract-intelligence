"use server";

import { revalidatePath } from "next/cache";

import { confirmEmailAlertAction, EmailActionConfirmError } from "@/lib/email-actions/confirm-action";
import type { ConfirmEmailActionState } from "./confirm-action-state";

// POST-only por construção (Server Action, nunca um handler GET) — ver
// requisito "nenhuma ação pode ocorrer por GET". O token vem sempre do
// segmento de rota (bind na página), nunca de um campo de formulário —
// impede que alguém troque o token só editando o HTML no navegador.
export async function confirmEmailAlertActionAction(
  rawToken: string,
  _prevState: ConfirmEmailActionState,
  formData: FormData
): Promise<ConfirmEmailActionState> {
  const comment = String(formData.get("comment") ?? "").trim() || null;
  const newDueAtRaw = String(formData.get("newDueAt") ?? "").trim();
  let newDueAt: string | null = null;

  if (newDueAtRaw) {
    const parsed = new Date(newDueAtRaw);
    if (Number.isNaN(parsed.getTime())) {
      return { error: "Data/hora inválida.", success: false };
    }
    newDueAt = parsed.toISOString();
  }

  try {
    await confirmEmailAlertAction({ rawToken, comment, newDueAt });
  } catch (error) {
    if (error instanceof EmailActionConfirmError) {
      return { error: error.message, success: false };
    }
    throw error;
  }

  revalidatePath(`/email-actions/${rawToken}`);
  return { error: null, success: true };
}
