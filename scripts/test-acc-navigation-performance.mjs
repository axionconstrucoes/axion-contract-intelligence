// Correção de desempenho (2026-08-31): rajada de ~15-16 requisições RSC
// simultâneas disparada pelo prefetch automático do <Link> em CADA item
// da sidebar (todos visíveis ao mesmo tempo), causando 503 intermitente
// em segmentos aleatórios do lote — comprovado via cross-check com os
// runtime logs do Vercel (nenhuma dessas rajadas jamais aparece como
// invocação de função com erro; a falha nasce antes da invocação,
// consistente com limite de concorrência da infraestrutura, não bug de
// aplicação). E os 2,35MB transferidos em /login, dominados por dois
// PNGs (logo 1254x1254 exibida a 83px; fundo 1672x941) servidos sem
// nenhuma otimização.
//
// Checagens estruturais (leitura de código-fonte/arquivo) — mesmo
// padrão já usado em scripts/test-brand-background.mjs — sem subir um
// servidor Next.js real.
//
// Uso:
//   node scripts/test-acc-navigation-performance.mjs

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
function readSource(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}
function absolutePath(relativePath) {
  return path.join(repoRoot, relativePath);
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
console.log("PERFORMANCE — PREFETCH DA SIDEBAR + PESO DO /login");
console.log("======================================");
console.log("");

// --- 1. Sidebar: prefetch desativado nos links do menu ---

const sidebarSource = readSource("apps/web/components/layout/app-sidebar.tsx");

check("app-sidebar.tsx: <Link> dos itens do menu tem prefetch={false} (elimina a rajada de ~16 requisições RSC simultâneas)", () => {
  const linkMatch = sidebarSource.match(/<Link[\s\S]*?<\/Link>|<Link[\s\S]*?\/>/);
  assert(linkMatch, "<Link> do menu não encontrado");
  assert(/prefetch=\{false\}/.test(sidebarSource), "prefetch={false} deveria estar presente no <Link> do menu");
});

check("app-sidebar.tsx: NAV_ITEMS continua vindo de @/lib/ui/nav-items (nenhuma lista duplicada/hardcoded)", () => {
  assert(sidebarSource.includes('from "@/lib/ui/nav-items"'), "import de NAV_ITEMS não deveria ter sido alterado");
});

check("app-sidebar.tsx: item ativo (pathname?.startsWith) e ícone por item continuam presentes — navegação não foi simplificada demais", () => {
  assert(sidebarSource.includes("pathname?.startsWith(href)"), "lógica de item ativo deveria continuar presente");
  assert(sidebarSource.includes("ICONS_BY_NAME[item.icon]"), "resolução de ícone por item deveria continuar presente");
});

check("app-sidebar.tsx: recolher/expandir (collapsed) e o botão de toggle continuam presentes — comportamento desktop/mobile preservado", () => {
  assert(sidebarSource.includes("setSidebarCollapsed"), "toggle collapsed deveria continuar presente");
  assert(sidebarSource.includes("aria-label={collapsed"), "aria-label do botão de toggle deveria continuar presente");
});

// --- 2. /login: logo via next/image, dimensionada para 83px com 2x retina ---

const loginPageSource = readSource("apps/web/app/login/page.tsx");

check("/login: importa Image de next/image e usa <Image ...> (não mais <img> cru) para a logo", () => {
  assert(/import Image from "next\/image"/.test(loginPageSource), "import de next/image ausente");
  assert(/<Image\s/.test(loginPageSource), "<Image> não encontrado em /login");
  assert(!/<img\s/.test(loginPageSource), "não deveria mais haver <img> cru em /login");
});

check("/login: <Image> da logo aponta para o MESMO asset oficial (/branding/acc-logo.png), sem cópia nova", () => {
  const imageMatch = loginPageSource.match(/<Image[^>]*src="\/branding\/acc-logo\.png"[^>]*\/>/);
  assert(imageMatch, "<Image src=\"/branding/acc-logo.png\" .../> não encontrado");
});

check("/login: <Image> da logo pede 166x166 (2x retina dos 83px exibidos) — não o tamanho intrínseco de 1254x1254 do arquivo original", () => {
  const imageMatch = loginPageSource.match(/<Image[^>]*src="\/branding\/acc-logo\.png"[^>]*\/>/);
  assert(imageMatch, "<Image> da logo não encontrado");
  assert(/width=\{166\}/.test(imageMatch[0]), "width={166} esperado");
  assert(/height=\{166\}/.test(imageMatch[0]), "height={166} esperado");
});

check("/login: <Image> da logo preserva o tamanho visual exibido (h-[83.2px] w-auto, idêntico ao anterior) e tem priority (evita flash de carregamento acima da dobra)", () => {
  const imageMatch = loginPageSource.match(/<Image[^>]*src="\/branding\/acc-logo\.png"[^>]*\/>/);
  assert(imageMatch, "<Image> da logo não encontrado");
  assert(imageMatch[0].includes('className="h-[83.2px] w-auto"'), "className de tamanho visual deveria ser idêntico ao anterior");
  assert(/\bpriority\b/.test(imageMatch[0]), "priority esperado (logo acima da dobra em /login)");
});

// --- 3. Fundo institucional: WebP otimizado com fallback seguro para PNG ---

const backgroundComponentSource = readSource("apps/web/components/brand/institutional-background.tsx");

check("institutional-background.tsx: backgroundImage usa image-set() com WebP como primeira opção e o PNG oficial como fallback explícito", () => {
  assert(/image-set\(/.test(backgroundComponentSource), "image-set() não encontrado em backgroundImage");
  assert(backgroundComponentSource.includes('type("image/webp")'), "tipo image/webp não declarado no image-set()");
  assert(backgroundComponentSource.includes('type("image/png")'), "tipo image/png (fallback) não declarado no image-set()");
  assert(
    backgroundComponentSource.includes("/brand/acc-background-oficial.webp") &&
      backgroundComponentSource.includes("/brand/acc-background-oficial.png"),
    "image-set() deveria referenciar tanto o .webp novo quanto o .png oficial original"
  );
});

check("institutional-background.tsx: INSTITUTIONAL_BACKGROUND_PNG_PATH continua exportado apontando para o PNG oficial (nenhum consumidor externo quebrado)", () => {
  assert(
    /export const INSTITUTIONAL_BACKGROUND_PNG_PATH = "\/brand\/acc-background-oficial\.png"/.test(backgroundComponentSource),
    "export de INSTITUTIONAL_BACKGROUND_PNG_PATH deveria continuar apontando para o PNG oficial, inalterado"
  );
});

check("acc-background-oficial.webp existe, é menor que o PNG oficial em pelo menos 20x, e nenhum dos dois arquivos originais foi removido", () => {
  const pngPath = absolutePath("apps/web/public/brand/acc-background-oficial.png");
  const webpPath = absolutePath("apps/web/public/brand/acc-background-oficial.webp");
  const logoPath = absolutePath("apps/web/public/branding/acc-logo.png");
  assert(existsSync(pngPath), "PNG oficial do fundo deveria continuar existindo, intocado");
  assert(existsSync(webpPath), "acc-background-oficial.webp deveria ter sido gerado");
  assert(existsSync(logoPath), "acc-logo.png (usado por sidebar/projetos/e-mail) deveria continuar existindo, intocado");
  const pngSize = statSync(pngPath).size;
  const webpSize = statSync(webpPath).size;
  assert(pngSize > 100000, `PNG oficial do fundo parece pequeno demais (${pngSize} bytes)`);
  assert(webpSize > 1000, `WebP gerado parece vazio/corrompido demais (${webpSize} bytes)`);
  assert(
    pngSize / webpSize >= 20,
    `WebP deveria ser pelo menos 20x menor que o PNG oficial (PNG=${pngSize}, WebP=${webpSize}, razão=${(pngSize / webpSize).toFixed(1)}x)`
  );
});

await checkAsync("acc-background-oficial.webp: mesmas dimensões do PNG oficial (1672x941) e cor média próxima (#c10c10) — aparência preservada, não é um recorte/redesenho", async () => {
  const sharp = (await import("sharp")).default;
  const webpPath = absolutePath("apps/web/public/brand/acc-background-oficial.webp");
  const metadata = await sharp(webpPath).metadata();
  assert(metadata.width === 1672, `largura deveria ser 1672, encontrada ${metadata.width}`);
  assert(metadata.height === 941, `altura deveria ser 941, encontrada ${metadata.height}`);
  const { data } = await sharp(webpPath).resize(1, 1).raw().toBuffer({ resolveWithObject: true });
  const [r, g, b] = [data[0], data[1], data[2]];
  const [er, eg, eb] = [0xc1, 0x0c, 0x10];
  const distance = Math.abs(r - er) + Math.abs(g - eg) + Math.abs(b - eb);
  assert(distance <= 45, `cor média do WebP rgb(${r},${g},${b}) está longe demais de #c10c10 (diferença ${distance}, esperado <=45)`);
});

// --- 4. Nenhum outro consumidor do logo/fundo foi alterado por engano ---

check("sidebar/projetos/email-actions/e-mail continuam referenciando o PNG oficial da logo diretamente (não migrados para next/image — fora do escopo desta correção)", () => {
  assert(sidebarSource.includes('src="/branding/acc-logo.png"'), "sidebar deveria continuar com <img> apontando pro PNG oficial");
  const projetosSource = readSource("apps/web/app/projetos/page.tsx");
  assert(projetosSource.includes('src="/branding/acc-logo.png"'), "/projetos deveria continuar com <img> apontando pro PNG oficial");
  const emailActionsSource = readSource("apps/web/app/email-actions/[token]/page.tsx");
  assert(emailActionsSource.includes('src="/branding/acc-logo.png"'), "/email-actions/[token] deveria continuar com <img> apontando pro PNG oficial");
  const loaderSource = readSource("apps/web/lib/email/branding/load-acc-logo-inline-image.ts");
  assert(loaderSource.includes('"acc-logo.png"'), "loader de logo inline do e-mail deveria continuar lendo o PNG oficial bruto, sem alteração");
});

console.log("");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
if (failed > 0) process.exit(1);
