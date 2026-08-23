"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@axion/db/server";
import type { CreateEventNoteState } from "./event-notes-actions-state";

// Este módulo é "use server" — só pode exportar funções async (Server
// Actions). Tipo e estado inicial vivem em ./event-notes-actions-state.ts.

const VALID_CATEGORIES = [
  "CONTEXTO_OPERACIONAL",
  "INFORMACAO_COMERCIAL",
  "OBSERVACAO_JURIDICA",
  "PLANEJAMENTO",
  "FINANCEIRO",
  "OUTROS",
];

function optionalField(formData: FormData, name: string): string | null {
  const value = String(formData.get(name) ?? "").trim();
  return value || null;
}

// Nenhuma lógica de permissão/autoria é duplicada aqui: a policy RLS
// "event_notes_insert_editor_self_authored" (EDITOR/ADMIN no projeto do
// evento + author_user_id = auth.uid()) é a única autoridade. Esta action
// só encaminha o INSERT e traduz o erro em estado exibível na UI.
export async function createEventNoteAction(
  _prevState: CreateEventNoteState,
  formData: FormData
): Promise<CreateEventNoteState> {
  const projectId = optionalField(formData, "projectId");
  const eventId = optionalField(formData, "eventId");
  const category = optionalField(formData, "category");
  const text = optionalField(formData, "text");

  if (!projectId || !eventId) {
    return { error: "Dados do evento ausentes. Recarregue a página e tente novamente." };
  }

  if (!category || !VALID_CATEGORIES.includes(category)) {
    return { error: "Selecione uma categoria válida." };
  }

  if (!text) {
    return { error: "Informe o texto da anotação." };
  }

  const supabase = await createSupabaseServerClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return { error: "Sessão expirada. Faça login novamente." };
  }

  const { error } = await supabase.from("event_notes").insert({
    event_id: eventId,
    author_user_id: authData.user.id,
    category,
    text,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/${projectId}/ledger/${eventId}`);
  revalidatePath(`/${projectId}/auditoria`);

  return { error: null };
}
