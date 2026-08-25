import type { Metadata } from "next";
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

export const metadata: Metadata = { title: "Auditoria" };

export default async function AuditoriaPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

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

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Auditoria" description="Trilha cronológica de ações realizadas na plataforma." />

      {entries.length === 0 ? (
        <EmptyState message="Nenhum registro de auditoria." />
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
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDateTime(entry.timestamp)}
                </TableCell>

                <TableCell>{entry.actorLabel}</TableCell>

                <TableCell>{normalizeLegacyMojibake(entry.action)}</TableCell>

                <TableCell className="text-muted-foreground">
                  {entry.entityType} · {entry.entityId}
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
