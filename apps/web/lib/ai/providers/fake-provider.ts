// Provider determinístico/fake — nenhuma chamada externa, nenhum custo,
// nenhuma rede. Usado como default nesta fase (AXION_AI_PROVIDER=fake) e
// para testes: mesma entrada sempre produz a mesma saída.
//
// Genérico por design: nunca conhece qual Expert está chamando (nada de
// nome/id/instruções hardcoded de um Expert específico) — usa somente o
// que vem em AiProviderRequest. Qualquer Expert pode reutilizar este
// provider sem alteração alguma neste arquivo.
//
// Importante: este provider NUNCA produz interpretação real — ele apenas
// ecoa, de forma estruturada e rastreável, os dados já presentes no
// EventAnalysisContext, e declara explicitamente em `uncertainties` que
// nenhuma análise real foi feita.

import type { EventAnalysisContext, ProjectAnalysisContext } from "../context/types";
import { LEGAL_SOURCE_UNAVAILABLE_NOTICE } from "../legal/types";
import type { ExpertContractualBasisRef, ExpertEvidenceRef, ExpertSeverity } from "../types";
import type {
  AiProvider,
  AiProviderCurationRequest,
  AiProviderQueryRequest,
  AiProviderRequest,
  AiProviderResponse,
} from "./types";

const SEVERITY_RANK: Record<ExpertSeverity, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

function isExpertSeverity(value: string): value is ExpertSeverity {
  return value === "LOW" || value === "MEDIUM" || value === "HIGH" || value === "CRITICAL";
}

function deriveSeverity(context: EventAnalysisContext): ExpertSeverity {
  const candidateSeverities = context.confrontationCandidates
    .map((c) => c.severity)
    .filter(isExpertSeverity);

  if (candidateSeverities.length > 0) {
    return candidateSeverities.reduce((highest, current) =>
      SEVERITY_RANK[current] > SEVERITY_RANK[highest] ? current : highest
    );
  }

  return context.relatedClauses.length > 0 ? "MEDIUM" : "LOW";
}

function deriveConfidence(context: EventAnalysisContext): number {
  const raw = 0.3 + 0.05 * context.relatedClauses.length + 0.05 * context.evidence.length;
  return Math.round(Math.min(raw, 0.6) * 100) / 100;
}

function buildContractualBasis(context: EventAnalysisContext): ExpertContractualBasisRef[] {
  return context.relatedClauses.map((clause) => ({
    documentId: clause.documentId || null,
    documentKind: clause.documentKind,
    clauseId: clause.id,
    clauseNumber: clause.clauseNumber,
    clauseTitle: clause.title,
    excerpt: clause.text.length > 400 ? `${clause.text.slice(0, 400)}…` : clause.text,
  }));
}

function buildEvidenceRefs(context: EventAnalysisContext): ExpertEvidenceRef[] {
  const fromEvidence: ExpertEvidenceRef[] = context.evidence.map((e) => ({
    sourceType: e.sourceType === "EMAIL" ? "EMAIL" : "DOCUMENT",
    sourceId: e.id,
    label: e.label,
    locator: e.locator,
  }));

  const fromClauses: ExpertEvidenceRef[] = context.relatedClauses.map((clause) => ({
    sourceType: "CLAUSE",
    sourceId: clause.id,
    label: `Cláusula ${clause.clauseNumber} — ${clause.title}`,
    locator: clause.documentTitle,
  }));

  const fromEmails: ExpertEvidenceRef[] = context.relatedEmails.map((email) => ({
    sourceType: "EMAIL",
    sourceId: email.id,
    label: email.subject,
    locator: `De: ${email.fromAddress} · Para: ${email.toAddress}`,
  }));

  return [...fromEvidence, ...fromClauses, ...fromEmails];
}

function buildFacts(context: EventAnalysisContext): string[] {
  const facts: string[] = [
    `Evento "${context.event.title}" (id=${context.event.id}), status ${context.event.status}, origem ${context.event.sourceType}.`,
  ];

  if (context.event.description.trim()) {
    facts.push(`Descrição registrada do evento: "${context.event.description.trim()}"`);
  }

  for (const clause of context.relatedClauses) {
    facts.push(`Cláusula ${clause.clauseNumber} ("${clause.title}") do documento "${clause.documentTitle}" está relacionada a este evento.`);
  }

  for (const candidate of context.confrontationCandidates) {
    facts.push(
      `Candidato de confrontação ${candidate.id} (status ${candidate.status}, confiança ${candidate.confidence}): ${candidate.summary}`
    );
  }

  return facts;
}

function buildQueryFacts(eventContext: EventAnalysisContext | null, projectContext: ProjectAnalysisContext | null): string[] {
  if (eventContext) {
    return buildFacts(eventContext);
  }
  if (projectContext) {
    return [
      `Projeto "${projectContext.project.name}" (id=${projectContext.project.id}), cliente ${projectContext.project.client}, status ${projectContext.project.status}.`,
      `${projectContext.eventsTotalCount} evento(s) no Event Ledger deste projeto — ${projectContext.events.length} mais recente(s) considerado(s) nesta consulta.`,
    ];
  }
  return [];
}

function buildQueryRisks(eventContext: EventAnalysisContext | null): string[] {
  if (!eventContext) return [];
  return eventContext.confrontationCandidates
    .filter((c) => c.severity === "HIGH" || c.severity === "CRITICAL")
    .map(
      (c) =>
        `Risco já sinalizado pelo confronto automático (candidato ${c.id}, severidade ${c.severity}): ${c.summary}`
    );
}

export function createFakeAiProvider(): AiProvider {
  return {
    id: "fake",
    async answerQuery(request: AiProviderQueryRequest): Promise<AiProviderResponse> {
      const { eventContext, projectContext } = request;

      const contextoInternoDeclarado = (eventContext?.eventNotes ?? []).map((note) => ({
        noteId: note.id,
        category: note.category,
        text: note.text,
        author: note.author,
        createdAt: note.createdAt,
        status: "DECLARED_CONTEXT" as const,
      }));

      const output = {
        expertId: request.expertId,
        expertName: request.expertName,
        expertVersion: request.expertVersion,
        scope: request.scope,
        question: request.question,
        fatosDocumentados: buildQueryFacts(eventContext, projectContext),
        contextoInternoDeclarado,
        baseContratual: eventContext ? buildContractualBasis(eventContext) : [],
        baseLegal: [],
        praticasNegociais: [],
        interpretacao:
          `Nenhuma interpretação real foi realizada para a pergunta "${request.question}" — este é o provider ` +
          `determinístico (fake) usado para validar a estrutura de resposta antes da conexão de um LLM real.`,
        riscos: buildQueryRisks(eventContext),
        severity: eventContext ? deriveSeverity(eventContext) : "LOW",
        recomendacoes: [
          "Revisar manualmente o contexto e as evidências relacionadas antes de qualquer decisão.",
          "Configurar um provider de IA real (AXION_AI_PROVIDER) para obter uma resposta de fato.",
        ],
        acoesSugeridas: [],
        informacoesFaltantes: [
          "Este resultado foi gerado pelo provider de teste (fake) — nenhuma análise real foi realizada.",
          LEGAL_SOURCE_UNAVAILABLE_NOTICE,
        ],
        rascunhoSugerido: null,
        confidence: eventContext ? deriveConfidence(eventContext) : 0.2,
        requiresHumanReview: true,
      };

      return {
        providerId: "fake",
        model: null,
        output,
      };
    },
    async generateAssessment(request: AiProviderRequest): Promise<AiProviderResponse> {
      const { context } = request;

      const possibleImpacts = context.confrontationCandidates.map(
        (candidate) =>
          `Impacto potencial já sinalizado pelo confronto automático (candidato ${candidate.id}, não pela análise deste Expert): ${candidate.summary}`
      );

      const output = {
        expertId: request.expertId,
        expertName: request.expertName,
        expertVersion: request.expertVersion,
        analysisType: request.analysisType,
        finding: {
          facts: buildFacts(context),
          interpretation:
            "Nenhuma interpretação real foi realizada — este é o provider determinístico (fake) usado para validar a estrutura de saída antes da conexão de um LLM real.",
        },
        severity: deriveSeverity(context),
        confidence: deriveConfidence(context),
        executiveSummary: `Contexto do evento "${context.event.title}" montado com sucesso: ${context.relatedClauses.length} cláusula(s), ${context.evidence.length} evidência(s) e ${context.relatedEmails.length} e-mail(s) relacionados. Nenhuma conclusão foi produzida por este provider.`,
        contractualBasis: buildContractualBasis(context),
        eventBasis: [context.event.title, context.event.description].filter((v) => v.trim().length > 0),
        evidenceRefs: buildEvidenceRefs(context),
        possibleImpacts,
        recommendedActions: [
          "Revisar manualmente as cláusulas e evidências relacionadas antes de qualquer decisão.",
          "Configurar um provider de IA real (AXION_AI_PROVIDER) para obter uma interpretação de fato.",
        ],
        uncertainties: [
          "Este resultado foi gerado por um provider determinístico (fake) — nenhuma análise real foi realizada.",
        ],
        requiresHumanReview: true,
      };

      return {
        providerId: "fake",
        model: null,
        output,
      };
    },

    async consolidateExecutiveCuration(request: AiProviderCurationRequest): Promise<AiProviderResponse> {
      const highestSeverity = request.positions.reduce<ExpertSeverity>(
        (highest, position) => (SEVERITY_RANK[position.severity] > SEVERITY_RANK[highest] ? position.severity : highest),
        "LOW"
      );

      const output = {
        situacao: request.situationSummary,
        fatosPrincipais: request.positions.map((p) => `${p.expertName}: ${p.interpretacao}`),
        posicoes: request.positions.map((p) => ({
          expertId: p.expertId,
          expertName: p.expertName,
          severity: p.severity,
          summary: p.interpretacao,
        })),
        // O provider fake nunca infere divergência real entre posições —
        // isso exigiria interpretação, que este provider deliberadamente
        // não produz (ver comentário no topo do arquivo).
        divergencias: [],
        riscos: request.positions.flatMap((p) => p.riscos),
        overallSeverity: highestSeverity,
        alternativas: [],
        recomendacao:
          "Nenhuma consolidação executiva real foi realizada — este é o provider determinístico (fake) usado para " +
          "validar a estrutura de saída antes da conexão de um LLM real. Configure um provider real (AXION_AI_PROVIDER_CEO).",
        decisoesHumanasNecessarias: [
          ...new Set(request.positions.flatMap((p) => p.informacoesFaltantes)),
          "Revisar manualmente as posições de cada Expert antes de qualquer decisão executiva.",
        ],
        requiresHumanReview: true,
      };

      return {
        providerId: "fake",
        model: null,
        output,
      };
    },
  };
}
