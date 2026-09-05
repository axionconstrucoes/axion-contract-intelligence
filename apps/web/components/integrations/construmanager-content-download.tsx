"use client";

// Painel de download de conteúdo do Construmanager (Pacote C).
//
// Deliberadamente pequeno: um botão por item, um resumo e um filtro por
// nome. Nenhuma navegação por pasta, nenhum visualizador, nenhum link de
// download para o navegador — o bucket é privado e o conteúdo não
// trafega para o cliente neste pacote.
//
// Duas operações distintas, dois gatilhos distintos:
//
//   PREPARAR  cria os vínculos (documento/versão -> alvo de download) a
//             partir dos metadados já sincronizados. Não baixa nada.
//   BAIXAR    transfere o conteúdo de UM alvo escolhido a dedo.
//
// Elas ficaram acopladas por um tempo — só a ação de download chamava o
// RPC de preparação — e, com o botão de lote oculto para o piloto, o
// painel travava em zero: sem vínculos não há botão por item, e sem
// botão não havia como criar vínculos. Separá-las desfaz o impasse sem
// reexpor o download em lote.
//
// O SHA-256 aparece abreviado (12 caracteres) apenas para conferência
// visual. Nada aqui compara revisões nem classifica mudança: isso é
// Pacote D.

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  initialDownloadConstrumanagerContentState,
  initialPrepareConstrumanagerContentState,
} from "@/app/[projectId]/integracoes/actions-state";
import {
  downloadConstrumanagerContentAction,
  prepareConstrumanagerContentAction,
} from "@/app/[projectId]/integracoes/actions";
import { ConstrumanagerContentStatusBadge } from "./construmanager-status-badge";
import { formatDateTime } from "@/lib/labels";
import type {
  ConstrumanagerContentItem,
  ConstrumanagerContentOverview,
} from "@/lib/integrations/construmanager/get-content-overview";

// Lote automático desligado durante o piloto controlado.
//
// O piloto exige UM alvo por vez, escolhido a dedo. Um clique acidental
// no botão de lote dispararia downloads reais de documentos que não são
// o alvo — por isso ele fica oculto, e não apenas "não usado". Voltar a
// exibi-lo é trocar esta constante para true; a Server Action que ele
// aciona continua intacta.
const SHOW_BATCH_DOWNLOAD = false;

// A obra piloto tem 203 alvos. Renderizar todos de uma vez seria uma UI
// grande sem ganho: o filtro por nome resolve a busca, e o teto mantém
// a lista curta.
const VISIBLE_LIMIT = 15;

// Só alvo ainda não armazenado é baixável: PENDENTE nunca foi buscado e
// ERRO é a nova tentativa manual. BAIXANDO está em curso e ARMAZENADO já
// tem conteúdo preservado — rebaixar por engano não corromperia nada
// (a operação é idempotente), mas gastaria banda à toa.
function isDownloadable(item: ConstrumanagerContentItem): boolean {
  return item.status === "PENDENTE" || item.status === "ERRO";
}

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
  const [filter, setFilter] = useState("");

  // Qual linha disparou a ação — só para mostrar "Baixando…" no botão
  // certo. O bloqueio de concorrência é o `pending`, que desabilita
  // todos os botões: um download por vez, por construção.
  const [activeLinkId, setActiveLinkId] = useState<string | null>(null);

  const [state, formAction, pending] = useActionState(
    downloadConstrumanagerContentAction,
    initialDownloadConstrumanagerContentState
  );

  const [prepareState, prepareAction, preparing] = useActionState(
    prepareConstrumanagerContentAction,
    initialPrepareConstrumanagerContentState
  );

  // Só sincroniza com o roteador. activeLinkId NÃO é zerado aqui de
  // propósito: ele é escrito no clique (event handler) e só é lido
  // junto com `pending`, então um valor remanescente depois que a ação
  // termina não é observável — e zerá-lo dentro do efeito dispararia
  // uma renderização em cascata (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (state.finishedAt) {
      router.refresh();
    }
  }, [router, state.finishedAt]);

  // Recarrega após a preparação para que os vínculos recém-criados
  // apareçam. Nenhum download é disparado por este efeito — ele só
  // pede ao servidor os dados novos da página.
  useEffect(() => {
    if (prepareState.finishedAt) {
      router.refresh();
    }
  }, [router, prepareState.finishedAt]);

  const items = useMemo(() => overview?.items ?? [], [overview]);

  const filtered = useMemo(() => {
    const term = filter.trim().toLocaleLowerCase();
    if (!term) return items;
    return items.filter((item) =>
      item.sourceName.toLocaleLowerCase().includes(term)
    );
  }, [items, filter]);

  const total = overview?.total ?? 0;
  const pendingCount = overview?.pending ?? 0;
  const stored = overview?.stored ?? 0;
  const failed = overview?.failed ?? 0;
  const downloading = overview?.downloading ?? 0;
  const distinctBlobs = overview?.distinctBlobs ?? 0;

  const visible = filtered.slice(0, VISIBLE_LIMIT);

  // Um download em curso também bloqueia a preparação, e vice-versa:
  // as duas escrevem na mesma tabela de vínculos.
  const busy = pending || preparing;

  return (
    <div className="flex flex-col gap-1.5 rounded-md border bg-background/60 p-2">
      {SHOW_BATCH_DOWNLOAD ? (
        <form action={formAction} className="flex items-center gap-2">
          <input type="hidden" name="projectId" value={projectId} />
          {/* Lote pequeno por padrão. O teto real é aplicado no servidor
              (CONTENT_DOWNLOAD_MAX_BATCH), não aqui. */}
          <input type="hidden" name="batchSize" value="2" />

          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setActiveLinkId(null)}
          >
            {pending && !activeLinkId ? "Baixando…" : "Baixar conteúdos pendentes"}
          </Button>
        </form>
      ) : null}

      <p className="text-xs">
        {total === 0
          ? "Metadados sincronizados. Prepare a lista de conteúdo para habilitar os downloads individuais."
          : `${stored} de ${total} armazenados · ${pendingCount} pendentes`}
        {downloading > 0 ? ` · ${downloading} baixando` : null}
        {failed > 0 ? ` · ${failed} com erro` : null}
      </p>

      {/* Preparação: só faz sentido enquanto não há vínculo nenhum.
          Cria os alvos a partir dos metadados já sincronizados e NÃO
          baixa arquivo algum. */}
      {total === 0 ? (
        <form action={prepareAction} className="flex items-center gap-2">
          <input type="hidden" name="projectId" value={projectId} />
          <Button type="submit" size="sm" variant="outline" disabled={busy}>
            {preparing ? "Preparando…" : "Preparar conteúdo para download"}
          </Button>
        </form>
      ) : null}

      {prepareState.success && prepareState.linksCreated !== null ? (
        <p className="text-xs text-muted-foreground">
          Preparação: {prepareState.linksCreated} vínculo(s) criado(s) ·{" "}
          {prepareState.documentsTotal ?? 0} documento(s) ·{" "}
          {prepareState.versionsTotal ?? 0} versão(ões) ·{" "}
          {prepareState.pendingTotal ?? 0} aguardando download
          {prepareState.finishedAt
            ? ` · ${formatDateTime(prepareState.finishedAt)}`
            : null}
        </p>
      ) : null}

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

      {items.length > 0 ? (
        <>
          <Input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filtrar por nome do arquivo…"
            aria-label="Filtrar conteúdos do Construmanager por nome"
            className="h-7 text-xs"
          />

          <ul className="flex flex-col gap-0.5 text-xs">
            {visible.map((item) => (
              <li
                key={item.linkId}
                className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
              >
                {isDownloadable(item) ? (
                  <form action={formAction} className="contents">
                    <input type="hidden" name="projectId" value={projectId} />
                    {/* linkId presente => a action baixa SOMENTE este
                        alvo e ignora o lote automático. */}
                    <input type="hidden" name="linkId" value={item.linkId} />

                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-xs"
                      disabled={busy}
                      onClick={() => setActiveLinkId(item.linkId)}
                    >
                      {pending && activeLinkId === item.linkId
                        ? "Baixando…"
                        : "Baixar"}
                    </Button>
                  </form>
                ) : null}

                <span className="text-foreground">{item.sourceName}</span>
                <span className="text-muted-foreground">
                  {item.target === "VERSAO" ? "versão" : "documento"}
                </span>
                <span className="text-muted-foreground">
                  #{item.objectId}
                </span>
                <ConstrumanagerContentStatusBadge status={item.status} />
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

          {filtered.length > VISIBLE_LIMIT ? (
            <p className="text-xs text-muted-foreground">
              Mostrando {VISIBLE_LIMIT} de {filtered.length} — refine o filtro
              para encontrar um arquivo específico.
            </p>
          ) : null}

          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nenhum arquivo corresponde ao filtro.
            </p>
          ) : null}
        </>
      ) : null}

      {prepareState.error ? (
        <p className="text-xs text-destructive">{prepareState.error}</p>
      ) : null}

      {state.firstError ? (
        <p className="text-xs text-destructive">{state.firstError}</p>
      ) : null}

      {state.error ? (
        <p className="text-xs text-destructive">{state.error}</p>
      ) : null}
    </div>
  );
}
