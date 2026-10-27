// Agrupamento dos alertas em e-mails: UM e-mail por OBRA e por DESTINATÁRIO. Um lote pode reunir
// vários alertas da mesma obra, mas nunca mistura obras (nem destinatários). Puro e testável; é a
// mesma chave usada pelo produtor de lotes (email/run-contract-alert-batches.ts).

export function projectRecipientKey(projectId: string, recipientId: string): string {
  return `${projectId}:${recipientId}`;
}

export interface BatchGroupEntry<T> {
  projectId: string;
  recipientId: string;
  item: T;
}

export interface BatchGroup<T> {
  projectId: string;
  recipientId: string;
  items: BatchGroupEntry<T>[];
}

export function groupByProjectAndRecipient<T>(entries: readonly BatchGroupEntry<T>[]): BatchGroup<T>[] {
  const groups = new Map<string, BatchGroup<T>>();
  for (const entry of entries) {
    const key = projectRecipientKey(entry.projectId, entry.recipientId);
    const group = groups.get(key) ?? { projectId: entry.projectId, recipientId: entry.recipientId, items: [] };
    group.items.push(entry);
    groups.set(key, group);
  }
  return Array.from(groups.values());
}
