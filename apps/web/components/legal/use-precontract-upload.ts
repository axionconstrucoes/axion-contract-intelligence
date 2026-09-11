"use client";

// Liga o pipeline injetável (lib/legal/run-precontract-upload.ts) ao
// React. Toda a lógica decisória vive lá — aqui ficam só o estado da
// tela, as dependências reais e a hidratação após recarregar a página.

import { useCallback, useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@axion/db/browser";
import { computeFileSha256Hex } from "@/lib/documents/multi-upload/sha256";
import type { ExistingDocumentSnapshot } from "@/lib/documents/multi-upload/types";
import {
  hydrateItemsFromExisting,
  itemsFromBatchVerification,
  type PrecontractDocumentItem,
  type PrecontractExistingDocument,
} from "@/lib/legal/precontract-document-state";
import {
  verifyPrecontractDocumentAction,
  verifyPrecontractDocumentsBatchAction,
} from "@/lib/legal/precontract-document-verify-action";
import { xhrUploadTransport } from "@/lib/legal/precontract-upload-transport";
import {
  runPrecontractUpload,
  type PrecontractUploadDeps,
  type RegisterUploadArgs,
} from "@/lib/legal/run-precontract-upload";

const BUCKET = "project-documents";

export interface PendingFile {
  file: File;
  kind: string;
  itemId: string;
}

export function usePrecontractUpload(params: {
  projectId: string;
  existingDocuments: readonly PrecontractExistingDocument[];
  classificationSnapshots: readonly ExistingDocumentSnapshot[];
  /** Injetável para teste; em produção é sempre o transporte XHR real. */
  deps?: Partial<PrecontractUploadDeps>;
}) {
  const { projectId, existingDocuments, classificationSnapshots } = params;

  const [items, setItems] = useState<PrecontractDocumentItem[]>(() =>
    hydrateItemsFromExisting(existingDocuments)
  );

  // hash -> itemId, para deduplicação dentro desta sessão.
  const batchHashIndex = useRef(new Map<string, string>());
  // itemId -> função de cancelamento do envio em curso.
  const abortHandles = useRef(new Map<string, () => void>());
  // Arquivos parados em AGUARDANDO_DECISAO, à espera da confirmação.
  const pendingFiles = useRef(new Map<string, PendingFile>());
  // Guarda contra o React Strict Mode: em dev o efeito roda duas vezes,
  // e sem isto a verificacao em lote rodaria duas vezes.
  const hydrationStarted = useRef(false);

  const updateItem = useCallback((itemId: string, patch: Partial<PrecontractDocumentItem>) => {
    setItems((current) => current.map((item) => (item.id === itemId ? { ...item, ...patch } : item)));
  }, []);

  const buildDeps = useCallback((): PrecontractUploadDeps => {
    const supabase = createSupabaseBrowserClient();

    return {
      transport: xhrUploadTransport,
      computeSha256: computeFileSha256Hex,
      storageBaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      newId: () => crypto.randomUUID(),
      async getSession() {
        const { data } = await supabase.auth.getSession();
        if (!data.session?.access_token) return null;
        return {
          accessToken: data.session.access_token,
          userEmail: data.session.user?.email ?? null,
        };
      },
      async registerUpload(args: RegisterUploadArgs) {
        const { error } = await supabase.rpc("register_project_document_upload", args).single();
        return { error: error ? { message: error.message } : null };
      },
      async removeStorageObject(paths: string[]) {
        const { error } = await supabase.storage.from(BUCKET).remove(paths);
        return { error: error ? { message: error.message } : null };
      },
      verifyDocument: verifyPrecontractDocumentAction,
      ...params.deps,
    };
  }, [params.deps]);

  /**
   * Hidratação após um F5: UMA única Server Action em lote. O servidor
   * descobre quais documentos e versões existem e estão autorizados a
   * partir do projectId — o navegador não envia a lista.
   *
   * Antes era uma Server Action POR DOCUMENTO (cinco documentos = cinco
   * round-trips, downloads e extrações). Agora é uma chamada só, com
   * teto no servidor.
   *
   * A guarda `hydrationStarted` cobre o React Strict Mode, que em dev
   * roda o efeito duas vezes: sem ela, cada documento seria reextraído
   * em duplicidade.
   */
  useEffect(() => {
    if (hydrationStarted.current) return;
    hydrationStarted.current = true;

    void verifyPrecontractDocumentsBatchAction(projectId)
      .then((result) => {
        if (!result.ok) {
          setItems((current) =>
            current.map((item) =>
              item.hydrated ? { ...item, status: "ERRO" as const, message: result.message } : item
            )
          );
          return;
        }

        // Substitui apenas os itens hidratados; envios em curso nesta
        // sessão são preservados.
        setItems((current) => [
          ...itemsFromBatchVerification(result.documents),
          ...current.filter((item) => !item.hydrated),
        ]);
      })
      .catch(() => {
        setItems((current) =>
          current.map((item) =>
            item.hydrated
              ? { ...item, status: "ERRO" as const, message: "Não foi possível verificar os documentos. Recarregue a página." }
              : item
          )
        );
      });
  }, [projectId]);

  const startUpload = useCallback(
    async (file: File, kind: string, itemId: string, decision?: "NOVA_VERSAO" | "DOCUMENTO_SEPARADO") => {
      const deps = buildDeps();

      const outcome = await runPrecontractUpload(deps, {
        projectId,
        file,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || null,
        kind,
        existingDocuments: classificationSnapshots,
        batchHashIndex: batchHashIndex.current,
        itemId,
        decision,
        onPatch: (patch) => updateItem(itemId, patch),
        onAbortHandle: (abort) => abortHandles.current.set(itemId, abort),
      });

      abortHandles.current.delete(itemId);

      if (outcome.sha256Hash) batchHashIndex.current.set(outcome.sha256Hash, itemId);

      // O arquivo fica guardado enquanto houver algo a refazer: decisao
      // pendente, erro ou cancelamento. So sai quando nao ha mais acao
      // possivel (pronto ou duplicado).
      if (outcome.status === "PRONTO" || outcome.status === "DUPLICADO") {
        pendingFiles.current.delete(itemId);
      } else {
        pendingFiles.current.set(itemId, { file, kind, itemId });
      }

      if (outcome.reconciliationError) {
        console.error("[precontract-upload]", outcome.reconciliationError);
      }
    },
    [buildDeps, classificationSnapshots, projectId, updateItem]
  );

  const addFile = useCallback(
    (file: File, kind: string) => {
      const itemId = crypto.randomUUID();

      setItems((current) => [
        ...current,
        {
          id: itemId,
          fileName: file.name,
          kind,
          sizeBytes: file.size,
          status: "ENVIANDO",
          uploadPercent: 0,
          documentId: null,
          documentVersionId: null,
          versionLabel: null,
          pageCount: null,
          characterCount: null,
          message: null,
          pendingDecision: null,
          hydrated: false,
        },
      ]);

      pendingFiles.current.set(itemId, { file, kind, itemId });
      void startUpload(file, kind, itemId);
    },
    [startUpload]
  );

  /** Confirmação humana de "nova versão" ou "documento separado". */
  const resolveDecision = useCallback(
    (itemId: string, decision: "NOVA_VERSAO" | "DOCUMENTO_SEPARADO") => {
      const pending = pendingFiles.current.get(itemId);
      if (!pending) return;
      updateItem(itemId, { status: "ENVIANDO", uploadPercent: 0, pendingDecision: null, message: null });
      void startUpload(pending.file, pending.kind, itemId, decision);
    },
    [startUpload, updateItem]
  );

  /** Cancelamento do envio em curso — aciona xhr.abort() de verdade. */
  const cancelUpload = useCallback((itemId: string) => {
    abortHandles.current.get(itemId)?.();
  }, []);

  /** Nova tentativa segura depois de erro ou cancelamento. */
  const retry = useCallback(
    (itemId: string) => {
      const pending = pendingFiles.current.get(itemId);
      if (!pending) return;
      updateItem(itemId, { status: "ENVIANDO", uploadPercent: 0, message: null });
      void startUpload(pending.file, pending.kind, itemId);
    },
    [startUpload, updateItem]
  );

  const removeItem = useCallback((itemId: string) => {
    abortHandles.current.get(itemId)?.();
    abortHandles.current.delete(itemId);
    pendingFiles.current.delete(itemId);
    setItems((current) => current.filter((item) => item.id !== itemId));
  }, []);

  return { items, addFile, cancelUpload, resolveDecision, retry, removeItem };
}
