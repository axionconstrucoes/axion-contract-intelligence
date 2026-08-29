// Puro, sem I/O. Bloco 4 — resolve qual documento é AUTORITATIVO para
// um assunto/cláusula específico, a partir da cadeia real de
// document_relations (nunca por inferência de nome/data de upload).
//
// Regras (exatamente como especificadas, nenhuma inventada):
//   1. cláusula expressa de precedência do contrato SEMPRE é verificada
//      primeiro — se existir, ela decide, e esta função nunca a
//      sobrepõe com uma inferência da cadeia de relações;
//   2. resposta oficial (RESPONDE) posterior prevalece sobre o
//      documento respondido APENAS no assunto respondido — nunca o
//      documento inteiro;
//   3. complemento (COMPLEMENTA) posterior prevalece sobre a resposta
//      anterior no assunto alterado;
//   4. uma relação com supersededByRelationId preenchido NUNCA é
//      autoritativa — foi substituída (SUBSTITUI), mas só no escopo
//      daquela relação específica, nunca o documento inteiro;
//   5. INCORPORA só é considerada quando existir na cadeia (o schema já
//      garante acceptanceEvidence preenchido para toda linha INCORPORA
//      — ver CHECK da migration); ausência de QUALQUER relação
//      conectando um documento candidato ao contrato para este assunto
//      nunca deve ser tratada como "incorporado por omissão" — retorna
//      DECISÃO HUMANA NECESSÁRIA;
//   6. nunca ordena só por data de upload — usa issuedAt (data de
//      emissão real do documento), com revision como desempate textual
//      quando issuedAt empatar.

import type { DocumentRelation } from "./types";

export interface AuthoritativeRelationResult {
  status: "RESOLVED" | "HUMAN_DECISION_REQUIRED";
  // Documento vencedor para este assunto — null quando HUMAN_DECISION_REQUIRED.
  authoritativeDocumentId: string | null;
  // Cadeia completa usada na decisão (mais antiga -> mais nova) — para o
  // Especialista Jurídico IA citar documento/versão/regra aplicada.
  chain: DocumentRelation[];
  reason: string;
}

function issuedAtSortKey(relation: DocumentRelation): string {
  // issuedAt ausente nunca "vence" um issuedAt real — ordenado antes de
  // qualquer data real (string vazia < qualquer data ISO).
  return relation.issuedAt ?? "";
}

export function resolveAuthoritativeDocumentForSubject(
  relations: DocumentRelation[],
  subject: string,
  options?: { explicitContractPrecedenceClauseDocumentId?: string | null }
): AuthoritativeRelationResult {
  if (options?.explicitContractPrecedenceClauseDocumentId) {
    return {
      status: "RESOLVED",
      authoritativeDocumentId: options.explicitContractPrecedenceClauseDocumentId,
      chain: [],
      reason: "Cláusula expressa de precedência do contrato governa este assunto — verificada antes de qualquer inferência da cadeia documental.",
    };
  }

  // Escopo estrito ao assunto — nunca ao documento inteiro (regra 2/4
  // do requisito). Comparação exata: o caller é responsável por
  // normalizar/agrupar assuntos equivalentes antes de chamar (esta
  // função nunca adivinha similaridade textual).
  const subjectRelations = relations
    .filter((relation) => relation.subject === subject)
    // Nunca autoritativa se já foi substituída por outra relação.
    .filter((relation) => !relations.some((other) => other.supersededByRelationId === relation.id));

  if (subjectRelations.length === 0) {
    return {
      status: "HUMAN_DECISION_REQUIRED",
      authoritativeDocumentId: null,
      chain: [],
      reason: "DECISÃO HUMANA NECESSÁRIA — VÍNCULO CONTRATUAL NÃO COMPROVADO: nenhuma relação documental registrada para este assunto.",
    };
  }

  const chain = subjectRelations
    .slice()
    .sort((a, b) => issuedAtSortKey(a).localeCompare(issuedAtSortKey(b)) || (a.revision ?? "").localeCompare(b.revision ?? ""));

  const latest = chain[chain.length - 1];

  if (latest.relationType === "INCORPORA" && !latest.acceptanceEvidence) {
    // Defensivo — o CHECK da migration já impede isso na origem, nunca
    // confiado silenciosamente aqui também.
    return {
      status: "HUMAN_DECISION_REQUIRED",
      authoritativeDocumentId: null,
      chain,
      reason: "DECISÃO HUMANA NECESSÁRIA — VÍNCULO CONTRATUAL NÃO COMPROVADO: relação INCORPORA sem evidência de aceitação registrada.",
    };
  }

  const relationLabel: Record<DocumentRelation["relationType"], string> = {
    RESPONDE: "responde",
    COMPLEMENTA: "complementa",
    ALTERA: "altera",
    SUBSTITUI: "substitui",
    INCORPORA: "incorpora",
  };

  return {
    status: "RESOLVED",
    authoritativeDocumentId: latest.fromDocumentId,
    chain,
    reason: `Documento mais recente que ${relationLabel[latest.relationType]} o assunto "${subject}"${latest.issuedAt ? ` (emitido em ${latest.issuedAt})` : ""} — escopo limitado a este assunto, nunca ao documento inteiro.`,
  };
}
