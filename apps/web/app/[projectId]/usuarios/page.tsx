import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { getProjectMembers } from "@/lib/data";
import { originLabels, permissionLabels } from "@/lib/labels";

export const metadata: Metadata = { title: "Usuários" };

export default async function UsuariosPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const members = await getProjectMembers(projectId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Usuários & Permissões" description="Usuários internos Axion e terceiros com acesso a este projeto." />
      {members.length === 0 ? (
        <EmptyState message="Nenhum usuário com acesso a este projeto." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Usuário</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Cargo</TableHead>
              <TableHead>Permissão</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.userId}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Avatar>{m.user.avatarInitials}</Avatar>
                    <div>
                      <p className="font-medium">{m.user.name}</p>
                      <p className="text-xs text-muted-foreground">{m.user.email}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{originLabels[m.user.origin]}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{m.user.title}</TableCell>
                <TableCell>
                  <Badge>{permissionLabels[m.permission]}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
