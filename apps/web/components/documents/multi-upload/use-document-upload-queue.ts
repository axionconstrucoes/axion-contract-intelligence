"use client";

// Hook do upload múltiplo de Documentos: mantém a fila em memória e
// orquestra o pipeline por arquivo (validação -> hash -> upload ->
// registro -> processamento -> concluído), com concorrência limitada
// e sem que a falha de um arquivo cancele os demais.
//
// Toda a lógica decisória (validação, dedup, progresso ponderado)
// vive em apps/web/lib/documents/multi-upload/queue-core.ts, pura e
// testada isoladamente — este hook só liga essa lógica ao Supabase e
// ao estado do React.
//
// O motor assíncrono lê/escreve sempre em itemsRef (nunca no `items`
// de useState dentro dos callbacks) para nunca operar sobre uma
// closure desatualizada enquanto vários arquivos processam em
// paralelo — `items` do useState só existe para disparar re-render.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@axion/db/browser";
import {
  buildDescriptor,
  buildImportErrorMessage,
  classifyCandidate,
  classifyStorageUploadError,
  computeBatchSummary,
  deriveTitleFromFileName,
  isBatchStillActive,
  isMppFile,
  mergeNewFiles,
  nextVersionLabel,
  progressForPhase,
  sanitizeFileName,
  suggestedKindForDescriptor,
  toExistingDocumentSnapshots,
  validateDescriptor,
} from "@/lib/documents/multi-upload/queue-core";
import { computeFileSha256Hex } from "@/lib/documents/multi-upload/sha256";
import { removeOrphanedStorageObject } from "@/lib/documents/multi-upload/storage-cleanup";
import type {
  BatchSummary,
  ExistingDocumentSnapshot,
  MultiUploadDocumentKind,
  QueueItem,
} from "@/lib/documents/multi-upload/types";
import type { ManagedDocument } from "@/lib/document-management";

const BUCKET = "project-documents";
const MAX_CONCURRENCY = 3;

function mapManagedDocuments(
  documents: readonly ManagedDocument[]
): ExistingDocumentSnapshot[] {
  return toExistingDocumentSnapshots(
    documents.map((document) => ({
      id: document.id,
      title: document.title,
      kind: document.kind,
      versions: document.versions.map((version) => ({
        versionIndex: version.versionIndex,
        sha256Hash: version.sha256Hash,
      })),
    }))
  );
}

export function useDocumentUploadQueue(
  projectId: string,
  initialDocuments: readonly ManagedDocument[]
) {
  const itemsRef = useRef<QueueItem[]>([]);
  const [items, setItemsState] = useState<QueueItem[]>([]);
  // "" (não selecionado) — nunca mais um kind pré-escolhido por
  // padrão; ver isMppFile/suggestedKindForDescriptor abaixo para a
  // única exceção (o próprio arquivo .mpp dita o tipo).
  const [batchDefaultKind, setBatchDefaultKindState] =
    useState<MultiUploadDocumentKind>("");
  const [isRunning, setIsRunning] = useState(false);

  const filesRef = useRef<Map<string, File>>(new Map());
  const existingDocumentsRef = useRef<ExistingDocumentSnapshot[]>(
    mapManagedDocuments(initialDocuments)
  );
  const batchHashIndexRef = useRef<Map<string, string>>(new Map());
  const activeIdsRef = useRef<Set<string>>(new Set());
  const userRef = useRef<{ id: string; email: string } | null>(null);

  // Único ponto de escrita da fila: atualiza a ref (fonte de
  // verdade lida pelo motor assíncrono) e o state (fonte de verdade
  // lida pela renderização), sempre em conjunto.
  const setItems = useCallback(
    (updater: (prev: QueueItem[]) => QueueItem[]) => {
      itemsRef.current = updater(itemsRef.current);
      setItemsState(itemsRef.current);
    },
    []
  );

  const updateItem = useCallback(
    (id: string, patch: Partial<QueueItem>) => {
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
      );
    },
    [setItems]
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const incoming = Array.from(files).map((file) => ({
        file,
        descriptor: buildDescriptor(file.name, file.size),
      }));

      const { toAdd: descriptorsToAdd } = mergeNewFiles(
        itemsRef.current.map((item) => item.descriptor),
        incoming.map((entry) => entry.descriptor)
      );

      const addedKeys = new Set(
        descriptorsToAdd.map(
          (descriptor) => `${descriptor.name.toLowerCase()}|${descriptor.sizeBytes}`
        )
      );

      const toAdd: QueueItem[] = [];

      for (const entry of incoming) {
        const key = `${entry.descriptor.name.toLowerCase()}|${entry.descriptor.sizeBytes}`;
        if (!addedKeys.has(key)) continue;
        addedKeys.delete(key); // um item de fila por entrada, mesmo com nomes repetidos no array de entrada

        const id = crypto.randomUUID();
        filesRef.current.set(id, entry.file);

        toAdd.push({
          id,
          descriptor: entry.descriptor,
          // .mpp sempre dita o próprio tipo (CRONOGRAMA_BASELINE) —
          // nunca herda o default do lote; qualquer outro arquivo
          // começa em batchDefaultKind, que agora é "" até o usuário
          // escolher (nunca mais CONTRATO_BASE implícito).
          kind: suggestedKindForDescriptor(entry.descriptor) ?? batchDefaultKind,
          status: "PENDENTE",
          phase: "VALIDACAO",
          progressPercent: 0,
          errorMessage: null,
          classification: null,
          matchedDocumentId: null,
          matchedDocumentTitle: null,
          sha256Hash: null,
          documentVersionId: null,
          requiresHumanReview: false,
        });
      }

      if (toAdd.length > 0) {
        setItems((prev) => [...prev, ...toAdd]);
      }
    },
    [batchDefaultKind, setItems]
  );

  const removeItem = useCallback(
    (id: string) => {
      const target = itemsRef.current.find((item) => item.id === id);
      if (!target || target.status !== "PENDENTE") return;

      filesRef.current.delete(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
    },
    [setItems]
  );

  const setItemKind = useCallback(
    (id: string, kind: MultiUploadDocumentKind) => {
      updateItem(id, { kind });
    },
    [updateItem]
  );

  const applyKindToAllPending = useCallback(
    (kind: MultiUploadDocumentKind) => {
      setItems((prev) =>
        prev.map((item) =>
          // .mpp nunca é sobrescrito pela aplicação em lote — seu tipo
          // é ditado pelo próprio formato do arquivo, nunca por uma
          // escolha manual do usuário (mesma regra do seletor
          // individual bloqueado em queue-item-row.tsx).
          item.status === "PENDENTE" && !isMppFile(item.descriptor)
            ? { ...item, kind }
            : item
        )
      );
    },
    [setItems]
  );

  const setBatchDefaultKind = useCallback(
    (kind: MultiUploadDocumentKind) => setBatchDefaultKindState(kind),
    []
  );

  const getUser = useCallback(async () => {
    if (userRef.current) return userRef.current;
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw new Error("Sessão expirada. Faça login novamente.");
    }
    userRef.current = { id: data.user.id, email: data.user.email ?? "" };
    return userRef.current;
  }, []);

  // Continua o pipeline (upload -> registro -> processamento) depois
  // que o arquivo foi classificado como NOVO diretamente, ou depois
  // de uma decisão humana explícita para NOVA_VERSAO/CONFLITO.
  const continueAfterDecision = useCallback(
    async (
      itemId: string,
      decision: "NOVO" | "NOVA_VERSAO",
      matchedDocument: ExistingDocumentSnapshot | null
    ) => {
      const file = filesRef.current.get(itemId);
      const current = itemsRef.current.find((i) => i.id === itemId);
      if (!file || !current) return;

      const supabase = createSupabaseBrowserClient();
      const documentId =
        decision === "NOVA_VERSAO" && matchedDocument
          ? matchedDocument.documentId
          : crypto.randomUUID();
      const documentVersionId = crypto.randomUUID();
      const sanitizedName = sanitizeFileName(file.name);
      const storagePath = `${projectId}/${documentId}/${documentVersionId}/${sanitizedName}`;

      let uploadedPath: string | null = null;

      try {
        // ---------- UPLOAD ----------
        updateItem(itemId, { status: "ENVIANDO", phase: "UPLOAD" });

        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(storagePath, file, {
            upsert: false,
            contentType: current.descriptor.mimeType ?? undefined,
          });

        if (uploadError) {
          // Mensagem/status técnico ORIGINAL do Storage sempre preservado
          // aqui (nunca descartado) — só não é exposto ao usuário final
          // como está (poderia incluir detalhes internos de
          // infraestrutura). classifyStorageUploadError decide uma
          // categoria segura e específica quando reconhece a causa (MIME
          // recusado, tamanho, permissão, nome duplicado); cai para a
          // mensagem genérica só quando realmente não sabe classificar.
          console.error(
            "[multi-upload] falha no Storage:",
            uploadError.message,
            "statusCode" in uploadError ? (uploadError as { statusCode?: string }).statusCode : undefined
          );
          updateItem(itemId, {
            status: "ERRO",
            errorMessage: buildImportErrorMessage(
              file.name,
              classifyStorageUploadError(uploadError.message)
            ),
          });
          return;
        }

        uploadedPath = storagePath;

        updateItem(itemId, {
          progressPercent: progressForPhase("UPLOAD", true),
        });

        // ---------- REGISTRO ----------
        updateItem(itemId, { status: "REGISTRANDO", phase: "REGISTRO" });

        const user = await getUser();

        const title =
          decision === "NOVA_VERSAO" && matchedDocument
            ? matchedDocument.title
            : deriveTitleFromFileName(file.name);

        const versionLabel =
          decision === "NOVA_VERSAO" && matchedDocument
            ? nextVersionLabel(matchedDocument)
            : "1.0";

        const { error: registerError } = await supabase
          .rpc("register_project_document_upload", {
            p_project_id: projectId,
            p_document_id: documentId,
            p_document_version_id: documentVersionId,
            p_kind: current.kind,
            p_title: title,
            p_version_label: versionLabel,
            p_document_date: new Date().toISOString().slice(0, 10),
            p_source_type: "UPLOAD_MANUAL",
            p_author: user.email || "Upload múltiplo",
            p_summary:
              "Documento enviado via upload múltiplo, sem resumo informado.",
            p_file_path: storagePath,
            p_original_file_name: file.name,
            p_mime_type: current.descriptor.mimeType,
            p_file_size_bytes: file.size,
            p_notes: null,
            p_sha256_hash: current.sha256Hash,
          })
          .single();

        if (registerError) {
          // Só o objeto desta tentativa específica é removido — o
          // path carrega o documentVersionId gerado agora mesmo,
          // nunca o de uma versão já registrada (cada tentativa,
          // inclusive cada retry, gera um documentVersionId novo).
          const cleanup = await removeOrphanedStorageObject(
            (paths) => supabase.storage.from(BUCKET).remove(paths),
            uploadedPath
          );
          uploadedPath = null;

          const isDuplicate =
            registerError.message.includes("DUPLICATE_FILE_HASH");
          const isSingleActiveContractBaseConflict = registerError.message.includes(
            "SINGLE_ACTIVE_CONTRACT_BASE"
          );

          // Deduplicação x lixeira (migration 20260829160000): o mesmo
          // hash pode já existir num documento que foi enviado para a
          // lixeira — a RPC de upload já impede a duplicata de
          // qualquer forma (índice único), mas o usuário merece saber
          // QUAL documento bateu e que ele está na lixeira, em vez de
          // só "arquivo duplicado" — nunca cria duplicata, só informa
          // melhor o caminho (restaurar, não reenviar).
          let duplicateInTrashTitle: string | null = null;
          if (isDuplicate && current.sha256Hash) {
            const { data: matchRows } = await supabase.rpc(
              "find_document_by_sha256",
              { p_project_id: projectId, p_sha256_hash: current.sha256Hash }
            );
            const match = Array.isArray(matchRows) ? matchRows[0] : matchRows;
            if (match?.is_trashed) {
              duplicateInTrashTitle = match.document_title ?? null;
            }
          }

          const baseMessage = isDuplicate
            ? duplicateInTrashTitle
              ? buildImportErrorMessage(
                  file.name,
                  `arquivo duplicado — já existe como "${duplicateInTrashTitle}", na lixeira. Restaure-o em vez de reenviar.`
                )
              : buildImportErrorMessage(file.name, "arquivo duplicado")
            : isSingleActiveContractBaseConflict
              ? buildImportErrorMessage(
                  file.name,
                  'este projeto já tem um Contrato-base ativo — abra o card existente e use "Adicionar nova versão" em vez de enviar um novo Contrato-base'
                )
              : buildImportErrorMessage(
                  file.name,
                  "falha ao registrar o documento"
                );

          updateItem(itemId, {
            status: isDuplicate ? "DUPLICADO" : "ERRO",
            // Se a própria limpeza também falhar, isso nunca fica
            // silencioso: o erro de reconciliação aparece explícito,
            // com o path do objeto órfão, junto do erro original.
            errorMessage: cleanup.removed
              ? baseMessage
              : `${baseMessage} ${cleanup.reconciliationError}`,
          });
          return;
        }

        uploadedPath = null;

        updateItem(itemId, {
          documentVersionId,
          progressPercent: progressForPhase("REGISTRO", true),
        });

        // Atualiza o snapshot local de dedup para que os PRÓXIMOS
        // arquivos do mesmo lote já enxerguem este documento (evita
        // dois arquivos novos com o mesmo título virarem dois
        // documentos separados dentro do mesmo envio).
        if (decision === "NOVO") {
          existingDocumentsRef.current = [
            ...existingDocumentsRef.current,
            {
              documentId,
              title,
              kind: current.kind,
              versions: [{ sha256Hash: current.sha256Hash }],
              nextVersionIndex: 2,
            },
          ];
        } else {
          existingDocumentsRef.current = existingDocumentsRef.current.map(
            (d) =>
              d.documentId === documentId
                ? {
                    ...d,
                    versions: [
                      ...d.versions,
                      { sha256Hash: current.sha256Hash },
                    ],
                    nextVersionIndex: d.nextVersionIndex + 1,
                  }
                : d
          );
        }

        // ---------- PROCESSAMENTO ----------
        // Nenhum worker de OCR/extração existe nesta etapa, para
        // nenhum tipo documental — o upload em si pode (e deve)
        // chegar a 100%, mas o STATUS final nunca finge que o
        // conteúdo foi analisado. Ata de Reunião (e qualquer futuro
        // tipo com requiresHumanReview) termina num status terminal
        // PRÓPRIO — AGUARDANDO_ANALISE — nunca reaproveitando
        // CONCLUIDO, que um usuário lendo a fila entenderia como
        // "está tudo pronto".
        updateItem(itemId, { status: "PROCESSANDO", phase: "PROCESSAMENTO" });

        const requiresHumanReview = current.kind === "ATA_REUNIAO";

        // .mpp: o upload/armazenamento é um sucesso completo (nunca
        // fica preso num status de "pendente" como Ata de Reunião —
        // não há decisão humana nenhuma pendente aqui), mas a tela
        // nunca pode insinuar que o cronograma foi lido/extraído — não
        // existe parser de MPP nesta etapa. Reaproveita o mesmo campo
        // (errorMessage, renderizado em cinza para status não-ERRO) já
        // usado pela nota informativa da Ata de Reunião.
        const mppInfoMessage = isMppFile(current.descriptor)
          ? "Arquivo MPP armazenado — extração ainda não realizada."
          : null;

        updateItem(itemId, {
          status: requiresHumanReview ? "AGUARDANDO_ANALISE" : "CONCLUIDO",
          phase: "CONCLUIDO",
          progressPercent: 100,
          requiresHumanReview,
          errorMessage: requiresHumanReview
            ? "Upload concluído — análise/OCR pendente. Extração de participantes, decisões, responsáveis, prazos e pendências ainda não está implementada nesta etapa; revisão humana necessária."
            : mppInfoMessage,
        });
      } catch (caughtError) {
        let baseMessage = buildImportErrorMessage(
          file.name,
          caughtError instanceof Error
            ? caughtError.message
            : "falha inesperada"
        );

        // uploadedPath só é não-nulo aqui se o upload terminou mas o
        // fluxo quebrou ANTES do registro confirmar sucesso — nunca
        // depois: o sucesso do registro zera uploadedPath como a
        // primeiríssima coisa que faz (linha acima, "uploadedPath =
        // null"), antes de qualquer código que possa lançar. Ou seja,
        // este bloco nunca remove o arquivo de uma versão já
        // registrada.
        if (uploadedPath) {
          const cleanup = await removeOrphanedStorageObject(
            (paths) => supabase.storage.from(BUCKET).remove(paths),
            uploadedPath
          );
          if (!cleanup.removed && cleanup.reconciliationError) {
            baseMessage = `${baseMessage} ${cleanup.reconciliationError}`;
          }
        }

        updateItem(itemId, {
          status: "ERRO",
          errorMessage: baseMessage,
        });
      }
    },
    [projectId, getUser, updateItem]
  );

  // Processa um único arquivo do início ao fim. Nunca lança para
  // fora: qualquer falha vira status ERRO/REJEITADO naquele item,
  // sem afetar os demais (sucesso parcial do lote é sempre possível).
  const processItem = useCallback(
    async (itemId: string) => {
      const file = filesRef.current.get(itemId);
      const current = itemsRef.current.find((i) => i.id === itemId);
      if (!file || !current) return;

      const descriptor = current.descriptor;

      // ---------- VALIDAÇÃO ----------
      updateItem(itemId, { status: "VALIDANDO", phase: "VALIDACAO" });

      const validation = validateDescriptor(descriptor);
      if (!validation.ok) {
        updateItem(itemId, {
          status: "REJEITADO",
          errorMessage: buildImportErrorMessage(
            file.name,
            validation.reason.replace(/\.$/, "").toLowerCase()
          ),
          progressPercent: progressForPhase("VALIDACAO", true),
        });
        return;
      }

      // Seleção de tipo documental é obrigatória antes do envio — "" só
      // é possível aqui para arquivos que não são .mpp (que já chegam
      // com CRONOGRAMA_BASELINE sugerido, ver addFiles); nunca envia
      // nem infere um tipo às cegas.
      if (!current.kind) {
        updateItem(itemId, {
          status: "REJEITADO",
          errorMessage: buildImportErrorMessage(
            file.name,
            "selecione o tipo documental antes de enviar"
          ),
          progressPercent: progressForPhase("VALIDACAO", true),
        });
        return;
      }

      updateItem(itemId, {
        progressPercent: progressForPhase("VALIDACAO", true),
      });

      // ---------- HASH + CLASSIFICAÇÃO ----------
      updateItem(itemId, { status: "CALCULANDO_HASH", phase: "HASH" });

      let sha256Hash: string;
      try {
        sha256Hash = await computeFileSha256Hex(file);
      } catch {
        updateItem(itemId, {
          status: "ERRO",
          errorMessage: buildImportErrorMessage(
            file.name,
            "falha ao calcular o hash do arquivo"
          ),
        });
        return;
      }

      batchHashIndexRef.current.set(sha256Hash, itemId);

      const classification = classifyCandidate({
        sha256Hash,
        fileName: file.name,
        kind: current.kind,
        existingDocuments: existingDocumentsRef.current,
        batchHashIndex: batchHashIndexRef.current,
        currentQueueItemId: itemId,
      });

      updateItem(itemId, {
        sha256Hash,
        classification: classification.classification,
        matchedDocumentId: classification.matchedDocumentId,
        matchedDocumentTitle: classification.matchedDocumentTitle,
        progressPercent: progressForPhase("HASH", true),
      });

      if (classification.classification === "DUPLICADO") {
        updateItem(itemId, {
          status: "DUPLICADO",
          errorMessage: classification.reason,
        });
        return;
      }

      if (classification.classification === "NOVA_VERSAO") {
        updateItem(itemId, { status: "AGUARDANDO_DECISAO_VERSAO" });
        return;
      }

      if (classification.classification === "CONFLITO") {
        updateItem(itemId, { status: "AGUARDANDO_DECISAO_CONFLITO" });
        return;
      }

      await continueAfterDecision(itemId, "NOVO", null);
    },
    [updateItem, continueAfterDecision]
  );

  // Motor de concorrência limitada: a cada "tick", preenche vagas
  // livres com itens PENDENTE ainda não reivindicados. Lê/escreve
  // sempre via itemsRef/activeIdsRef — nunca via closures de estado.
  //
  // A auto-chamada recursiva (quando um item termina, um novo tick
  // preenche a vaga liberada) passa por tickRef em vez do binding
  // `tick` direto: evita fechar sobre uma versão desatualizada da
  // própria função caso `tick` seja recriado enquanto uma chamada
  // anterior ainda está em voo.
  const tickRef = useRef<() => void>(() => {});

  const tick = useCallback(() => {
    const pending = itemsRef.current.filter(
      (item) =>
        item.status === "PENDENTE" && !activeIdsRef.current.has(item.id)
    );

    const freeSlots = MAX_CONCURRENCY - activeIdsRef.current.size;
    const toStart = pending.slice(0, Math.max(0, freeSlots));

    for (const item of toStart) {
      activeIdsRef.current.add(item.id);
      void processItem(item.id).finally(() => {
        activeIdsRef.current.delete(item.id);
        tickRef.current();
      });
    }

    // Reabilita o rótulo/estado do botão "Iniciar envio" no exato
    // momento em que o lote termina de verdade (chamado tanto no
    // startBatch() inicial quanto em toda conclusão recursiva de item
    // acima) — nunca um useEffect observando `items` (setState
    // síncrono dentro de efeito é evitado de propósito: aqui é reação
    // direta a um evento, não derivação reativa de estado).
    if (activeIdsRef.current.size === 0 && !isBatchStillActive(itemsRef.current)) {
      setIsRunning((current) => (current ? false : current));
    }
  }, [processItem]);

  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  const startBatch = useCallback(() => {
    setIsRunning(true);
    tick();
  }, [tick]);

  const retryItem = useCallback(
    (itemId: string) => {
      setItems((prev) =>
        prev.map((item) =>
          item.id === itemId
            ? {
                ...item,
                status: "PENDENTE",
                phase: "VALIDACAO",
                progressPercent: 0,
                errorMessage: null,
                classification: null,
                matchedDocumentId: null,
                matchedDocumentTitle: null,
                sha256Hash: null,
                documentVersionId: null,
              }
            : item
        )
      );
      tick();
    },
    [setItems, tick]
  );

  const confirmVersionDecision = useCallback(
    (itemId: string) => {
      const item = itemsRef.current.find((i) => i.id === itemId);
      if (!item || !item.matchedDocumentId) return;
      const matched = existingDocumentsRef.current.find(
        (d) => d.documentId === item.matchedDocumentId
      );
      if (!matched) return;
      activeIdsRef.current.add(itemId);
      void continueAfterDecision(itemId, "NOVA_VERSAO", matched).finally(
        () => {
          activeIdsRef.current.delete(itemId);
          tick();
        }
      );
    },
    [continueAfterDecision, tick]
  );

  const rejectVersionDecision = useCallback(
    (itemId: string) => {
      activeIdsRef.current.add(itemId);
      void continueAfterDecision(itemId, "NOVO", null).finally(() => {
        activeIdsRef.current.delete(itemId);
        tick();
      });
    },
    [continueAfterDecision, tick]
  );

  const confirmConflictAsNew = useCallback(
    (itemId: string) => {
      activeIdsRef.current.add(itemId);
      void continueAfterDecision(itemId, "NOVO", null).finally(() => {
        activeIdsRef.current.delete(itemId);
        tick();
      });
    },
    [continueAfterDecision, tick]
  );

  const cancelConflictItem = useCallback(
    (itemId: string) => {
      const file = filesRef.current.get(itemId);
      updateItem(itemId, {
        status: "REJEITADO",
        errorMessage: file
          ? buildImportErrorMessage(
              file.name,
              "cancelado após conflito de tipo documental"
            )
          : "Cancelado após conflito de tipo documental.",
      });
    },
    [updateItem]
  );

  const summary: BatchSummary = useMemo(
    () => computeBatchSummary(items),
    [items]
  );

  return {
    items,
    summary,
    batchDefaultKind,
    isRunning,
    addFiles,
    removeItem,
    setItemKind,
    applyKindToAllPending,
    setBatchDefaultKind,
    startBatch,
    retryItem,
    confirmVersionDecision,
    rejectVersionDecision,
    confirmConflictAsNew,
    cancelConflictItem,
  };
}
