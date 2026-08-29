"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { ManagedDocument } from "@/lib/document-management";
import {
  ACCEPT_ATTRIBUTE,
} from "@/lib/documents/multi-upload/allowed-file-types";
import { MULTI_UPLOAD_DOCUMENT_KINDS } from "@/lib/documents/multi-upload/types";
import type { MultiUploadDocumentKind } from "@/lib/documents/multi-upload/types";
import { QueueItemRow } from "./queue-item-row";
import { UploadSummaryBar } from "./upload-summary-bar";
import { useDocumentUploadQueue } from "./use-document-upload-queue";

type Props = {
  projectId: string;
  documents: ManagedDocument[];
};

export function DocumentMultiUploadPanel({ projectId, documents }: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const {
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
  } = useDocumentUploadQueue(projectId, documents);

  // Atualiza a lista de documentos da página assim que qualquer
  // arquivo do lote conclui — sem depender de o usuário sair e
  // voltar à aba.
  const lastCompletedCountRef = useRef(0);
  useEffect(() => {
    if (summary.completed > lastCompletedCountRef.current) {
      lastCompletedCountRef.current = summary.completed;
      router.refresh();
    }
  }, [summary.completed, router]);

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files && event.target.files.length > 0) {
      addFiles(event.target.files);
    }
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      addFiles(event.dataTransfer.files);
    }
  }

  const hasPending = items.some((item) => item.status === "PENDENTE");

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-8 text-center transition-colors ${
          isDragging ? "border-primary bg-primary/5" : "border-border"
        }`}
      >
        <p className="text-sm text-muted-foreground">
          Arraste e solte vários arquivos aqui, ou
        </p>

        <Button
          type="button"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
        >
          Selecionar arquivos
        </Button>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          onChange={handleFileInputChange}
          className="hidden"
        />

        <p className="text-xs text-muted-foreground">
          Você pode selecionar arquivos em mais de uma vez — nada do que já
          foi adicionado se perde. Máximo 50 MB por arquivo.
        </p>
      </div>

      {items.length > 0 ? (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Tipo documental padrão do lote</span>
              <Select
                value={batchDefaultKind}
                onChange={(event) =>
                  setBatchDefaultKind(
                    event.target.value as MultiUploadDocumentKind
                  )
                }
                className="h-9"
              >
                <option value="" disabled>
                  Selecione o tipo documental
                </option>
                {MULTI_UPLOAD_DOCUMENT_KINDS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </label>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!hasPending || !batchDefaultKind}
              onClick={() => applyKindToAllPending(batchDefaultKind)}
            >
              Aplicar a todos ainda aguardando
            </Button>

            <Button
              type="button"
              disabled={!hasPending}
              onClick={startBatch}
              className="ml-auto"
            >
              {isRunning ? "Enviando lote..." : "Iniciar envio"}
            </Button>
          </div>

          <UploadSummaryBar summary={summary} />

          <div className="flex flex-col gap-2">
            {items.map((item) => (
              <QueueItemRow
                key={item.id}
                item={item}
                onKindChange={(kind) => setItemKind(item.id, kind)}
                onRemove={() => removeItem(item.id)}
                onRetry={() => retryItem(item.id)}
                onConfirmVersion={() => confirmVersionDecision(item.id)}
                onRejectVersion={() => rejectVersionDecision(item.id)}
                onConfirmConflict={() => confirmConflictAsNew(item.id)}
                onCancelConflict={() => cancelConflictItem(item.id)}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
