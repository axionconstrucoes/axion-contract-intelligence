// REGRA VISUAL FINAL da aba Documentos (substitui integralmente todo
// esquema anterior, incluindo o marrom de ADITIVO e o caso neutro
// branco/preto) — aplicada ao CARTÃO INTEIRO, não só à faixa do
// cabeçalho, sempre uma das três cores abaixo:
//   BORDÔ   -> contrato-base, aditivo, e qualquer documento que seja um
//              ANEXO CONTRATUAL formalmente incorporado (a condição de
//              anexo contratual PREVALECE sobre o tipo original).
//   VERDE   -> relatório semanal SEM vínculo contratual.
//   LARANJA -> especificações, atas, editais e todos os demais
//              documentos não contratuais.
// Conteúdo (metadados/versões/botões) dentro da caixa colorida fica num
// painel claro opaco (contentPanelClassName) para garantir contraste AA
// sem reescrever cada elemento nested. Classificação por document.kind
// (enum canônico) e, quando informado pelo chamador, pelo vínculo real
// isContractualAttachment — nunca por nome de arquivo/título.
//
// Uso:
//   node scripts/test-document-kind-card-appearance.mjs

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
console.log("DOCUMENTOS — cor do cartão inteiro (regra final: bordô/verde/laranja)");
console.log("======================================");
console.log("");

const { getDocumentKindCardAppearance } = await import(
  "../apps/web/lib/documents/document-kind-card-appearance.ts"
);

// --- BORDÔ: contrato-base, aditivo ---

check("CONTRATO_BASE: CARTÃO INTEIRO bordô institucional (token de marca), fonte branca", () => {
  const appearance = getDocumentKindCardAppearance("CONTRATO_BASE");
  assert(appearance.cardClassName.includes("bg-brand-sidebar"));
  assert(appearance.cardClassName.includes("text-brand-sidebar-foreground"));
  assert(appearance.titleClassName.includes("text-brand-sidebar-foreground"));
  assert(appearance.badgeClassName.includes("text-brand-sidebar-foreground"));
});

check("ADITIVO: CARTÃO INTEIRO bordô institucional — MESMA cor de CONTRATO_BASE (não mais marrom)", () => {
  const contratoBase = getDocumentKindCardAppearance("CONTRATO_BASE");
  const aditivo = getDocumentKindCardAppearance("ADITIVO");
  assert(aditivo.cardClassName === contratoBase.cardClassName, "ADITIVO deveria ter exatamente a mesma cor bordô de CONTRATO_BASE");
  assert(!aditivo.cardClassName.includes("amber"), "ADITIVO não deveria mais usar marrom (amber)");
});

// --- VERDE: relatório semanal sem vínculo contratual ---

check("RELATORIO_SEMANAL e RELATORIO (mesmo conceito, dois fluxos de upload): CARTÃO INTEIRO verde, fonte branca", () => {
  for (const kind of ["RELATORIO_SEMANAL", "RELATORIO"]) {
    const appearance = getDocumentKindCardAppearance(kind);
    assert(/\bbg-emerald-700\b/.test(appearance.cardClassName), `${kind} deveria ter bg-emerald-700: "${appearance.cardClassName}"`);
    assert(appearance.cardClassName.includes("text-white"));
    assert(appearance.titleClassName.includes("text-white"));
  }
});

// --- LARANJA: especificações, atas, editais e todos os demais não contratuais ---

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

check("especificações, atas, editais e todos os demais documentos não contratuais: CARTÃO INTEIRO laranja, fonte branca (checagem exaustiva de todo o enum restante)", () => {
  for (const kind of ORANGE_KINDS) {
    const appearance = getDocumentKindCardAppearance(kind);
    assert(/\bbg-orange-700\b/.test(appearance.cardClassName), `${kind} deveria ter bg-orange-700: "${appearance.cardClassName}"`);
    assert(appearance.cardClassName.includes("text-white"));
  }
});

check("kind ausente/inválido (null/undefined/desconhecido) nunca quebra e cai em laranja — nunca um caso neutro silencioso", () => {
  for (const kind of [null, undefined, "KIND_INEXISTENTE"]) {
    const appearance = getDocumentKindCardAppearance(kind);
    assert(/\bbg-orange-700\b/.test(appearance.cardClassName), `kind ${JSON.stringify(kind)} deveria cair em laranja`);
  }
});

check("as três cores são todas distintas entre si e todas têm painel de conteúdo claro (bg-card) para contraste AA", () => {
  const bordo = getDocumentKindCardAppearance("CONTRATO_BASE");
  const verde = getDocumentKindCardAppearance("RELATORIO_SEMANAL");
  const laranja = getDocumentKindCardAppearance("EDITAL");
  assert(bordo.cardClassName !== verde.cardClassName && verde.cardClassName !== laranja.cardClassName && bordo.cardClassName !== laranja.cardClassName);
  for (const appearance of [bordo, verde, laranja]) {
    assert(appearance.contentPanelClassName.includes("bg-card"));
    assert(appearance.titleClassName.includes("font-bold"));
  }
});

// --- isContractualAttachment: a condição de anexo contratual prevalece sobre o tipo original ---

check("isContractualAttachment=true força BORDÔ mesmo para um tipo que seria verde ou laranja — 'a condição de anexo contratual prevalece sobre o tipo original'", () => {
  const bordo = getDocumentKindCardAppearance("CONTRATO_BASE");

  const propostaIncorporada = getDocumentKindCardAppearance("PROPOSTA_COMERCIAL", { isContractualAttachment: true });
  assert(propostaIncorporada.cardClassName === bordo.cardClassName, "proposta comercial incorporada ao contrato deveria ficar bordô (exemplo do requisito)");

  const cronogramaIncorporado = getDocumentKindCardAppearance("CRONOGRAMA_BASELINE", { isContractualAttachment: true });
  assert(cronogramaIncorporado.cardClassName === bordo.cardClassName, "cronograma incorporado ao contrato deveria ficar bordô (exemplo do requisito)");

  const especificacaoIncorporada = getDocumentKindCardAppearance("ESPECIFICACAO", { isContractualAttachment: true });
  assert(especificacaoIncorporada.cardClassName === bordo.cardClassName, "especificação incorporada ao contrato deveria ficar bordô (exemplo do requisito)");

  const relatorioIncorporado = getDocumentKindCardAppearance("RELATORIO_SEMANAL", { isContractualAttachment: true });
  assert(relatorioIncorporado.cardClassName === bordo.cardClassName, "mesmo um relatório (normalmente verde) vira bordô quando é um anexo contratual real");
});

check("sem isContractualAttachment (ou false): proposta/cronograma NÃO incorporados permanecem laranja (exemplo do requisito)", () => {
  const laranja = getDocumentKindCardAppearance("EDITAL");
  const propostaNaoIncorporada = getDocumentKindCardAppearance("PROPOSTA_COMERCIAL");
  const cronogramaNaoIncorporado = getDocumentKindCardAppearance("CRONOGRAMA_BASELINE", { isContractualAttachment: false });
  assert(propostaNaoIncorporada.cardClassName === laranja.cardClassName, "proposta não incorporada deveria ficar laranja");
  assert(cronogramaNaoIncorporado.cardClassName === laranja.cardClassName, "cronograma não incorporado deveria ficar laranja");
});

check("classificação nunca infere vínculo pelo nome — a função só aceita kind e um booleano explícito isContractualAttachment, nunca título/nome de arquivo", () => {
  const source = readSource("apps/web/lib/documents/document-kind-card-appearance.ts");
  assert(
    /export function getDocumentKindCardAppearance\(\s*kind: string \| null \| undefined,\s*options\?:/.test(source),
    "assinatura deveria ser (kind, options?: { isContractualAttachment?: boolean })"
  );
  assert(!/filename|fileName|originalFileName|\btitle\b/i.test(source), "não deveria existir nenhuma referência a nome de arquivo/título nesta função");
});

check("isContractualAttachment=true tem exatamente UM caller real: contractual-attachment-row.tsx — e só é alcançado quando o agrupador já confirmou um parentDocumentId real (nunca um chute da interface); documentos/page.tsx não chama isso diretamente", () => {
  const pageSource = readSource("apps/web/app/[projectId]/documentos/page.tsx");
  assert(!pageSource.includes("isContractualAttachment"), "documentos/page.tsx não deveria chamar getDocumentKindCardAppearance com isContractualAttachment diretamente — só via componentes dedicados");

  const attachmentRowSource = readSource("apps/web/components/documents/contractual-attachment-row.tsx");
  assert(attachmentRowSource.includes("isContractualAttachment: true"), "contractual-attachment-row.tsx deveria ser o único caller real de isContractualAttachment=true");

  const documentCardSource = readSource("apps/web/components/documents/document-card.tsx");
  assert(
    !documentCardSource.includes("isContractualAttachment:"),
    "DocumentCard (usado para o principal do grupo e para documentos sem vínculo) nunca deveria PASSAR isContractualAttachment — não é o componente que renderiza anexos já vinculados (menção em comentário explicando o porquê é esperada, chamada real não)"
  );
});

check("DocumentCard (reaproveitado por page.tsx via grupos contratuais e lista sem vínculo): cor forte aplicada ao CARTÃO INTEIRO (Card), e o conteúdo (versões/botões) fica dentro do painel claro", () => {
  const documentCardSource = readSource("apps/web/components/documents/document-card.tsx");
  const pageSource = readSource("apps/web/app/[projectId]/documentos/page.tsx");
  assert(documentCardSource.includes("<Card className={kindAppearance.cardClassName}>"));
  assert(documentCardSource.includes("kindAppearance.contentPanelClassName"));
  assert(pageSource.includes("DocumentCard"), "page.tsx deveria renderizar a listagem através de DocumentCard, não reimplementar o cartão inline");
});

check("DocumentCard não usa mais o esquema antigo (cor só no cabeçalho, headerClassName)", () => {
  const documentCardSource = readSource("apps/web/components/documents/document-card.tsx");
  assert(!documentCardSource.includes("kindAppearance.headerClassName"), "esquema antigo (cor só no cabeçalho) não deveria mais existir");
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exitCode = 1;
}
