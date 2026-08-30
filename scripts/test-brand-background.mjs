// Fundo institucional AXION/ACC (bordô + quadriculado branco) em
// /login e /projetos, restaurado a partir da composição real
// encontrada no histórico Git (commit e8e172d "feat: finalize ACC
// visual redesign for go-live", branch main/backup, lida só como
// referência — nunca mesclada nesta branch) e reimplementada como
// asset reutilizável em apps/web/public/brand/. Estrutural (leitura de
// código-fonte/arquivo), mesmo padrão já usado em
// scripts/test-risk-medium-color.mjs e scripts/test-document-kind-card-colors.mjs;
// dimensões do PNG são verificadas de verdade (sharp, já presente em
// node_modules — nenhuma dependência nova instalada).
//
// Uso:
//   node scripts/test-brand-background.mjs

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
console.log("FUNDO INSTITUCIONAL — BORDÔ + QUADRICULADO (/login, /projetos)");
console.log("======================================");
console.log("");

// Fundo oficial ATUAL: um PNG real fornecido pela marca (foto/textura,
// não um SVG gerado por código) — substituiu integralmente o SVG
// bordô/quadriculado sintético de uma iteração anterior (arquivos
// legados abaixo continuam em disco, órfãos, mas o componente central
// (institutional-background.tsx) não os importa/referencia mais; ver
// checagem explícita de ausência de dependência mais abaixo). As
// checagens desta seção validam o comportamento ATUAL — nunca a
// expectativa antiga do SVG sintético.
const OFFICIAL_PNG_RELATIVE_PATH = "apps/web/public/brand/acc-background-oficial.png";
const OFFICIAL_PNG_PUBLIC_PATH = "/brand/acc-background-oficial.png";
// Cor predominante (extraída do PNG oficial por histograma de pixels via
// sharp, ver institutional-background.tsx) — verificada de verdade
// abaixo (recomputada de forma independente a partir do arquivo real,
// não só comparada como string), não só citada aqui.
const OFFICIAL_DOMINANT_COLOR_HEX = "#c10c10";
const OFFICIAL_DOMINANT_COLOR_RGB = [0xc1, 0x0c, 0x10];

const pngExists = existsSync(absolutePath(OFFICIAL_PNG_RELATIVE_PATH));

check("PNG oficial do fundo institucional existe em apps/web/public/brand/ e não é um arquivo vazio", () => {
  assert(pngExists, `${OFFICIAL_PNG_RELATIVE_PATH} não encontrado`);
  const stat = statSync(absolutePath(OFFICIAL_PNG_RELATIVE_PATH));
  assert(stat.size > 100000, `acc-background-oficial.png parece pequeno demais (${stat.size} bytes) para uma foto/textura real`);
});

await checkAsync("PNG oficial: formato PNG válido, dimensões esperadas (1672×941, a proporção real do arquivo fornecido pela marca)", async () => {
  const sharp = (await import("sharp")).default;
  const metadata = await sharp(absolutePath(OFFICIAL_PNG_RELATIVE_PATH)).metadata();
  assert(metadata.format === "png", `formato deveria ser png, encontrado ${metadata.format}`);
  assert(metadata.width === 1672, `largura deveria ser 1672, encontrada ${metadata.width}`);
  assert(metadata.height === 941, `altura deveria ser 941, encontrada ${metadata.height}`);
  // Canal alfa não é garantido — a versão do asset trocada manualmente
  // em 2026-08-29 (linhas principais mais suaves) não tem alfa
  // (hasAlpha=false); a versão anterior tinha. Não é uma propriedade que
  // este teste deveria travar — a única coisa realmente exigida é que o
  // arquivo seja um PNG válido nas dimensões esperadas.
});

await checkAsync("PNG oficial: cor predominante recomputada de verdade a partir do arquivo (média de pixel via sharp) bate com a constante exportada (#c10c10) — não é só uma string citada, é extração real", async () => {
  const sharp = (await import("sharp")).default;
  const { data } = await sharp(absolutePath(OFFICIAL_PNG_RELATIVE_PATH)).resize(1, 1).raw().toBuffer({ resolveWithObject: true });
  const [r, g, b] = [data[0], data[1], data[2]];
  const [er, eg, eb] = OFFICIAL_DOMINANT_COLOR_RGB;
  const distance = Math.abs(r - er) + Math.abs(g - eg) + Math.abs(b - eb);
  assert(
    distance <= 45,
    `cor média recomputada rgb(${r},${g},${b}) está longe demais de ${OFFICIAL_DOMINANT_COLOR_HEX} (soma das diferenças ${distance}, esperado <=45) — a constante pode não refletir mais o arquivo real`
  );
});

// --- globals.css: --brand-sidebar (fonte da cor) não foi alterado ---

const globalsCss = readSource("apps/web/app/globals.css");

check("globals.css: --brand-sidebar permanece #7f1d1d institucional (oklch(0.396 0.141 25.723)), intocado", () => {
  assert(
    /--brand-sidebar:\s*oklch\(0\.396 0\.141 25\.723\)/.test(globalsCss),
    "--brand-sidebar deveria continuar oklch(0.396 0.141 25.723)"
  );
});

// --- Componente central reutilizável ---

const backgroundComponentPath = "apps/web/components/brand/institutional-background.tsx";
const backgroundComponentSource = readSource(backgroundComponentPath);

check("institutional-background.tsx: existe um componente central único (InstitutionalBackground)", () => {
  assert(/export function InstitutionalBackground/.test(backgroundComponentSource), "InstitutionalBackground não exportado");
});

check("institutional-background.tsx: usa o PNG OFICIAL (acc-background-oficial.png) como background-image — comportamento atual, não o SVG sintético legado", () => {
  assert(
    backgroundComponentSource.includes(OFFICIAL_PNG_PUBLIC_PATH),
    `deveria referenciar ${OFFICIAL_PNG_PUBLIC_PATH} como backgroundImage`
  );
  assert(/backgroundImage/.test(backgroundComponentSource), "deveria setar backgroundImage");
});

check("institutional-background.tsx: exporta o caminho público do PNG oficial e a cor predominante para reuso (ex.: overlay/scrim)", () => {
  assert(backgroundComponentSource.includes("INSTITUTIONAL_BACKGROUND_PNG_PATH"), "constante do caminho do PNG oficial não exportada");
  assert(backgroundComponentSource.includes("INSTITUTIONAL_BACKGROUND_DOMINANT_COLOR"), "constante da cor predominante não exportada");
});

check("ausência de dependência obrigatória do SVG sintético antigo: institutional-background.tsx não importa/referencia acc-burgundy-white-grid-background(.svg|-1920x1080.png) — o .svg legado continua em disco, órfão (o .png derivado foi removido na substituição manual do asset oficial), mas nenhum dos dois é exigido pelo componente atual", () => {
  assert(!backgroundComponentSource.includes("acc-burgundy-white-grid-background"), "institutional-background.tsx não deveria referenciar o asset sintético legado — o fundo atual é só o PNG oficial");
});

// --- /login usa o fundo institucional ---

const loginPageSource = readSource("apps/web/app/login/page.tsx");

check("/login: renderiza <InstitutionalBackground /> (componente central, não CSS duplicado)", () => {
  assert(
    loginPageSource.includes("<InstitutionalBackground") &&
      loginPageSource.includes('from "@/components/brand/institutional-background"'),
    "/login deveria importar e renderizar InstitutionalBackground"
  );
});

check("/login: NÃO tem mais link de download do fundo institucional (ACC é Google-only — removido intencionalmente)", () => {
  assert(!loginPageSource.includes("Baixar fundo institucional"), "link de download não deveria mais existir em /login");
  assert(!loginPageSource.includes("INSTITUTIONAL_BACKGROUND_PNG_PATH"), "/login não deveria mais importar o caminho do PNG (não usa mais para link de download)");
});

check("/login: autenticação Google-only — sem formulário de e-mail/senha, sem divisor 'ou', login/actions.ts (Server Action de senha, sem nenhum consumidor) removido por completo — a retirada dos campos da tela sozinha não bastaria, o caminho de senha no servidor precisava deixar de existir", () => {
  assert(!loginPageSource.includes('from "./actions"'), "/login não deveria mais importar a action de senha (form removido)");
  assert(!/type="email"/.test(loginPageSource) && !/type="password"/.test(loginPageSource), "campos de e-mail/senha não deveriam mais existir em /login");
  assert(!loginPageSource.includes("Entrar com email e senha"), "botão de login por senha não deveria mais existir");
  assert(!/>\s*ou\s*</.test(loginPageSource), "divisor 'ou' não deveria mais existir");
  assert(
    loginPageSource.includes('from "./google-signin-button"') && loginPageSource.includes("GoogleSignInButton"),
    "GoogleSignInButton deveria continuar presente (único método de login)"
  );
  assert(!existsSync(path.join(repoRoot, "apps/web/app/login/actions.ts")), "login/actions.ts (signInWithPassword, sem consumidor) deveria ter sido removido — não apenas desreferenciado pela UI");
});

check("/login: logo oficial ACC continua presente", () => {
  assert(loginPageSource.includes("/branding/acc-logo.png"), "logo oficial não encontrado em /login");
});

// --- /projetos usa o mesmo fundo ---

const projetosPageSource = readSource("apps/web/app/projetos/page.tsx");

check("/projetos: renderiza <InstitutionalBackground /> — mesmo componente central de /login, sem duplicar classes", () => {
  assert(
    projetosPageSource.includes("<InstitutionalBackground") &&
      projetosPageSource.includes('from "@/components/brand/institutional-background"'),
    "/projetos deveria importar e renderizar InstitutionalBackground"
  );
});

check("/projetos: NÃO tem mais links públicos de download (logotipo/ícone técnico/fundo institucional) — removidos intencionalmente, assets continuam em public/ para uso interno do app", () => {
  assert(!projetosPageSource.includes("Baixar logotipo"), "link 'Baixar logotipo' não deveria mais existir em /projetos");
  assert(!projetosPageSource.includes("Baixar ícone técnico"), "link 'Baixar ícone técnico' não deveria mais existir em /projetos");
  assert(!projetosPageSource.includes("Baixar fundo institucional"), "link 'Baixar fundo institucional' não deveria mais existir em /projetos");
  assert(!projetosPageSource.includes("INSTITUTIONAL_BACKGROUND_PNG_PATH"), "/projetos não deveria mais importar o caminho do PNG (não usa mais para link de download)");
});

check("/projetos: logo oficial ACC continua presente", () => {
  assert(projetosPageSource.includes("/branding/acc-logo.png"), "logo oficial não encontrado em /projetos");
});

check("/projetos: painel de conteúdo mantém fundo opaco/translúcido adequado — cartões e cabeçalho não ficam direto sobre o bordô", () => {
  assert(/bg-card/.test(projetosPageSource), "deveria haver um painel com bg-card envolvendo o conteúdo");
});

check("/projetos: botão de saída (logout) e lista de projetos continuam presentes", () => {
  assert(projetosPageSource.includes("LogoutButton"), "LogoutButton deveria continuar presente");
  assert(projetosPageSource.includes("getProjects"), "listagem de projetos deveria continuar presente");
});

check("assets de marca (logo/ícone técnico/fundo) continuam em apps/web/public/ mesmo sem link de download — o app ainda os usa internamente (favicon, <img>, background-image)", () => {
  assert(existsSync(absolutePath("apps/web/public/branding/acc-logo.png")), "acc-logo.png deveria continuar em public/branding/");
  assert(existsSync(absolutePath("apps/web/public/branding/acc-icon.svg")), "acc-icon.svg deveria continuar em public/branding/");
  assert(existsSync(absolutePath("apps/web/public/brand/acc-background-oficial.png")), "acc-background-oficial.png deveria continuar em public/brand/");
});

// --- Nenhuma rota interna do projeto recebeu o fundo por engano ---

check("nenhuma página/layout interna do projeto ([projectId]/**) referencia InstitutionalBackground", () => {
  const internalDir = absolutePath("apps/web/app/[projectId]");
  const offenders = [];
  function walk(dir) {
    for (const entry of readdirSyncSafe(dir)) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
        const content = readFileSync(full, "utf8");
        if (content.includes("InstitutionalBackground")) {
          offenders.push(path.relative(repoRoot, full));
        }
      }
    }
  }
  function readdirSyncSafe(dir) {
    return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : [];
  }
  walk(internalDir);
  assert(offenders.length === 0, `páginas internas não deveriam usar o fundo institucional: ${offenders.join(", ")}`);
});

check("layout raiz (apps/web/app/layout.tsx) não aplica o fundo globalmente", () => {
  const rootLayoutSource = readSource("apps/web/app/layout.tsx");
  assert(!rootLayoutSource.includes("InstitutionalBackground"), "o fundo deve ser por página (login/projetos), nunca no layout raiz compartilhado");
});

// --- Nenhuma alteração no OAuth/callback ---

check("apps/web/app/auth/callback/route.ts: não referencia o fundo institucional (fluxo OAuth intocado)", () => {
  const callbackSource = readSource("apps/web/app/auth/callback/route.ts");
  assert(!callbackSource.includes("InstitutionalBackground"), "callback OAuth não deveria ter sido tocado por esta feature");
});

check("apps/web/app/login/google-signin-button.tsx: não referencia o fundo institucional", () => {
  const googleButtonSource = readSource("apps/web/app/login/google-signin-button.tsx");
  assert(!googleButtonSource.includes("InstitutionalBackground"), "google-signin-button.tsx não deveria ter sido tocado");
});

// --- Faixa SISTEMA EM TESTE não foi alterada ---

check("faixa SISTEMA EM TESTE: nenhum arquivo desta feature a referencia/altera", () => {
  const testModeBannerSource = readSource("apps/web/components/layout/test-mode-banner.tsx");
  assert(
    /repeating-linear-gradient\(45deg,#facc15/.test(testModeBannerSource),
    "test-mode-banner.tsx deveria continuar com o gradiente diagonal amarelo/preto original"
  );
  for (const source of [backgroundComponentSource, loginPageSource, projetosPageSource]) {
    assert(!/SISTEMA EM TESTE/i.test(source), "esta feature não deveria mencionar/alterar a faixa SISTEMA EM TESTE");
  }
});

// (Dimensões/formato/cor predominante do PNG oficial já verificados de
// verdade, incondicionalmente, logo no início deste arquivo — o PNG
// oficial é um asset real sempre presente no repositório, não algo
// gerado opcionalmente numa etapa do build.)

// --- PARTE 2: cinza-claro entre cartões nas páginas internas ---

console.log("");
console.log("======================================");
console.log("CINZA-CLARO ENTRE CARTÕES (páginas internas autenticadas)");
console.log("======================================");
console.log("");

const workspaceLayoutSource = readSource("apps/web/app/[projectId]/layout.tsx");

check("[projectId]/layout.tsx: <main> usa bg-gray-100 (equivalente a #f3f4f6), aplicado centralmente (não por page.tsx)", () => {
  const mainMatch = workspaceLayoutSource.match(/<main[^>]*className="[^"]*"[^>]*>/);
  assert(mainMatch, "elemento <main> não encontrado em [projectId]/layout.tsx");
  assert(/\bbg-gray-100\b/.test(mainMatch[0]), `<main> deveria usar bg-gray-100: "${mainMatch[0]}"`);
});

check("TopBar (cabeçalho) continua bg-white — não afetado pelo cinza do <main>", () => {
  const topBarSource = readSource("apps/web/components/layout/top-bar.tsx");
  assert(/\bbg-white\b/.test(topBarSource), "TopBar deveria continuar com bg-white explícito");
});

check("AppSidebar continua bg-brand-sidebar (bordô) — não afetado pelo cinza do <main>", () => {
  const sidebarSource = readSource("apps/web/components/layout/app-sidebar.tsx");
  assert(/\bbg-brand-sidebar\b/.test(sidebarSource), "AppSidebar deveria continuar com bg-brand-sidebar explícito");
});

check("Card (cartões) continua bg-card (branco) — não foi tocado por esta mudança", () => {
  const cardSource = readSource("apps/web/components/ui/card.tsx");
  assert(/\bbg-card\b/.test(cardSource), "Card deveria continuar com bg-card explícito");
});

check("Table (tabelas soltas, ex.: auditoria/usuários) recebeu fundo branco explícito — não herda o cinza do <main>", () => {
  const tableSource = readSource("apps/web/components/ui/table.tsx");
  assert(/\bbg-card\b/.test(tableSource), "Table deveria ter um fundo explícito (bg-card) para não ficar cinza ao ser usada fora de um Card");
});

check("/login e /projetos NÃO recebem o cinza-claro (usam o fundo institucional, não o layout interno)", () => {
  assert(!/\bbg-gray-100\b/.test(loginPageSource), "/login não deveria usar bg-gray-100");
  assert(!/\bbg-gray-100\b/.test(projetosPageSource), "/projetos não deveria usar bg-gray-100");
});

check("faixa SISTEMA EM TESTE e layout raiz não referenciam o cinza-claro (mudança fica só dentro de [projectId]/layout.tsx)", () => {
  const rootLayoutSource = readSource("apps/web/app/layout.tsx");
  const testModeBannerSource = readSource("apps/web/components/layout/test-mode-banner.tsx");
  assert(!/\bbg-gray-100\b/.test(rootLayoutSource), "layout raiz não deveria ter ganhado bg-gray-100");
  assert(!/\bbg-gray-100\b/.test(testModeBannerSource), "faixa SISTEMA EM TESTE não deveria ter sido tocada");
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
