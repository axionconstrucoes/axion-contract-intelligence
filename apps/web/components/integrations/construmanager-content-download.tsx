"use client";

// Painel de download de conteúdo do Construmanager (Pacote C).
//
// Deliberadamente pequeno: um botão de lote, um resumo e uma lista
// curta dos últimos alvos. Nenhuma navegação por pasta, nenhum
// visualizador, nenhum link de download para o navegador — o bucket é
// privado e o conteúdo não trafega para o cliente neste pacote.
//
// O SHA-256 aparece abreviado (12 caracteres) apenas para conferência
// visual. Nada aqui compara revisões nem classifica mudança: isso é
// Pacote D.

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { initialDownloadConstrumanagerContentState } from "@/app/[projectId]/integracoes/actions-state";
import { downloadConstrumanagerContentAction } from "@/app/[projectId]/integracoes/actions";
import { formatDateTime } from "@/lib/labels";
import type { ConstrumanagerContentOverview } from "@/lib/integrations/construmanager/get-content-overview";

const STATUS_LABEL: Record<string, string> = {
  PENDENTE: "Pendente",
  BAIXANDO: "Baixando",
  ARMAZENADO: "Armazenado",
  ERRO: "Erro",
};

function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

export function ConstrumanagerContentDownload({
  projectId,
  overview,
}: {
  projectId: string;
  overview: ConstrumanagerContentOverview | null;
}) {
  const router = useRouter();

  const [state, formAction, pending] = useActionState(
    downloadConstrumanagerContentAction,
    initialDownloadConstrumanagerContentState
  );

  useEffect(() => {
    if (state.finishedAt) {
      router.refresh();
    }
  }, [router, state.finishedAt]);

  const total = overview?.total ?? 0;
  const pendingCount = overview?.pending ?? 0;
  const stored = overview?.stored ?? 0;
  const failed = overview?.failed ?? 0;
  const downloading = overview?.downloading ?? 0;
  const distinctBlobs = overview?.distinctBlobs ?? 0;

  const displayedError = state.error ?? null;

  return (
    <div className="flex flex-col gap-1.5 rounded-md border bg-background/60 p-2">
      <form action={formAction} className="flex items-center gap-2">
        <input type="hidden" name="projectId" value={projectId} />
        {/* Lote pequeno por padrão. O teto real é aplicado no servidor
            (CONTENT_DOWNLOAD_MAX_BATCH), não aqui. */}
        <input type="hidden" name="batchSize" value="2" />

        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Baixando…" : "Baixar conteúdos pendentes"}
        </Button>
      </form>

      <p className="text-xs">
        {total === 0
          ? "Conteúdo ainda não preparado. Sincronize os metadados primeiro."
          : `${stored} de ${total} armazenados · ${pendingCount} pendentes`}
        {downloading > 0 ? ` · ${downloading} baixando` : null}
        {failed > 0 ? ` · ${failed} com erro` : null}
      </p>

      {stored > 0 ? (
        <p className="text-xs text-muted-foreground">
          {distinctBlobs} conteúdo(s) físico(s) distinto(s) ·{" "}
          {formatBytes(overview?.storedBytes ?? 0)} em disco
          {stored > distinctBlobs
            ? ` · ${stored - distinctBlobs} deduplicado(s)`
            : null}
        </p>
      ) : null}

      {state.success && state.attempted !== null ? (
        <p className="text-xs text-muted-foreground">
          Última execução: {state.attempted} tentativa(s) ·{" "}
          {state.stored ?? 0} armazenado(s) · {state.failed ?? 0} erro(s) ·{" "}
          {state.blobsCreated ?? 0} novo(s) · {state.blobsReused ?? 0}{" "}
          reaproveitado(s)
          {state.finishedAt ? ` · ${formatDateTime(state.finishedAt)}` : null}
        </p>
      ) : null}

      {overview && overview.recent.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-xs">
          {overview.recent.slice(0, 6).map((item) => (
            <li
              key={item.linkId}
              className="flex flex-wrap items-baseline gap-x-2"
            >
              <span className="text-foreground">{item.sourceName}</span>
              <span className="text-muted-foreground">
                {item.target === "VERSAO" ? "versão" : "documento"}
              </span>
              <span className="text-muted-foreground">
                {STATUS_LABEL[item.status] ?? item.status}
              </span>
              {item.sizeBytes !== null ? (
                <span className="text-muted-foreground">
                  {formatBytes(item.sizeBytes)}
                </span>
              ) : null}
              {item.sha256Short ? (
                <span className="font-mono text-muted-foreground">
                  {item.sha256Short}…
                </span>
              ) : null}
              {item.downloadedAt ? (
                <span className="text-muted-foreground">
                  {formatDateTime(item.downloadedAt)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {state.firstError ? (
        <p className="text-xs text-destructive">{state.firstError}</p>
      ) : null}

      {displayedError ? (
        <p className="text-xs text-destructive">{displayedError}</p>
      ) : null}
    </div>
  );
}
