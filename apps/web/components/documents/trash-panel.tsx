import { RestoreDocumentControl } from "@/components/documents/restore-document-control";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TrashedDocument } from "@/lib/document-management";
import { formatDateTime } from "@/lib/labels";

// Lixeira — só renderizado pelo caller (documentos/page.tsx) quando o
// usuário é ADMINISTRADOR ativo do projeto (mesma permissão exigida
// pelas RPCs trash_project_document/restore_project_document no
// servidor). Reversível por construção: nada aqui foi apagado, só
// marcado com deleted_at.
export function TrashPanel({
  projectId,
  trashedDocuments,
}: {
  projectId: string;
  trashedDocuments: TrashedDocument[];
}) {
  if (trashedDocuments.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Lixeira</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Nenhum documento na lixeira.</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lixeira ({trashedDocuments.length})</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {trashedDocuments.map((document) => (
          <div
            key={document.id}
            className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate font-medium">{document.title}</span>
              <span className="text-xs text-muted-foreground">
                {document.kind.replaceAll("_", " ")} · enviado para a lixeira em {formatDateTime(document.deletedAt)}
                {document.deletedByUserName ? ` por ${document.deletedByUserName}` : ""}
              </span>
            </div>
            <RestoreDocumentControl projectId={projectId} documentId={document.id} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
