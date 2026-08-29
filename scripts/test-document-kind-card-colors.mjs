// Cores do cartão de documento por TIPO DOCUMENTAL (Documentos) —
// REGRA VISUAL FINAL: bordô (contrato-base/aditivo/anexo contratual),
// verde (relatório semanal sem vínculo contratual), laranja (todos os
// demais documentos não contratuais). A cor representa só o tipo
// documental/vínculo contratual — nunca risco, severidade,
// processamento ou resultado de análise.
//
// Cobre a função centralizada
// apps/web/lib/documents/document-kind-card-appearance.ts (importada e
// executada de verdade — não é só regex, mesmo padrão já usado em
// scripts/test-multi-document-upload.mjs para queue-core.ts) e
// checagens estruturais em apps/web/app/[projectId]/documentos/page.tsx
// e em globals.css/badges.tsx (cores de risco intocadas), mesmo padrão
// já usado em scripts/test-risk-medium-color.mjs.
//
// Ver scripts/test-document-kind-card-appearance.mjs para a suíte
// dedicada e mais completa desta regra (incluindo isContractualAttachment)
// — as checagens abaixo cobrem o esquema de cores por igualdade exata
// (Set.has, nunca substring) e os invariantes que não mudam com a cor
// (risco/severidade/banner de teste).
//
// Uso:
//   node scripts/test-document-kind-card-colors.mjs

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
console.log("CORES DO CARTÃO DE DOCUMENTO POR TIPO DOCUMENTAL (Documentos)");
console.log("======================================");
console.log("");

const { getDocumentKindCardAppearance } = await import(
  "../apps/web/lib/documents/document-kind-card-appearance.ts"
);

// Esquema ATUAL (REGRA VISUAL FINAL — substitui integralmente todos os
// esquemas anteriores desta suíte, incluindo o de "vermelho + marrom +
// neutro" que substituiu o esquema de 4 grupos original). Não há mais
// caso neutro: todo DocumentKind cai em uma das três cores.
const BORDO_KINDS = ["CONTRATO_BASE", "ADITIVO"];
const GREEN_KINDS = ["RELATORIO_SEMANAL", "RELATORIO"];

// Todos os demais valores reais de DocumentKind — checagem exaustiva,
// não uma amostra.
const ORANGE_KINDS = [
  "EDITAL",
  "RFI",
  "RFP",
  "ESPECIFICACAO",
  "DESENHO",
  "PLANILHA",
  "CRONOGRAMA_BASELINE",
  "CRONOGRAMA_REVISAO",
  "PROPOSTA_AXION",
  "CLARIFICACAO_CLIENTE",
  "ATA_REUNIAO",
  "PROPOSTA_COMERCIAL",
  "PROPOSTA_TECNICA",
  "PLANILHA_CONTRATUAL",
  "NOTIFICACAO",
  "ESG_SSMA",
  "DIARIO_OBRA",
  "OUTRO",
];

// --- 1: CONTRATO_BASE e ADITIVO recebem bordô institucional (caixa inteira) ---

check("CONTRATO_BASE e ADITIVO recebem bordô institucional na caixa inteira (border-brand-sidebar, bg-brand-sidebar, text-brand-sidebar-foreground) — nunca mais marrom para ADITIVO", () => {
  for (const kind of BORDO_KINDS) {
    const { cardClassName, titleClassName } = getDocumentKindCardAppearance(kind);
    assert(/\bbg-brand-sidebar\b/.test(cardClassName), `${kind} esperado bg-brand-sidebar: "${cardClassName}"`);
    assert(/\bborder-brand-sidebar\b/.test(cardClassName), `${kind} esperado border-brand-sidebar: "${cardClassName}"`);
    assert(/\btext-brand-sidebar-foreground\b/.test(cardClassName), `${kind} esperado text-brand-sidebar-foreground: "${cardClassName}"`);
    assert(titleClassName.includes("font-bold"), `${kind}: título deveria ser negrito`);
  }
});

// --- 2: RELATORIO_SEMANAL e RELATORIO recebem verde (caixa inteira) ---

check("RELATORIO_SEMANAL e RELATORIO recebem verde na caixa inteira (bg-emerald-700, text-white) — relatório semanal sem vínculo contratual", () => {
  for (const kind of GREEN_KINDS) {
    const { cardClassName, titleClassName } = getDocumentKindCardAppearance(kind);
    assert(/\bbg-emerald-700\b/.test(cardClassName), `${kind} esperado bg-emerald-700: "${cardClassName}"`);
    assert(/\btext-white\b/.test(cardClassName), `${kind} esperado text-white: "${cardClassName}"`);
    assert(titleClassName.includes("font-bold"), `${kind}: título deveria ser negrito`);
  }
});

// --- 3: todos os demais DocumentKind reais recebem laranja ---

check("todos os demais DocumentKind reais recebem laranja (bg-orange-700, text-white) — especificações, atas, editais e demais documentos não contratuais", () => {
  for (const kind of ORANGE_KINDS) {
    const { cardClassName, titleClassName } = getDocumentKindCardAppearance(kind);
    assert(/\bbg-orange-700\b/.test(cardClassName), `${kind} esperado bg-orange-700: "${cardClassName}"`);
    assert(/\btext-white\b/.test(cardClassName), `${kind} esperado text-white: "${cardClassName}"`);
    assert(titleClassName.includes("font-bold"), `${kind}: título deveria ser negrito`);
  }
});

// --- valor desconhecido cai em laranja (nunca mais neutro/quebra) ---

check("valor de kind desconhecido, null ou undefined cai em laranja (nunca neutro, nunca quebra)", () => {
  for (const kind of ["VALOR_DESCONHECIDO", null, undefined, ""]) {
    const { cardClassName } = getDocumentKindCardAppearance(kind);
    assert(/\bbg-orange-700\b/.test(cardClassName), `kind ${JSON.stringify(kind)} deveria cair em laranja`);
  }
});

// --- 12-13: regra depende exclusivamente do kind — igualdade exata, nunca substring/título ---

check("igualdade exata: valores que só CONTÊM um kind bordô/verde como substring caem em laranja (default), nunca herdam a cor por acidente", () => {
  const substringTraps = [
    "ADITIVO_CANCELADO",
    "PRE_ADITIVO",
    "XADITIVOX",
    "CONTRATO_BASE_ANTIGO",
    "NAO_CONTRATO_BASE",
    "RELATORIO_SEMANAL_ANTIGO",
    "PRE_RFI",
    "DIARIO_OBRA_ANTIGO",
  ];
  const laranja = getDocumentKindCardAppearance("OUTRO");
  for (const trap of substringTraps) {
    const { cardClassName } = getDocumentKindCardAppearance(trap);
    assert(cardClassName === laranja.cardClassName, `"${trap}" contém a substring mas não é igual a nenhum kind — deveria cair em laranja (default)`);
  }
});

check("assinatura da função aceita kind e um segundo parâmetro opcional (isContractualAttachment) — nunca título/nome de arquivo", () => {
  assert(getDocumentKindCardAppearance.length <= 2, "getDocumentKindCardAppearance deveria receber no máximo (kind, options)");
});

const appearanceHelperSource = readSource(
  "apps/web/lib/documents/document-kind-card-appearance.ts"
);

check("document-kind-card-appearance.ts: nunca referencia title/fileName/filename/summary na decisão de cor", () => {
  assert(
    !/\btitle\b|\bfileName\b|\bfilename\b|originalFileName|\bsummary\b/i.test(appearanceHelperSource),
    "o helper central não pode basear a cor em título, nome de arquivo ou resumo"
  );
});

check("document-kind-card-appearance.ts: comparação é por igualdade exata (Set.has), não .includes()", () => {
  assert(!appearanceHelperSource.includes(".includes("), "não deveria usar .includes() (substring) na regra de cor");
  assert(/\.has\(/.test(appearanceHelperSource), "deveria usar Set.has() (igualdade exata)");
});

// --- 14: cores de risco/severidade não foram alteradas ---

const globalsCss = readSource("apps/web/app/globals.css");

check("globals.css: --risk-media permanece intocado (azul, oklch hue 200-280)", () => {
  const match = globalsCss.match(/--risk-media:\s*oklch\([^)]*\s(\d+(?:\.\d+)?)\)/);
  assert(match, "--risk-media não encontrado");
  const hue = Number(match[1]);
  assert(hue >= 200 && hue <= 280, `--risk-media deveria continuar azul (hue 200-280), encontrado ${hue}`);
});

check("globals.css: --severity-baixa/media/alta/critica permanecem intocados", () => {
  assert(/--severity-baixa:\s*oklch\(0\.6 0\.09 175\)/.test(globalsCss), "--severity-baixa alterado");
  assert(/--severity-media:\s*oklch\(0\.75 0\.14 85\)/.test(globalsCss), "--severity-media alterado");
  assert(/--severity-alta:\s*oklch\(0\.68 0\.19 45\)/.test(globalsCss), "--severity-alta alterado");
  assert(/--severity-critica:\s*oklch\(0\.58 0\.22 25\)/.test(globalsCss), "--severity-critica alterado");
});

const badgesSource = readSource("apps/web/components/shared/badges.tsx");

check("badges.tsx: severityClasses (risco) não foi tocado por esta mudança", () => {
  assert(
    /MEDIA:\s*"[^"]*bg-risk-media\s+text-white\s+font-bold[^"]*"/.test(badgesSource),
    "severityClasses.MEDIA deveria continuar bg-risk-media + text-white + font-bold"
  );
  assert(
    /ALTA:\s*"border-transparent bg-severity-alta text-white font-bold"/.test(badgesSource),
    "severityClasses.ALTA deveria continuar inalterado"
  );
});

// --- 15: faixa SISTEMA EM TESTE não foi alterada por esta mudança ---

check("faixa SISTEMA EM TESTE: nenhum arquivo desta feature (helper, página, script) a referencia ou modifica", () => {
  const documentosPageSource = readSource(
    "apps/web/app/[projectId]/documentos/page.tsx"
  );
  assert(
    !/SISTEMA EM TESTE/i.test(appearanceHelperSource) && !/SISTEMA EM TESTE/i.test(documentosPageSource),
    "esta feature não deveria mencionar/alterar a faixa SISTEMA EM TESTE"
  );
});

// --- 16: as três cores são distintas entre si ---

check("BORDÔ, VERDE e LARANJA usam cores DISTINTAS entre si (nunca a mesma classe) — todas com título em negrito", () => {
  const bordo = getDocumentKindCardAppearance("CONTRATO_BASE");
  const verde = getDocumentKindCardAppearance("RELATORIO_SEMANAL");
  const laranja = getDocumentKindCardAppearance("OUTRO");

  assert(bordo.cardClassName !== verde.cardClassName, "bordô e verde deveriam ter cores diferentes");
  assert(verde.cardClassName !== laranja.cardClassName, "verde e laranja deveriam ter cores diferentes");
  assert(bordo.cardClassName !== laranja.cardClassName, "bordô e laranja deveriam ter cores diferentes");
  assert(bordo.titleClassName.includes("font-bold"));
  assert(verde.titleClassName.includes("font-bold"));
  assert(laranja.titleClassName.includes("font-bold"));
});

// --- estrutural: página usa o helper central, sem lógica antiga inline ---

const documentosPageSource = readSource(
  "apps/web/app/[projectId]/documentos/page.tsx"
);

check("documentos/page.tsx: usa o helper central getDocumentKindCardAppearance (via DocumentCard, reaproveitado pelos grupos contratuais e pela lista sem vínculo), não reimplementa a regra inline", () => {
  const documentCardSource = readSource("apps/web/components/documents/document-card.tsx");
  assert(documentosPageSource.includes("DocumentCard"), "a página deveria renderizar a listagem através de DocumentCard");
  assert(
    documentCardSource.includes("getDocumentKindCardAppearance(") &&
      documentCardSource.includes(
        'from "@/lib/documents/document-kind-card-appearance"'
      ),
    "DocumentCard deveria importar e chamar getDocumentKindCardAppearance"
  );
});

check("documentos/page.tsx: não tem mais lógica de cor antiga inline (verde antigo, amarelo antigo por .includes, ou ternário de kind)", () => {
  assert(!documentosPageSource.includes('.kind.includes("ADITIVO")'), "regra antiga por substring deveria ter sido removida");
  assert(!/border-green-500\/50|bg-green-50 dark:bg-green-950/.test(documentosPageSource), "cor verde antiga (lógica inline anterior) não deveria mais aparecer");
  assert(
    !/document\.kind === "CONTRATO_BASE"/.test(documentosPageSource),
    "não deveria haver comparação de kind inline na página — só via helper central"
  );
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
