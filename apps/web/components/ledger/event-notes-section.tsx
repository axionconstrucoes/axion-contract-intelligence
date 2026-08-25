import { NotebookPen } from "lucide-react";
import { EventNoteForm } from "@/components/ledger/event-note-form";
import { getEventNotes } from "@/lib/event-notes";
import { eventNoteCategoryLabels, formatDateTime } from "@/lib/labels";

// Anotações do Evento: informação declarada internamente por um usuário —
// nunca evidência, documento, e-mail ou cláusula. Visual propositalmente
// distinto (âmbar/pontilhado) do restante da página, com aviso explícito
// de que é conteúdo declarado, não confirmado documentalmente.
export async function EventNotesSection({
  projectId,
  eventId,
  canReview,
}: {
  projectId: string;
  eventId: string;
  canReview: boolean;
}) {
  const notes = await getEventNotes(eventId);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="flex items-center gap-2">
        <NotebookPen className="size-4 text-amber-600 dark:text-amber-400" />
        <h2 className="text-sm font-semibold">Anotações do Evento</h2>
      </div>

      <p className="text-xs text-muted-foreground">
        Informação declarada internamente — não é evidência, documento, e-mail ou cláusula, e não foi
        confirmada documentalmente.
      </p>

      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma anotação registrada para este evento.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notes.map((note) => (
            <li key={note.id} className="rounded-md border border-amber-500/20 bg-card p-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded border border-amber-500/40 px-1.5 py-0.5 font-medium text-amber-700 dark:text-amber-400">
                  {eventNoteCategoryLabels[note.category]}
                </span>
                <span>{note.authorName}</span>
                <span>·</span>
                <span>{formatDateTime(note.createdAt)}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap">{note.text}</p>
            </li>
          ))}
        </ul>
      )}

      {canReview ? (
        <EventNoteForm projectId={projectId} eventId={eventId} />
      ) : (
        <p className="rounded-md border bg-muted p-3 text-xs text-muted-foreground">
          Você possui acesso de leitura. Adicionar anotação exige permissão EDITOR ou ADMIN.
        </p>
      )}
    </div>
  );
}
