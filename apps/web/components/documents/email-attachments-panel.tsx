"use client";

// Painel client de "Anexos de E-mail" — recebe as linhas já compostas
// server-side (getEmailAttachmentRegistryForProject) e só filtra/busca/
// ordena no client (sem I/O adicional, sem nova tabela).

import { useMemo, useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { OFFICIAL_EXPERT_DEFINITIONS } from "@/lib/ai/expert-definitions";
import {
  filterEmailAttachmentRows,
  searchEmailAttachmentRows,
  sortEmailAttachmentRows,
} from "@/lib/email/attachments/registry/filter-sort-rows";
import { resolveFileExtensionLabel } from "@/lib/email/attachments/registry/resolve-file-extension";
import type {
  EmailAttachmentRegistryFilter,
  EmailAttachmentRegistryRow,
  EmailAttachmentRegistrySortKey,
} from "@/lib/email/attachments/registry/types";
import type { ExpertId, ExpertSeverity } from "@/lib/ai/types";
import { EmailAttachmentRow } from "./email-attachment-row";

const FILTER_OPTIONS: { value: EmailAttachmentRegistryFilter; label: string }[] = [
  { value: "TODOS", label: "Todos" },
  { value: "CONSIDERADOS_PELO_ACC", label: "Considerados pelo ACC" },
  { value: "PROCESSADOS", label: "Processados" },
  { value: "AGUARDANDO_PROCESSAMENTO", label: "Aguardando processamento" },
  { value: "COM_FINDINGS", label: "Com findings" },
  { value: "INCORPORADOS_A_DOCUMENTOS", label: "Incorporados a Documentos" },
];

const SORT_OPTIONS: { value: EmailAttachmentRegistrySortKey; label: string }[] = [
  { value: "DATA", label: "Data" },
  { value: "NOME", label: "Nome" },
  { value: "STATUS", label: "Status" },
  { value: "RISCO", label: "Risco" },
];

const SEVERITY_OPTIONS: { value: ExpertSeverity; label: string }[] = [
  { value: "LOW", label: "Baixo" },
  { value: "MEDIUM", label: "Médio" },
  { value: "HIGH", label: "Alto" },
  { value: "CRITICAL", label: "Crítico" },
];

export function EmailAttachmentsPanel({
  projectId,
  rows,
  canPromote,
}: {
  projectId: string;
  rows: EmailAttachmentRegistryRow[];
  canPromote: boolean;
}) {
  const [filter, setFilter] = useState<EmailAttachmentRegistryFilter>("TODOS");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<EmailAttachmentRegistrySortKey>("DATA");
  const [fileType, setFileType] = useState<string>("TODOS");
  const [expertId, setExpertId] = useState<string>("TODOS");
  const [severity, setSeverity] = useState<string>("TODOS");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");

  const fileTypeOptions = useMemo(() => {
    const set = new Set(rows.map((row) => resolveFileExtensionLabel(row.attachment.originalFileName)));
    return Array.from(set).sort();
  }, [rows]);

  const visibleRows = useMemo(() => {
    let result = filterEmailAttachmentRows(rows, filter);
    result = searchEmailAttachmentRows(result, query);

    if (fileType !== "TODOS") {
      result = result.filter((row) => resolveFileExtensionLabel(row.attachment.originalFileName) === fileType);
    }
    if (expertId !== "TODOS") {
      result = result.filter((row) => row.expertIds.includes(expertId as ExpertId));
    }
    if (severity !== "TODOS") {
      result = result.filter((row) => row.findings.highestSeverity === severity);
    }
    if (periodFrom) {
      result = result.filter((row) => (row.email?.date ?? row.attachment.receivedAt).slice(0, 10) >= periodFrom);
    }
    if (periodTo) {
      result = result.filter((row) => (row.email?.date ?? row.attachment.receivedAt).slice(0, 10) <= periodTo);
    }

    return sortEmailAttachmentRows(result, sortKey, "desc");
  }, [rows, filter, query, fileType, expertId, severity, periodFrom, periodTo, sortKey]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {FILTER_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setFilter(option.value)}
            className={`rounded-md border px-3 py-1 text-xs font-medium transition-colors ${
              filter === option.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Input
          placeholder="Buscar por arquivo, assunto ou remetente…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="lg:col-span-2"
        />

        <Select value={fileType} onChange={(event) => setFileType(event.target.value)}>
          <option value="TODOS">Tipo de arquivo</option>
          {fileTypeOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>

        <Select value={expertId} onChange={(event) => setExpertId(event.target.value)}>
          <option value="TODOS">Expert</option>
          {Object.values(OFFICIAL_EXPERT_DEFINITIONS).map((definition) => (
            <option key={definition.expertId} value={definition.expertId}>
              {definition.expertName}
            </option>
          ))}
        </Select>

        <Select value={severity} onChange={(event) => setSeverity(event.target.value)}>
          <option value="TODOS">Risco</option>
          {SEVERITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>

        <Select value={sortKey} onChange={(event) => setSortKey(event.target.value as EmailAttachmentRegistrySortKey)}>
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              Ordenar por {option.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Período
          <Input type="date" value={periodFrom} onChange={(event) => setPeriodFrom(event.target.value)} className="h-8 w-auto" />
        </label>
        <span className="text-xs text-muted-foreground">até</span>
        <Input type="date" value={periodTo} onChange={(event) => setPeriodTo(event.target.value)} className="h-8 w-auto" />
      </div>

      {visibleRows.length === 0 ? (
        <EmptyState message="Nenhum anexo de e-mail encontrado para os filtros selecionados." />
      ) : (
        <div className="flex flex-col gap-3">
          {visibleRows.map((row) => (
            <EmailAttachmentRow key={row.attachment.id} projectId={projectId} row={row} canPromote={canPromote} />
          ))}
        </div>
      )}
    </div>
  );
}
