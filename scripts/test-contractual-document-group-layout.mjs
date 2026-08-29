// GRUPOS CONTRATUAIS — layout visual (contrato/aditivo à ESQUERDA,
// anexos à DIREITA, conector visual, nunca empilhados em desktop).
// Estrutural (leitura de código-fonte) — a prova de que o CSS
// responsivo realmente produz esse resultado, em desktop/tablet/mobile,
// foi feita nesta rodada com um harness de iframes de largura fixa
// (iframes têm viewport próprio para media queries, contornando a
// limitação já documentada deste ambiente de que resize_window/
// window.resizeTo não mudam a largura real da janela) — screenshots
// reais conferidos manualmente e removidos depois (não fazem parte do
// produto). Esta suíte é a prova permanente, reexecutável sem
// navegador, de que o markup que produziu esses screenshots continua
// correto.
//
// Uso:
//   node scripts/test-contractual-document-group-layout.mjs

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
console.log("GRUPOS CONTRATUAIS — layout visual (contrato/aditivo à esquerda, anexos à direita, conector)");
console.log("======================================");
console.log("");

const groupSectionSource = readSource("apps/web/components/documents/contractual-document-group-section.tsx");
const attachmentRowSource = readSource("apps/web/components/documents/contractual-attachment-row.tsx");
const groupLibSource = readSource("apps/web/lib/documents/group-contractual-documents.ts");
const pageSource = readSource("apps/web/app/[projectId]/documentos/page.tsx");

check("mobile-first: o container empilha por padrão (flex-col) e só vira duas colunas lado a lado a partir de md: (md:flex-row) — NUNCA embaixo um do outro em desktop", () => {
  assert(/className="flex flex-col md:flex-row/.test(groupSectionSource), "container principal deveria ser flex-col por padrão, md:flex-row no desktop");
});

check("coluna esquerda (contrato-base/aditivo) ~35% só no desktop (md:w-[35%] md:shrink-0) — no mobile ocupa a largura inteira (empilhado)", () => {
  assert(groupSectionSource.includes("md:w-[35%] md:shrink-0"), "coluna do documento principal deveria ser ~35% e não encolher no desktop");
});

check("coluna direita (anexos) preenche o restante do espaço no desktop (md:flex-1) — nunca uma largura fixa que poderia estourar", () => {
  assert(groupSectionSource.includes("md:w-auto md:flex-1"), "coluna de anexos deveria usar flex-1 para ocupar o restante (~60-65%) sem depender de um cálculo exato de porcentagem");
});

check("CONECTOR VISUAL: área central estreita e decorativa entre as duas colunas no desktop (aria-hidden, nunca informação real)", () => {
  const desktopConnectorMatch = groupSectionSource.match(
    /<div aria-hidden="true" className="hidden items-center md:flex md:w-10 md:shrink-0">\s*<div className="h-px w-full bg-brand-sidebar\/50" \/>\s*<\/div>/
  );
  assert(desktopConnectorMatch, "deveria existir uma coluna conectora estreita e fixa (md:w-10) com uma linha horizontal bordô discreta (bg-brand-sidebar/50), aria-hidden");
});

check("CONECTOR VISUAL no mobile: linha vertical curta entre o principal e os anexos, também aria-hidden, só abaixo de md", () => {
  const mobileConnectorMatch = groupSectionSource.match(
    /<div aria-hidden="true" className="flex items-center justify-center py-1 md:hidden">\s*<div className="h-3 w-px bg-brand-sidebar\/50" \/>\s*<\/div>/
  );
  assert(mobileConnectorMatch, "deveria existir uma linha vertical curta (h-3 w-px) só no mobile (md:hidden), aria-hidden");
});

check("separador horizontal no mobile entre principal e anexos (border-t), cancelado no desktop (md:border-t-0) — nunca os dois ao mesmo tempo", () => {
  assert(groupSectionSource.includes("border-t border-brand-sidebar/30 md:w-auto md:flex-1 md:border-t-0"), "a coluna de anexos deveria ter border-t só no mobile, cancelado no desktop");
});

check("com MAIS DE UM anexo: espinha vertical (border-l-2) com uma ramificação horizontal por anexo, cada uma aria-hidden — só quando há mais de um anexo (hasMultipleAttachments)", () => {
  assert(groupSectionSource.includes("hasMultipleAttachments"), "deveria haver uma distinção explícita entre 0 / 1 / mais de 1 anexo");
  assert(
    groupSectionSource.includes('<div className="flex flex-col gap-1 border-l-2 border-brand-sidebar/40 pl-3">'),
    "com múltiplos anexos, deveria haver uma espinha vertical bordô discreta (border-l-2 border-brand-sidebar/40)"
  );
  assert(
    /<span\s+aria-hidden="true"\s+className="absolute top-1\/2 -left-3 h-px w-3 -translate-y-1\/2 bg-brand-sidebar\/40"\s*\/>/.test(groupSectionSource),
    "cada anexo, quando há mais de um, deveria ter uma ramificação horizontal própria (branch tick), aria-hidden"
  );
});

check("com EXATAMENTE UM anexo: ligação horizontal simples — NUNCA a espinha vertical (border-l-2), que só faz sentido com múltiplos anexos", () => {
  const singleAttachmentBlockMatch = groupSectionSource.match(/\) : \(\s*<div className="flex flex-col gap-1">[\s\S]*?<\/div>\s*\)\}/);
  assert(singleAttachmentBlockMatch, "deveria existir um ramo dedicado para exatamente 1 anexo, sem a espinha (border-l-2)");
  assert(!singleAttachmentBlockMatch[0].includes("border-l-2"), "o ramo de 1 anexo não deveria usar a espinha vertical — só a linha horizontal do conector central já basta");
});

check("ESTADO SEM ANEXOS: texto compacto EXATO 'Nenhum anexo contratual vinculado' — nunca uma frase mais longa/genérica", () => {
  assert(groupSectionSource.includes('<p className="text-xs text-muted-foreground">Nenhum anexo contratual vinculado</p>'), "o texto do estado vazio deveria ser exatamente esse, compacto");
});

check("ESTADO SEM ANEXOS: controle de vinculação só é OFERECIDO ao ADMINISTRADOR (canLinkContractualAttachment), nunca a todo mundo que pode fazer upload (canUpload cobre GESTOR também)", () => {
  const emptyStateBlock = groupSectionSource.slice(
    groupSectionSource.indexOf("group.attachments.length === 0"),
    groupSectionSource.indexOf(") : hasMultipleAttachments")
  );
  assert(emptyStateBlock.includes("canLinkContractualAttachment ?"), "o controle de vinculação no estado vazio deveria ser condicionado a canLinkContractualAttachment, não a canUpload");
  assert(emptyStateBlock.includes("LinkExistingDocumentToParentControl"), "deveria oferecer o controle de vincular um documento existente a este contrato/aditivo");
});

check("página (documentos/page.tsx): canLinkContractualAttachment é estritamente ADMINISTRADOR — mais restrito que canUpload (ADMINISTRADOR OU GESTOR)", () => {
  assert(pageSource.includes('const canLinkContractualAttachment = permission === "ADMINISTRADOR";'), "canLinkContractualAttachment deveria ser só ADMINISTRADOR");
  assert(pageSource.includes("canUpload =") && pageSource.includes('"GESTOR"'), "canUpload continua cobrindo ADMINISTRADOR e GESTOR (só o UPLOAD, não o vínculo contratual)");
  assert(
    pageSource.includes("contractualParentOptions={canLinkContractualAttachment ? contractualParentOptions : undefined}"),
    "o controle 'Vincular como anexo contratual' na lista de documentos sem vínculo também deveria ser restrito a canLinkContractualAttachment, não canUpload"
  );
});

check("página passa linkableDocuments (documentos SEM vínculo) e canLinkContractualAttachment para CADA grupo — nunca só para um", () => {
  const renderBlock = pageSource.slice(
    pageSource.indexOf("contractualGroups.map((group) =>"),
    pageSource.indexOf("))}", pageSource.indexOf("contractualGroups.map((group) =>"))
  );
  assert(renderBlock.includes("canLinkContractualAttachment={canLinkContractualAttachment}"), "cada ContractualDocumentGroupSection deveria receber canLinkContractualAttachment");
  assert(renderBlock.includes("linkableDocuments={linkableDocuments}"), "cada ContractualDocumentGroupSection deveria receber a lista de documentos vinculáveis");
});

check("TÍTULOS EXATOS exigidos (CONTRATO-BASE / ANEXOS AO CONTRATO-BASE / ADITIVO CONTRATUAL NN / ANEXOS AO ADITIVO CONTRATUAL NN) — derivados por uma função pura testável, nunca hardcoded duas vezes com risco de divergir", () => {
  assert(groupLibSource.includes("export function deriveContractualGroupTitles"), "deveria existir uma função dedicada que deriva os títulos exatos");
  assert(groupSectionSource.includes("deriveContractualGroupTitles(group.label)"), "o componente deveria usar essa função, nunca montar o texto do título inline");
  assert(groupSectionSource.includes("{principalTitle}") && groupSectionSource.includes("{attachmentsTitle}"), "os dois títulos derivados deveriam ser renderizados, um por coluna");
});

check("título de cada coluna fica JUNTO do seu próprio conteúdo (não uma faixa única no topo do grupo) — em uppercase, fundo bordô", () => {
  const titleOccurrences = groupSectionSource.match(/text-\[11px\] font-bold tracking-wide text-brand-sidebar-foreground uppercase/g) ?? [];
  assert(titleOccurrences.length === 2, `esperado exatamente 2 títulos com essa classe (um por coluna), encontrado ${titleOccurrences.length}`);
});

check("ZERO rolagem horizontal: min-w-0 em todos os blocos relevantes (coluna esquerda, coluna direita, cartão, cada linha de anexo) e nenhum overflow-x-auto/scroll no grupo", () => {
  const minWidthOccurrences = groupSectionSource.match(/min-w-0/g) ?? [];
  assert(minWidthOccurrences.length >= 4, `esperado min-w-0 em pelo menos 4 pontos (coluna esquerda, painel do principal, coluna direita, painel de anexos), encontrado ${minWidthOccurrences.length}x`);
  assert(!/overflow-x-(auto|scroll)/.test(groupSectionSource), "o grupo contratual nunca deveria precisar de rolagem horizontal própria");
  assert(groupSectionSource.includes('className="relative min-w-0"'), "cada linha de anexo (quando há mais de uma) deveria ter min-w-0 também, para o texto truncar em vez de estourar");
});

check("título do anexo trunca (truncate) em vez de forçar a linha a crescer — min-w-0 também na linha do anexo compacta", () => {
  assert(attachmentRowSource.includes("min-w-0"), "ContractualAttachmentRow deveria ter min-w-0");
  assert(attachmentRowSource.includes("truncate"), "o título do anexo deveria truncar, nunca forçar overflow horizontal");
});

check("CRÍTICO — bug real encontrado via screenshot em 375px (não visível em leitura de código): a linha do anexo empilha texto/ações em telas estreitas (flex-col por padrão, sm:flex-row só a partir de 640px) — antes disso, baixar/desvincular/lixeira sobrepunham o texto e vazavam a largura", () => {
  assert(
    /flex min-w-0 flex-col gap-1\.5 rounded-md px-2 py-1\.5 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-2/.test(
      attachmentRowSource
    ),
    "o container da linha deveria empilhar por padrão (flex-col) e só virar linha única a partir de sm: (640px) — nunca items-center/justify-between incondicional, que foi a causa real da sobreposição"
  );
  assert(
    attachmentRowSource.includes('className="flex flex-wrap items-center gap-1.5 sm:shrink-0 sm:justify-end"'),
    "o bloco de ações (baixar/desvincular/lixeira) deveria poder quebrar linha (flex-wrap) como segunda camada de proteção, mesmo dentro do modo sm:flex-row"
  );
});

check("ContractualAttachmentRow exibe título, tipo, VERSÃO VIGENTE (não só contagem de versões) e fundamento da incorporação — os 4 campos exigidos, de forma compacta", () => {
  assert(attachmentRowSource.includes("document.title"), "deveria exibir o título");
  assert(attachmentRowSource.includes("document.kind.replaceAll"), "deveria exibir o tipo");
  assert(attachmentRowSource.includes("v. vigente ${current.versionLabel}"), "deveria exibir a VERSÃO VIGENTE explicitamente, não só a contagem de versões");
  assert(attachmentRowSource.includes("document.contractualIncorporationBasis"), "deveria exibir o fundamento da incorporação");
});

check("moldura bordô envolve o grupo INTEIRO (as duas colunas + conector), não só um dos lados", () => {
  assert(groupSectionSource.includes("overflow-hidden rounded-lg border-2 border-brand-sidebar"), "a moldura deveria estar no container mais externo, ao redor de tudo");
});

check("dados: agrupamento é exclusivamente por parentDocumentId (nunca por nome/título) — mesma garantia já coberta por test-group-contractual-documents.mjs, reaproveitada aqui via import direto", () => {
  assert(groupLibSource.includes("if (!document.parentDocumentId) continue;"), "o agrupamento deveria continuar filtrando estritamente por parentDocumentId");
  assert(!/\.title\.(includes|startsWith|toLowerCase)/.test(groupLibSource), "o agrupamento nunca deveria inspecionar o título/nome do documento");
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exitCode = 1;
}
