// Testes do detector de cláusulas (formato decimal + regressão do formato
// "CLÁUSULA PRIMEIRA"). Uso: node scripts/test-clause-decimal-detector.mjs
// Trechos baseados no contrato NEWPORT (texto já normalizado).

import { detectClauseCandidates } from "./clause-structure-detector.mjs";

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

const segs = (...pages) =>
  pages.map((text, index) => ({
    id: `seg-${index + 1}`,
    pageNumber: index + 1,
    locator: `contrato.pdf · pág. local ${index + 1} · pág. global ${index + 1} · TEXTO_NATIVO`,
    textContent: text,
  }));
const numbers = (candidates) => candidates.map((candidate) => candidate.proposedClauseNumber);

// Um segmento por página, como no documento real.
const page1 =
  "Página 1 de 3 CONTRATO PARTE A - QUADRO RESUMO 01 CONTRATANTE NEWPORT LOGÍSTICA FUNDO, fundo de investimento. " +
  "02 OBJETO 2.1. Constitui objeto deste Contrato a execução da Obra. 2.2 . A Contratada declara que visitou o Local. " +
  "03 PRAZOS 3.1. Este Contrato entra em vigor na assinatura. 3.2. A Obra deverá ser concluída em até 214 dias contados da emissão. " +
  "3.5.1. Em até 5 (cinco) dias da solicitação, a Contratada apresentará proposta.";
const page2 =
  "Página 2 de 3 PARTE B - CONDIÇÕES GERAIS ÍNDICE 1. ESCOPO DA CONTRATAÇÃO.............................. 24 " +
  "2. DECLARAÇÕES INICIAIS................................. 25 TERMOS E CONDIÇÕES 1. ESCOPO DA CONTRATAÇÃO " +
  "1.1. Escopo da Contratação. O presente Contrato tem por objeto a Obra, conforme item 3.6.2 e cláusula 13.3, " +
  "pelo valor de R$ 25.500.000,00 e CNPJ 32.527.626/0001-47, com início em 16.07.2024 às 18 horas. " +
  "1.2. Elaboração dos Projetos. A Contratada será a responsável pelos Projetos, observado o disposto nos itens 6.1 a 6.3";
const page3 =
  "Página 3 de 3 e seguirá até a entrega. 2. DECLARAÇÕES INICIAIS 2.1. Competência. A Contratada declara competência " +
  "na forma da legislação processual civil 2.2. Conhecimento do Local. A Contratada conhece o local. ***";
const page4 = "ANEXO I – DOCUMENTAÇÃO TÉCNICA 6. OBRAS 6.1. Todos os projetos deverão ter Responsável Técnico.";

const candidates = detectClauseCandidates(segs(page1, page2, page3, page4));

check("Parte A: títulos sem ponto (01, 02 OBJETO, 03 PRAZOS) e subcláusulas 2.1, 2.2 ., 3.1, 3.2, 3.5.1", () => {
  assertEqual(numbers(candidates.filter((c) => c.section === "A")), ["A-1", "A-2", "A-2.1", "A-2.2", "A-3", "A-3.1", "A-3.2", "A-3.5.1"]);
});
check("Parte B: sumário ignorado; títulos e subcláusulas reconhecidos; numeração reinicia por seção", () => {
  assertEqual(numbers(candidates.filter((c) => c.section === "B")), ["B-1", "B-1.1", "B-1.2", "B-2", "B-2.1", "B-2.2"]);
});
check("referências (item 3.6.2, cláusula 13.3, itens 6.1 a 6.3), valores, CNPJ, datas e horas não viram cláusula", () => {
  const all = numbers(candidates).join(" ");
  for (const bad of ["3.6.2", "13.3", "6.1", "6.3", "25.500", "32.527", "16.07", "-18"]) {
    if (all.includes(bad)) throw new Error(`falso positivo: ${bad}`);
  }
});
check("anexo depois da última página do contrato ('Página 3 de 3') não é detectado como cláusula", () => {
  if (candidates.some((c) => c.proposedText.includes("Responsável Técnico"))) throw new Error("cláusula do anexo detectada");
});
check("título inline de subcláusula ('Escopo da Contratação.') e título em maiúsculas do nível 1", () => {
  const c11 = candidates.find((c) => c.proposedClauseNumber === "B-1.1");
  const c1 = candidates.find((c) => c.proposedClauseNumber === "B-1");
  assertEqual([c11.proposedTitle, c1.proposedTitle], ["Escopo da Contratação", "ESCOPO DA CONTRATAÇÃO"]);
});
check("cláusula que atravessa página: páginas de início e fim, rodapé removido do texto", () => {
  const c12 = candidates.find((c) => c.proposedClauseNumber === "B-1.2");
  assertEqual([c12.startPage, c12.endPage], [2, 3]);
  if (/Página \d+ de \d+/.test(c12.proposedText)) throw new Error("rodapé no texto da cláusula");
  if (!c12.locator.includes("até pág. global 3")) throw new Error("locator sem página final");
});
check("hierarquia preservada no texto proposto (pai › filho)", () => {
  const c351 = candidates.find((c) => c.proposedClauseNumber === "A-3.5.1");
  if (!c351.proposedText.includes("3 PRAZOS › 3.5.1")) throw new Error(c351.proposedText.split("\n")[0]);
});
check("início sem pontuação aceito só como próximo irmão, e sinalizado para revisão", () => {
  const c22 = candidates.find((c) => c.proposedClauseNumber === "B-2.2");
  if (!c22.flags.some((flag) => flag.startsWith("INICIO_SEM_PONTUACAO"))) throw new Error("sem sinalização");
});
check("chave do candidato é estável (seção|número|ocorrência), independente da posição do segmento", () => {
  assertEqual(candidates.find((c) => c.proposedClauseNumber === "B-1.1").candidateKey, "B|1.1|1");
});
check("numeração inconsistente do documento (como '22.1' dentro da 23 no NEWPORT) é mantida e sinalizada", () => {
  const text =
    "PARTE B - GERAIS 1. DISPOSIÇÕES GERAIS 1.1. Notificações. Por escrito. 1.2. Aditamento. Por aditivo. " +
    "2. RESOLUÇÃO DE DISPUTAS 1.1 Interpretação do Contrato. Lei brasileira. 1.2 Foro. São Paulo.";
  const result = detectClauseCandidates(segs(text));
  assertEqual(numbers(result), ["B-1", "B-1.1", "B-1.2", "B-2", "B-1.1 (2ª ocorrência)", "B-1.2 (2ª ocorrência)"]);
  if (!result[4].flags.some((flag) => flag.startsWith("NUMERACAO_INCONSISTENTE"))) throw new Error("sem sinalização");
  assertEqual(new Set(result.map((c) => c.candidateKey)).size, result.length);
});
check("texto sem estrutura de cláusula devolve zero candidatos (o chamador deve tratar como FALHA de detecção)", () => {
  assertEqual(detectClauseCandidates(segs("Ata da assembleia. Aos 16 de julho de 2024 compareceram os membros.")).length, 0);
});
check("regressão: formato 'CLÁUSULA PRIMEIRA –' continua no detector original e tem prioridade", () => {
  const result = detectClauseCandidates(
    segs("CLÁUSULA PRIMEIRA – DO OBJETO 1.1. A Contratada executará a obra. CLÁUSULA SEGUNDA – DO PREÇO O preço é fixo.")
  );
  assertEqual([result.map((c) => c.proposedClauseNumber), result.map((c) => c.pattern)], [["1", "2"], ["CLAUSE_WORD", "CLAUSE_WORD"]]);
  assertEqual(result[0].detector, "clause-structure");
});

console.log("");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
process.exit(failed > 0 ? 1 : 0);
