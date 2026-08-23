// Filtro, busca e ordenação — funções puras (sem I/O), reutilizadas
// tanto pelo componente client (components/documents/email-attachments-panel.tsx)
// quanto pelos testes (sem precisar de jsdom).

import type { EmailAttachmentRegistryFilter, EmailAttachmentRegistryRow, EmailAttachmentRegistrySortKey } from "./types";

const SEVERITY_RANK: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

export function filterEmailAttachmentRows(
  rows: EmailAttachmentRegistryRow[],
  filter: EmailAttachmentRegistryFilter
): EmailAttachmentRegistryRow[] {
  switch (filter) {
    case "CONSIDERADOS_PELO_ACC":
      return rows.filter((row) => row.consideredByAcc);
    case "PROCESSADOS":
      return rows.filter((row) => row.displayStatus.tone === "processed");
    case "AGUARDANDO_PROCESSAMENTO":
      return rows.filter((row) => row.displayStatus.tone === "pending" || row.displayStatus.tone === "processing");
    case "COM_FINDINGS":
      return rows.filter((row) => row.findings.count > 0);
    case "INCORPORADOS_A_DOCUMENTOS":
      return rows.filter((row) => row.linkedDocument !== null);
    case "TODOS":
    default:
      return rows;
  }
}

export function searchEmailAttachmentRows(rows: EmailAttachmentRegistryRow[], query: string): EmailAttachmentRegistryRow[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return rows;
  return rows.filter((row) => {
    const haystack = [row.attachment.originalFileName, row.email?.subject ?? "", row.email?.from ?? ""].join(" ").toLowerCase();
    return haystack.includes(normalized);
  });
}

export function sortEmailAttachmentRows(
  rows: EmailAttachmentRegistryRow[],
  sortKey: EmailAttachmentRegistrySortKey,
  direction: "asc" | "desc" = "desc"
): EmailAttachmentRegistryRow[] {
  const sorted = [...rows].sort((a, b) => {
    switch (sortKey) {
      case "NOME":
        return a.attachment.originalFileName.localeCompare(b.attachment.originalFileName, "pt-BR");
      case "STATUS":
        return a.displayStatus.label.localeCompare(b.displayStatus.label, "pt-BR");
      case "RISCO": {
        const rankA = a.findings.highestSeverity ? SEVERITY_RANK[a.findings.highestSeverity] : -1;
        const rankB = b.findings.highestSeverity ? SEVERITY_RANK[b.findings.highestSeverity] : -1;
        return rankA - rankB;
      }
      case "DATA":
      default: {
        const dateA = a.email?.date ?? a.attachment.receivedAt;
        const dateB = b.email?.date ?? b.attachment.receivedAt;
        return dateA.localeCompare(dateB);
      }
    }
  });
  return direction === "desc" ? sorted.reverse() : sorted;
}
