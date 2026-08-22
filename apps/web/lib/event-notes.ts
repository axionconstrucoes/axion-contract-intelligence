import "server-only";

import { createSupabaseServerClient } from "@axion/db/server";

export type EventNoteCategory =
  | "CONTEXTO_OPERACIONAL"
  | "INFORMACAO_COMERCIAL"
  | "OBSERVACAO_JURIDICA"
  | "PLANEJAMENTO"
  | "FINANCEIRO"
  | "OUTROS";

export type EventNote = {
  id: string;
  eventId: string;
  category: EventNoteCategory;
  text: string;
  authorUserId: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
};

type EventNoteRow = {
  id: string;
  event_id: string;
  category: EventNoteCategory;
  text: string;
  author_user_id: string;
  created_at: string;
  updated_at: string;
};

type ProfileRow = {
  id: string;
  name: string;
};

// "Anotações do Evento": informação declarada internamente por um
// usuário — nunca evidência/documento/e-mail/cláusula. Ver
// docs/ai/experts.md (Declared context x evidence).
export async function getEventNotes(eventId: string): Promise<EventNote[]> {
  const supabase = await createSupabaseServerClient();

  const { data: noteData, error: noteError } = await supabase
    .from("event_notes")
    .select("id,event_id,category,text,author_user_id,created_at,updated_at")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false });

  if (noteError) {
    if (noteError.code === "22P02") {
      return [];
    }
    throw new Error(`Falha ao carregar anotações do evento: ${noteError.message}`);
  }

  const notes = noteData as unknown as EventNoteRow[];
  if (notes.length === 0) {
    return [];
  }

  const authorIds = Array.from(new Set(notes.map((n) => n.author_user_id)));

  const { data: profileData, error: profileError } = await supabase
    .from("profiles")
    .select("id,name")
    .in("id", authorIds);

  if (profileError) {
    throw new Error(`Falha ao carregar autores das anotações: ${profileError.message}`);
  }

  const authorNameById = new Map((profileData as unknown as ProfileRow[]).map((p) => [p.id, p.name]));

  return notes.map((note) => ({
    id: note.id,
    eventId: note.event_id,
    category: note.category,
    text: note.text,
    authorUserId: note.author_user_id,
    authorName: authorNameById.get(note.author_user_id) ?? "Usuário não disponível",
    createdAt: note.created_at,
    updatedAt: note.updated_at,
  }));
}
