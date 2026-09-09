import { readFileSync } from "node:fs";
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

const validator = read("apps/web/lib/integrations/esg-ssma/validate-drive-source.ts");
const client = read("apps/web/lib/drive/drive-client.ts");
const action = read("apps/web/app/[projectId]/integracoes/actions.ts");
const component = read("apps/web/components/integrations/ssma-drive-connection-check.tsx");
const card = read("apps/web/components/integrations/integration-card.tsx");
const state = read("apps/web/app/[projectId]/integracoes/actions-state.ts");

check("cliente dedicado usa somente get/list", client.includes("DriveReadOnlyFilesClient") && !/interface DriveReadOnlyFilesClient[\s\S]*?create\(/.test(client));
check("consulta inclui Shared Drives", validator.includes("supportsAllDrives: true") && validator.includes("includeItemsFromAllDrives: true"));
check("consulta exclui lixeira", validator.includes("trashed = false"));
check("paginação impede contagem parcial", validator.includes("nextPageToken") && validator.includes("while (pageToken)"));
check("as 11 pastas vêm da política única", validator.includes("ESG_SSMA_PROJECT_SUBFOLDERS.map"));
check("pastas ausentes bloqueiam validação", validator.includes("MISSING_FOLDERS"));
check("pastas duplicadas bloqueiam validação", validator.includes("DUPLICATED_FOLDERS"));
check("resultado não expõe ids do Drive", !/SsmaDriveFolderInspection[\s\S]{0,220}\bid:/.test(validator));
check("action autentica o usuário", action.includes("const user = await requireUser(supabase)"));
check("action exige ADMINISTRADOR no servidor", action.includes('membership?.permission !== "ADMINISTRADOR"'));
check("URL vem da configuração do projeto", action.includes('.eq("source_type", "ESG_SSMA")') && action.includes("config.folder_reference"));
check("nenhuma URL/ID privado está hardcoded", !/drive\.google\.com\/drive\/folders\/[A-Za-z0-9_-]{10,}/.test(action + validator));
check("credencial permanece em variáveis de ambiente", action.includes("isDriveOAuthConfigured") && action.includes("loadDriveOAuthConfig"));
check("erros externos são sanitizados", action.includes("sanitizeSsmaDriveValidationError"));
check("estado retornado contém somente contagens", state.includes("ValidateSsmaDriveState") && state.includes("totalFiles"));
check("UI declara somente leitura", component.includes("Somente leitura"));
check("UI mostra 11/11 e contagem por pasta", component.includes("11/11 pastas") && component.includes("Ver contagem por pasta"));
check("painel aparece apenas para ADMIN no ESG_SSMA", card.includes('source.type === "ESG_SSMA" && canManage'));
check(
  "nenhuma operação de download/escrita no validador",
  !/client\.(create|update|delete|download|export|getMedia)\(/i.test(validator) &&
    !/media:\s*\{/i.test(validator)
);

console.log(`\nRESULTADO: ${passed} passaram, ${failed} falharam`);
if (failed > 0) process.exit(1);
