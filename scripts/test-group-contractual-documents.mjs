// GRUPOS CONTRATUAIS (aba Documentos) — Contrato-base | Anexos ao
// contrato-base, Aditivo 01 | Anexos ao Aditivo 01, etc. Cobre a função
// pura groupDocumentsByContractualStructure — executada de verdade,
// nunca só lida como texto.
//
// "Não inferir anexos pelo nome": o agrupamento usa exclusivamente
// parentDocumentId (um vínculo real e persistido, não um campo que
// existe hoje no schema — ver relatório do item 3). Com dados reais
// (parentDocumentId sempre null), o resultado é honestamente "um grupo
// por CONTRATO_BASE/ADITIVO, zero anexos".
//
// Uso:
//   node scripts/test-group-contractual-documents.mjs

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
console.log("GRUPOS CONTRATUAIS — Contrato-base/Aditivo N + anexos");
console.log("======================================");
console.log("");

const { groupDocumentsByContractualStructure, deriveContractualGroupTitles } = await import(
  "../apps/web/lib/documents/group-contractual-documents.ts"
);

function doc(id, kind, createdAt, parentDocumentId = null) {
  return { id, kind, createdAt, parentDocumentId };
}

check("dados reais de hoje (parentDocumentId sempre null): um grupo por CONTRATO_BASE/ADITIVO, ZERO anexos cada — nunca fabrica um vínculo que não existe", () => {
  const documents = [
    doc("contrato", "CONTRATO_BASE", "2026-01-01"),
    doc("aditivo-1", "ADITIVO", "2026-02-01"),
    doc("proposta", "PROPOSTA_COMERCIAL", "2026-01-15"),
  ];
  const { groups, ungrouped } = groupDocumentsByContractualStructure(documents);
  assert(groups.length === 2, `esperado 2 grupos, obtido ${groups.length}`);
  assert(groups[0].label === "Contrato-base");
  assert(groups[0].attachments.length === 0, "sem parentDocumentId real, o grupo não deveria ter anexos");
  assert(groups[1].label === "Aditivo 01");
  assert(groups[1].attachments.length === 0);
  assert(ungrouped.length === 1 && ungrouped[0].id === "proposta", "documento sem vínculo contratual deveria continuar na lista geral");
});

check("aditivos numerados na ordem de criação (Aditivo 01, Aditivo 02, ...) — nunca por número extraído do título", () => {
  const documents = [
    doc("contrato", "CONTRATO_BASE", "2026-01-01"),
    doc("aditivo-b", "ADITIVO", "2026-03-01"),
    doc("aditivo-a", "ADITIVO", "2026-02-01"),
  ];
  const { groups } = groupDocumentsByContractualStructure(documents);
  assert(groups.map((g) => g.label).join(",") === "Contrato-base,Aditivo 01,Aditivo 02");
  assert(groups[1].principal.id === "aditivo-a", "aditivo mais antigo deveria ser Aditivo 01");
  assert(groups[2].principal.id === "aditivo-b", "aditivo mais recente deveria ser Aditivo 02");
});

check("um anexo aparece SOMENTE dentro do grupo do documento pai — nunca reaparece na lista geral (ungrouped)", () => {
  const documents = [
    doc("contrato", "CONTRATO_BASE", "2026-01-01"),
    doc("anexo-1", "ESPECIFICACAO", "2026-01-10", "contrato"),
  ];
  const { groups, ungrouped } = groupDocumentsByContractualStructure(documents);
  assert(groups[0].attachments.length === 1 && groups[0].attachments[0].id === "anexo-1");
  assert(ungrouped.length === 0, "o anexo não deveria aparecer de novo na lista geral");
});

check("anexos de grupos diferentes NUNCA se misturam — um anexo do contrato-base nunca aparece no grupo do Aditivo 01, e vice-versa", () => {
  const documents = [
    doc("contrato", "CONTRATO_BASE", "2026-01-01"),
    doc("aditivo-1", "ADITIVO", "2026-02-01"),
    doc("anexo-contrato", "ESPECIFICACAO", "2026-01-05", "contrato"),
    doc("anexo-aditivo", "CRONOGRAMA_REVISAO", "2026-02-05", "aditivo-1"),
  ];
  const { groups } = groupDocumentsByContractualStructure(documents);
  const contratoGroup = groups.find((g) => g.label === "Contrato-base");
  const aditivoGroup = groups.find((g) => g.label === "Aditivo 01");
  assert(contratoGroup.attachments.map((a) => a.id).join(",") === "anexo-contrato");
  assert(aditivoGroup.attachments.map((a) => a.id).join(",") === "anexo-aditivo");
});

check("nenhum documento aparece duas vezes — cada anexo pertence a exatamente um grupo, nunca a dois", () => {
  const documents = [
    doc("contrato", "CONTRATO_BASE", "2026-01-01"),
    doc("aditivo-1", "ADITIVO", "2026-02-01"),
    doc("anexo-1", "ESPECIFICACAO", "2026-01-05", "contrato"),
  ];
  const { groups } = groupDocumentsByContractualStructure(documents);
  const occurrences = groups.flatMap((g) => g.attachments.map((a) => a.id)).filter((id) => id === "anexo-1");
  assert(occurrences.length === 1, `anexo-1 apareceu ${occurrences.length} vezes, esperado 1`);
});

check("nunca infere vínculo pelo nome — dois documentos com o mesmo prefixo de título/kind mas sem parentDocumentId real ficam em ungrouped, não viram anexo por semelhança", () => {
  const documents = [
    doc("contrato", "CONTRATO_BASE", "2026-01-01"),
    doc("proposta-parecida", "PROPOSTA_COMERCIAL", "2026-01-02", null),
  ];
  const { groups, ungrouped } = groupDocumentsByContractualStructure(documents);
  assert(groups[0].attachments.length === 0);
  assert(ungrouped.some((d) => d.id === "proposta-parecida"), "sem parentDocumentId, o documento não deveria virar anexo por parecença de nome/kind");
});

check("nenhum outro tipo documental vira 'principal' de grupo — só CONTRATO_BASE/ADITIVO", () => {
  const documents = [doc("relatorio", "RELATORIO_SEMANAL", "2026-01-01")];
  const { groups, ungrouped } = groupDocumentsByContractualStructure(documents);
  assert(groups.length === 0);
  assert(ungrouped.length === 1);
});

check("lista vazia não quebra — zero grupos, zero ungrouped", () => {
  const { groups, ungrouped } = groupDocumentsByContractualStructure([]);
  assert(groups.length === 0 && ungrouped.length === 0);
});

check("deriveContractualGroupTitles: CONTRATO-BASE / ANEXOS AO CONTRATO-BASE — títulos exatos exigidos pelo layout visual", () => {
  const { principalTitle, attachmentsTitle } = deriveContractualGroupTitles("Contrato-base");
  assert(principalTitle === "CONTRATO-BASE", `esperado "CONTRATO-BASE", obtido "${principalTitle}"`);
  assert(attachmentsTitle === "ANEXOS AO CONTRATO-BASE", `esperado "ANEXOS AO CONTRATO-BASE", obtido "${attachmentsTitle}"`);
});

check("deriveContractualGroupTitles: ADITIVO CONTRATUAL NN / ANEXOS AO ADITIVO CONTRATUAL NN — número extraído do MESMO label que sortAndLabelContractualPrincipals produz, nunca uma segunda fonte", () => {
  const { principalTitle, attachmentsTitle } = deriveContractualGroupTitles("Aditivo 01");
  assert(principalTitle === "ADITIVO CONTRATUAL 01", `esperado "ADITIVO CONTRATUAL 01", obtido "${principalTitle}"`);
  assert(attachmentsTitle === "ANEXOS AO ADITIVO CONTRATUAL 01", `esperado "ANEXOS AO ADITIVO CONTRATUAL 01", obtido "${attachmentsTitle}"`);

  const second = deriveContractualGroupTitles("Aditivo 02");
  assert(second.principalTitle === "ADITIVO CONTRATUAL 02");
});

check("função é pura — sem 'server-only', sem I/O (importável por um script Node standalone)", () => {
  const source = readSource("apps/web/lib/documents/group-contractual-documents.ts");
  assert(!source.includes('import "server-only"'), "esta função deveria ser pura/testável, sem server-only");
  assert(!/createSupabaseServerClient|\.from\(/i.test(source), "não deveria fazer nenhuma chamada ao banco");
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exitCode = 1;
}
