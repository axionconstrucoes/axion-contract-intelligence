// Hierarquia documental do BID (Bloco 4) — tipos espelhando 1:1 a
// tabela public.document_relations (migration
// 20260829180000_document_relation_hierarchy.sql). Nunca uma segunda
// classificação concorrente de relação entre documentos.

export type DocumentRelationType = "RESPONDE" | "COMPLEMENTA" | "ALTERA" | "SUBSTITUI" | "INCORPORA";

export interface DocumentRelation {
  id: string;
  projectId: string;
  fromDocumentId: string;
  toDocumentId: string;
  relationType: DocumentRelationType;
  // Assunto/cláusula afetada — o ESCOPO da relação; nunca o documento
  // "to" inteiro (uma resposta pontual nunca substitui o edital
  // inteiro, só o assunto respondido).
  subject: string;
  issuedAt: string | null;
  revision: string | null;
  issuer: string | null;
  acceptanceEvidence: string | null;
  supersededByRelationId: string | null;
  createdAt: string;
}
