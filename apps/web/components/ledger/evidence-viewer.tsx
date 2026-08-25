import type { EvidenceRef } from "@axion/types";
import { Card, CardContent } from "@/components/ui/card";
import { getDocument, getDocumentVersion, getEmail } from "@/lib/data";
import { formatDate, sourceTypeShortLabels } from "@/lib/labels";

export async function EvidenceViewer({ evidences }: { evidences: EvidenceRef[] }) {
  const cards = await Promise.all(
    evidences.map(async (evidence, index) => {
      const email = evidence.emailId ? await getEmail(evidence.emailId) : null;
      const documentVersion = evidence.documentVersionId
        ? await getDocumentVersion(evidence.documentVersionId)
        : null;
      const document = documentVersion ? await getDocument(documentVersion.documentId) : null;

      return (
        <Card key={evidence.id ?? `${index}-${evidence.locator}`}>
          <CardContent className="flex flex-col gap-1.5 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase text-muted-foreground">
                Evidência original — {sourceTypeShortLabels[evidence.sourceType]}
              </span>
            </div>
            <p className="text-sm font-medium">{evidence.label}</p>
            <p className="font-mono text-xs text-muted-foreground">{evidence.locator}</p>
            {evidence.emailId && (
              <div className="mt-1 rounded-md border border-border bg-muted/40 p-3 text-sm">
                {email ? (
                  <>
                    <p><span className="text-muted-foreground">De:</span> {email.from}</p>
                    <p><span className="text-muted-foreground">Para:</span> {email.to}</p>
                    <p><span className="text-muted-foreground">Assunto:</span> {email.subject}</p>
                    <p className="mt-2 text-muted-foreground">{email.snippet}</p>
                  </>
                ) : (
                  <p className="text-muted-foreground">E-mail não disponível</p>
                )}
              </div>
            )}
            {evidence.documentVersionId && (
              <div className="mt-1 rounded-md border border-border bg-muted/40 p-3 text-sm">
                {documentVersion ? (
                  <>
                    <p className="font-medium">{document?.title ?? "Documento não disponível"}</p>
                    <p className="text-muted-foreground">
                      Versão {documentVersion.versionLabel} · {formatDate(documentVersion.documentDate)}
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground">Versão de documento não disponível</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      );
    })
  );

  return <div className="flex flex-col gap-2">{cards}</div>;
}
