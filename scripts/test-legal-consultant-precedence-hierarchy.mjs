// HIERARQUIA DO EXPERT JURÍDICO (item 4) — ordem de precedência padrão
// entre documentos contratuais, adicionada às instruções base do
// Consultor Jurídico IA: Aditivo aprovado (só no que altera) > Contrato
// assinado > Anexos formalmente incorporados > Edital/RFP > Documentos
// informativos. A cláusula específica de precedência do próprio
// contrato sempre prevalece sobre esta hierarquia padrão.
//
// Estrutural (leitura de código-fonte) — mesmo padrão já usado para
// outras seções de prompt versionadas neste projeto (ver
// apps/web/lib/additionals/confrontation/identity.ts).
//
// Uso:
//   node scripts/test-legal-consultant-precedence-hierarchy.mjs

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
console.log("HIERARQUIA DO EXPERT JURÍDICO — ordem de precedência padrão");
console.log("======================================");
console.log("");

const { LEGAL_CONSULTANT_INSTRUCTIONS, LEGAL_CONSULTANT_VERSION } = await import(
  "../apps/web/lib/ai/experts/legal-consultant/identity.ts"
);

// Normaliza espaços/quebras de linha para uma checagem robusta ao
// wrap de texto do prompt (que muda com frequência sem alterar o
// significado) — usado só nas checagens de frase corrida abaixo.
const normalizedInstructions = LEGAL_CONSULTANT_INSTRUCTIONS.replace(/\s+/g, " ");
function includesNormalized(phrase) {
  return normalizedInstructions.includes(phrase.replace(/\s+/g, " "));
}
const { CLIENT_SOURCE_CONFRONTATION_VERSION, CLIENT_SOURCE_CONFRONTATION_INSTRUCTIONS } = await import(
  "../apps/web/lib/additionals/confrontation/identity.ts"
);

check("versão do Expert foi incrementada (v1 -> v2 -> v3) junto com a mudança de prompt", () => {
  assert(LEGAL_CONSULTANT_VERSION === "v3", `esperado v3, obtido ${LEGAL_CONSULTANT_VERSION}`);
  assert(LEGAL_CONSULTANT_INSTRUCTIONS.includes(LEGAL_CONSULTANT_VERSION), "as instruções deveriam referenciar a versão atual");
});

check("as 5 camadas da hierarquia aparecem, na ordem correta (mais para menos prioritária)", () => {
  const order = [
    "Aditivo aprovado",
    "Contrato assinado",
    "Anexos formalmente incorporados",
    "Edital/RFP",
    "Documentos meramente informativos",
  ];
  let lastIndex = -1;
  for (const term of order) {
    const index = LEGAL_CONSULTANT_INSTRUCTIONS.indexOf(term);
    assert(index !== -1, `termo "${term}" não encontrado nas instruções`);
    assert(index > lastIndex, `"${term}" deveria aparecer depois do item anterior da hierarquia`);
    lastIndex = index;
  }
});

check("aditivo só prevalece NO QUE ALTERA — fora disso o contrato-base original continua vigente", () => {
  assert(/somente na parte que ele efetivamente altera/.test(LEGAL_CONSULTANT_INSTRUCTIONS));
  assert(
    /fora\s+do que o aditivo altera, o contrato-base original continua vigente/.test(LEGAL_CONSULTANT_INSTRUCTIONS),
    "regra de vigência residual do contrato-base fora do que o aditivo altera não encontrada"
  );
});

check("proposta/descrição/especificação/cronograma só prevalecem sobre o edital quando formalmente aceitos/incorporados — nunca por padrão", () => {
  assert(
    /só prevalecem sobre o edital\/RFP quando formalmente\s*\naceitos\/incorporados ao contrato/.test(LEGAL_CONSULTANT_INSTRUCTIONS),
    "deveria existir a regra explícita de incorporação formal"
  );
});

check("cláusula específica de precedência do contrato SEMPRE prevalece sobre a hierarquia padrão", () => {
  assert(/cláusula específica de ordem de precedência do próprio contrato/i.test(LEGAL_CONSULTANT_INSTRUCTIONS));
  assert(/SEMPRE prevalece sobre esta hierarquia padrão/.test(LEGAL_CONSULTANT_INSTRUCTIONS));
  assert(/nunca aplique a hierarquia padrão por cima de uma cláusula explícita/.test(LEGAL_CONSULTANT_INSTRUCTIONS));
});

check("toda conclusão de precedência deve citar: documento, versão, cláusula, vínculo, regra de precedência aplicada, conclusão, necessidade de revisão humana", () => {
  for (const term of [
    "**documento**",
    "**versão**",
    "**cláusula**",
    "**vínculo**",
    "**regra de\nprecedência aplicada**",
    "**conclusão**",
    "**revisão humana é necessária**",
  ]) {
    assert(LEGAL_CONSULTANT_INSTRUCTIONS.includes(term), `elemento de citação obrigatória não encontrado: ${term}`);
  }
});

check("vínculo nunca é inferido só pelo nome do documento", () => {
  assert(/nunca inferido só pelo nome/.test(LEGAL_CONSULTANT_INSTRUCTIONS));
});

check("contractualLink transporta FATOS, nunca uma conclusão de precedência pré-calculada — a CONCLUSÃO continua sempre do Expert", () => {
  assert(LEGAL_CONSULTANT_INSTRUCTIONS.includes("`contractualLink`"), "deveria haver uma seção dedicada explicando contractualLink");
  assert(
    includesNormalized("Isto NUNCA vem acompanhado de um nível de precedência pré-calculado"),
    "deveria deixar explícito que não existe um nível de precedência pré-computado no contexto"
  );
});

check("anexo de CONTRATO_BASE só acompanha a precedência do contrato quando a incorporação estiver comprovada (vínculo + fundamento)", () => {
  assert(
    includesNormalized(
      "acompanha a precedência do contrato-base (nível 2) SOMENTE quando a incorporação estiver comprovada"
    )
  );
});

check("anexo de ADITIVO só acompanha a precedência do aditivo se o aditivo estiver aprovado/vigente E só no escopo alterado — a existência do vínculo, sozinha, NUNCA prova isso", () => {
  assert(
    includesNormalized(
      "acompanha a precedência do aditivo (nível 1) SOMENTE SE esse aditivo estiver aprovado/vigente, e apenas no escopo que esse aditivo efetivamente altera"
    )
  );
  assert(includesNormalized("A EXISTÊNCIA do vínculo, sozinha, NUNCA prova que o aditivo está aprovado/vigente"));
  assert(
    LEGAL_CONSULTANT_INSTRUCTIONS.includes("declare a vigência do aditivo como"),
    "sem confirmação de vigência, deveria declarar DECISÃO HUMANA NECESSÁRIA em vez de presumir"
  );
});

check("cláusula explícita de precedência continua prevalecendo sobre a leitura de contractualLink", () => {
  assert(
    includesNormalized("Uma cláusula de precedência EXPLÍCITA do contrato (seção acima) sempre prevalece sobre a leitura de `contractualLink`")
  );
});

check("confrontation/identity.ts (v2): precedenceFound/precedenceSummary continuam se referindo só a uma cláusula EXPLÍCITA do contrato — nunca marcados a partir da hierarquia padrão herdada da base", () => {
  assert(CLIENT_SOURCE_CONFRONTATION_VERSION === "v2");
  assert(
    CLIENT_SOURCE_CONFRONTATION_INSTRUCTIONS.includes("nunca marque"),
    "confrontation deveria deixar explícito que a hierarquia padrão não conta como cláusula explícita"
  );
  assert(CLIENT_SOURCE_CONFRONTATION_INSTRUCTIONS.includes("a partir da hierarquia padrão da seção"));
  assert(CLIENT_SOURCE_CONFRONTATION_INSTRUCTIONS.includes("precedenceFound = true"));
  // A hierarquia padrão da base (herdada) continua presente no prompt
  // combinado — o confronto não a remove, só esclarece o que ela NÃO é.
  assert(CLIENT_SOURCE_CONFRONTATION_INSTRUCTIONS.includes("Aditivo aprovado"));
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exitCode = 1;
}
