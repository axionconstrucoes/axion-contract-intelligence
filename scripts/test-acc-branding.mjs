// Testes de identidade visual ACC (logo, favicon, cabeçalho padrão de
// todas as telas, browser title, projeto próximo ao cabeçalho,
// responsividade estrutural). Lógica pura testada de verdade
// (mapProjectRow); presença de marcação/assets verificada
// estruturalmente (sem framework de DOM neste projeto — mesmo
// princípio de toda a suíte). NUNCA chama a API Anthropic — este
// pacote é só branding/UI.
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/test-acc-branding.mjs

import { existsSync, readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const { mapProjectRow } = await import("../apps/web/lib/project-mapper");
const { EXPERT_PROVIDER_ENV_VAR } = await import("../apps/web/lib/ai/providers/resolve-provider-for-expert");

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
function readSource(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}
function fileExists(relativePath) {
  return existsSync(path.join(repoRoot, relativePath));
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

const ALL_PROVIDER_ENV_VARS = [...Object.values(EXPERT_PROVIDER_ENV_VAR), "AXION_AI_PROVIDER"];
const originalProviderEnv = Object.fromEntries(ALL_PROVIDER_ENV_VARS.map((name) => [name, process.env[name]]));
for (const name of ALL_PROVIDER_ENV_VARS) process.env[name] = "fake";
function restoreProviderEnv() {
  for (const name of ALL_PROVIDER_ENV_VARS) {
    if (originalProviderEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalProviderEnv[name];
  }
}

console.log("");
console.log("======================================");
console.log("IDENTIDADE VISUAL ACC — TESTES");
console.log("======================================");
console.log("");

// ---------------- 1. Logo / assets ----------------

check("assets: logo e ícone ACC existem em apps/web/public/branding/", () => {
  assert(fileExists("apps/web/public/branding/acc-logo.svg"), "acc-logo.svg ausente");
  assert(fileExists("apps/web/public/branding/acc-icon.svg"), "acc-icon.svg ausente");
});

check("logo: fundo vermelho escuro, texto ACC branco (nunca sólido claro/AXION)", () => {
  const logo = readSource("apps/web/public/branding/acc-logo.svg");
  assert(/fill="#7f1d1d"/i.test(logo), "logo deveria ter fundo vermelho escuro (#7f1d1d)");
  assert(/fill="#ffffff"/i.test(logo), "texto do logo deveria ser branco");
  assert(/>ACC</.test(logo), "logo deveria mostrar o texto ACC");
  assert(!/AXION/.test(logo), "logo nunca deveria conter o texto AXION — só o logo AXION é proibido, não a marca ACC");
});

check("ícone: fundo vermelho escuro, ACC branco, formato quadrado", () => {
  const icon = readSource("apps/web/public/branding/acc-icon.svg");
  assert(/fill="#7f1d1d"/i.test(icon));
  assert(/fill="#ffffff"/i.test(icon));
  assert(/viewBox="0 0 64 64"/.test(icon), "ícone deveria ter proporção quadrada");
});

check("logo e ícone usam a MESMA cor institucional (consistência entre os dois assets)", () => {
  const logo = readSource("apps/web/public/branding/acc-logo.svg");
  const icon = readSource("apps/web/public/branding/acc-icon.svg");
  const logoFill = logo.match(/fill="(#[0-9a-f]{6})"/i)[1];
  const iconFill = icon.match(/fill="(#[0-9a-f]{6})"/i)[1];
  assert(logoFill.toLowerCase() === iconFill.toLowerCase(), `logo (${logoFill}) e ícone (${iconFill}) deveriam usar a mesma cor institucional`);
});

// ---------------- 2. Favicon / metadata raiz ----------------

check("layout raiz: favicon aponta para o ícone ACC; título usa template 'ACC | %s'", () => {
  const source = readSource("apps/web/app/layout.tsx");
  assert(source.includes('icons: { icon: "/branding/acc-icon.svg" }'), "metadata.icons deveria apontar para o ícone ACC");
  assert(source.includes('template: "ACC | %s"'), "título deveria usar o template 'ACC | %s'");
  assert(!/axion-contract-intelligence/i.test(source), "nunca deveria expor o nome técnico do repositório no título");
});

// ---------------- 3. Logo AXION nunca exibido ----------------

check("logo AXION nunca é exibido em lugar nenhum: nenhum <img>/<svg> referencia um asset 'axion-logo' ou similar", () => {
  const files = [
    "apps/web/components/layout/app-sidebar.tsx",
    "apps/web/app/login/page.tsx",
    "apps/web/app/projetos/page.tsx",
  ];
  for (const file of files) {
    const source = readSource(file);
    assert(!/axion-logo|axion\.svg|axion\.png|axion-icon/i.test(source), `${file} não deveria referenciar nenhum asset de logo AXION`);
  }
});

// ---------------- 4. Sidebar ----------------

check("sidebar: ícone ACC sempre visível (expandida e recolhida) — fora do bloco condicional de collapsed", () => {
  const source = readSource("apps/web/components/layout/app-sidebar.tsx");
  const headerBlockMatch = source.match(/flex h-14 items-center gap-2 border-b[\s\S]*?<\/div>\s*\n\s*<nav/);
  assert(headerBlockMatch, "bloco de cabeçalho da sidebar não encontrado");
  const headerBlock = headerBlockMatch[0];
  // Logo ACC oficial (PNG) — substitui o placeholder acc-icon.svg (ACC —
  // AJUSTES FINAIS APROVADOS DO DASHBOARD VISUAL, seção 2/3: logo ACC
  // aparece SOMENTE aqui, na sidebar).
  assert(headerBlock.includes('src="/branding/acc-logo.png"'), "logo ACC deveria estar presente no cabeçalho da sidebar");
  assert(!/\{!collapsed &&[\s\S]*?acc-logo\.png/.test(headerBlock), "o logo nunca deveria estar dentro do bloco condicional 'apenas quando expandida'");
});

check("sidebar: texto 'AXION Controle de Contratos' só aparece quando expandida (nunca na recolhida)", () => {
  const source = readSource("apps/web/components/layout/app-sidebar.tsx");
  assert(/\{!collapsed &&[\s\S]{0,260}AXION Controle de Contratos/.test(source), "wordmark deveria estar condicionado a !collapsed");
});

// ---------------- 5. Login ----------------

check("login: logo ACC presente, texto atualizado para 'AXION Controle de Contratos'", () => {
  const source = readSource("apps/web/app/login/page.tsx");
  assert(source.includes('src="/branding/acc-logo.png"'));
  assert(source.includes("AXION Controle de Contratos"));
  assert(source.includes('title: "Login"'));
});

// ---------------- 6. Download de logo/ícone ----------------

check("projetos: opções de download de logotipo e ícone existem, apontam para os arquivos reais", () => {
  const source = readSource("apps/web/app/projetos/page.tsx");
  assert(source.includes('href="/branding/acc-logo.png"') && source.includes("download"), "deveria existir link de download do logotipo");
  assert(source.includes('href="/branding/acc-icon.svg"') && source.includes("download"), "deveria existir link de download do ícone técnico");
});

// ---------------- 7. Cabeçalho padrão de todas as telas ----------------

const pageHeaderSource = readSource("apps/web/components/layout/page-header.tsx");

// REDESIGN VISUAL PREMIUM (2026-08-24) — AJUSTES APROVADOS: o prefixo
// "AXION CONTROLE DE CONTRATOS" repetido em preto/negrito em toda tela
// (antes bloco único com travessão) foi substituído por um eyebrow
// discreto (muted-foreground, uppercase via CSS) acima do título da
// página — o nome da aba continua vermelho-institucional, agora como
// h1 de destaque (hierarquia executiva, seção 5/7 do redesign). O
// título usa text-brand-sidebar (o mesmo token de cor da sidebar, não
// mais um vermelho hardcoded) — pedido explícito do usuário: título de
// página e sidebar nunca podem divergir de cor.
check("PageHeader: eyebrow institucional discreto acima do título; nome da aba na MESMA cor da sidebar (h1 de destaque)", () => {
  assert(pageHeaderSource.includes("AXION Controle de Contratos"));
  assert(/text-muted-foreground[\s\S]{0,40}AXION Controle de Contratos/.test(pageHeaderSource), "eyebrow institucional deveria ser discreto (muted-foreground)");
  assert(/text-brand-sidebar[\s\S]{0,20}\{title\}/.test(pageHeaderSource), "nome da aba deveria usar o mesmo token de cor da sidebar (text-brand-sidebar)");
  assert(pageHeaderSource.includes("font-semibold"), "título da página deveria ser negrito/semibold");
});

check("PageHeader usa a MESMA variável de cor da sidebar (text-brand-sidebar) — título e sidebar nunca divergem", () => {
  assert(pageHeaderSource.includes("text-brand-sidebar"));
});

const ALL_15_PAGES = [
  "apps/web/app/[projectId]/acoes/page.tsx",
  "apps/web/app/[projectId]/action-requests/page.tsx",
  "apps/web/app/[projectId]/adicionais/page.tsx",
  "apps/web/app/[projectId]/auditoria/page.tsx",
  "apps/web/app/[projectId]/dashboard/page.tsx",
  "apps/web/app/[projectId]/documentos/page.tsx",
  "apps/web/app/[projectId]/esg/page.tsx",
  "apps/web/app/[projectId]/experts-ia/page.tsx",
  "apps/web/app/[projectId]/integracoes/page.tsx",
  "apps/web/app/[projectId]/ledger/page.tsx",
  "apps/web/app/[projectId]/revisao-clausulas/page.tsx",
  "apps/web/app/[projectId]/revisao-contratual/page.tsx",
  "apps/web/app/[projectId]/startup/page.tsx",
  "apps/web/app/[projectId]/timeline/page.tsx",
  "apps/web/app/[projectId]/usuarios/page.tsx",
];

check(`cabeçalho padronizado: as ${ALL_15_PAGES.length} páginas principais usam <PageHeader (nenhum <h1> avulso reimplementado)`, () => {
  for (const file of ALL_15_PAGES) {
    const source = readSource(file);
    assert(source.includes("<PageHeader"), `${file} deveria usar o componente PageHeader compartilhado`);
    assert(source.includes('from "@/components/layout/page-header"'), `${file} deveria importar PageHeader`);
  }
});

// ---------------- 8. Browser tab title ----------------

check(`browser title: as ${ALL_15_PAGES.length} páginas principais + login + projetos definem metadata.title curto (nunca o nome técnico do repositório)`, () => {
  const allPages = [...ALL_15_PAGES, "apps/web/app/login/page.tsx", "apps/web/app/projetos/page.tsx"];
  for (const file of allPages) {
    const source = readSource(file);
    assert(/export const metadata: Metadata = \{ title: "[^"]+"\s*\}/.test(source), `${file} deveria exportar metadata.title`);
    assert(!/axion-contract-intelligence|apps\/web/i.test(source.match(/export const metadata[^;]+;/)?.[0] ?? ""), `${file}: título nunca deveria expor o nome técnico do repositório`);
  }
});

// ---------------- 9. Projeto próximo ao cabeçalho (nome + código) ----------------

check("Project.code: mapeado de verdade a partir da linha do banco (mapProjectRow), nunca descartado", () => {
  const project = mapProjectRow({
    id: "proj-1",
    code: "ARN-2025-001",
    name: "Arena Multiuso",
    client: "Prefeitura X",
    status: "ATIVO",
    location: "Itaguaí, RJ",
    contract_number: "CT-1",
    start_date: "2025-01-01",
    baseline_end_date: "2026-01-01",
  });
  assert(project.code === "ARN-2025-001", `code deveria ser mapeado, obtido: ${project.code}`);
});

check("TopBar: mostra o código do projeto discretamente próximo ao seletor (quando disponível)", () => {
  const source = readSource("apps/web/components/layout/top-bar.tsx");
  assert(source.includes("currentProject?.code"), "TopBar deveria exibir o código do projeto quando disponível");
  // REDESIGN VISUAL PREMIUM (2026-08-24): TopBar deixou de ser uma área
  // vermelha sólida grande (seção 1 do redesign — "não através de
  // grandes áreas saturadas de cor") e passou a ser clara/neutra, com o
  // vermelho institucional reservado a acentos (logo, título de página,
  // estado ativo da sidebar). Código do projeto agora discreto sobre
  // fundo claro (muted-foreground), não mais branco translúcido.
  assert(source.includes("text-xs text-muted-foreground"), "código deveria ser discreto sobre o header claro");
});

// ---------------- 9b. REDESIGN VISUAL PREMIUM (2026-08-24) — AJUSTES APROVADOS ----------------

check("header: identidade 'AXION' em destaque + 'Controle de Contratos' discreto, sobre header claro (não mais barra vermelha sólida com texto branco)", () => {
  const source = readSource("apps/web/components/layout/top-bar.tsx");
  assert(/font-semibold[^"]*text-foreground">\s*AXION/.test(source), "AXION deveria continuar em destaque (semibold) no header");
  assert(source.includes("Controle de Contratos"), "nome completo do produto deveria continuar presente no header");
});

check("nome do projeto: cor neutra de alto contraste sobre o header claro (nunca mais amarelo sobre vermelho — combinação abandonada no redesign premium)", () => {
  const source = readSource("apps/web/components/layout/project-switcher.tsx");
  assert(!/text-yellow-\d{3}/.test(source), "seletor de projeto não deveria mais usar amarelo (header deixou de ser vermelho sólido)");
  assert(source.includes("font-semibold") || source.includes("font-bold"), "nome do projeto deveria continuar com peso visual (semibold/bold)");
});

check("logo ACC aparece SOMENTE na sidebar — nunca na área branca de conteúdo, ao lado de títulos de página, em cards, ou como decoração do Dashboard Visual", () => {
  const sidebarSource = readSource("apps/web/components/layout/app-sidebar.tsx");
  assert(sidebarSource.includes('src="/branding/acc-logo.png"'), "a sidebar é o único lugar onde o logo ACC deveria aparecer no app");

  const noLogoFiles = [
    "apps/web/components/layout/page-header.tsx",
    "apps/web/app/[projectId]/dashboard/page.tsx",
    "apps/web/app/[projectId]/dashboard/visual/page.tsx",
    "apps/web/components/dashboard/dashboard-visual-entry-card.tsx",
    "apps/web/components/dashboard-visual/summary-cards.tsx",
    "apps/web/components/dashboard-visual/contract-value-card.tsx",
    "apps/web/components/dashboard-visual/deadline-card.tsx",
    "apps/web/components/dashboard-visual/source-volume-table.tsx",
    "apps/web/components/dashboard-visual/experts-cards.tsx",
  ];
  for (const file of noLogoFiles) {
    const source = readSource(file);
    assert(!/acc-logo\.(png|svg)/.test(source), `${file} não deveria referenciar o logo ACC (área de conteúdo/cards do app)`);
  }
});

check("card de acesso ao Dashboard Visual: usa o ícone real (dashboard-visual.png), sem nenhum fallback Lucide", () => {
  const source = readSource("apps/web/components/dashboard/dashboard-visual-entry-card.tsx");
  assert(source.includes('src="/branding/dashboard-visual.png"'), "card deveria usar o ícone real dashboard-visual.png");
  assert(!/from ["']lucide-react["']/.test(source), "não deveria mais importar nenhum ícone Lucide como substituto");
  assert(!source.includes("LayoutDashboard"), "fallback LayoutDashboard deveria ter sido removido definitivamente");
});

// ---------------- 10. revisao-clausulas: corrige o bug de <main> duplicado ----------------

check("revisao-clausulas: nunca mais um <main> duplicado dentro do <main> já fornecido pelo layout (bug corrigido)", () => {
  const source = readSource("apps/web/app/[projectId]/revisao-clausulas/page.tsx");
  assert(!/<main\b/.test(source), "página não deveria mais renderizar seu próprio <main> (o layout já fornece um)");
  assert(!/<\/main>/.test(source));
});

// ---------------- 11. Sem biblioteca nova instalada ----------------

check("nenhuma biblioteca nova foi instalada para branding (só SVG estático + componente próprio)", () => {
  const packageJson = readSource("apps/web/package.json");
  for (const lib of ["react-svg", "next-seo", "favicons", "@vercel/og"]) {
    assert(!packageJson.includes(`"${lib}"`), `não deveria ter instalado ${lib}`);
  }
});

// ---------------- 12. Responsividade estrutural (sem framework de DOM) ----------------

check("cabeçalho responsivo: PageHeader nunca força largura fixa/overflow horizontal (sem whitespace-nowrap forçado no título)", () => {
  assert(!/whitespace-nowrap/.test(pageHeaderSource), "título não deveria forçar nowrap (permitir quebra em telas estreitas)");
});

// REDESIGN VISUAL PREMIUM (2026-08-24): logo aumentado em 20% a pedido
// do usuário (size-7/28px → 33.6px) — continua um tamanho FIXO em
// pixels (nunca um valor relativo/percentual), então a regra original
// ("nunca deforma ao encolher a sidebar") continua valendo.
check("sidebar: logo/ícone tem tamanho fixo em pixels (33.6px, +20% sobre o tamanho anterior) — nunca deforma ao encolher a sidebar", () => {
  const source = readSource("apps/web/components/layout/app-sidebar.tsx");
  assert(/className="size-\[33\.6px\] shrink-0/.test(source), "ícone deveria ter tamanho fixo em pixels e shrink-0 (nunca deformar)");
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

restoreProviderEnv();

if (failed > 0) {
  process.exit(1);
}
