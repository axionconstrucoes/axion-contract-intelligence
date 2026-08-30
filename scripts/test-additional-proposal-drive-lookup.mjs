// "Selecionar proposta em ORÇAMENTOS" (Propostas de Adicionais — Parte 7)
// — dropdown de propostas, número/escopo/preço resolvidos no SERVIDOR a
// partir só do driveFolderId (nunca confiando em nome/número/escopo/
// preço vindos do navegador), fixture determinística (nunca o Drive
// real nesta etapa).
//
// Uso:
//   node scripts/test-additional-proposal-drive-lookup.mjs

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

async function checkAsync(name, fn) {
  try {
    await fn();
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
console.log("PROPOSTAS DE ADICIONAIS — Selecionar proposta em ORÇAMENTOS (fixture determinística)");
console.log("======================================");
console.log("");

const { parseProposalNumberFromFolderName } = await import(
  "../apps/web/lib/additionals/proposal-drive-lookup/parse-proposal-folder-name.ts"
);
const { selectMostRecentCustoFile } = await import(
  "../apps/web/lib/additionals/proposal-drive-lookup/select-most-recent-custo-file.ts"
);
const { findPlanilhaOrcamentariaFolder } = await import(
  "../apps/web/lib/additionals/proposal-drive-lookup/find-planilha-orcamentaria-folder.ts"
);
const { isSingleFechamentoWorkbook, parseFechamentoCellValue } = await import(
  "../apps/web/lib/additionals/proposal-drive-lookup/extract-fechamento-estimate.ts"
);
const { resolveAdditionalProposalFromDrive } = await import(
  "../apps/web/lib/additionals/proposal-drive-lookup/resolve-proposal-from-drive.ts"
);
const { createFixtureProposalDriveLookupClient } = await import(
  "../apps/web/lib/additionals/proposal-drive-lookup/fixture-client.ts"
);
// list-orcamentos-proposals.ts e get-proposal-drive-lookup-client.ts têm
// "import \"server-only\"" (só resolvível dentro do bundler do Next.js —
// mesmo motivo pelo qual send-contract-alert-email.ts etc. nunca são
// importados diretamente por um script standalone neste projeto) —
// verificados abaixo por leitura de código-fonte, não por import direto.

// ---------- número extraído corretamente ----------

check("número extraído corretamente do nome completo da pasta (exemplo do requisito)", () => {
  assert(parseProposalNumberFromFolderName("AXN CP 617 - DUX VINHEDO - SP") === "AXN CP 617");
});

check("número extraído tolera espaçamento/caixa variados no prefixo", () => {
  assert(parseProposalNumberFromFolderName("axn cp617 - Cliente X") === "AXN CP617");
  assert(parseProposalNumberFromFolderName("AXNCP  617 - Cliente Y") === "AXNCP 617");
});

check("nome sem padrão reconhecível cai para o primeiro segmento (nunca lança, nunca inventa)", () => {
  assert(parseProposalNumberFromFolderName("Pasta Qualquer - Sub") === "Pasta Qualquer");
  assert(parseProposalNumberFromFolderName("SemSeparador") === "SemSeparador");
});

// ---------- nome completo vira escopo / arquivo custo mais recente / case-insensitive ----------

check("arquivo mais recente contendo 'custo' é selecionado — nunca o primeiro da lista", () => {
  const files = [
    { id: "a", name: "Custo Rev01.xlsx", mimeType: "x", modifiedTime: "2026-01-01T00:00:00Z" },
    { id: "b", name: "CUSTO Rev02.xlsx", mimeType: "x", modifiedTime: "2026-02-01T00:00:00Z" },
    { id: "c", name: "Memorial de Escopo.docx", mimeType: "x", modifiedTime: "2026-03-01T00:00:00Z" },
  ];
  const selected = selectMostRecentCustoFile(files);
  assert(selected?.id === "b", `esperado arquivo "b" (mais recente com 'custo'), obtido: ${selected?.id}`);
});

check("comparação de 'custo' é case-insensitive (CUSTO, custo, Custo, CuStO)", () => {
  const files = [
    { id: "x", name: "Planilha CuStO Final.xlsx", mimeType: "x", modifiedTime: "2026-01-01T00:00:00Z" },
    { id: "y", name: "Outro Arquivo.xlsx", mimeType: "x", modifiedTime: "2026-06-01T00:00:00Z" },
  ];
  assert(selectMostRecentCustoFile(files)?.id === "x");
});

check("nenhum arquivo com 'custo' -> null, nunca escolhe um arquivo qualquer", () => {
  const files = [{ id: "z", name: "Memorial Descritivo.docx", mimeType: "x", modifiedTime: "2026-01-01T00:00:00Z" }];
  assert(selectMostRecentCustoFile(files) === null);
});

check('"02_PLANILHA ORÇAMENTÁRIA" é encontrada por classificação semântica (reaproveita classifyFolderName)', () => {
  const subfolders = [
    { id: "f1", name: "01_RECEBIDOS CLIENTE", modifiedTime: null },
    { id: "f2", name: "02_PLANILHA ORÇAMENTÁRIA", modifiedTime: null },
  ];
  assert(findPlanilhaOrcamentariaFolder(subfolders)?.id === "f2");
});

// ---------- aba única FECHAMENTO usando B12 como estimativa ----------

check('aba única "FECHAMENTO" (case-insensitive) é reconhecida como estimativa; múltiplas abas não são', () => {
  assert(isSingleFechamentoWorkbook(["FECHAMENTO"]) === true);
  assert(isSingleFechamentoWorkbook(["fechamento"]) === true);
  assert(isSingleFechamentoWorkbook(["INSUMOS", "FECHAMENTO"]) === false);
  assert(isSingleFechamentoWorkbook([]) === false);
  assert(isSingleFechamentoWorkbook(["RESUMO"]) === false);
});

check("parseFechamentoCellValue lê número puro e string formatada (R$ 1.234.567,89) — nunca lança, null quando irreconhecível", () => {
  assert(parseFechamentoCellValue(487500.42) === 487500.42);
  assert(parseFechamentoCellValue("R$ 1.234.567,89") === 1234567.89);
  assert(parseFechamentoCellValue("abc") === null);
  assert(parseFechamentoCellValue(null) === null);
});

// ---------- fluxo completo com a fixture ----------

const fixtureClient = createFixtureProposalDriveLookupClient();

await checkAsync("caminho feliz (fixture): AXN CP 617 resolve número, escopo=nome completo, preço=FECHAMENTO/B12, isEstimate=true", async () => {
  const result = await resolveAdditionalProposalFromDrive(fixtureClient, "folder-axn-cp-617", "AXN CP 617 - DUX VINHEDO - SP");
  assert(result.proposalNumber === "AXN CP 617");
  assert(result.folderName === "AXN CP 617 - DUX VINHEDO - SP", "escopo deveria ser o nome completo da pasta, exatamente como no Drive");
  assert(result.costFileName === "AXN CP 617 - CUSTO Rev02.xlsx", "deveria escolher o arquivo custo MAIS RECENTE (Rev02), não o Rev01");
  assert(result.salePrice === 487500.42);
  assert(result.priceSource === "FECHAMENTO_B12_ESTIMATE");
  assert(result.isEstimate === true);
});

await checkAsync("planilha com múltiplas abas (AXN CP 640): preço NÃO resolvido, nenhum valor inventado, warning explicando o motivo", async () => {
  const result = await resolveAdditionalProposalFromDrive(fixtureClient, "folder-axn-cp-640", "AXN CP 640 - ACME LOGÍSTICA - MG");
  assert(result.salePrice === null);
  assert(result.priceSource === "NOT_RESOLVED");
  assert(result.isEstimate === false);
  assert(result.warnings.length > 0);
});

await checkAsync('pasta sem "02_PLANILHA ORÇAMENTÁRIA" (AXN CP 655): resolvido sem preço, warning claro, nunca quebra', async () => {
  const result = await resolveAdditionalProposalFromDrive(fixtureClient, "folder-axn-cp-655", "AXN CP 655 - BETA MOTORS - RS");
  assert(result.proposalNumber === "AXN CP 655");
  assert(result.costFileName === null);
  assert(result.salePrice === null);
  assert(result.warnings.some((w) => w.includes("PLANILHA ORÇAMENTÁRIA")));
});

await checkAsync("fixture: ORÇAMENTOS tem as 3 propostas esperadas, incluindo o exemplo do requisito", async () => {
  const folders = await fixtureClient.listOrcamentosSubfolders();
  assert(folders.length === 3);
  assert(folders.some((f) => f.name === "AXN CP 617 - DUX VINHEDO - SP"));
});

check("list-orcamentos-proposals.ts delega para getProposalDriveLookupClient().listOrcamentosSubfolders() — nunca uma segunda fonte de dados", () => {
  const source = readSource("apps/web/lib/additionals/proposal-drive-lookup/list-orcamentos-proposals.ts");
  assert(source.includes("client.listOrcamentosSubfolders()"));
  assert(source.includes("getProposalDriveLookupClient()"));
});

// ---------- somente descendentes diretos de ORÇAMENTOS / adulteração recusada ----------

const driveLookupActionsSource = readSource("apps/web/app/[projectId]/adicionais/drive-lookup-actions.ts");

check("resolveAdditionalProposalFromDriveAction busca a lista real de ORÇAMENTOS de novo — nunca confia num folderId solto do cliente", () => {
  assert(driveLookupActionsSource.includes("client.listOrcamentosSubfolders()"));
  assert(driveLookupActionsSource.includes("folders.find((f) => f.id === folderId)"));
  assert(driveLookupActionsSource.includes("não é uma subpasta direta de ORÇAMENTOS"));
});

check("resolveAdditionalProposalFromDriveAction valida permissão ADMINISTRADOR (RLS/ACTIVE) no servidor, nunca só no cliente", () => {
  assert(driveLookupActionsSource.includes('import { getCurrentProjectPermission } from "@/lib/contract-review";'));
  assert(driveLookupActionsSource.includes('if (permission !== "ADMINISTRADOR")'));
});

check("resolveAdditionalProposalFromDriveAction resolve TUDO (número/escopo/preço) a partir do folderId — nunca aceita esses valores prontos do formData", () => {
  assert(!driveLookupActionsSource.includes('formData.get("proposalNumber")'));
  assert(!driveLookupActionsSource.includes('formData.get("folderName")'));
  assert(!driveLookupActionsSource.includes('formData.get("salePrice")'));
  assert(driveLookupActionsSource.includes("resolveAdditionalProposalFromDrive(client, folder.id, folder.name)"));
});

const additionalsActionsSource = readSource("apps/web/app/[projectId]/adicionais/actions.ts");

check("createAdditionalProposalAction: adulteração do cliente é recusada — para sourceType DRIVE, número/escopo/preço são SEMPRE sobrescritos pela resolução no servidor", () => {
  assert(additionalsActionsSource.includes("const driveFolderId = sourceType === \"DRIVE\" ? optionalField(formData, \"driveFolderId\") : null;"));
  assert(additionalsActionsSource.includes("if (driveFolderId) {"));
  assert(additionalsActionsSource.includes("const resolved = await resolveAdditionalProposalFromDrive(client, folder.id, folder.name);"));
  assert(additionalsActionsSource.includes("proposalNumber = resolved.proposalNumber;"));
  assert(additionalsActionsSource.includes("description = resolved.folderName;"));
  assert(additionalsActionsSource.includes("proposedValue = resolved.salePrice ?? undefined;"));
});

await checkAsync("adulteração concreta: folderId de fora de ORÇAMENTOS é recusado mesmo que o nome pareça válido", async () => {
  const folders = await fixtureClient.listOrcamentosSubfolders();
  const tampered = folders.find((f) => f.id === "folder-nao-existe-inventado-pelo-cliente");
  assert(tampered === undefined, "um folderId forjado nunca deveria bater com a lista real de ORÇAMENTOS");
});

// ---------- estado vazio desabilita criação / loading / erro ----------

const createFormSource = readSource("apps/web/components/additionals/additional-proposal-create-form.tsx");

check("estado vazio (nenhuma proposta em ORÇAMENTOS) desabilita a criação e mostra mensagem clara — nunca um dropdown vazio silencioso", () => {
  assert(createFormSource.includes("driveProposalFolders.length === 0"));
  assert(createFormSource.includes("Nenhuma proposta encontrada na pasta ORÇAMENTOS"));
});

check("selecionar a proposta no dropdown dispara a resolução sozinha (onChange -> requestSubmit, sem botão Buscar) — loading e erro exibidos na UI", () => {
  assert(!createFormSource.includes(">Buscar<"), "botão 'Buscar' não deveria mais existir — a seleção já dispara a resolução");
  assert(createFormSource.includes("resolveFormRef.current?.requestSubmit()"), "onChange do <Select> deveria disparar requestSubmit() no form de resolução");
  assert(createFormSource.includes('onChange={() => resolveFormRef.current?.requestSubmit()}'));
  assert(createFormSource.includes("resolvePending ?") && createFormSource.includes("Buscando…"), "indicador de carregamento (Buscando…) deveria continuar visível");
  assert(createFormSource.includes('resolveState.status === "error"'));
});

check("botão Criar proposta fica desabilitado até a resolução do Drive terminar (sourceType DRIVE sem resolved)", () => {
  assert(createFormSource.includes("sourceType === \"DRIVE\" && (!resolved || driveProposalFolders.length === 0)"));
});

check("formulário de resolução (seleção no dropdown) e o de criação NUNCA são aninhados — dois <form> irmãos, HTML válido", () => {
  const formOpenCount = (createFormSource.match(/<form /g) ?? []).length;
  assert(formOpenCount === 2, `esperado exatamente 2 <form> no componente, encontrado ${formOpenCount}`);
});

check("após a resolução, número/escopo/preço/estimativa/arquivo de origem aparecem claramente como somente leitura", () => {
  assert(createFormSource.includes("Proposta selecionada (somente leitura)"));
  assert(createFormSource.includes("resolved.proposalNumber") && createFormSource.includes("Número"));
  assert(createFormSource.includes("resolved.folderName") && createFormSource.includes("escopo"));
  assert(createFormSource.includes("resolved.salePrice") && createFormSource.includes("Preço de venda"));
  assert(createFormSource.includes("resolved.isEstimate") && createFormSource.includes("Estimativa"));
  assert(createFormSource.includes("resolved.costFileName") && createFormSource.includes("Arquivo de origem"));
});

// ---------- nenhum acesso real ao Drive / nenhum token no cliente ----------

// As duas checagens abaixo procuram USO real (import/require/chamada de
// API), nunca menção em comentário — os dois arquivos EXPLICAM em
// comentário como uma implementação real deveria ser feita no futuro
// (mesmo padrão de lib/drive/drive-client.ts), o que é esperado e não
// pode disparar falso positivo aqui.
check("fixture-client.ts nunca importa/chama SDK googleapis ou rede — só dados locais determinísticos", () => {
  const fixtureSource = readSource("apps/web/lib/additionals/proposal-drive-lookup/fixture-client.ts");
  assert(!/from ["']googleapis["']|require\(["']googleapis["']\)|\bfetch\(/i.test(fixtureSource));
});

check("get-proposal-drive-lookup-client.ts: a fixture só existe fora de produção (NODE_ENV !== 'production') — nenhum import/chamada real ao SDK do Drive em nenhum caso", () => {
  const clientSource = readSource("apps/web/lib/additionals/proposal-drive-lookup/get-proposal-drive-lookup-client.ts");
  assert(clientSource.includes("createFixtureProposalDriveLookupClient()"));
  assert(clientSource.includes('process.env.NODE_ENV !== "production"'), "a fixture deveria ser condicionada a NODE_ENV !== production");
  assert(!/from ["']googleapis["']|require\(["']googleapis["']\)|new google\.auth\.OAuth2\(/i.test(clientSource));
});

check("nenhum token/credencial do Drive é passado ao componente cliente (create-form recebe só {id,name} resolvidos)", () => {
  assert(!/clientSecret|refreshToken|OAuth|access_token/i.test(createFormSource));
});

// ---------- Fail-closed: fixture recusada em produção ----------

// get-proposal-drive-lookup-client.ts e list-orcamentos-proposals.ts têm
// "import \"server-only\"" no topo — só resolvível dentro do bundler do
// Next.js, nunca por um import direto de um script Node standalone (o
// loader em ts-module-resolver.mjs não stub-a o pacote "server-only",
// de propósito: ver header deste arquivo). Por isso o comportamento
// fail-closed é verificado por leitura de código-fonte (mesmo padrão
// já usado para clientSource acima), não chamando a função de verdade.
check("fail-closed ESTRUTURAL: getProposalDriveLookupClient() retorna null ANTES de instanciar a fixture quando NODE_ENV=production (nunca a fixture fictícia 'AXN CP 617')", () => {
  const clientSource = readSource("apps/web/lib/additionals/proposal-drive-lookup/get-proposal-drive-lookup-client.ts");
  assert(clientSource.includes("if (!isProposalDriveFixtureAllowed()) return null;"), "getProposalDriveLookupClient() deveria checar o gate fail-closed antes de criar a fixture");
  const gateIndex = clientSource.indexOf("if (!isProposalDriveFixtureAllowed()) return null;");
  const fixtureCallIndex = clientSource.indexOf("return createFixtureProposalDriveLookupClient();");
  assert(gateIndex !== -1 && fixtureCallIndex !== -1 && gateIndex < fixtureCallIndex, "o retorno null deveria vir ANTES da criação da fixture");
});

check("fail-closed ESTRUTURAL: listOrcamentosProposalFolders() retorna lista VAZIA quando o client é null — nunca chama listOrcamentosSubfolders() da fixture nesse caso", () => {
  const listSource = readSource("apps/web/lib/additionals/proposal-drive-lookup/list-orcamentos-proposals.ts");
  assert(listSource.includes("if (!client) return [];"), "listOrcamentosProposalFolders() deveria retornar [] quando getProposalDriveLookupClient() retorna null");
  const nullCheckIndex = listSource.indexOf("if (!client) return [];");
  const listCallIndex = listSource.indexOf("listOrcamentosSubfolders()");
  assert(nullCheckIndex !== -1 && listCallIndex !== -1 && nullCheckIndex < listCallIndex, "a checagem de client nulo deveria vir ANTES de chamar listOrcamentosSubfolders()");
});

check("fail-closed ESTRUTURAL: drive-lookup-actions.ts recusa ANTES de qualquer outra checagem quando o cliente é null — bloqueio no SERVIDOR, nunca só a interface (mesmo uma chamada direta à Server Action, ignorando a UI, é recusada)", () => {
  assert(driveLookupActionsSource.includes("if (!client) {"), "resolveAdditionalProposalFromDriveAction deveria checar client === null");
  assert(driveLookupActionsSource.includes("Integração com Google Drive ainda não configurada."));
});

check("fail-closed ESTRUTURAL: createAdditionalProposalAction também recusa a origem DRIVE quando o cliente é null — bloqueio server-side na CRIAÇÃO, não só na resolução/dropdown", () => {
  assert(additionalsActionsSource.includes("Integração com Google Drive ainda não configurada"), "createAdditionalProposalAction deveria recusar explicitamente quando o client é null");
  const driveBlockIndex = additionalsActionsSource.indexOf("if (driveFolderId) {");
  const nullCheckIndex = additionalsActionsSource.indexOf("if (!client) {", driveBlockIndex);
  const listFoldersIndex = additionalsActionsSource.indexOf("listOrcamentosSubfolders()", driveBlockIndex);
  assert(driveBlockIndex !== -1 && nullCheckIndex !== -1 && listFoldersIndex !== -1 && nullCheckIndex < listFoldersIndex, "a checagem de client nulo deveria vir ANTES de qualquer chamada ao client");
});

check("fail-closed NA INTERFACE: o formulário distingue 'integração não configurada' (produção) de 'ORÇAMENTOS genuinamente vazio' (fixture/dev) — duas mensagens diferentes, nunca a mesma; o dropdown fica indisponível nos dois casos", () => {
  assert(createFormSource.includes("driveIntegrationConfigured"), "o formulário deveria receber a flag driveIntegrationConfigured");
  assert(createFormSource.includes("Integração com Google Drive ainda não configurada."));
  assert(createFormSource.includes("Nenhuma proposta encontrada na pasta ORÇAMENTOS."));
});

check("fail-closed NA INTERFACE: adicionais/page.tsx calcula a flag no SERVIDOR (isProposalDriveFixtureAllowed) e a repassa ao formulário — nunca uma heurística do lado do cliente", () => {
  const pageSource = readSource("apps/web/app/[projectId]/adicionais/page.tsx");
  assert(pageSource.includes("isProposalDriveFixtureAllowed()"));
  assert(pageSource.includes("driveIntegrationConfigured={isProposalDriveFixtureAllowed()}"));
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exitCode = 1;
}
