"use client";

// Painel de sincronização de metadados do Construmanager (Pacote B).
//
// Deliberadamente simples: só o botão e o resumo da última execução.
// A tela de documentos técnicos é de outro pacote — aqui não há lista
// de arquivos, nem download, nem navegação por pasta.

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { initialSyncConstrumanagerMetadataState } from "@/app/[projectId]/integracoes/actions-state";
import { syncConstrumanagerMetadataAction } from "@/app/[projectId]/integracoes/actions";
import { formatDateTime } from "@/lib/labels";
import type { ConstrumanagerMetadataOverview } from "@/lib/integrations/construmanager/get-metadata-overview";

export function ConstrumanagerMetadataSync({
  projectId,
  overview,
}: {
  projectId: string;
  overview: ConstrumanagerMetadataOverview | null;
}) {
  const router = useRouter();

  const [state, formAction, pending] = useActionState(
    syncConstrumanagerMetadataAction,
    initialSyncConstrumanagerMetadataState
  );

  useEffect(() => {
    if (state.syncedAt) {
      router.refresh();
    }
  }, [router, state.syncedAt]);

  // O resultado recém-executado tem prioridade sobre o que veio do
  // banco; sem execução nesta sessão, mostramos a última registrada.
  const lastSyncAt = state.syncedAt ?? overview?.lastSyncAt ?? null;

  const documentsSeen = state.success
    ? state.documentsSeen
    : overview?.documentsSeen ?? null;

  const versionsSeen = state.success
    ? state.historicalVersionsSeen
    : overview?.historicalVersionsSeen ?? null;

  const documentsCreated = state.success
    ? state.documentsCreated
    : overview?.documentsCreated ?? null;

  const versionsCreated = state.success
    ? state.versionsCreated
    : overview?.versionsCreated ?? null;

  const orphaned = state.success
    ? state.versionsOrphaned
    : overview?.versionsOrphaned ?? null;

  const displayedError = state.success
    ? null
    : state.error ?? overview?.lastSyncError ?? null;

  const statusLabel = state.success
    ? orphaned && orphaned > 0
      ? "Concluída com ressalvas"
      : "Concluída"
    : overview?.lastSyncStatus === "SUCESSO"
      ? "Concluída"
      : overview?.lastSyncStatus === "PARCIAL"
        ? "Concluída com ressalvas"
        : overview?.lastSyncStatus === "ERRO"
          ? "Falhou"
          : null;

  return (
    <div className="flex flex-col gap-1.5 rounded-md border bg-background/60 p-2">
      <form action={formAction}>
        <input type="hidden" name="projectId" value={projectId} />

        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Sincronizando…" : "Sincronizar metadados"}
        </Button>
      </form>

      <p className="text-xs">
        {lastSyncAt
          ? `Última sincronização: ${formatDateTime(lastSyncAt)}`
          : "Metadados ainda não sincronizados."}
        {statusLabel ? ` · ${statusLabel}` : null}
      </p>

      {documentsSeen !== null ? (
        <dl className="grid gap-1 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Documentos vigentes:</dt>
            <dd className="text-foreground">{documentsSeen}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Versões históricas:</dt>
            <dd className="text-foreground">{versionsSeen ?? 0}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Novos documentos:</dt>
            <dd className="text-foreground">{documentsCreated ?? 0}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Novas versões:</dt>
            <dd className="text-foreground">{versionsCreated ?? 0}</dd>
          </div>
        </dl>
      ) : null}

      {orphaned && orphaned > 0 ? (
        <p className="text-xs text-muted-foreground">
          {orphaned} versão(ões) histórica(s) sem documento vigente
          correspondente foram ignoradas — nenhum vínculo foi inferido.
        </p>
      ) : null}

      {displayedError ? (
        <p className="text-xs text-destructive">{displayedError}</p>
      ) : null}
    </div>
  );
}
