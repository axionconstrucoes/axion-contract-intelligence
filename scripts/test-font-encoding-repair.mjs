// Testes da camada normalizada de texto extraído
// (apps/web/lib/documents/extraction/repair-font-encoding.ts).
// Uso: node scripts/test-font-encoding-repair.mjs

import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const { normalizeExtractedText, normalizeSegmentText } = await import(
  "../apps/web/lib/documents/extraction/repair-font-encoding.ts"
);

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
  if (actual !== expected) {
    throw new Error(`esperado ${JSON.stringify(expected)}, obtido ${JSON.stringify(actual)}`);
  }
}

const norm = (text) => normalizeExtractedText(text).text;

// ---------- corrige (amostras reais do contrato NEWPORT, Parte 1) ----------
check("minúsculas: construÁ„o, Aplic·vel, obrigaÁıes, atÈ", () => {
  assertEqual(
    norm("contrato de construÁ„o com a LegislaÁ„o Aplic·vel e obrigaÁıes atÈ o fim"),
    "contrato de construção com a Legislação Aplicável e obrigações até o fim"
  );
});
check("maiúscula acentuada no meio de palavra: TÈcnica, perÌodo, apÛs", () => {
  assertEqual(norm("DocumentaÁ„o TÈcnica no perÌodo apÛs a entrega"), "Documentação Técnica no período após a entrega");
});
check("MAIÚSCULAS: RESOLU«√O, OBRIGA«’ES, SUSPENS√O", () => {
  assertEqual(norm("RESOLU«√O DAS OBRIGA«’ES E SUSPENS√O"), "RESOLUÇÃO DAS OBRIGAÇÕES E SUSPENSÃO");
});
check("crase isolada, ordinais e parágrafo: ‡, 1∫, n∫, ß 2", () => {
  assertEqual(norm("conforme ‡ cláusula 1∫, item n∫ 3 e ß 2 do contrato n„o"), "conforme à cláusula 1º, item nº 3 e § 2 do contrato não");
});
check("inicial acentuada em palavra comprovadamente corrompida: Ûrg„os", () => {
  assertEqual(norm("perante os Ûrg„os competentes e a execuÁ„o"), "perante os órgãos competentes e a execução");
});
check("lista de correções para auditoria (original → normalizado)", () => {
  const { repairs } = normalizeExtractedText("a execuÁ„o n„o");
  assertEqual(JSON.stringify(repairs), JSON.stringify([
    { original: "execuÁ„o", normalized: "execução" },
    { original: "n„o", normalized: "não" },
  ]));
});

check("verbo 'é' isolado entre minúsculas: que È o", () => {
  assertEqual(norm("a obrigaÁ„o que È o objeto, e È devida"), "a obrigação que é o objeto, e é devida");
});
check("'È' isolado fora do contexto minúsculo não muda", () => {
  assertEqual(norm("a execuÁ„o. È Assim"), "a execução. È Assim");
});

check("MAIÚSCULAS com Í corrompido: ÕNDICE, ÕNICIO, LOGÕSTICA (sem tocar AÇÕES)", () => {
  // "ÕNICIO" vira "ÍNICIO" (grafia do próprio documento, acento na 1ª
  // letra) — a camada corrige a codificação, nunca a ortografia.
  assertEqual(norm("ÕNDICE · 6. ÕNICIO DOS SERVIÇOS · NEWPORT LOGÕSTICA · OBRIGAÇÕES"), "ÍNDICE · 6. ÍNICIO DOS SERVIÇOS · NEWPORT LOGÍSTICA · OBRIGAÇÕES");
});

// ---------- NÃO altera texto correto ----------
check("texto correto sem sinal de corrupção fica idêntico", () => {
  const text = "Água, Ácido, ÁREA, INFORMAÇÕES, Órgãos, É obrigação da CONTRATADA — 1º e § 2.";
  assertEqual(norm(text), text);
});
check("tipografia legítima preservada mesmo em trecho corrompido: “Contrato”, d’água, EPI’s, · separador", () => {
  assertEqual(
    norm("a execuÁ„o do “Contrato” (d’água, EPI’s) · Seção 2"),
    "a execução do “Contrato” (d’água, EPI’s) · Seção 2"
  );
});
check("palavra válida com maiúscula acentuada inicial não muda: Água em trecho corrompido", () => {
  assertEqual(norm("Água e esgoto: a execuÁ„o"), "Água e esgoto: a execução");
});
check("palavra cuja correção não resulta em português válido fica como está", () => {
  assertEqual(norm("a execuÁ„o e o código X·Y9"), "a execução e o código X·Y9");
});
check("segmentos de OCR e marcadores de página pendente nunca são tocados", () => {
  const ocr = "texto com execuÁ„o";
  assertEqual(normalizeSegmentText(ocr, "arquivo.pdf · pág. local 1 · pág. global 1 · OCR por (confianca 90%)").text, ocr);
  assertEqual(normalizeSegmentText(ocr, "arquivo.pdf · pág. local 1 · pág. global 1 · PENDENTE: OCR_BAIXA_CONFIANCA").text, ocr);
  assertEqual(normalizeSegmentText(ocr, "arquivo.pdf · pág. local 1 · pág. global 1 · TEXTO_NATIVO").text, "texto com execução");
});

console.log("");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
process.exit(failed > 0 ? 1 : 0);
