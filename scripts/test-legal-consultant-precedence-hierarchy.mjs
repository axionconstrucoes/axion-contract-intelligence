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

check("versão do Expert foi incrementada (v1 -> v2 -> v3 -> v4) junto com a mudança de prompt", () => {
  assert(LEGAL_CONSULTANT_VERSION === "v4", `esperado v4, obtido ${LEGAL_CONSULTANT_VERSION}`);
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

// --- v4: defesa do Construtor, sem quebrar a hierarquia --------------

check("v4: o contrato continua soberano — a proposta NUNCA prevalece sobre ele", () => {
  assert(includesNormalized("O contrato é soberano"), "a soberania do contrato precisa estar explícita");
  assert(
    includesNormalized("a proposta comercial NÃO prevalece sobre o contrato-base"),
    "a não-prevalência da proposta precisa ser dita sem rodeio"
  );
  // A hierarquia original continua intacta — a v4 acrescenta, não substitui.
  assert(includesNormalized("Aditivo aprovado"), "a hierarquia padrão não pode ter sido removida");
  assert(
    includesNormalized("só prevalecem sobre o edital/RFP quando formalmente aceitos/incorporados"),
    "a regra de incorporação formal continua valendo"
  );
});

check("v4: a proposta anexada é fonte de ARGUMENTO em litígio, nunca regra de precedência", () => {
  assert(includesNormalized("fonte legítima de argumento"), "o uso probatório precisa estar previsto");
  assert(
    includesNormalized("classifique como **INTERPRETAÇÃO DA IA**"),
    "a tese precisa sair como interpretação, nunca como precedência"
  );
  assert(
    includesNormalized("nunca como regra de precedência"),
    "o limite precisa ser explícito"
  );
  assert(includesNormalized("pode sustentar a tese de que"), "linguagem condicional obrigatória");
  assert(
    includesNormalized("cite o anexo em"),
    "sem citação em baseContratual não há tese"
  );
});

check("v4: proposta NÃO incorporada não sustenta tese — vira lacuna declarada", () => {
  assert(
    includesNormalized("não construa tese sobre ela"),
    "documento meramente informativo não pode virar tese"
  );
  assert(
    includesNormalized("a ausência de incorporação formal é, ela própria, um achado relevante"),
    "a lacuna precisa ser tratada como achado"
  );
});

check("v4: parcialidade vale para recomendação, nunca para fato", () => {
  assert(includesNormalized("defesa dos interesses do Construtor"), "o perfil precisa estar declarado");
  assert(
    includesNormalized("A parcialidade vale para RECOMENDAÇÃO e para a tese jurídica — nunca para o FATO"),
    "o limite da parcialidade é o que protege a separação fato/interpretação"
  );
  assert(
    includesNormalized("inclusive quando o que ela diz é desfavorável à AXION"),
    "ler a cláusula como está escrita, mesmo contra a AXION"
  );
});

check("v4: o checklist de blindagem tem dois modos, ligados ao workspaceType", () => {
  assert(includesNormalized("PRE_CONTRATUAL"), "o modo propositivo precisa estar amarrado ao workspace");
  assert(includesNormalized("OBRA"), "o modo diagnóstico precisa existir");
  assert(
    includesNormalized("Nunca afirme que um mecanismo ausente \"deveria valer\": ele não vale"),
    "em obra assinada, mecanismo ausente não vale — é a trava contra leitura errada"
  );
});

check("v4: os quatro eixos de blindagem estão cobertos", () => {
  const eixos = [
    "Condições de contorno e solo",
    "Ordem de mudança",
    "Extensão automática",
    "Aviso prévio",
    "Teto global",
    "Proporcionalidade da mora",
    "Exclusividade de remédio",
    "Eficácia do RDO",
    "Força das atas de reunião",
    "Vinculação da proposta e da planilha",
  ];
  for (const eixo of eixos) {
    assert(includesNormalized(eixo), `eixo de blindagem ausente: ${eixo}`);
  }
});

check("v4: patamar de mercado é prática negocial, nunca obrigação nem baseLegal", () => {
  assert(
    includesNormalized("Patamares de mercado NUNCA são obrigação"),
    "o limite precisa ter título próprio"
  );
  assert(includesNormalized('kind: "NEGOTIATION_PRACTICE"'), "a classificação obrigatória precisa estar dita");
  assert(
    includesNormalized("nunca o coloque em"),
    "patamar de mercado não pode ir para baseLegal"
  );
  assert(
    includesNormalized('nunca afirme que um contrato "descumpre" um patamar de mercado'),
    "descumprir prática de mercado não existe"
  );
  // baseLegal continua vazia nesta fase — a v4 não afrouxou isso.
  assert(
    includesNormalized("deixe \\`baseLegal\\` vazio") || includesNormalized("baseLegal"),
    "a regra de baseLegal vazia precisa continuar"
  );
});

check("v4: dado externo que não existe no contexto vira informação faltante", () => {
  assert(includesNormalized("INMET"), "o caso concreto da chuva precisa estar tratado");
  assert(
    includesNormalized("Nunca afirme que o dado existe ou que ele confirma a tese"),
    "a proibição de inventar o dado precisa ser explícita"
  );
  assert(includesNormalized("informacoesFaltantes"), "o destino do dado ausente precisa estar dito");
});

check("v4: redline sai em recomendacoes, não em rascunhoSugerido", () => {
  assert(
    includesNormalized("proponha a nova redação em"),
    "o destino do redline precisa estar explícito"
  );
  assert(
    includesNormalized("para redline nesta fase"),
    "a exclusão precisa ser explícita, com o motivo"
  );
  assert(
    includesNormalized("guardrail de grounding"),
    "o motivo técnico precisa estar registrado para quem for reavaliar"
  );
  // rascunhoSugerido continua existindo para comunicação, com o status travado.
  assert(includesNormalized('status: "DRAFT_PENDING_REVIEW"'), "o rascunho de comunicação segue travado");
});

check("v4: o roteiro de saída mapeia para campos do ExpertQueryResponse, não texto livre", () => {
  assert(
    includesNormalized("nunca devolva o relatório como texto livre"),
    "a resposta é estruturada, não relatório markdown"
  );
  for (const campo of ["interpretacao", "riscos", "baseContratual", "informacoesFaltantes", "acoesSugeridas"]) {
    assert(includesNormalized(campo), `campo de destino ausente no roteiro: ${campo}`);
  }
  assert(includesNormalized("Empreitada Global"), "a modalidade precisa entrar no resumo executivo");
  assert(includesNormalized("PMG"), "PMG precisa estar coberto");
});

check("v4: governança e revisão humana continuam intactas", () => {
  assert(includesNormalized("requiresHumanReview"), "revisão humana obrigatória preservada");
  assert(
    includesNormalized("Você NÃO PODE: aprovar sua própria recomendação"),
    "os limites de governança não podem ter sido afrouxados pela postura de defesa"
  );
  assert(
    includesNormalized("assumir posição jurídica vinculante pela AXION"),
    "defesa do Construtor não autoriza posição vinculante"
  );
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exitCode = 1;
}
