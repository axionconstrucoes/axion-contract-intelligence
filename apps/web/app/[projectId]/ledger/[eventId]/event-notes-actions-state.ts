// Tipo e estado inicial do Server Action de Anotações do Evento
// (./event-notes-actions.ts) — deliberadamente FORA do módulo
// "use server". Ver
// apps/web/app/[projectId]/acoes/actions-state.ts para a explicação
// completa do porquê.

export type CreateEventNoteState = {
  error: string | null;
};

export const initialCreateEventNoteState: CreateEventNoteState = { error: null };
