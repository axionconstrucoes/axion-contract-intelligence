import { AdditionalProposalLinkForm } from "./additional-proposal-link-form";
import { FeatureInfo } from "@/components/shared/feature-info";
import { CHECKLIST_LINK_ROLES, type AdditionalProposalLink } from "@/lib/additionals/types";
import type { SuggestedExistingSources } from "@/lib/additionals/suggest-existing-sources";
import { additionalProposalLinkRoleLabels, formatDate } from "@/lib/labels";

/**
 * Checklist mínimo exigido ao marcar CONTRATADO (seção "DOCUMENTAÇÃO DO
 * ADICIONAL CONTRATADO"). Sempre mostra primeiro o que já existe no
 * sistema (suggestExistingSourcesForProposal) — nunca pede upload
 * duplicado sem antes sugerir o que já foi encontrado.
 */
export function AdditionalProposalChecklist({
  projectId,
  proposalId,
  links,
  suggestions,
}: {
  projectId: string;
  proposalId: string;
  links: AdditionalProposalLink[];
  suggestions: SuggestedExistingSources;
}) {
  const linksByRole = new Map<string, AdditionalProposalLink[]>();
  for (const link of links) {
    const list = linksByRole.get(link.linkRole) ?? [];
    list.push(link);
    linksByRole.set(link.linkRole, list);
  }

  const hasSuggestions = suggestions.documents.length > 0 || suggestions.emails.length > 0;

  return (
    <div className="flex flex-col gap-4 rounded-md border p-4">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-medium">
          Checklist documental
          <FeatureInfo helpId="adicionais-documentacao" />
        </p>
        <p className="text-xs text-muted-foreground">
          O sistema busca automaticamente o que já existe no projeto antes de pedir um novo upload.
        </p>
      </div>

      {hasSuggestions ? (
        <div className="rounded-md bg-accent/40 p-3 text-xs">
          <p className="mb-1 font-medium">Já encontrado no projeto (número da proposta no título/assunto):</p>
          <ul className="flex flex-col gap-1">
            {suggestions.documents.map((d) => (
              <li key={d.documentVersionId}>
                Documento: {d.documentTitle} ({d.documentKind}, {d.versionLabel}) — id <code>{d.documentVersionId}</code>
              </li>
            ))}
            {suggestions.emails.map((e) => (
              <li key={e.emailId}>
                E-mail: {e.subject} ({formatDate(e.sentAt)}) — id <code>{e.emailId}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col divide-y">
        {CHECKLIST_LINK_ROLES.map((role) => {
          const roleLinks = linksByRole.get(role) ?? [];
          return (
            <div key={role} className="flex flex-col gap-2 py-3">
              <p className="text-sm font-medium">{additionalProposalLinkRoleLabels[role]}</p>
              {roleLinks.length > 0 ? (
                <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {roleLinks.map((link) => (
                    <li key={link.id}>
                      {link.notApplicable
                        ? `Não aplicável — ${link.notApplicableJustification}`
                        : `Vinculado (${link.documentVersionId ? "documento" : link.emailId ? "e-mail" : link.emailAttachmentId ? "anexo" : "evento"}: ${
                            link.documentVersionId ?? link.emailId ?? link.emailAttachmentId ?? link.eventId
                          })`}
                    </li>
                  ))}
                </ul>
              ) : (
                <AdditionalProposalLinkForm projectId={projectId} proposalId={proposalId} linkRole={role} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
