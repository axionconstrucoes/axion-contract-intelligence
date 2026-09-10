import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const readSource = (relativePath) =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

const createForm = readSource(
  "apps/web/components/legal/precontract-workspace-create-form.tsx"
);
const legalPage = readSource("apps/web/app/[projectId]/juridico/page.tsx");
const action = readSource("apps/web/app/juridico/actions.ts");

let passed = 0;

function check(name, condition) {
  if (!condition) throw new Error(`Falha: ${name}`);
  console.log(`OK   ${name}`);
  passed += 1;
}

console.log("\nJURÍDICO PRÉ-CONTRATUAL — UPLOAD DE DOCUMENTOS\n");

check(
  "a criação permanece na tela e devolve o identificador da análise",
  action.includes("projectId: String(data)") && action.includes('revalidatePath("/juridico")')
);
check(
  "a tela inicial oferece upload múltiplo depois da criação",
  createForm.includes("DocumentMultiUploadPanel") &&
    createForm.includes("Carregar documentos para a análise")
);
check(
  "a análise já criada também oferece upload múltiplo",
  legalPage.includes("DocumentMultiUploadPanel") && legalPage.includes("isPrecontract && canUpload")
);
check(
  "o upload respeita a permissão documental do projeto",
  legalPage.includes('permission === "ADMINISTRADOR"') &&
    legalPage.includes('permission === "GESTOR"') &&
    legalPage.includes('permission === "GERENTE"')
);

console.log(`\nRESULTADO: ${passed} passaram, 0 falharam`);
