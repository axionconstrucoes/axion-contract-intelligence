"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { isMppFile } from "@/lib/documents/multi-upload/queue-core";
import { MULTI_UPLOAD_DOCUMENT_KINDS } from "@/lib/documents/multi-upload/types";
import type {
  MultiUploadDocumentKind,
  QueueItem,
} from "@/lib/documents/multi-upload/types";
import {
  PHASE_LABELS,
  STATUS_BADGE_VARIANT,
  STATUS_LABELS,
} from "./status-labels";

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const EDITABLE_KIND_STATUSES = new Set(["PENDENTE"]);
const REMOVABLE_STATUSES = new Set(["PENDENTE"]);
const RETRYABLE_STATUSES = new Set(["ERRO"]);

type Props = {
  item: QueueItem;
  onKindChange: (kind: MultiUploadDocumentKind) => void;
  onRemove: () => void;
  onRetry: () => void;
  onConfirmVersion: () => void;
  onRejectVersion: () => void;
  onConfirmConflict: () => void;
  onCancelConflict: () => void;
};

export function QueueItemRow({
  item,
  onKindChange,
  onRemove,
  onRetry,
  onConfirmVersion,
  onRejectVersion,
  onConfirmConflict,
  onCancelConflict,
}: Props) {
  // .mpp nunca é editável — o formato do arquivo já dita o tipo
  // documental (CRONOGRAMA_BASELINE, aplicado em addFiles); permitir
  // trocar para outro tipo aqui seria semanticamente incoerente (um
  // binário do MS Project não pode virar "Contrato"/"Aditivo"/etc.).
  const canEditKind = EDITABLE_KIND_STATUSES.has(item.status) && !isMppFile(item.descriptor);
  const canRemove = REMOVABLE_STATUSES.has(item.status);
  const canRetry = RETRYABLE_STATUSES.has(item.status);

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">
            {item.descriptor.name}
          </span>
          <span className="text-xs text-muted-foreground">
            .{item.descriptor.extension || "?"} ·{" "}
            {formatBytes(item.descriptor.sizeBytes)} ·{" "}
            {PHASE_LABELS[item.phase]}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant={STATUS_BADGE_VARIANT[item.status]}>
            {STATUS_LABELS[item.status]}
          </Badge>

          {canRemove ? (
            <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
              Remover
            </Button>
          ) : null}

          {canRetry ? (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              Tentar novamente
            </Button>
          ) : null}
        </div>
      </div>

      <Progress value={item.progressPercent} />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Tipo documental:</span>
        <Select
          value={item.kind}
          disabled={!canEditKind}
          onChange={(event) =>
            onKindChange(event.target.value as MultiUploadDocumentKind)
          }
          className="h-8 w-auto text-xs"
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
      </div>

      {item.status === "AGUARDANDO_DECISAO_VERSAO" ? (
        <div className="flex flex-col gap-2 rounded-md border border-amber-500/50 bg-amber-50 p-2 text-xs dark:bg-amber-950/30">
          <span>
            Isso parece uma nova versão de{" "}
            <strong>{item.matchedDocumentTitle}</strong>. Confirmar?
          </span>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={onConfirmVersion}>
              Sim, é nova versão
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRejectVersion}
            >
              Não, é um documento separado
            </Button>
          </div>
        </div>
      ) : null}

      {item.status === "AGUARDANDO_DECISAO_CONFLITO" ? (
        <div className="flex flex-col gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs">
          <span>
            Já existe <strong>{item.matchedDocumentTitle}</strong> com um tipo
            documental diferente do selecionado. Decisão necessária.
          </span>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={onConfirmConflict}>
              Enviar como documento novo e separado
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancelConflict}
            >
              Cancelar este arquivo
            </Button>
          </div>
        </div>
      ) : null}

      {item.errorMessage ? (
        <p
          className={
            item.status === "ERRO" || item.status === "REJEITADO"
              ? "text-xs text-destructive"
              : "text-xs text-muted-foreground"
          }
        >
          {item.errorMessage}
        </p>
      ) : null}
    </div>
  );
}
