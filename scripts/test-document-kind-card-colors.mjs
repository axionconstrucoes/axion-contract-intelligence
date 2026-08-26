// Cores do cartão de documento por TIPO DOCUMENTAL (Documentos) —
// amarelo forte (contrato-base/aditivo), vermelho-claro (relatório
// semanal), verde-claro (ata, RFI, RFP, edital), azul-claro (diário de
// obra), neutro para o restante. A cor representa só o tipo documental
// — nunca risco, severidade, processamento ou resultado de análise.
//
// Cobre a função centralizada
// apps/web/lib/documents/document-kind-card-appearance.ts (importada e
// executada de verdade — não é só regex, mesmo padrão já usado em
// scripts/test-multi-document-upload.mjs para queue-core.ts) e
// checagens estruturais em apps/web/app/[projectId]/documentos/page.tsx
// e em globals.css/badges.tsx (cores de risco intocadas), mesmo padrão
// já usado em scripts/test-risk-medium-color.mjs.
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

// Grupos exatamente como definidos na tarefa, usando os valores reais
// de DocumentKind (packages/types/src/index.ts) e da constraint do
// banco (supabase/migrations/20260825130000_multi_document_upload_foundation.sql,
// seção 1 — nomes confirmados idênticos, nenhum divergente).
const STRONG_YELLOW_KINDS = ["CONTRATO_BASE", "ADITIVO"];
const LIGHT_RED_KINDS = ["RELATORIO_SEMANAL"];
const LIGHT_GREEN_KINDS = ["ATA_REUNIAO", "RFI", "RFP", "EDITAL"];
const LIGHT_BLUE_KINDS = ["DIARIO_OBRA"];

// Todos os demais valores reais de DocumentKind — devem ficar neutros
// nesta etapa (checagem exaustiva, não uma amostra).
const NEUTRAL_KINDS = [
  "ESPECIFICACAO",
  "DESENHO",
  "PLANILHA",
  "CRONOGRAMA_BASELINE",
  "CRONOGRAMA_REVISAO",
  "PROPOSTA_AXION",
  "CLARIFICACAO_CLIENTE",
  "PROPOSTA_COMERCIAL",
  "PROPOSTA_TECNICA",
  "PLANILHA_CONTRATUAL",
  "RELATORIO",
  "NOTIFICACAO",
  "ESG_SSMA",
  "OUTRO",
];

function shadeOf(className, utility, color) {
  const match = className?.match(new RegExp(`\\b${utility}-${color}-(\\d+)\\b`));
  return match ? Number(match[1]) : null;
}

// --- 1-3: amarelo forte para CONTRATO_BASE / ADITIVO ---

for (const kind of STRONG_YELLOW_KINDS) {
  check(`${kind} recebe amarelo forte (bg-yellow-200, border-yellow-700, border-2, text-black)`, () => {
    const { cardClassName } = getDocumentKindCardAppearance(kind);
    assert(typeof cardClassName === "string", `${kind} deveria ter cardClassName`);
    assert(/\bbg-yellow-200\b/.test(cardClassName), `esperado bg-yellow-200: "${cardClassName}"`);
    assert(/\bborder-yellow-700\b/.test(cardClassName), `esperado border-yellow-700: "${cardClassName}"`);
    assert(/\bborder-2\b/.test(cardClassName), `esperado border-2: "${cardClassName}"`);
    assert(/\btext-black\b/.test(cardClassName), `esperado text-black: "${cardClassName}"`);
  });
}

// --- 4: RELATORIO_SEMANAL vermelho-claro ---

check("RELATORIO_SEMANAL recebe vermelho-claro (bg-red-50, border-red-400)", () => {
  const { cardClassName } = getDocumentKindCardAppearance("RELATORIO_SEMANAL");
  assert(/\bbg-red-50\b/.test(cardClassName), `esperado bg-red-50: "${cardClassName}"`);
  assert(/\bborder-red-400\b/.test(cardClassName), `esperado border-red-400: "${cardClassName}"`);
  assert(/\btext-black\b/.test(cardClassName), `esperado text-black: "${cardClassName}"`);
});

// --- 5-8: ATA_REUNIAO, RFI, RFP, EDITAL verde-claro ---

for (const kind of LIGHT_GREEN_KINDS) {
  check(`${kind} recebe verde-claro (bg-green-50, border-green-500)`, () => {
    const { cardClassName } = getDocumentKindCardAppearance(kind);
    assert(/\bbg-green-50\b/.test(cardClassName), `esperado bg-green-50: "${cardClassName}"`);
    assert(/\bborder-green-500\b/.test(cardClassName), `esperado border-green-500: "${cardClassName}"`);
    assert(/\btext-black\b/.test(cardClassName), `esperado text-black: "${cardClassName}"`);
  });
}

// --- 9: DIARIO_OBRA azul-claro ---

check("DIARIO_OBRA recebe azul-claro (bg-blue-50, border-blue-500)", () => {
  const { cardClassName } = getDocumentKindCardAppearance("DIARIO_OBRA");
  assert(/\bbg-blue-50\b/.test(cardClassName), `esperado bg-blue-50: "${cardClassName}"`);
  assert(/\bborder-blue-500\b/.test(cardClassName), `esperado border-blue-500: "${cardClassName}"`);
  assert(/\btext-black\b/.test(cardClassName), `esperado text-black: "${cardClassName}"`);
});

// --- 10: tipos neutros não recebem nenhuma dessas cores ---

check("todos os demais DocumentKind reais permanecem neutros (nenhuma cor aplicada)", () => {
  for (const kind of NEUTRAL_KINDS) {
    const { cardClassName, titleClassName } = getDocumentKindCardAppearance(kind);
    assert(cardClassName === undefined, `${kind} deveria ser neutro, mas recebeu "${cardClassName}"`);
    assert(titleClassName === undefined, `${kind} não deveria ter titleClassName`);
  }
});

// --- 11: valor desconhecido permanece neutro (inclui null/undefined) ---

check("valor de kind desconhecido, null ou undefined permanece neutro", () => {
  for (const kind of ["VALOR_DESCONHECIDO", null, undefined, ""]) {
    const { cardClassName, titleClassName } = getDocumentKindCardAppearance(kind);
    assert(cardClassName === undefined, `kind ${JSON.stringify(kind)} deveria ser neutro`);
    assert(titleClassName === undefined, `kind ${JSON.stringify(kind)} não deveria ter titleClassName`);
  }
});

// --- 12-13: regra depende exclusivamente do kind — igualdade exata, nunca substring/título ---

check("igualdade exata: valores que só CONTÊM um kind colorido como substring permanecem neutros", () => {
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
  for (const trap of substringTraps) {
    const { cardClassName } = getDocumentKindCardAppearance(trap);
    assert(cardClassName === undefined, `"${trap}" contém a substring mas não é igual a nenhum kind — deveria ficar neutro`);
  }
});

check("assinatura da função não aceita título/nome de arquivo — só kind", () => {
  assert(getDocumentKindCardAppearance.length === 1, "getDocumentKindCardAppearance deveria receber só o kind");
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

// --- 16: contrato/aditivo com destaque visual mais forte que os demais grupos ---

check("amarelo forte é visualmente mais forte que vermelho/verde/azul-claro (fundo mais saturado, borda mais escura, título em negrito)", () => {
  const strong = getDocumentKindCardAppearance("CONTRATO_BASE");
  const red = getDocumentKindCardAppearance("RELATORIO_SEMANAL");
  const green = getDocumentKindCardAppearance("ATA_REUNIAO");
  const blue = getDocumentKindCardAppearance("DIARIO_OBRA");

  const strongBgShade = shadeOf(strong.cardClassName, "bg", "yellow");
  const strongBorderShade = shadeOf(strong.cardClassName, "border", "yellow");

  for (const [label, group] of [["vermelho-claro", red], ["verde-claro", green], ["azul-claro", blue]]) {
    const bgUtilityColor = group.cardClassName.match(/\bbg-(red|green|blue)-(\d+)\b/);
    const borderUtilityColor = group.cardClassName.match(/\bborder-(red|green|blue)-(\d+)\b/);
    assert(bgUtilityColor && borderUtilityColor, `não foi possível extrair shades de ${label}`);

    const groupBgShade = Number(bgUtilityColor[2]);
    const groupBorderShade = Number(borderUtilityColor[2]);

    assert(
      strongBgShade > groupBgShade,
      `fundo do amarelo forte (${strongBgShade}) deveria ser mais saturado que o de ${label} (${groupBgShade})`
    );
    assert(
      strongBorderShade > groupBorderShade,
      `borda do amarelo forte (${strongBorderShade}) deveria ser mais escura que a de ${label} (${groupBorderShade})`
    );

    assert(
      strong.titleClassName?.includes("font-bold") && !group.titleClassName?.includes("font-bold"),
      `só contrato-base/aditivo deveriam ter título em negrito — ${label} não deveria`
    );
  }
});

// --- estrutural: página usa o helper central, sem lógica antiga inline ---

const documentosPageSource = readSource(
  "apps/web/app/[projectId]/documentos/page.tsx"
);

check("documentos/page.tsx: usa o helper central getDocumentKindCardAppearance, não reimplementa a regra inline", () => {
  assert(
    documentosPageSource.includes("getDocumentKindCardAppearance(") &&
      documentosPageSource.includes(
        'from "@/lib/documents/document-kind-card-appearance"'
      ),
    "a página deveria importar e chamar getDocumentKindCardAppearance"
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
