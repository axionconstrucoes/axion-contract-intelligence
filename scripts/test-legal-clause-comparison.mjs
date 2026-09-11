// Regressao da apresentacao juridica lado a lado. Tudo em memoria:
// nenhuma rede, banco, persistencia ou chamada a provider real.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const {
  LEGAL_CONSULTANT_DOCUMENT_QUERY_RESPONSE_JSON_SCHEMA,
  validateLegalClauseComparisons,
} = await import("../apps/web/lib/ai/experts/legal-consultant/clause-comparison.ts");

let passed = 0;
let failed = 0;
function assert(condition, message) { if (!condition) throw new Error(message ?? "assertion failed"); }
function check(name, fn) {
  try { fn(); console.log(`OK   ${name}`); passed += 1; }
  catch (error) { console.log(`FAIL ${name}`); console.log(`     ${error.message}`); failed += 1; }
}
function rejects(name, mutate, fragment) {
  check(name, () => {
    const candidate = structuredClone(baseComparison);
    mutate(candidate);
    try { validateLegalClauseComparisons([candidate], documents); }
    catch (error) { assert(String(error.message).includes(fragment), `erro inesperado: ${error.message}`); return; }
    throw new Error("deveria rejeitar");
  });
}

const documents = [{
  documentId: "doc-a",
  documentVersionId: "ver-a",
  title: "Minuta principal",
  kind: "CONTRATO_BASE",
  versionLabel: "2.0",
  fileName: "minuta.docx",
  pageCount: 10,
  characterCount: 120,
  text: "12.3 Reajuste. O preço será reajustado pelo INCC a cada doze meses.",
  truncated: false,
  omittedCharacters: 0,
}];

const baseComparison = {
  documentId: "doc-a",
  documentVersionId: "ver-a",
  clauseNumber: "12.3",
  clauseTitle: "Reajuste",
  originalText: "O preço será reajustado pelo INCC a cada doze meses.",
  proposedText: "O preço será reajustado após doze meses, mediante acordo escrito entre as partes.",
  action: "MODIFY",
  rationale: "Evita aplicação automática sem confirmação das partes.",
  mitigatedRisk: "Reduz divergência sobre índice e marco temporal.",
  legalBasis: null,
  severity: "MEDIUM",
  confidence: 0.84,
};

check("SCHEMA: comparacao por clausula e obrigatoria somente no schema documental", () => {
  assert(LEGAL_CONSULTANT_DOCUMENT_QUERY_RESPONSE_JSON_SCHEMA.required.includes("analiseClausulas"));
  assert(LEGAL_CONSULTANT_DOCUMENT_QUERY_RESPONSE_JSON_SCHEMA.properties.analiseClausulas.type === "array");
});

check("FONTE: texto real da mesma versao e aceito e metadados sao derivados do servidor", () => {
  const [result] = validateLegalClauseComparisons([baseComparison], documents);
  assert(result.documentTitle === "Minuta principal");
  assert(result.versionLabel === "2.0");
  assert(result.sourceVerified === true);
  assert(result.requiresHumanReview === undefined, "revisao pertence ao envelope, nao ao item do provider");
});

check("FONTE: diferenca apenas de espaco e Unicode nao perde o vinculo", () => {
  const candidate = { ...baseComparison, originalText: "O preço será reajustado pelo INCC\n a cada doze meses." };
  assert(validateLegalClauseComparisons([candidate], documents).length === 1);
});

rejects("ISOLAMENTO: documentId de outro projeto e rejeitado", (c) => { c.documentId = "doc-b"; }, "fora do contexto");
rejects("ISOLAMENTO: versao diferente e rejeitada", (c) => { c.documentVersionId = "ver-b"; }, "fora do contexto");
rejects("GROUNDING: clausula inventada e rejeitada", (c) => { c.originalText = "Multa de 50% por atraso."; }, "nao foi localizado");
rejects("FORMA: MODIFY sem sugestao e rejeitado", (c) => { c.proposedText = null; }, "MODIFY exige");
rejects("FORMA: REMOVE com nova redacao e rejeitado", (c) => { c.action = "REMOVE"; }, "REMOVE exige");
rejects("FORMA: ADD com texto original e rejeitado", (c) => { c.action = "ADD"; }, "ADD exige");
rejects("GOVERNANCA: base legal de memoria e rejeitada", (c) => { c.legalBasis = "artigo inventado"; }, "deve ser null");

check("FORMA: ADD explicito e aceito sem inventar clausula existente", () => {
  const candidate = { ...baseComparison, action: "ADD", originalText: null };
  assert(validateLegalClauseComparisons([candidate], documents)[0].sourceVerified === true);
});

check("FORMA: nenhuma alteracao recomendada pode ser array vazio", () => {
  assert(validateLegalClauseComparisons([], documents).length === 0);
});

const panelSource = readFileSync(path.join(repoRoot, "apps/web/components/ai/expert-query-panel.tsx"), "utf8");
const workspaceSource = readFileSync(path.join(repoRoot, "apps/web/components/legal/precontract-workspace-client.tsx"), "utf8");
const querySource = readFileSync(path.join(repoRoot, "apps/web/lib/ai/experts/legal-consultant/query.ts"), "utf8");
const validatorSource = readFileSync(path.join(repoRoot, "apps/web/lib/ai/experts/legal-consultant/clause-comparison.ts"), "utf8");

check("UI: clausula fica a esquerda e sugestao a direita em duas colunas", () => {
  assert(panelSource.includes('lg:grid-cols-2'));
  assert(panelSource.includes("Cláusula do contrato"));
  assert(panelSource.includes("Sugestão do Consultor Jurídico"));
});

check("UI: argumento aparece em hover/foco acessivel", () => {
  assert(panelSource.includes('role="tooltip"'));
  assert(panelSource.includes("group-hover:visible") && panelSource.includes("group-focus-within:visible"));
  assert(panelSource.includes("Por que alterar?"));
});

check("UI: so a consulta atual existe; nao ha lista nem historico", () => {
  assert(workspaceSource.includes("useActionState") || panelSource.includes("useActionState"));
  assert(!panelSource.includes("queryHistory") && !panelSource.includes("consultationHistory"));
});

check("FLUXO: comparacao usa schema documental e validacao de origem", () => {
  assert(querySource.includes("LEGAL_CONSULTANT_DOCUMENT_QUERY_RESPONSE_JSON_SCHEMA"));
  assert(querySource.includes("validateLegalClauseComparisons"));
  assert(querySource.includes("projectContext?.contractualDocuments"));
});

check("SEM PERSISTENCIA: validador nao possui operacoes de escrita", () => {
  for (const operation of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc("]) {
    assert(!validatorSource.includes(operation), `operacao proibida: ${operation}`);
  }
});

console.log(`\nRESULTADO: ${passed} passaram, ${failed} falharam`);
if (failed > 0) process.exit(1);
