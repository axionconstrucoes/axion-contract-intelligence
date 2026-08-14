import type { EvidenceRef } from "@axion/types";
import { Card, CardContent } from "@/components/ui/card";
import { getDocument, getEmail } from "@/lib/data";
import { sourceTypeShortLabels } from "@/lib/labels";

export function EvidenceViewer({ evidence }: { evidence: EvidenceRef }) {
  const email = evidence.emailId ? getEmail(evidence.emailId) : null;
  const document = evidence.documentId ? getDocument(evidence.documentId) : null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase text-muted-foreground">
            Evidência original — {sourceTypeShortLabels[evidence.sourceType]}
          </span>
        </div>
        <p className="text-sm font-medium">{evidence.label}</p>
        <p className="font-mono text-xs text-muted-foreground">{evidence.locator}</p>
        {email && (
          <div className="mt-1 rounded-md border border-border bg-muted/40 p-3 text-sm">
            <p><span className="text-muted-foreground">De:</span> {email.from}</p>
            <p><span className="text-muted-foreground">Para:</span> {email.to}</p>
            <p><span className="text-muted-foreground">Assunto:</span> {email.subject}</p>
            <p className="mt-2 text-muted-foreground">{email.snippet}</p>
          </div>
        )}
        {document && (
          <div className="mt-1 rounded-md border border-border bg-muted/40 p-3 text-sm">
            <p className="font-medium">{document.title}</p>
            <p className="text-muted-foreground">{document.summary}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
