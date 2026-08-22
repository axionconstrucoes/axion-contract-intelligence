"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { eventNoteCategoryLabels, type EventNoteCategory } from "@/lib/labels";
import { createEventNoteAction, initialCreateEventNoteState } from "@/app/[projectId]/ledger/[eventId]/event-notes-actions";

const CATEGORY_OPTIONS = Object.keys(eventNoteCategoryLabels) as EventNoteCategory[];

export function EventNoteForm({ projectId, eventId }: { projectId: string; eventId: string }) {
  const [state, formAction, pending] = useActionState(createEventNoteAction, initialCreateEventNoteState);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border border-dashed p-4">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="eventId" value={eventId} />

      <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Categoria
          <Select name="category" defaultValue="CONTEXTO_OPERACIONAL" required>
            {CATEGORY_OPTIONS.map((category) => (
              <option key={category} value={category}>
                {eventNoteCategoryLabels[category]}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Nova anotação
          <Textarea
            name="text"
            required
            rows={3}
            placeholder="Ex.: Não temos um contrato assinado, mas o cliente já está medindo os serviços e pagando regularmente."
          />
        </label>
      </div>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Salvando…" : "Adicionar anotação"}
      </Button>
    </form>
  );
}
