// Contexto somente-leitura montado a partir do próprio projeto para
// alimentar um AI Expert. Nunca contém conhecimento geral do modelo —
// apenas dados recuperados das fontes autorizadas (contract_events,
// event_evidence, clauses, documents, event_clause_confrontation_candidates,
// emails, event_notes). Ver build-event-context.ts.

export interface ContextEvent {
  id: string;
  projectId: string;
  title: string;
  description: string;
  occurredAt: string;
  sourceType: string;
  status: string;
}

export interface ContextEvidence {
  id: string;
  sourceType: string;
  label: string;
  locator: string;
  emailId: string | null;
  documentVersionId: string | null;
}

// Vínculo contratual REAL e persistido (documents.contractual_*,
// migration 20260829090000_document_contractual_attachment_linkage.sql)
// do documento-fonte de uma cláusula com o instrumento contratual ao
// qual foi formalmente incorporado — "não basta alterar o prompt de
// identidade": isto é o que faz a hierarquia de precedência do
// Consultor Jurídico IA (legal-consultant/identity.ts) usar DADOS
// estruturados de verdade, em vez de só prosa no prompt.
//
// DELIBERADAMENTE SEM nenhum campo "precedenceLevel"/conclusão de
// precedência pré-calculada: o vínculo persistido prova só que o
// documento foi formalmente incorporado a ESTE pai (parentDocumentKind
// + incorporationBasis são fatos) — ele NUNCA prova, sozinho, que um
// ADITIVO está aprovado/vigente (não existe nenhuma coluna de
// status/aprovação em documents; inventar isso aqui seria fabricar um
// fato que o schema não tem). Só o Expert, olhando o resto do contexto
// (cláusulas do próprio aditivo, notas do evento, etc.), pode concluir
// se um aditivo está vigente e qual o escopo que ele altera — e uma
// cláusula de precedência explícita do contrato sempre prevalece sobre
// qualquer hierarquia padrão. Ver a seção "Hierarquia de precedência"
// em legal-consultant/identity.ts para como estes FATOS devem ser
// usados na CONCLUSÃO (que é sempre do Expert, nunca pré-computada
// aqui).
export interface ContextContractualLink {
  parentDocumentId: string;
  /** Fato, não conclusão — só os dois valores que documents_kind_check aceita como pai (ver migration). */
  parentDocumentKind: "CONTRATO_BASE" | "ADITIVO";
  parentDocumentTitle: string;
  /** Rótulo da versão mais recente do documento PAI — null se o pai não tiver nenhuma versão registrada. */
  parentCurrentVersionLabel: string | null;
  incorporationBasis: string;
  linkedByUserId: string;
  linkedAt: string;
}

export interface ContextClause {
  id: string;
  clauseNumber: string;
  title: string;
  text: string;
  documentId: string;
  documentKind: string;
  documentTitle: string;
  /** Por que esta cláusula está no contexto: já confrontada (cross-reference) ou candidata pendente/decidida. */
  relation: "CROSS_REFERENCE" | "CONFRONTATION_CANDIDATE";
  /** Vínculo contratual do documento-fonte desta cláusula, quando existir — null quando o documento não é um anexo contratual vinculado (inclusive: sempre null até a migration 20260829090000 ser aplicada, ver map-contractual-link-context.ts). */
  contractualLink: ContextContractualLink | null;
}

/** Metadados leves de um anexo — nunca o conteúdo; documentVersionId só é não-nulo após promoção via linkEmailAttachmentToDocument. */
export interface ContextEmailAttachment {
  id: string;
  originalFileName: string;
  mimeType: string;
  processingStatus: string;
  documentVersionId: string | null;
}

export interface ContextEmail {
  id: string;
  subject: string;
  snippet: string;
  sentAt: string;
  fromAddress: string;
  toAddress: string;
  /** Nunca ausente/undefined — [] quando o e-mail não tem anexo ingerido. */
  attachments: ContextEmailAttachment[];
}

export interface ContextConfrontationCandidate {
  id: string;
  clauseId: string;
  status: string;
  findingType: string;
  severity: string;
  confidence: number;
  summary: string;
  eventBasis: string;
  clauseBasis: string;
}

/**
 * Anotação declarada manualmente por um usuário sobre o evento (tabela
 * event_notes). NUNCA é fato documental/evidência — é informação
 * declarada internamente, sem confirmação documental. Todo Expert que
 * usa isto deve dizer explicitamente que a conclusão depende de contexto
 * declarado, não confirmado (ver evidentialStatus).
 */
export interface ContextEventNote {
  id: string;
  category: string;
  text: string;
  author: string;
  createdAt: string;
  sourceType: "USER_NOTE";
  evidentialStatus: "DECLARED_CONTEXT";
}

/**
 * Resumo de um evento dentro do contexto de projeto (escopo PROJECT).
 * Propositalmente leve — nunca inclui evidências/cláusulas/e-mails do
 * evento (isso é escopo EVENT, ver EventAnalysisContext) para não
 * "despejar todo o projeto no modelo" ao responder uma pergunta de nível
 * de projeto.
 */
export interface ProjectContextEventSummary {
  id: string;
  title: string;
  status: string;
  occurredAt: string;
  categories: string[];
}

/**
 * Resumo de uma obrigação ESG/SSMA contratual dentro do contexto de
 * projeto, para o Diretor de ESG IA (e qualquer outro Expert que precise
 * dela). Reflete apenas o registro mais recente de cada obrigação — nunca
 * o histórico completo (mesmo princípio de "não despejar tudo no
 * modelo" de ProjectContextEventSummary). `riskLevel` vem sempre do
 * cálculo determinístico (apps/web/lib/esg/compute-obligation-risk.ts),
 * nunca de uma estimativa da IA.
 */
export interface ContextEsgObligationSummary {
  id: string;
  title: string;
  category: string;
  periodicity: string;
  requiredEvidenceDescription: string | null;
  penaltyDescription: string | null;
  latestSubmissionStatus: string | null;
  latestSubmissionDueDate: string | null;
  latestSubmissionRiskLevel: string | null;
  latestSubmissionEvidenceCount: number;
}

/**
 * Contexto pronto para um AI Expert responder uma pergunta de escopo
 * PROJECT. Somente leitura. Metadata de seleção (`eventsTotalCount` vs
 * `events.length`) existe para uma futura estratégia de
 * retrieval/ranking — nesta fase a seleção é só "N eventos mais
 * recentes", sem ranking por relevância.
 */
export interface ProjectAnalysisContext {
  projectId: string;
  project: {
    id: string;
    name: string;
    client: string;
    status: string;
    contractNumber: string | null;
  };
  events: ProjectContextEventSummary[];
  eventsTotalCount: number;
  esgObligations: ContextEsgObligationSummary[];
  esgObligationsTotalCount: number;
}

/**
 * Contexto pronto para um AI Expert analisar um evento. Somente leitura —
 * montá-lo nunca cria, altera ou apaga nada no projeto.
 */
export interface EventAnalysisContext {
  projectId: string;
  eventId: string;
  /** Presente somente quando o contexto foi restringido a um único candidato. */
  focusCandidateId: string | null;
  event: ContextEvent;
  evidence: ContextEvidence[];
  relatedClauses: ContextClause[];
  relatedEmails: ContextEmail[];
  confrontationCandidates: ContextConfrontationCandidate[];
  eventNotes: ContextEventNote[];
}
