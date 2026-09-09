import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const definitions = read("apps/web/lib/ssma/checklist-definitions.ts");
const app = read("apps/web/components/ssma/ssma-field-app.tsx");
const page = read("apps/web/app/ssma/[projectId]/page.tsx");
const manifest = read("apps/web/app/manifest.ts");
const esgPage = read("apps/web/app/[projectId]/esg/page.tsx");
const rootLayout = read("apps/web/app/layout.tsx");
const pwaRegistration = read("apps/web/components/pwa-registration.tsx");
const serviceWorker = read("apps/web/public/sw.js");

let checks = 0;
function assert(condition, message) {
  checks += 1;
  if (!condition) throw new Error(message);
}

assert((definitions.match(/number: \d+,/g) ?? []).length === 11, "Devem existir exatamente 11 telas");
assert(definitions.includes('slug: "remessa-bota-fora"'), "Remessa deve existir");
assert(definitions.includes("number: 11") && definitions.includes("independent: true"), "Remessa deve ser a tela 11 independente");
assert(definitions.includes('driveFolder: "07 - REMESSAS PARA BOTA-FORA"'), "Remessa deve preservar a pasta real do Drive");
assert(definitions.includes('type SsmaChecklistState = "FEITO" | "NA"'), "Estados devem ser somente Feito e NA");
assert(!definitions.toLowerCase().includes("justificativa"), "NA não deve exigir justificativa");
assert(app.includes('src="/branding/acc-logo.png"'), "Deve usar o logo ACC oficial");
assert(app.includes('top-1/2') && app.includes('-translate-y-1/2'), "Logo deve ser centralizado verticalmente no cabeçalho");
assert(app.includes('bg-[#7f1d1d]'), "Cabeçalho deve usar bordô institucional");
assert(app.includes('checked={checks[check] === value}'), "Feito e NA devem ser mutuamente exclusivos");
assert(app.includes("definition.checks.every"), "Todos os itens devem ser respondidos antes do envio");
assert(app.includes("!allChecksAnswered"), "Envio deve ficar bloqueado com checklist incompleto");
assert(app.includes("Carregado automaticamente do cadastro da obra"), "Técnico deve ser automático");
assert(page.includes("getProjectMembers(projectId)"), "Técnico deve vir do cadastro real do projeto");
assert(page.includes('member.status === "ACTIVE"'), "Somente membro ativo pode acessar");
assert(page.includes("buildEsgSsmaProjectFolderName"), "Nome da obra deve seguir o padrão aprovado");
assert(manifest.includes('display: "standalone"'), "Aplicativo deve ser instalável");
assert(manifest.includes('theme_color: "#7f1d1d"'), "Manifest deve usar a cor institucional");
assert(rootLayout.includes("<PwaRegistration />"), "Layout deve registrar o aplicativo instalável");
assert(pwaRegistration.includes('register("/sw.js")'), "Service worker deve ser registrado");
assert(!serviceWorker.includes('addEventListener("fetch"'), "Dados autenticados não devem ser armazenados em cache nesta fase");
assert(esgPage.includes("/ssma/${projectId}"), "Módulo ESG deve oferecer acesso ao aplicativo");
assert(definitions.includes('value: "MEDIA", label: "Médio", className: "bg-[#2563EB] text-white"'), "Médio deve ser azul");
assert(definitions.includes('value: "ALTA", label: "Alto", className: "bg-[#FFD600] text-black"'), "Alto deve ser amarelo");
assert(app.includes('type="file"') && app.includes('name="photos"'), "Formulários devem permitir selecionar fotos");
assert(app.includes("multiple"), "Seleção de fotos deve aceitar múltiplos arquivos");
assert(app.includes('accept="image/jpeg,image/png,.jpg,.jpeg,.png"'), "Upload deve aceitar somente JPG e PNG");
assert(app.includes("MAX_PHOTO_SIZE_BYTES = 15 * 1024 * 1024"), "Cada foto deve ser limitada a 15 MB");
assert(app.includes("MAX_PHOTOS_PER_FORM = 20"), "Cada formulário deve aceitar no máximo 20 fotos");
assert(app.includes("URL.createObjectURL(file)"), "Fotos devem ter pré-visualização local");
assert(app.includes("URL.revokeObjectURL"), "Pré-visualizações devem liberar memória do navegador");
assert(app.includes("removePhoto(photo.id)"), "Usuário deve poder remover uma foto antes do envio");
assert(app.includes("Selecionar fotos do computador"), "Desktop deve ter ação explícita para escolher fotos");
assert(app.includes("file.lastModified"), "Fotos repetidas devem ser detectadas na seleção");
assert(app.includes("action: selectedActionRef.current"), "Foto deve preservar a ação correspondente, como antes/depois");

console.log(`${checks} verificações, 0 falhas`);
