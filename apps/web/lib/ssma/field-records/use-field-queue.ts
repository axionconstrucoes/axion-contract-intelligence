"use client";

// Hook da fila offline no navegador: abre o IndexedDB, mantém a lista do usuário e dispara o envio
// quando há conexão (ao abrir, ao voltar a rede, ao voltar para a aba e a cada 30 s se houver
// pendências). A lógica vive em queue-core.ts (testada); aqui só há ligação com o navegador.

import { useCallback, useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@axion/db/browser";
import { computeFileSha256Hex } from "@/lib/documents/multi-upload/sha256";
import { contextKey, createIdbStore, LAST_USER_KEY, lastProjectKey, openOfflineDb, type OfflineContext, type OfflineMetaStore } from "./idb-store";
import { createFieldQueue, type FieldQueue, type NewPhotoInput, type QueueStore, type SyncReport } from "./queue-core";
import { createSupabaseTransport } from "./supabase-transport";
import type { FieldRecordDraft, QueuedRecord } from "./types";

export interface FieldQueueState {
  ready: boolean;
  items: QueuedRecord[];
  foreignPending: number;
  syncing: boolean;
  /** Último resultado conhecido de alcançar o servidor. */
  reachable: boolean;
  message: string | null;
  storageError: string | null;
}

const SYNC_MESSAGES: Record<SyncReport["outcome"], string | null> = {
  DONE: null,
  OFFLINE: "Sem conexão. Os registros continuam salvos no aparelho e serão enviados quando a internet voltar.",
  BUSY: null,
  BLOCKED_NO_SESSION: "Sessão encerrada. Entre novamente para enviar os registros salvos.",
  BLOCKED_USER_MISMATCH: "Há registros neste aparelho criados por outra conta. Eles não serão enviados por esta conta.",
};

export function useFieldQueue(userId: string) {
  const queueRef = useRef<FieldQueue | null>(null);
  const storeRef = useRef<(QueueStore & OfflineMetaStore) | null>(null);
  const [state, setState] = useState<FieldQueueState>({
    ready: false,
    items: [],
    foreignPending: 0,
    syncing: false,
    reachable: typeof navigator === "undefined" ? true : navigator.onLine,
    message: null,
    storageError: null,
  });

  const refresh = useCallback(async () => {
    const queue = queueRef.current;
    if (!queue) return;
    const [items, foreignPending] = await Promise.all([queue.listForUser(userId), queue.foreignPendingCount(userId)]);
    setState((current) => ({ ...current, items, foreignPending }));
  }, [userId]);

  const runSync = useCallback(
    async (retryPermanent = false) => {
      const queue = queueRef.current;
      if (!queue) return;
      setState((current) => ({ ...current, syncing: true }));
      try {
        const report = await queue.sync(userId, { retryPermanent });
        setState((current) => ({
          ...current,
          reachable: report.outcome !== "OFFLINE",
          message: report.outcome === "DONE" && report.failed > 0 ? "Alguns registros não foram enviados. Veja o motivo em cada item." : SYNC_MESSAGES[report.outcome],
        }));
      } catch {
        setState((current) => ({ ...current, message: "Não foi possível sincronizar agora. Tente novamente." }));
      } finally {
        setState((current) => ({ ...current, syncing: false }));
        await refresh();
      }
    },
    [userId, refresh]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = await openOfflineDb();
        const store = createIdbStore(db);
        const supabase = createSupabaseBrowserClient();
        const queue = createFieldQueue({
          store,
          transport: createSupabaseTransport(supabase),
          hashBlob: computeFileSha256Hex,
          withLock: async <T,>(name: string, fn: () => Promise<T>): Promise<T> =>
            typeof navigator !== "undefined" && navigator.locks ? ((await navigator.locks.request(name, fn)) as T) : fn(),
        });
        if (cancelled) return;
        storeRef.current = store;
        queueRef.current = queue;
        await queue.recoverInterrupted(userId);
        // Pede armazenamento persistente (reduz o risco de o navegador apagar os dados do app).
        void navigator.storage?.persist?.();
        setState((current) => ({ ...current, ready: true }));
        await refresh();
        if (navigator.onLine) void runSync();
      } catch {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            ready: true,
            storageError: "Este navegador não permitiu guardar dados no aparelho. O registro offline não está disponível aqui.",
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, refresh, runSync]);

  useEffect(() => {
    const onOnline = () => {
      setState((current) => ({ ...current, reachable: true }));
      void runSync();
    };
    const onOffline = () => setState((current) => ({ ...current, reachable: false }));
    const onVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void runSync();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => {
      if (navigator.onLine && queueRef.current) {
        void queueRef.current.listForUser(userId).then((items) => {
          if (items.some((item) => item.status !== "SYNCED" && !item.permanentError)) void runSync();
        });
      }
    }, 30_000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [userId, runSync]);

  const save = useCallback(
    async (projectId: string, draft: FieldRecordDraft, photos: NewPhotoInput[]) => {
      const queue = queueRef.current;
      if (!queue) throw new Error("O armazenamento do aparelho não está disponível.");
      const item = await queue.save({ userId, projectId, draft, photos });
      await refresh();
      if (navigator.onLine) void runSync();
      return item;
    },
    [userId, refresh, runSync]
  );

  const discard = useCallback(
    async (clientId: string) => {
      await queueRef.current?.discard(userId, clientId);
      await refresh();
    },
    [userId, refresh]
  );

  const purgeForeign = useCallback(async () => {
    await queueRef.current?.purgeForeign(userId);
    await refresh();
  }, [userId, refresh]);

  /** Guarda o contexto mínimo (obra, nomes dos membros) para abrir o formulário sem rede. */
  const rememberContext = useCallback(
    async (userLabel: string, project: OfflineContext["projects"][number]) => {
      const store = storeRef.current;
      if (!store) return;
      const current = await store.getMeta<OfflineContext>(contextKey(userId));
      const projects = [...(current?.projects ?? []).filter((entry) => entry.id !== project.id), project];
      await store.putMeta(contextKey(userId), { userId, userLabel, projects, savedAt: new Date().toISOString() } satisfies OfflineContext);
      await store.putMeta(LAST_USER_KEY, { userId });
      await store.putMeta(lastProjectKey(userId), project.id);
    },
    [userId]
  );

  /** Ao sair da conta: apaga o contexto guardado (a fila de registros NÃO é apagada). */
  const forgetContext = useCallback(async () => {
    const store = storeRef.current;
    if (!store) return;
    await store.deleteMeta(contextKey(userId));
    await store.deleteMeta(LAST_USER_KEY);
  }, [userId]);

  /** Contexto guardado no aparelho para o usuário (usado pela casca offline). */
  const loadContext = useCallback(async () => {
    const store = storeRef.current;
    if (!store) return null;
    const context = await store.getMeta<OfflineContext>(contextKey(userId));
    const lastProjectId = await store.getMeta<string>(lastProjectKey(userId));
    return context ? { context, lastProjectId } : null;
  }, [userId]);

  return { ...state, loadContext, refresh, runSync, save, discard, purgeForeign, rememberContext, forgetContext };
}
