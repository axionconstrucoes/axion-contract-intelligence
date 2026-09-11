"use client";

// Card único da análise jurídica pré-contratual: arrastar/selecionar
// (um ou vários arquivos de uma vez, cada um com sua própria linha),
// nome do arquivo, tipo documental, barra e percentual REAL de upload, e
// os estados Enviando / Processando / Pronto / Erro (mais
// "Aguardando sua confirmação" e "Documento duplicado", que o pipeline
// de upload do ACC já distinguia e que não podem ser perdidos aqui).
//
// Componente puramente de apresentação: todo o comportamento vem do hook
// usePrecontractUpload.

import { useRef, useState } from "react";
import { FileText, Loader2, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { documentKindLabels } from "@/lib/labels";
import {
  PRECONTRACT_STATUS_LABELS,
  formatBytes,
  type PrecontractDocumentItem,
  type PrecontractDocumentStatus,
} from "@/lib/legal/precontract-document-state";

const ACCEPTED = ".pdf,.docx,.txt";

const STATUS_STYLES: Record<PrecontractDocumentStatus, string> = {
  OCIOSO: "text-muted-foreground",
  AGUARDANDO_DECISAO: "text-severity-alta",
  ENVIANDO: "text-primary",
  PROCESSANDO: "text-severity-alta",
  PRONTO: "text-emerald-600 dark:text-emerald-400",
  DUPLICADO: "text-muted-foreground",
  ERRO: "text-destructive",
};

const KIND_OPTIONS = ["CONTRATO_BASE", "ADITIVO", "EDITAL", "PROPOSTA_COMERCIAL", "PROPOSTA_TECNICA"] as const;

function kindLabel(kind: string): string {
  return documentKindLabels[kind as keyof typeof documentKindLabels] ?? kind;
}

export function PrecontractDocumentCard({
  canUpload,
  items,
  onAddFile,
  onCancel,
  onResolveDecision,
  onRetry,
}: {
  canUpload: boolean;
  items: readonly PrecontractDocumentItem[];
  onAddFile: (file: File, kind: string) => void;
  onCancel: (itemId: string) => void;
  onResolveDecision: (itemId: string, decision: "NOVA_VERSAO" | "DOCUMENTO_SEPARADO") => void;
  onRetry: (itemId: string) => void;
}) {
  const [kind, setKind] = useState<string>("CONTRATO_BASE");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Seleção múltipla: cada arquivo entra no pipeline por conta própria
  // (mesmo `onAddFile` de sempre, uma vez por arquivo) — a validação de
  // formato, a deduplicação por hash e o versionamento continuam sendo
  // feitos por arquivo em runPrecontractUpload. Nada muda no pipeline.
  const addFiles = (list: FileList | null | undefined) => {
    if (!list) return;
    for (const file of Array.from(list)) onAddFile(file, kind);
  };

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="size-5" />
          Documento da negociação
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Contrato, minuta ou aditivo em PDF, DOCX ou TXT. O especialista jurídico responde a partir do texto deste
          documento.
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {canUpload ? (
          <>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Tipo documental
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value)}
                className="w-full max-w-xs rounded-md border bg-background px-3 py-2 text-sm"
              >
                {KIND_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {kindLabel(option)}
                  </option>
                ))}
              </select>
            </label>

            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                addFiles(event.dataTransfer.files);
              }}
              onClick={() => inputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
              }}
              className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border border-dashed p-6 text-center transition-colors ${
                dragging ? "border-primary bg-primary/5" : "hover:bg-muted/40"
              }`}
            >
              <UploadCloud className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium">Arraste os documentos aqui ou clique para selecionar</p>
              <p className="text-xs text-muted-foreground">
                PDF, DOCX ou TXT com texto selecionável · é possível selecionar vários de uma vez
              </p>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED}
                multiple
                className="hidden"
                onChange={(event) => {
                  addFiles(event.target.files);
                  event.target.value = "";
                }}
              />
            </div>
          </>
        ) : (
          <p className="rounded-md border bg-muted p-3 text-sm text-muted-foreground">
            Você possui acesso de leitura. O envio de documentos exige permissão de GERENTE, GESTOR ou ADMINISTRADOR.
          </p>
        )}

        {items.map((item) => (
          <div key={item.id} className="flex flex-col gap-1.5 rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {kindLabel(item.kind)} · {formatBytes(item.sizeBytes)}
                  {item.versionLabel ? ` · v${item.versionLabel}` : ""}
                  {item.pageCount ? ` · ${item.pageCount} página(s)` : ""}
                </p>
              </div>
              <span className={`flex items-center gap-1.5 text-xs font-semibold ${STATUS_STYLES[item.status]}`}>
                {item.status === "ENVIANDO" || item.status === "PROCESSANDO" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : null}
                {PRECONTRACT_STATUS_LABELS[item.status]}
                {item.status === "ENVIANDO" ? ` · ${item.uploadPercent}%` : ""}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div
                className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={item.uploadPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Envio de ${item.fileName}`}
              >
                <div
                  className={`h-full transition-all ${item.status === "ERRO" ? "bg-destructive" : "bg-primary"}`}
                  style={{ width: `${item.uploadPercent}%` }}
                />
              </div>
              <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {item.uploadPercent}%
              </span>

              {item.status === "ENVIANDO" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-xs"
                  onClick={() => onCancel(item.id)}
                >
                  <X className="size-3.5" />
                  Cancelar envio
                </Button>
              ) : null}

              {item.status === "ERRO" && !item.hydrated ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-xs"
                  onClick={() => onRetry(item.id)}
                >
                  Tentar novamente
                </Button>
              ) : null}
            </div>

            {item.message ? (
              <p className={`text-xs ${item.status === "ERRO" ? "text-destructive" : "text-muted-foreground"}`}>
                {item.message}
              </p>
            ) : null}

            {/* Nova versão x documento separado é decisão HUMANA — o
                sistema nunca escolhe sozinho (mesma regra do upload
                múltiplo, ver classifyCandidate). */}
            {item.status === "AGUARDANDO_DECISAO" && item.pendingDecision ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-severity-alta/40 bg-severity-alta/5 p-2.5">
                <p className="w-full text-xs">
                  {item.pendingDecision.classification === "NOVA_VERSAO"
                    ? `Parece uma nova versão de "${item.pendingDecision.matchedDocumentTitle}". Como devemos registrar?`
                    : `Já existe "${item.pendingDecision.matchedDocumentTitle}" com tipo documental diferente. Como devemos registrar?`}
                </p>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => onResolveDecision(item.id, "NOVA_VERSAO")}
                >
                  Registrar como nova versão
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => onResolveDecision(item.id, "DOCUMENTO_SEPARADO")}
                >
                  Registrar como documento separado
                </Button>
              </div>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
