// Bloco 4 — hierarquia documental do BID: testes reais da função pura
// de resolução (resolveAuthoritativeDocumentForSubject) contra os
// cenários exatos do requisito. Achado desta rodada: nenhum tipo de
// relação (RESPONDE/COMPLEMENTA/ALTERA/SUBSTITUI/INCORPORA) existia —
// isto é modelagem nova, testada aqui pela primeira vez.
//
// Uso:
//   node scripts/test-document-relation-hierarchy.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
function readSource(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`OK   ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`FAIL ${name}`);
    console.log(`     ${error.message}`);
    failed += 1;
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message ?? "assertion failed");
}

console.log("");
console.log("======================================");
console.log("HIERARQUIA DOCUMENTAL DO BID — resolução de assunto (Bloco 4)");
console.log("======================================");
console.log("");

const { resolveAuthoritativeDocumentForSubject } = await import(
  "../apps/web/lib/documents/document-relations/resolve-authoritative-relation.ts"
);

function relation(overrides) {
  return {
    id: crypto.randomUUID(),
    projectId: "p1",
    fromDocumentId: "doc-unset",
    toDocumentId: "doc-unset",
    relationType: "RESPONDE",
    subject: "Cláusula 7.2 — prazo de entrega",
    issuedAt: "2026-01-01",
    revision: null,
    issuer: "Cliente",
    acceptanceEvidence: null,
    supersededByRelationId: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

check("sem NENHUMA relação para o assunto -> DECISÃO HUMANA NECESSÁRIA — VÍNCULO CONTRATUAL NÃO COMPROVADO", () => {
  const result = resolveAuthoritativeDocumentForSubject([], "Cláusula 7.2 — prazo de entrega");
  assert(result.status === "HUMAN_DECISION_REQUIRED");
  assert(result.reason.includes("VÍNCULO CONTRATUAL NÃO COMPROVADO"));
});

check("resposta oficial posterior prevalece sobre o edital original SÓ no assunto respondido", () => {
  const edital = "doc-edital";
  const resposta = "doc-resposta";
  const relations = [
    relation({ fromDocumentId: resposta, toDocumentId: edital, relationType: "RESPONDE", issuedAt: "2026-02-01" }),
  ];
  const result = resolveAuthoritativeDocumentForSubject(relations, "Cláusula 7.2 — prazo de entrega");
  assert(result.status === "RESOLVED");
  assert(result.authoritativeDocumentId === resposta, "a resposta deveria prevalecer sobre o edital para este assunto");
});

check("uma pergunta ISOLADA nunca cria regra — sem relação RESPONDE registrada, o questionário sozinho não é autoritativo", () => {
  // O questionário em si nunca é inserido como "from" de uma relação
  // que resolve um assunto — só a RESPOSTA oficial é. Sem uma relação
  // real conectando resposta->assunto, a função corretamente não tem
  // nada para resolver (mesmo teste do cenário "sem relação" acima,
  // reafirmado aqui com o vocabulário exato do requisito).
  const result = resolveAuthoritativeDocumentForSubject([], "Pergunta isolada nunca vira regra");
  assert(result.status === "HUMAN_DECISION_REQUIRED");
});

check("complemento posterior prevalece sobre a resposta anterior no assunto alterado", () => {
  const resposta = "doc-resposta";
  const complemento = "doc-complemento";
  const relations = [
    relation({ fromDocumentId: resposta, toDocumentId: "doc-edital", relationType: "RESPONDE", issuedAt: "2026-02-01" }),
    relation({ fromDocumentId: complemento, toDocumentId: resposta, relationType: "COMPLEMENTA", issuedAt: "2026-03-01" }),
  ];
  const result = resolveAuthoritativeDocumentForSubject(relations, "Cláusula 7.2 — prazo de entrega");
  assert(result.authoritativeDocumentId === complemento, `esperado o complemento mais recente, obtido ${result.authoritativeDocumentId}`);
  assert(result.chain.length === 2, "a cadeia completa deveria ser preservada para citação (Especialista Jurídico)");
});

check("nunca ordena só por data de UPLOAD (createdAt) — usa issuedAt real, mesmo quando createdAt está em ordem invertida", () => {
  const antigo = "doc-antigo";
  const novo = "doc-novo";
  const relations = [
    // createdAt (registrado no sistema) é o OPOSTO de issuedAt (emitido de verdade) — a função deve seguir issuedAt.
    relation({ fromDocumentId: novo, toDocumentId: "doc-edital", relationType: "RESPONDE", issuedAt: "2026-01-01", createdAt: "2026-05-01T00:00:00Z" }),
    relation({ fromDocumentId: antigo, toDocumentId: "doc-edital", relationType: "RESPONDE", issuedAt: "2026-04-01", createdAt: "2026-01-01T00:00:00Z" }),
  ];
  const result = resolveAuthoritativeDocumentForSubject(relations, "Cláusula 7.2 — prazo de entrega");
  assert(result.authoritativeDocumentId === antigo, "deveria vencer quem tem issuedAt mais recente (2026-04-01), não quem foi cadastrado por último no sistema");
});

check("cláusula expressa de precedência do contrato é SEMPRE verificada primeiro — nunca sobreposta pela cadeia de relações", () => {
  const contratoClausula = "doc-contrato";
  const relations = [
    relation({ fromDocumentId: "doc-complemento-recente", toDocumentId: "doc-edital", relationType: "COMPLEMENTA", issuedAt: "2026-12-01" }),
  ];
  const result = resolveAuthoritativeDocumentForSubject(relations, "Cláusula 7.2 — prazo de entrega", {
    explicitContractPrecedenceClauseDocumentId: contratoClausula,
  });
  assert(result.authoritativeDocumentId === contratoClausula, "a cláusula expressa do contrato deveria vencer, mesmo com uma relação mais recente na cadeia");
});

check("relação já SUBSTITUÍDA (supersededByRelationId de outra) nunca é autoritativa", () => {
  const antiga = relation({ fromDocumentId: "doc-antiga-resposta", toDocumentId: "doc-edital", relationType: "RESPONDE", issuedAt: "2026-01-01" });
  const nova = relation({ fromDocumentId: "doc-nova-resposta", toDocumentId: "doc-edital", relationType: "SUBSTITUI", issuedAt: "2026-02-01", supersededByRelationId: null });
  // marca a antiga como substituída pela nova
  const superseding = { ...nova, supersededByRelationId: antiga.id };
  const relations = [antiga, superseding];
  const result = resolveAuthoritativeDocumentForSubject(relations, antiga.subject);
  assert(result.authoritativeDocumentId !== "doc-antiga-resposta", "a relação substituída nunca deveria vencer");
});

check("INCORPORA sem acceptanceEvidence nunca é aceita como resolvida (defensivo, mesmo com o CHECK do banco)", () => {
  const relations = [
    relation({ fromDocumentId: "doc-proposta", toDocumentId: "doc-contrato", relationType: "INCORPORA", issuedAt: "2026-01-01", acceptanceEvidence: null }),
  ];
  const result = resolveAuthoritativeDocumentForSubject(relations, "Premissas comerciais da proposta");
  assert(result.status === "HUMAN_DECISION_REQUIRED");
});

check("migration real: documents_kind_check aceita QUESTIONARIO_BID e COMPLEMENTO_CIRCULAR; document_relations com relation_type inválido é recusado pelo próprio schema (CHECK)", () => {
  const migrationSource = readSource("supabase/migrations/20260829180000_document_relation_hierarchy.sql");
  assert(migrationSource.includes("'QUESTIONARIO_BID'") && migrationSource.includes("'COMPLEMENTO_CIRCULAR'"));
  assert(/relation_type in \('RESPONDE', 'COMPLEMENTA', 'ALTERA', 'SUBSTITUI', 'INCORPORA'\)/.test(migrationSource));
  assert(migrationSource.includes("check (relation_type <> 'INCORPORA' or nullif(btrim(coalesce(acceptance_evidence, '')), '') is not null)"), "o schema já deveria exigir evidência de aceitação para INCORPORA");
});

check("document_relations é IMUTÁVEL por design (sem UPDATE/DELETE) — mesma filosofia de project_additional_proposal_links, rastreabilidade nunca comprometida", () => {
  const migrationSource = readSource("supabase/migrations/20260829180000_document_relation_hierarchy.sql");
  assert(!/for update|for delete/i.test(migrationSource), "não deveria haver nenhuma policy de UPDATE/DELETE em document_relations");
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");
if (failed > 0) process.exitCode = 1;
