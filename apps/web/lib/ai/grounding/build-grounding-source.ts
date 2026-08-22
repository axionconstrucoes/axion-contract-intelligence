// Constrói o GroundingSource (vocabulário + cláusulas/fontes legais
// disponíveis) a partir do contexto já recuperado pelos Context
// Builders existentes (build-event-context.ts/build-project-context.ts)
// e dos campos já validados de uma resposta (fatosDocumentados,
// contractualBasis, baseLegal). Nunca acessa o banco, nunca adiciona
// conhecimento fora do que já foi passado ao provider.

import type { EventAnalysisContext, ProjectAnalysisContext } from "../context/types";
import type { LegalCitation } from "../legal/types";
import type { ExpertContractualBasisRef } from "../types";
import type { GroundingSource } from "./types";

export interface BuildGroundingSourceInput {
  eventContext?: EventAnalysisContext | null;
  projectContext?: ProjectAnalysisContext | null;
  /** Fatos já produzidos na própria resposta (fatosDocumentados/finding.facts) — também contam como fonte. */
  documentedFacts?: string[];
  /** Base contratual já citada na resposta — soma-se às cláusulas do contexto bruto. */
  contractualBasis?: ExpertContractualBasisRef[];
  /** Base legal já citada na resposta. */
  legalCitations?: LegalCitation[];
}

function normalizeClauseNumber(value: string): string {
  return value.trim();
}

export function buildGroundingSource(input: BuildGroundingSourceInput): GroundingSource {
  const sourceTexts: string[] = [];
  const clauseNumbers = new Set<string>();
  const legalReferences = new Set<string>();

  const { eventContext, projectContext, documentedFacts, contractualBasis, legalCitations } = input;

  if (eventContext) {
    sourceTexts.push(eventContext.event.title, eventContext.event.description);
    for (const evidence of eventContext.evidence) {
      sourceTexts.push(evidence.label);
    }
    for (const clause of eventContext.relatedClauses) {
      sourceTexts.push(clause.title, clause.text, clause.documentTitle);
      clauseNumbers.add(normalizeClauseNumber(clause.clauseNumber));
    }
    for (const email of eventContext.relatedEmails) {
      sourceTexts.push(email.subject, email.snippet);
    }
    for (const note of eventContext.eventNotes) {
      sourceTexts.push(note.text);
    }
    for (const candidate of eventContext.confrontationCandidates) {
      sourceTexts.push(candidate.summary, candidate.eventBasis, candidate.clauseBasis);
    }
  }

  if (projectContext) {
    sourceTexts.push(projectContext.project.name, projectContext.project.client);
    for (const event of projectContext.events) {
      sourceTexts.push(event.title);
    }
    for (const obligation of projectContext.esgObligations) {
      sourceTexts.push(obligation.title, obligation.requiredEvidenceDescription ?? "", obligation.penaltyDescription ?? "");
    }
  }

  for (const fact of documentedFacts ?? []) {
    sourceTexts.push(fact);
  }

  for (const basis of contractualBasis ?? []) {
    if (basis.clauseNumber) clauseNumbers.add(normalizeClauseNumber(basis.clauseNumber));
    if (basis.excerpt) sourceTexts.push(basis.excerpt);
    if (basis.clauseTitle) sourceTexts.push(basis.clauseTitle);
  }

  for (const citation of legalCitations ?? []) {
    legalReferences.add(citation.source.referencia);
    legalReferences.add(citation.source.dispositivo);
  }

  return {
    sourceTexts: sourceTexts.filter((text) => text.trim().length > 0),
    availableClauseNumbers: Array.from(clauseNumbers).filter((c) => c.length > 0),
    availableLegalReferences: Array.from(legalReferences).filter((r) => r.length > 0),
  };
}
