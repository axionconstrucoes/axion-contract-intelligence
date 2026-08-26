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

import { existsSync, readFileSync, readdirSync } from "node:fs";
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

const SVG_RELATIVE_PATH = "apps/web/public/brand/acc-burgundy-white-grid-background.svg";
const PNG_RELATIVE_PATH = "apps/web/public/brand/acc-burgundy-white-grid-background-1920x1080.png";
const SVG_PUBLIC_PATH = "/brand/acc-burgundy-white-grid-background.svg";
const PNG_PUBLIC_PATH = "/brand/acc-burgundy-white-grid-background-1920x1080.png";

const pngExists = existsSync(absolutePath(PNG_RELATIVE_PATH));

// --- Asset SVG existe e é o real fundo bordô/quadriculado ---

check("asset SVG do fundo institucional existe em apps/web/public/brand/", () => {
  assert(existsSync(absolutePath(SVG_RELATIVE_PATH)), `${SVG_RELATIVE_PATH} não encontrado`);
});

const svgSource = readSource(SVG_RELATIVE_PATH);

check("SVG: base bordô institucional (#7f1d1d — mesmo tom exato de --brand-sidebar)", () => {
  assert(/fill="#7f1d1d"/i.test(svgSource), "cor de base #7f1d1d não encontrada no SVG");
});

check("SVG: contém padrão de grade/quadriculado branco (pattern + stroke branco)", () => {
  assert(/<pattern[^>]*>/.test(svgSource), "nenhum <pattern> encontrado");
  assert(/stroke="#ffffff"/i.test(svgSource), "traço branco do quadriculado não encontrado");
});

check("SVG: grade de 48×48 px preservada", () => {
  assert(/<pattern[^>]*width="48"[^>]*height="48"/.test(svgSource), "pattern deveria continuar 48x48");
});

check("SVG: opacidade das linhas brancas ajustada para 16% (de ~7% anterior)", () => {
  assert(/stroke-opacity="0\.16"/.test(svgSource), 'esperado stroke-opacity="0.16" — reticulado deveria estar mais forte');
  assert(!/stroke-opacity="0\.0?7"/.test(svgSource), "opacidade antiga (0.07) não deveria mais estar presente");
});

check("SVG: sem texto, sem elementos de interface (só <svg>/<defs>/<pattern>/<path>/<rect>)", () => {
  assert(!/<text[\s>]/i.test(svgSource), "SVG não deveria conter elementos <text>");
  assert(!/<button|<input|<a\s/i.test(svgSource), "SVG não deveria conter elementos de interface");
});

check("SVG: proporção widescreen (16:9, 1920x1080)", () => {
  assert(/viewBox="0 0 1920 1080"/.test(svgSource), "viewBox 1920x1080 não encontrado");
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

check("institutional-background.tsx: usa o próprio asset SVG como background-image (fundo = arquivo baixável, sem duplicar implementação)", () => {
  assert(
    backgroundComponentSource.includes(SVG_PUBLIC_PATH),
    `deveria referenciar ${SVG_PUBLIC_PATH} como backgroundImage`
  );
  assert(/backgroundImage/.test(backgroundComponentSource), "deveria setar backgroundImage");
});

check("institutional-background.tsx: exporta os caminhos públicos do SVG e do PNG para reuso nos links de download", () => {
  assert(backgroundComponentSource.includes("INSTITUTIONAL_BACKGROUND_SVG_PATH"), "constante do caminho SVG não exportada");
  assert(backgroundComponentSource.includes("INSTITUTIONAL_BACKGROUND_PNG_PATH"), "constante do caminho PNG não exportada");
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

check("/login: tem link de download do fundo institucional, com atributo download, apontando para o SVG real", () => {
  const linkMatch = loginPageSource.match(/<a[^>]*href=\{INSTITUTIONAL_BACKGROUND_SVG_PATH\}[^>]*>/);
  assert(linkMatch, "link de download do fundo institucional não encontrado em /login");
  assert(/\bdownload\b/.test(linkMatch[0]), "link deveria ter o atributo download");
});

check("/login: link de download não abre em nova aba nem usa URL assinada/externa (mesma origem, caminho estático em /brand/)", () => {
  assert(!loginPageSource.includes("target=\"_blank\""), "não deveria abrir em nova aba");
  assert(!/signedUrl|storage\.from\(|createSignedUrl/i.test(loginPageSource), "não deveria expor Storage/URL assinada");
});

check("/login: botão Google e formulário de login permanecem intactos (autenticação não alterada)", () => {
  assert(loginPageSource.includes('from "./actions"') && loginPageSource.includes("login"), "action de login não deveria ter sido removida");
  assert(
    loginPageSource.includes('from "./google-signin-button"') && loginPageSource.includes("GoogleSignInButton"),
    "GoogleSignInButton deveria continuar presente"
  );
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

check("/projetos: tem link de download do fundo institucional (SVG), com atributo download", () => {
  const linkMatch = projetosPageSource.match(/<a[^>]*href=\{INSTITUTIONAL_BACKGROUND_SVG_PATH\}[^>]*>/);
  assert(linkMatch, "link de download do fundo institucional (SVG) não encontrado em /projetos");
  assert(/\bdownload\b/.test(linkMatch[0]), "link deveria ter o atributo download");
});

check("/projetos: logo oficial ACC continua presente", () => {
  assert(projetosPageSource.includes("/branding/acc-logo.png"), "logo oficial não encontrado em /projetos");
});

check("/projetos: painel de conteúdo mantém fundo opaco/translúcido adequado — cartões e cabeçalho não ficam direto sobre o bordô", () => {
  assert(/bg-card/.test(projetosPageSource), "deveria haver um painel com bg-card envolvendo o conteúdo");
});

if (pngExists) {
  check("/projetos: também oferece 'Baixar fundo em PNG' apontando para o PNG real", () => {
    const linkMatch = projetosPageSource.match(/<a[^>]*href=\{INSTITUTIONAL_BACKGROUND_PNG_PATH\}[^>]*>/);
    assert(linkMatch, "link de download do fundo em PNG não encontrado em /projetos");
    assert(/\bdownload\b/.test(linkMatch[0]), "link do PNG deveria ter o atributo download");
  });
}

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

check("apps/web/app/login/google-signin-button.tsx e login/actions.ts: não referenciam o fundo institucional", () => {
  const googleButtonSource = readSource("apps/web/app/login/google-signin-button.tsx");
  const actionsSource = readSource("apps/web/app/login/actions.ts");
  assert(!googleButtonSource.includes("InstitutionalBackground"), "google-signin-button.tsx não deveria ter sido tocado");
  assert(!actionsSource.includes("InstitutionalBackground"), "login/actions.ts não deveria ter sido tocado");
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

// --- PNG (se existir): dimensões corretas e arquivo abre normalmente ---

if (pngExists) {
  await checkAsync("PNG do fundo institucional: 1920x1080, formato PNG válido, abre corretamente", async () => {
    const sharp = (await import("sharp")).default;
    const metadata = await sharp(absolutePath(PNG_RELATIVE_PATH)).metadata();
    assert(metadata.format === "png", `formato deveria ser png, encontrado ${metadata.format}`);
    assert(metadata.width === 1920, `largura deveria ser 1920, encontrada ${metadata.width}`);
    assert(metadata.height === 1080, `altura deveria ser 1080, encontrada ${metadata.height}`);
  });

  await checkAsync("PNG: reticulado regenerado a partir do SVG atualizado (linha visivelmente mais forte que o 7% anterior)", async () => {
    const sharp = (await import("sharp")).default;
    const y = 500;
    const { data, info } = await sharp(absolutePath(PNG_RELATIVE_PATH))
      .extract({ left: 900, top: y, width: 200, height: 1 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    let peakGreen = 0;
    for (let x = 0; x < info.width; x++) {
      peakGreen = Math.max(peakGreen, data[x * 4 + 1]);
    }
    // Base bordô puro tem G=29; a 7% (versão anterior) a linha chegava a
    // G≈37; a 16% chega a G≈47. Faixa com folga dos dois lados para não
    // ser frágil a diferenças de 1-2 níveis entre renderizações, mas
    // ainda incapaz de passar com a opacidade antiga.
    assert(
      peakGreen >= 42 && peakGreen <= 55,
      `pico de verde na linha de grade deveria refletir ~16% de opacidade (G entre 42-55), encontrado G=${peakGreen} — PNG pode não ter sido regenerado a partir do SVG atualizado`
    );
  });
} else {
  console.log("INFO PNG não gerado nesta etapa — checagens de PNG puladas (SVG é obrigatório, PNG é opcional).");
}

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
