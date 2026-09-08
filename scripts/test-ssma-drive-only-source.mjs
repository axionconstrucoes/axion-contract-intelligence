import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    passed += 1;
    console.log(`OK   ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL ${label}`);
  }
}

const sources = read("packages/mock-data/src/sources.ts");
const operationalDefinitions = sources.split("const NO_ORIGIN")[0];
const form = read("apps/web/components/integrations/integration-origin-form.tsx");
const card = read("apps/web/components/integrations/integration-card.tsx");
const actions = read("apps/web/app/[projectId]/integracoes/actions.ts");
const documentsPage = read("apps/web/app/[projectId]/documentos/page.tsx");
const policy = read("apps/web/lib/integrations/esg-ssma/drive-source-policy.ts");
const types = read("packages/types/src/index.ts");

for (const type of ["EMAIL", "DIARIO_OBRA", "CONSTRUMANAGER", "ERP", "ESG_SSMA"]) {
  check(`fonte operacional preservada: ${type}`, operationalDefinitions.includes(`type: "${type}"`));
}

for (const type of [
  "CONTRATO",
  "GOOGLE_DRIVE",
  "RECEBIDOS_CLIENTE",
  "EDITAL_RFI_RFP",
  "CRONOGRAMA",
  "RELATORIO_SEMANAL",
  "ORCAMENTO",
]) {
  check(`fonte documental retirada da grade de integrações: ${type}`, !operationalDefinitions.includes(`type: "${type}"`));
  check(`taxonomia histórica preservada: ${type}`, types.includes(`| "${type}"`));
}

check("ESG/SSMA declarado como única fonte Google Drive", sources.includes("Única fonte do Google Drive usada pelo ACC"));
check("formulário ESG aceita URL da pasta", form.includes("Cole a URL da pasta SSMA-ESG desta obra"));
check("formulário ESG fixa Drive compartilhado", form.includes('sourceType === "ESG_SSMA" ? "DRIVE_COMPARTILHADO"'));
check("action bloqueia fonte fora da lista operacional", actions.includes("Esta fonte não faz parte das integrações operacionais do ACC"));
check("action exige URL completa de pasta Google Drive", actions.includes("Informe a URL completa da pasta SSMA/ESG"));
check("action fixa sistema Google Drive no servidor", /sourceType === "ESG_SSMA" \? "Google Drive"/.test(actions));
check("action fixa Drive compartilhado no servidor", /sourceType === "ESG_SSMA" \? "DRIVE_COMPARTILHADO"/.test(actions));
check("action nunca aceita arquivo único para ESG", /p_file_reference: sourceType === "ESG_SSMA" \? null/.test(actions));
check("card oferece link direto somente para URL de pasta válida", card.includes("Abrir pasta SSMA/ESG no Google Drive") && card.includes("drive.google.com/drive/folders/"));
check("Documentos explica o fluxo manual", documentsPage.includes("Upload manual de contratos, aditivos, editais, RFI, RFP"));
check("Documentos registra exclusividade SSMA/ESG", documentsPage.includes("Google Drive é reservado exclusivamente ao SSMA/ESG"));

const expectedFolders = [
  "DIÁLOGO DIÁRIO DE SEGURANÇA - DDA",
  "DIÁLOGO SEMANAL DE SEGURANÇA - DDS",
  "FOTOS DIÁRIAS DE SEGURANÇA",
  "ANÁLISE PRELIMINAR DE RISCO - APR",
  "PERMISSÃO DE TRABALHO - PT",
  "LISTA DE INTEGRAÇÃO",
  "REMESSAS PARA BOTA-FORA",
  "ORGANIZAÇÃO DO ALMOXARIFADO",
  "RISCOS APONTADOS",
  "LIMPEZA DA OBRA",
  "OUTROS",
];
for (const folder of expectedFolders) check(`estrutura SSMA/ESG documentada: ${folder}`, policy.includes(folder));

check("raiz SSMA/ESG documentada sem publicar diretório privado", policy.includes("SSMA-ESG > pasta do projeto"));
check("nenhum ID ou link privado do Drive está codificado", !/drive\/folders\/[A-Za-z0-9_-]{10,}/.test(policy));

const migrations = readdirSync(path.join(root, "supabase/migrations"));
check("nenhuma migration específica desta mudança", !migrations.some((name) => /ssma.*drive.*source|drive.*only/i.test(name)));

console.log(`\nRESULTADO: ${passed} passaram, ${failed} falharam`);
if (failed > 0) process.exit(1);
