import type { Metadata } from "next";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { getAuditLog, getUser } from "@/lib/data";
import { formatDateTime } from "@/lib/labels";
import { normalizeLegacyMojibake } from "@/lib/normalize-legacy-mojibake";
import { Badge } from "@/components/ui/badge";

const LOG_FILTERS = [
  { value: "TODOS", label: "Todos" },
  { value: "PROJETOS", label: "Projetos e versões" },
  { value: "ATAS", label: "Atas de reunião" },
  { value: "RELATORIOS", label: "Relatórios e RDO" },
  { value: "MEDICOES", label: "Medições" },
  { value: "EMAILS", label: "E-mails" },
  { value: "ACOES", label: "Ações e SLA" },
  { value: "SSMA", label: "SSMA/ESG" },
  { value: "INTEGRACOES", label: "Integrações e falhas" },
] as const;

type LogFilter = (typeof LOG_FILTERS)[number]["value"];

function classifyLog(entry: { action: string; entityType: string; detail: string }): Exclude<LogFilter, "TODOS"> {
  const haystack = `${entry.action} ${entry.entityType} ${entry.detail}`.toLocaleUpperCase("pt-BR");
  if (/ACCIDENT|SSMA|ESG/.test(haystack)) return "SSMA";
  if (/INTEGRATION|SYNC|CONSTRUMANAGER|DRIVE|CONECTIV/.test(haystack)) return "INTEGRACOES";
  if (/MEASUREMENT|MEDI[CÇ][AÃ]O/.test(haystack)) return "MEDICOES";
  if (/MEETING|MINUTE|ATA /.test(haystack)) return "ATAS";
  if (/REPORT|RELAT[OÓ]RIO|DIARIO|DIÁRIO|RDO/.test(haystack)) return "RELATORIOS";
  if (/EMAIL|GMAIL/.test(haystack)) return "EMAILS";
  if (/SLA|ACTION|ESCALAT|A[CÇ][AÃ]O/.test(haystack)) return "ACOES";
  return "PROJETOS";
}

export const metadata: Metadata = { title: "Auditoria" };

export default async function AuditoriaPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ tipo?: string }>;
}) {
  const { projectId } = await params;
  const requestedFilter = (await searchParams).tipo?.toLocaleUpperCase("pt-BR") ?? "TODOS";
  const activeFilter = LOG_FILTERS.some((item) => item.value === requestedFilter)
    ? requestedFilter as LogFilter
    : "TODOS";

  const log = await getAuditLog(projectId);

  const entries = await Promise.all(
    log.map(async (entry) => {
      if (entry.actorType === "SYSTEM") {
        return {
          ...entry,
          actorLabel: "Sistema",
        };
      }

      if (entry.actorType === "LEGACY") {
        return {
          ...entry,
          actorLabel: entry.actorLabel ?? "Usuário legado",
        };
      }

      const user = await getUser(entry.actor);

      return {
        ...entry,
        actorLabel: user ? user.name : "Usuário não disponível",
      };
    })
  );
  const categorizedEntries = entries.map((entry) => ({ ...entry, category: classifyLog(entry) }));
  const visibleEntries = activeFilter === "TODOS"
    ? categorizedEntries
    : categorizedEntries.filter((entry) => entry.category === activeFilter);
  const operationalFailures = categorizedEntries.filter((entry) =>
    /FAILED|ERROR|INDISPON[IÍ]VEL|TARGET_NOT_CONFIGURED/.test(`${entry.action} ${entry.detail}`.toLocaleUpperCase("pt-BR"))
  ).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Auditoria" description="Trilha cronológica e supervisão operacional para a Diretoria." />

      <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
        <span className="mr-1 text-sm font-semibold">Filtrar logs:</span>
        {LOG_FILTERS.map((filter) => (
          <Link
            key={filter.value}
            href={filter.value === "TODOS" ? `/${projectId}/auditoria` : `/${projectId}/auditoria?tipo=${filter.value}`}
          >
            <Badge variant={activeFilter === filter.value ? "default" : "outline"}>{filter.label}</Badge>
          </Link>
        ))}
      </div>

      {operationalFailures > 0 ? (
        <div className="rounded-md border border-red-600 bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-100">
          <strong>Supervisão do ACC:</strong> {operationalFailures} registro(s) de falha ou indisponibilidade no histórico. Use o filtro “Integrações e falhas” para investigar.
        </div>
      ) : null}

      {visibleEntries.length === 0 ? (
        <EmptyState message="Nenhum registro de auditoria para este filtro." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data/Hora</TableHead>
              <TableHead>Ator</TableHead>
              <TableHead>Ação</TableHead>
              <TableHead>Entidade</TableHead>
              <TableHead>Detalhe</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {visibleEntries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDateTime(entry.timestamp)}
                </TableCell>

                <TableCell>{entry.actorLabel}</TableCell>

                <TableCell>{normalizeLegacyMojibake(entry.action)}</TableCell>

                <TableCell className="text-muted-foreground">
                  <span title={`Categoria: ${LOG_FILTERS.find((item) => item.value === entry.category)?.label ?? entry.category}`}>
                    {entry.entityType} · {entry.entityId}
                  </span>
                </TableCell>

                <TableCell className="text-muted-foreground">
                  {normalizeLegacyMojibake(entry.detail)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
