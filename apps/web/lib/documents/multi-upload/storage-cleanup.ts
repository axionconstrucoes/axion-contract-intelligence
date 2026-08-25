// Limpeza de objeto órfão no Storage — extraído para ser testável sem
// um client Supabase real: recebe a função de remoção por parâmetro
// (mesma assinatura de supabase.storage.from(bucket).remove).
//
// Regra dura: só é chamado com o path do objeto RECÉM-ENVIADO desta
// tentativa específica (documentVersionId gerado por tentativa, nunca
// reaproveitado) — nunca com o path de uma versão já registrada. Ver
// use-document-upload-queue.ts: uploadedPath é zerado IMEDIATAMENTE
// após o registro no servidor ter sucesso, antes de qualquer outro
// código que possa lançar, então o catch mais externo nunca tenta
// remover um arquivo que já virou uma versão de verdade.

export type StorageRemoveFn = (
  paths: string[]
) => Promise<{ error: { message: string } | null }>;

export type StorageCleanupResult = {
  removed: boolean;
  reconciliationError: string | null;
};

export function buildReconciliationError(path: string, reason: string): string {
  return `Falha ao limpar o arquivo enviado (${path}): ${reason}. Reconciliação manual necessária — o objeto pode ter ficado órfão no Storage.`;
}

// Nunca lança: falha de limpeza vira reconciliationError explícito,
// nunca é engolida em silêncio (era o bug do "best-effort" anterior,
// que capturava só exceções, não o retorno {error} da própria API).
export async function removeOrphanedStorageObject(
  removeFn: StorageRemoveFn,
  path: string
): Promise<StorageCleanupResult> {
  try {
    const { error } = await removeFn([path]);

    if (error) {
      return {
        removed: false,
        reconciliationError: buildReconciliationError(path, error.message),
      };
    }

    return { removed: true, reconciliationError: null };
  } catch (caughtError) {
    return {
      removed: false,
      reconciliationError: buildReconciliationError(
        path,
        caughtError instanceof Error ? caughtError.message : "erro desconhecido"
      ),
    };
  }
}
