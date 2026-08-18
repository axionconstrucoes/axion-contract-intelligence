import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { getAuditLog, getUser } from "@/lib/data";
import { formatDateTime } from "@/lib/labels";

export default async function AuditoriaPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const log = getAuditLog(projectId);
  const entries = await Promise.all(
    log.map(async (entry) => {
      if (entry.actor === "sistema") {
        return { ...entry, actorLabel: "Sistema" };
      }
      const user = await getUser(entry.actor);
      return { ...entry, actorLabel: user ? user.name : "Usuário não disponível" };
    })
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Auditoria</h1>
        <p className="text-sm text-muted-foreground">Trilha cronológica de ações realizadas na plataforma.</p>
      </div>
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
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(entry.timestamp)}</TableCell>
                <TableCell>{entry.actorLabel}</TableCell>
                <TableCell>{entry.action}</TableCell>
                <TableCell className="text-muted-foreground">{entry.entityType} · {entry.entityId}</TableCell>
                <TableCell className="text-muted-foreground">{entry.detail}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
