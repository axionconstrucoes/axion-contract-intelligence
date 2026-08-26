// Destaque visual amarelo — Contrato Base e Aditivo (Documentos).
// Cobre a função centralizada apps/web/lib/documents/document-kind-highlight.ts
// (importada e executada de verdade — não é só regex, mesmo padrão já
// usado em scripts/test-multi-document-upload.mjs para queue-core.ts) e
// checagens estruturais em apps/web/app/[projectId]/documentos/page.tsx,
// mesmo padrão já usado em scripts/test-risk-medium-color.mjs.
//
// Uso:
//   node scripts/test-yellow-contract-document-cards.mjs

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
console.log("DESTAQUE AMARELO — CONTRATO BASE / ADITIVO (Documentos)");
console.log("======================================");
console.log("");

const {
  isHighlightedDocumentKind,
  getDocumentKindHighlightClassName,
} = await import("../apps/web/lib/documents/document-kind-highlight.ts");

// Todos os valores de DocumentKind (packages/types/src/index.ts) que NÃO
// devem receber destaque — a lista completa, não uma amostra, para
// travar contra qualquer novo valor de kind ganhando amarelo por engano.
const OTHER_DOCUMENT_KINDS = [
  "EDITAL",
  "RFI",
  "RFP",
  "ESPECIFICACAO",
  "DESENHO",
  "PLANILHA",
  "CRONOGRAMA_BASELINE",
  "CRONOGRAMA_REVISAO",
  "RELATORIO_SEMANAL",
  "PROPOSTA_AXION",
  "CLARIFICACAO_CLIENTE",
  "ATA_REUNIAO",
  "PROPOSTA_COMERCIAL",
  "PROPOSTA_TECNICA",
  "PLANILHA_CONTRATUAL",
  "RELATORIO",
  "NOTIFICACAO",
  "ESG_SSMA",
  "DIARIO_OBRA",
  "OUTRO",
];

// --- Casos exigidos pelo escopo ---

check("CONTRATO_BASE recebe destaque amarelo", () => {
  assert(isHighlightedDocumentKind("CONTRATO_BASE") === true);
  const className = getDocumentKindHighlightClassName("CONTRATO_BASE");
  assert(typeof className === "string", "deveria retornar uma classe, não undefined");
});

check("ADITIVO recebe destaque amarelo", () => {
  assert(isHighlightedDocumentKind("ADITIVO") === true);
  const className = getDocumentKindHighlightClassName("ADITIVO");
  assert(typeof className === "string", "deveria retornar uma classe, não undefined");
});

check("RELATORIO_SEMANAL não recebe destaque", () => {
  assert(isHighlightedDocumentKind("RELATORIO_SEMANAL") === false);
  assert(getDocumentKindHighlightClassName("RELATORIO_SEMANAL") === undefined);
});

check("nenhum outro DocumentKind (todos os 20 restantes) recebe destaque", () => {
  for (const kind of OTHER_DOCUMENT_KINDS) {
    assert(isHighlightedDocumentKind(kind) === false, `${kind} não deveria ser destacado`);
    assert(getDocumentKindHighlightClassName(kind) === undefined, `${kind} não deveria retornar classe`);
  }
});

check("valor de kind desconhecido (fora do enum, ex.: dado bruto do banco) nunca é destacado", () => {
  assert(isHighlightedDocumentKind("VALOR_DESCONHECIDO") === false);
  assert(getDocumentKindHighlightClassName("VALOR_DESCONHECIDO") === undefined);
});

// --- Classes exatas exigidas (fundo, borda, texto) ---

check("classe de destaque contém fundo yellow-100", () => {
  const className = getDocumentKindHighlightClassName("CONTRATO_BASE");
  assert(/\bbg-yellow-100\b/.test(className), `classe deveria conter bg-yellow-100: "${className}"`);
});

check("classe de destaque contém borda yellow-600", () => {
  const className = getDocumentKindHighlightClassName("ADITIVO");
  assert(/\bborder-yellow-600\b/.test(className), `classe deveria conter border-yellow-600: "${className}"`);
});

check("classe de destaque contém texto preto explícito (alto contraste)", () => {
  const className = getDocumentKindHighlightClassName("CONTRATO_BASE");
  assert(/\btext-black\b/.test(className), `classe deveria conter text-black: "${className}"`);
});

// --- Regra por igualdade exata — nunca substring, título ou nome de arquivo ---

check("igualdade exata: valores que só CONTÊM 'ADITIVO' ou 'CONTRATO_BASE' como substring não são destacados", () => {
  const substringTraps = [
    "ADITIVO_CANCELADO",
    "PRE_ADITIVO",
    "XADITIVOX",
    "CONTRATO_BASE_ANTIGO",
    "NAO_CONTRATO_BASE",
  ];
  for (const trap of substringTraps) {
    assert(
      isHighlightedDocumentKind(trap) === false,
      `"${trap}" contém a substring mas não é igual ao kind — não deveria ser destacado (regressão do bug antigo com .includes())`
    );
  }
});

check("assinatura das funções não aceita título/nome de arquivo — só kind", () => {
  assert(isHighlightedDocumentKind.length === 1, "isHighlightedDocumentKind deveria receber só o kind");
  assert(getDocumentKindHighlightClassName.length === 1, "getDocumentKindHighlightClassName deveria receber só o kind");
});

// --- Checagens estruturais no código-fonte ---

const highlightHelperSource = readSource("apps/web/lib/documents/document-kind-highlight.ts");

check("document-kind-highlight.ts: nunca referencia title/fileName/filename na decisão de destaque", () => {
  assert(
    !/\btitle\b|\bfileName\b|\bfilename\b|originalFileName/i.test(highlightHelperSource),
    "a função central não pode basear a decisão em título ou nome de arquivo"
  );
});

check("document-kind-highlight.ts: comparação é por igualdade exata (Set.has), não .includes()", () => {
  assert(!highlightHelperSource.includes(".includes("), "não deveria usar .includes() (substring) na regra de destaque");
  assert(/\.has\(/.test(highlightHelperSource), "deveria usar Set.has() (igualdade exata)");
});

const documentosPageSource = readSource("apps/web/app/[projectId]/documentos/page.tsx");

check("documentos/page.tsx: usa a função centralizada, não reimplementa a regra inline", () => {
  assert(
    documentosPageSource.includes("getDocumentKindHighlightClassName(") &&
      documentosPageSource.includes('from "@/lib/documents/document-kind-highlight"'),
    "a página deveria importar e chamar getDocumentKindHighlightClassName"
  );
});

check("documentos/page.tsx: não tem mais a regra antiga por substring (.includes(\"ADITIVO\")) nem o verde antigo", () => {
  assert(!documentosPageSource.includes('.kind.includes("ADITIVO")'), "regra antiga por substring deveria ter sido removida");
  assert(!/border-green-500|bg-green-50/.test(documentosPageSource), "cor verde antiga não deveria mais aparecer");
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
