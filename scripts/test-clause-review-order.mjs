// Testes da ordem documental da revisão de cláusulas
// (apps/web/lib/clause-review-order.ts). Uso: node scripts/test-clause-review-order.mjs

import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const { compareClauseLabels, parseClauseLabel, orderDocumentally } = await import("../apps/web/lib/clause-review-order.ts");

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`OK   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}`);
    console.log(`     ${error instanceof Error ? error.message : error}`);
  }
}
function assertEqual(actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`esperado ${e}, obtido ${a}`);
}
const sorted = (labels) => [...labels].sort(compareClauseLabels);

check("6.2 vem antes de 6.10 (numérico, não alfabético)", () => {
  assertEqual(sorted(["B-6.10", "B-6.2", "B-6.1"]), ["B-6.1", "B-6.2", "B-6.10"]);
});
check("pai antes dos filhos e hierarquia profunda: 6, 6.4, 6.4.1, 6.5", () => {
  assertEqual(sorted(["B-6.5", "B-6.4.1", "B-6", "B-6.4"]), ["B-6", "B-6.4", "B-6.4.1", "B-6.5"]);
});
check("Parte A inteira antes da Parte B", () => {
  assertEqual(sorted(["B-1", "A-15", "A-2", "B-1.1"]), ["A-2", "A-15", "B-1", "B-1.1"]);
});
check("ocorrência repetida logo depois da primeira", () => {
  assertEqual(sorted(["B-22.1 (2ª ocorrência)", "B-23", "B-22.1", "B-22.2"]), ["B-22.1", "B-22.1 (2ª ocorrência)", "B-22.2", "B-23"]);
});
check("formato 'CLÁUSULA' (sem parte) continua ordenado numericamente", () => {
  assertEqual(sorted(["10", "2", "1"]), ["1", "2", "10"]);
});
check("parse do rótulo", () => {
  assertEqual(parseClauseLabel("B-22.1 (2ª ocorrência)"), { section: "B", parts: [22, 1], occurrence: 2 });
});

check("anomalia de numeração fica onde aparece no documento (22.1 2ª ocorrência após a 23), resto na ordem numérica", () => {
  // docIndex = ordem de detecção (texto); 6.10 detectado antes de 6.2 não muda a ordem numérica.
  const items = [
    ["B-22", 0], ["B-22.1", 1], ["B-22.2", 2], ["B-6.10", 3], ["B-6.2", 4], ["B-23", 5],
    ["B-22.1 (2ª ocorrência)", 6], ["B-22.2 (2ª ocorrência)", 7],
  ];
  const ordered = orderDocumentally(items, {
    label: (item) => item[0],
    docIndex: (item) => item[1],
    isAnomaly: (item) => item[0].includes("ocorrência"),
  }).map((item) => item[0]);
  assertEqual(ordered, ["B-6.2", "B-6.10", "B-22", "B-22.1", "B-22.2", "B-23", "B-22.1 (2ª ocorrência)", "B-22.2 (2ª ocorrência)"]);
});

console.log("");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
process.exit(failed > 0 ? 1 : 0);
