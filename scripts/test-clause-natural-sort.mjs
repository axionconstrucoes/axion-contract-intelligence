// ORDEM NATURAL DAS CLÁUSULAS (aba Documentos) — cobre a função pura
// sortClausesNaturally/compareClauseNumbersNaturally — executada de
// verdade, nunca só lida como texto.
//
// Bug corrigido: a query em getClauses (lib/data.ts) não tem ORDER BY,
// e o Postgres pode escolher o índice btree
// (document_version_id, clause_number) — texto — para o scan, produzindo
// ordem lexicográfica ("1, 10, 2, 3..."). A correção ordena o array em
// memória, na fonte (getClauses), sem migration e sem alterar o texto,
// título ou identificador de nenhuma cláusula.
//
// Uso:
//   node scripts/test-clause-natural-sort.mjs

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
console.log("ORDEM NATURAL DAS CLÁUSULAS — clause_number 1,2,9,10 (nunca alfabética)");
console.log("======================================");
console.log("");

const { sortClausesNaturally, compareClauseNumbersNaturally } = await import(
  "../apps/web/lib/documents/sort-clauses-naturally.ts"
);

function clause(id, clauseNumber, title = `Título ${id}`) {
  return { id, clauseNumber, title, text: `Texto da cláusula ${id}`, documentId: "doc-1", projectId: "proj-1" };
}

check("cláusula 10 vem depois da cláusula 9, e cláusula 2 depois da 1 — nunca ordem alfabética (1, 10, 2, 3...)", () => {
  const input = [clause("a", "1"), clause("b", "10"), clause("c", "2"), clause("d", "3"), clause("e", "9")];
  const sorted = sortClausesNaturally(input).map((c) => c.clauseNumber);
  assert(sorted.join(",") === "1,2,3,9,10", `esperado "1,2,3,9,10", obtido "${sorted.join(",")}"`);
});

check("decimais por segmento: 1.1, 1.2, 1.10 — nunca comparado como float (1.10 não vira 1.1)", () => {
  const input = [clause("a", "1.10"), clause("b", "1.1"), clause("c", "1.2")];
  const sorted = sortClausesNaturally(input).map((c) => c.clauseNumber);
  assert(sorted.join(",") === "1.1,1.2,1.10", `esperado "1.1,1.2,1.10", obtido "${sorted.join(",")}"`);
});

check("número seguido de letra: 2-A, 2-B, 10-A — a parte numérica prevalece sobre a comparação de string", () => {
  const input = [clause("a", "10-A"), clause("b", "2-B"), clause("c", "2-A")];
  const sorted = sortClausesNaturally(input).map((c) => c.clauseNumber);
  assert(sorted.join(",") === "2-A,2-B,10-A", `esperado "2-A,2-B,10-A", obtido "${sorted.join(",")}"`);
});

check("valores vazios/não padronizados NUNCA são descartados — só empurrados para o final, mantendo ordem estável entre si", () => {
  const input = [clause("a", "2"), clause("b", ""), clause("c", "1"), clause("d", "  ")];
  const sorted = sortClausesNaturally(input);
  assert(sorted.length === 4, `nenhum registro pode desaparecer — esperado 4, obtido ${sorted.length}`);
  assert(sorted.map((c) => c.id).join(",") === "c,a,b,d", `esperado "c,a,b,d", obtido "${sorted.map((c) => c.id).join(",")}"`);
});

check("nunca ordena pelo título completo — dois clause_number idênticos preservam a ordem original de entrada (estabilidade)", () => {
  const input = [clause("a", "1", "Zebra"), clause("b", "1", "Abelha")];
  const sorted = sortClausesNaturally(input);
  assert(sorted.map((c) => c.id).join(",") === "a,b", "ordem estável esperada: título nunca deveria decidir o resultado");
});

check("lista vazia não quebra — retorna array vazio", () => {
  assert(sortClausesNaturally([]).length === 0);
});

check("compareClauseNumbersNaturally é simétrico/consistente para o mesmo par em qualquer ordem", () => {
  assert(compareClauseNumbersNaturally("2", "10") < 0, '"2" deveria vir antes de "10"');
  assert(compareClauseNumbersNaturally("10", "2") > 0, '"10" deveria vir depois de "2"');
  assert(compareClauseNumbersNaturally("5", "5") === 0);
});

check("função é pura — sem 'server-only', sem I/O, sem chamada ao banco (importável por um script Node standalone)", () => {
  const source = readSource("apps/web/lib/documents/sort-clauses-naturally.ts");
  assert(!source.includes('import "server-only"'), "esta função deveria ser pura/testável, sem server-only");
  assert(!/createSupabaseServerClient|\.from\(/i.test(source), "não deveria fazer nenhuma chamada ao banco");
});

check("getClauses (lib/data.ts) aplica sortClausesNaturally ao array retornado — correção na fonte, não só na UI", () => {
  const source = readSource("apps/web/lib/data.ts");
  assert(source.includes("sortClausesNaturally"), "getClauses deveria importar/usar sortClausesNaturally");
  assert(/return sortClausesNaturally\(clauses\);/.test(source), "getClauses deveria retornar o array já ordenado naturalmente");
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exitCode = 1;
}
