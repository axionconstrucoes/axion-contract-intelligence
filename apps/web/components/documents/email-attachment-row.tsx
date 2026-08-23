"use client";

// Uma linha por ocorrência de attachment/e-mail (seção 5/17 do
// requisito) — nunca colapsa mesmo hash em e-mails diferentes, nunca
// duplica por Expert/finding (agregados na própria linha, seção 18).

import { useState } from "react";
import { AttachmentStatusBadge, SeverityBadge } from "@/components/shared/badges";
import { FeatureInfo } from "@/components/shared/feature-info";
import { Button } from "@/components/ui/button";
import { expertIconClassName, resolveExpertIcon } from "@/components/ai/expert-visual-identity";
import { OFFICIAL_EXPERT_DEFINITIONS } from "@/lib/ai/expert-definitions";
import { confrontationSeverityToAlertSeverity, formatDate, formatDateTime, formatFileSize } from "@/lib/labels";
import { resolveFileExtensionLabel } from "@/lib/email/attachments/registry/resolve-file-extension";
import type { EmailAttachmentRegistryRow } from "@/lib/email/attachments/registry/types";
import { EmailAttachmentPromoteForm } from "./email-attachment-promote-form";

export function EmailAttachmentRow({
  projectId,
  row,
  canPromote,
}: {
  projectId: string;
  row: EmailAttachmentRegistryRow;
  canPromote: boolean;
}) {
  const [promoting, setPromoting] = useState(false);
  const { attachment, email, displayStatus, linkedDocument, consideredByAcc, expertIds, findings, sameContentOccurrenceCount } = row;

  const emailDate = email?.date ?? attachment.receivedAt;
  const extension = resolveFileExtensionLabel(attachment.originalFileName);

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{formatDate(emailDate)}</p>
          <p className="truncate text-sm font-medium">{attachment.originalFileName}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md border px-2 py-0.5 text-xs font-medium">{extension}</span>
          <AttachmentStatusBadge status={displayStatus} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          De: <strong className="text-foreground">{email?.from ?? "Remetente não disponível"}</strong>
        </span>
        <span>·</span>
        <span>{email?.subject ?? "Assunto não disponível"}</span>
        {sameContentOccurrenceCount > 1 ? (
          <>
            <span>·</span>
            <span>Mesmo conteúdo encontrado em {sameContentOccurrenceCount} e-mails</span>
          </>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <span className="flex items-center gap-1.5 text-xs">
          <span className="font-medium">Considerado pelo ACC:</span>
          <span className={consideredByAcc ? "font-medium text-severity-baixa" : "text-muted-foreground"}>
            {consideredByAcc ? "Sim" : "Não"}
          </span>
          <FeatureInfo helpId="anexos-considerado" />
        </span>

        {expertIds.length > 0 ? (
          <span className="flex items-center gap-1">
            {expertIds.map((expertId) => {
              const definition = OFFICIAL_EXPERT_DEFINITIONS[expertId as keyof typeof OFFICIAL_EXPERT_DEFINITIONS];
              if (!definition) return null;
              const Icon = resolveExpertIcon(definition.visualIdentity);
              return (
                <span key={expertId} title={definition.expertName}>
                  <Icon className={expertIconClassName(definition.visualIdentity, "size-3.5")} aria-hidden="true" />
                </span>
              );
            })}
          </span>
        ) : null}

        {findings.count > 0 ? (
          <span className="flex items-center gap-1.5 text-xs">
            {findings.highestSeverity ? <SeverityBadge severity={confrontationSeverityToAlertSeverity[findings.highestSeverity]} /> : null}
            <span>
              {findings.count} finding{findings.count === 1 ? "" : "s"}
            </span>
          </span>
        ) : null}

        <span className="flex items-center gap-1.5 text-xs">
          {linkedDocument ? (
            <span className="font-medium text-severity-baixa">Incorporado aos Documentos</span>
          ) : (
            <span className="text-muted-foreground">Não incorporado</span>
          )}
          <FeatureInfo helpId="anexos-incorporado" />
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <details className="rounded-md border">
          <summary className="cursor-pointer p-2 text-xs font-medium">Ver e-mail de origem</summary>
          <div className="flex flex-col gap-1 border-t p-3 text-xs text-muted-foreground">
            <p>
              <strong className="text-foreground">Assunto:</strong> {email?.subject ?? "Não disponível"}
            </p>
            <p>
              <strong className="text-foreground">De:</strong> {email?.from ?? "Não disponível"}
            </p>
            <p>
              <strong className="text-foreground">Para:</strong> {email?.to ?? "Não disponível"}
            </p>
            <p>
              <strong className="text-foreground">Data/hora:</strong> {email ? formatDateTime(email.date) : "Não disponível"}
            </p>
            {email?.snippet ? <p className="pt-1">{email.snippet}</p> : null}
          </div>
        </details>

        <details className="rounded-md border">
          <summary className="cursor-pointer p-2 text-xs font-medium">Proveniência</summary>
          <dl className="grid gap-2 border-t p-3 text-xs sm:grid-cols-2">
            <ProvenanceField label="Filename" value={attachment.originalFileName} />
            <ProvenanceField label="Tipo" value={attachment.mimeType} />
            <ProvenanceField label="Tamanho" value={formatFileSize(attachment.fileSizeBytes)} />
            <ProvenanceField label="Hash (SHA-256)" value={attachment.sha256Hash} />
            <ProvenanceField label="Gmail message ID" value={attachment.gmailMessageId} />
            <ProvenanceField label="Attachment ID" value={attachment.id} />
            <ProvenanceField label="Data/hora do e-mail" value={email ? formatDateTime(email.date) : "Não disponível"} />
            <ProvenanceField label="Remetente" value={email?.from ?? "Não disponível"} />
            <ProvenanceField label="Destinatários" value={email?.to ?? "Não disponível"} />
            <ProvenanceField label="Assunto" value={email?.subject ?? "Não disponível"} />
            <ProvenanceField label="Storage path" value={attachment.storagePath} />
            <ProvenanceField label="Status de processamento" value={displayStatus.label} />
            <ProvenanceField
              label="Documento ACC vinculado"
              value={linkedDocument ? `${linkedDocument.documentTitle} (${linkedDocument.documentKind})` : "Nenhum"}
            />
            <ProvenanceField
              label="Experts relacionados"
              value={
                expertIds.length > 0
                  ? expertIds
                      .map((id) => OFFICIAL_EXPERT_DEFINITIONS[id as keyof typeof OFFICIAL_EXPERT_DEFINITIONS]?.expertName ?? id)
                      .join(", ")
                  : "Nenhum"
              }
            />
            <ProvenanceField label="Findings relacionados" value={findings.count > 0 ? `${findings.count} finding(s)` : "Nenhum"} />
          </dl>
        </details>
      </div>

      {!linkedDocument && canPromote ? (
        promoting ? (
          <EmailAttachmentPromoteForm
            projectId={projectId}
            attachmentId={attachment.id}
            defaultTitle={email?.subject ?? attachment.originalFileName}
            defaultDate={emailDate.slice(0, 10)}
            defaultAuthor={email?.from ?? ""}
            onCancel={() => setPromoting(false)}
          />
        ) : (
          <div>
            <Button type="button" size="sm" variant="outline" onClick={() => setPromoting(true)}>
              Incorporar aos Documentos
            </Button>
          </div>
        )
      ) : null}
    </div>
  );
}

function ProvenanceField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words text-foreground">{value}</dd>
    </div>
  );
}
