// Seleção dos alvos de download de conteúdo.
//
// Extraída da Server Action por um motivo concreto: um módulo
// "use server" só pode exportar funções async, então a regra "linkId
// presente => baixa SOMENTE aquele alvo" não teria como ser exercida
// por teste ali dentro. Aqui ela vira uma função pura sobre o
// construtor de consulta, verificável de verdade em vez de auditada
// por expressão regular.
//
// A regra é de segurança operacional, não de estilo: um piloto
// controlado que baixasse "o documento errado" produziria um SHA-256
// atribuído ao alvo errado.

/**
 * Subconjunto do construtor do supabase-js que esta seleção usa.
 * Genérico para que o teste possa passar um dublê que registra as
 * chamadas.
 */
export interface ContentTargetQuery<T> {
  eq(column: string, value: unknown): T;
  in(column: string, values: readonly unknown[]): T;
  order(column: string, options: { ascending: boolean }): T;
  limit(count: number): T;
}

/** Status que ainda admitem uma tentativa de download. */
export const RETRYABLE_DOWNLOAD_STATUSES = ["PENDENTE", "ERRO"] as const;

export function applyContentTargetSelection<
  T extends ContentTargetQuery<T>,
>(
  query: T,
  options: { linkId: string | null; batchSize: number }
): T {
  // Alvo explícito: uma igualdade por id e nada mais. Sem filtro de
  // status (uma nova tentativa manual sobre alvo já armazenado é
  // idempotente), sem ordenação e — o ponto crítico — SEM limit, que
  // aqui só poderia acrescentar outros alvos à execução.
  if (options.linkId) {
    return query.eq("id", options.linkId);
  }

  return query
    .in("download_status", [...RETRYABLE_DOWNLOAD_STATUSES])
    .order("created_at", { ascending: true })
    .limit(options.batchSize);
}
