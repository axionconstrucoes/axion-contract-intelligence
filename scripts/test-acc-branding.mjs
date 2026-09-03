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

check("layout raiz: favicon aponta para o ícone ACC (SVG + derivados PNG de favicon real, substituiu o SVG único original); título usa template 'ACC | %s'", () => {
  const source = readSource("apps/web/app/layout.tsx");
  assert(source.includes('{ url: "/branding/acc-icon.svg", type: "image/svg+xml" }'), "metadata.icons deveria continuar apontando para o ícone SVG ACC");
  assert(source.includes("acc-favicon-32x32.png") && source.includes("acc-favicon-16x16.png") && source.includes("acc-favicon-48x48.png"), "metadata.icons deveria incluir os favicons PNG derivados (redimensionamento do logo oficial, ver scripts/test-branding-startup-actions-sla.mjs)");
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
//
// AJUSTE DE POSICIONAMENTO DO CABEÇALHO (imagem anotada por Reynaldo,
// aprovada): o nome por extenso da marca sai da sidebar e passa a
// viver centralizado no cabeçalho superior (ver seção 9b/TopBar
// abaixo) — a sidebar mantém só o símbolo, sempre centralizado e
// sempre visível (expandida OU recolhida, nunca mais condicionado a
// !collapsed). Os 2 checks abaixo substituem os antigos, que ainda
// validavam o texto condicional na sidebar.

check("sidebar: ícone ACC sempre visível e centralizado (expandida e recolhida) — fora de qualquer bloco condicional de collapsed", () => {
  const source = readSource("apps/web/components/layout/app-sidebar.tsx");
  const headerBlockMatch = source.match(/<div className="flex h-14 items-center justify-center border-b[\s\S]*?<\/div>/);
  assert(headerBlockMatch, "bloco de cabeçalho da sidebar (logo centralizado) não encontrado");
  const headerBlock = headerBlockMatch[0];
  // Logo ACC oficial (PNG) — logo ACC aparece SOMENTE aqui, na sidebar.
  assert(headerBlock.includes('src="/branding/acc-logo.png"'), "logo ACC deveria estar presente no cabeçalho da sidebar");
  assert(!/\{!collapsed/.test(headerBlock), "o logo nunca deveria estar dentro de nenhum bloco condicional de collapsed — sempre visível");
  assert(headerBlock.includes("justify-center"), "o logo deveria estar centralizado horizontalmente na largura da sidebar");
});

check("sidebar: NUNCA mais exibe o nome por extenso da marca — ele vive só no cabeçalho superior agora (evita duplicar a mesma informação em dois lugares)", () => {
  const source = readSource("apps/web/components/layout/app-sidebar.tsx");
  assert(!/AXION Controle de Contratos/i.test(source), "a sidebar não deveria mais exibir o texto do nome da marca — só o símbolo");
});

// ---------------- 5. Login ----------------

check("login: logo ACC presente, texto atualizado para 'AXION Controle de Contratos'", () => {
  const source = readSource("apps/web/app/login/page.tsx");
  assert(source.includes('src="/branding/acc-logo.png"'));
  assert(source.includes("AXION Controle de Contratos"));
  assert(source.includes('title: "Login"'));
});

// ---------------- 6. Download de logo/ícone ----------------

check("projetos: NÃO tem mais links públicos de download de logotipo/ícone/fundo — removidos intencionalmente (ACC é Google-only); os assets continuam em public/ para uso interno do app (favicon, <img>, background-image)", () => {
  const source = readSource("apps/web/app/projetos/page.tsx");
  assert(!source.includes("Baixar logotipo"), "link de download do logotipo não deveria mais existir em /projetos");
  assert(!source.includes("Baixar ícone técnico"), "link de download do ícone técnico não deveria mais existir em /projetos");
  assert(fileExists("apps/web/public/branding/acc-logo.png"), "acc-logo.png deveria continuar em public/branding/ mesmo sem link de download");
  assert(fileExists("apps/web/public/branding/acc-icon.svg"), "acc-icon.svg deveria continuar em public/branding/ mesmo sem link de download");
});

// ---------------- 7. Cabeçalho padrão de todas as telas ----------------

const pageHeaderSource = readSource("apps/web/components/layout/page-header.tsx");

check("PageHeader: NÃO repete mais 'AXION CONTROLE DE CONTRATOS — ' (a marca já aparece uma única vez, na sidebar — repeti-la em todo cabeçalho de página era redundante); só o nome da aba, vermelho-institucional/negrito, +1 corpo (text-xl)", () => {
  assert(!pageHeaderSource.includes("AXION CONTROLE DE CONTRATOS"), "PageHeader não deveria mais repetir o nome da marca — só a sidebar mantém");
  assert(/text-red-900[\s\S]{0,20}\{title\}/.test(pageHeaderSource), "nome da aba deveria ser vermelho institucional");
  assert(pageHeaderSource.includes("font-bold") && pageHeaderSource.includes("text-xl"), "cabeçalho deveria ser negrito e um corpo maior (text-xl)");
});

check("PageHeader usa a MESMA cor institucional do logo/ícone (red-900 ~ #7f1d1d, consistência de marca)", () => {
  // Tailwind red-900 = #7f1d1d — mesma família de vermelho institucional usada no SVG.
  assert(pageHeaderSource.includes("text-red-900"));
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

// ---------------- 9b. POSICIONAMENTO DO CABEÇALHO (rodada "imagem anotada") ----------------
//
// Uma rodada anterior tinha uma decisão final que rejeitava reintroduzir
// o título da marca na TopBar (título só na sidebar). Reynaldo revisou
// essa decisão numa imagem anotada: agora é o INVERSO — o texto por
// extenso "AXION Controle de Contratos" centralizado no cabeçalho
// superior, e a sidebar mantém só o símbolo (ver seção 4 acima). Estes
// checks substituem os antigos (que validavam a decisão anterior) para
// validar a decisão atual real.

check("TopBar: compacta (h-14 a partir de sm), fundo branco, mostra o código do projeto discretamente (mesmo texto/contraste já existente, nunca reescrito para um header vermelho)", () => {
  const source = readSource("apps/web/components/layout/top-bar.tsx");
  assert(source.includes("h-14"), "TopBar deveria continuar compacta (h-14) a partir de sm");
  assert(source.includes("bg-white"), "TopBar deveria continuar com fundo branco (decisão institucional — não vermelho)");
  assert(source.includes("currentProject?.code"), "TopBar deveria exibir o código do projeto quando disponível");
  assert(source.includes("text-xs text-muted-foreground"), "código do projeto deveria manter o contraste discreto já existente");
});

check("TopBar: exibe 'AXION Controle de Contratos' centralizado, em UMA única linha (truncate, nunca quebra), sem duplicar a marca em nenhum outro lugar da tela", () => {
  const topBarSource = readSource("apps/web/components/layout/top-bar.tsx");
  assert(/AXION Controle de Contratos/.test(topBarSource), "TopBar deveria exibir o nome da marca por extenso, centralizado");
  assert(topBarSource.includes("text-center"), "o título deveria estar centralizado (text-center)");
  assert(topBarSource.includes("truncate"), "o título deveria truncar em vez de quebrar linha (uma única linha em desktop)");
  assert((topBarSource.match(/AXION Controle de Contratos/g) ?? []).length === 1, "o texto da marca deveria aparecer exatamente uma vez na TopBar — nunca duplicado");
  assert(!topBarSource.includes("bg-brand-header"), "TopBar não deveria usar o token de header vermelho — fundo branco é a decisão institucional");

  const sidebarSource = readSource("apps/web/components/layout/app-sidebar.tsx");
  const pageHeaderSource2 = readSource("apps/web/components/layout/page-header.tsx");
  assert(!/AXION Controle de Contratos/i.test(sidebarSource), "a marca por extenso não deveria mais aparecer na sidebar (só o símbolo)");
  assert(!/AXION Controle de Contratos/i.test(pageHeaderSource2), "a marca por extenso não deveria aparecer no PageHeader — só na TopBar");
});

check("TopBar: título realmente centralizado via CSS Grid (1fr auto 1fr) — nunca 'no meio do espaço sobrando' de um flexbox simples, que se desloca conforme a largura do grupo da direita", () => {
  const source = readSource("apps/web/components/layout/top-bar.tsx");
  assert(source.includes("grid-cols-[1fr_auto_1fr]"), "TopBar deveria usar grid de 3 colunas (1fr auto 1fr) para centralizar o título de verdade em telas sm+");
});

check("TopBar: canto direito na ordem aprovada — seletor de projeto, código, número do contrato (quando existir), avatar, botão de sair; seletor+código+contrato formam um único agrupamento visual compacto", () => {
  const topBarSource = readSource("apps/web/components/layout/top-bar.tsx");
  assert(topBarSource.includes("<ProjectSwitcher"), "TopBar deveria continuar com o seletor de projeto");
  // Restaurado: a correção que removia este chip NÃO foi autorizada — o
  // número do contrato precisa continuar visível (discreto, condicional
  // a existir) no agrupamento da direita, entre o código e o avatar.
  assert(topBarSource.includes("currentProject?.contractNumber"), "TopBar deveria continuar mostrando o número do contrato quando existir — remoção não autorizada");
  assert(topBarSource.includes("<Avatar>"), "TopBar deveria continuar com o avatar do usuário");
  assert(topBarSource.includes("<LogoutButton"), "TopBar deveria continuar com o botão de sair");

  const switcherIndex = topBarSource.indexOf("<ProjectSwitcher");
  const codeIndex = topBarSource.indexOf("currentProject?.code");
  const contractIndex = topBarSource.indexOf("currentProject?.contractNumber");
  const avatarIndex = topBarSource.indexOf("<Avatar>");
  const logoutIndex = topBarSource.indexOf("<LogoutButton");
  assert(
    switcherIndex < codeIndex && codeIndex < contractIndex && contractIndex < avatarIndex && avatarIndex < logoutIndex,
    "a ordem no markup deveria ser seletor, código, contrato, avatar, sair — a mesma ordem visual aprovada"
  );

  // Nunca "hidden"/display:none — só truncamento/quebra controlada.
  assert(!/contractNumber[\s\S]{0,40}\bhidden\b/.test(topBarSource), "o número do contrato nunca deveria ser escondido definitivamente (classe hidden) — só truncar/quebrar");

  const switcherSource = readSource("apps/web/components/layout/project-switcher.tsx");
  assert(!/text-yellow-\d{3}/.test(switcherSource), "nome do projeto não deveria usar amarelo — exploração abandonada, nunca implementada de verdade");
  assert(switcherSource.includes("font-bold"), "nome do projeto deveria manter o negrito já existente");
});

check("TopBar: seletor de projeto trunca nomes longos com reticências e expõe tooltip acessível (title) com o nome completo", () => {
  const switcherSource = readSource("apps/web/components/layout/project-switcher.tsx");
  assert(switcherSource.includes("truncate"), "o seletor deveria truncar nomes longos (reticências) em vez de forçar overflow/rolagem horizontal");
  assert(switcherSource.includes("title={currentProject?.name}"), "o seletor deveria expor o nome completo do projeto via title (tooltip acessível nativo) quando truncado");
});

check("faixa global 'SISTEMA EM TESTE' continua acima de tudo (root layout), nunca duplicada dentro da TopBar", () => {
  const rootLayoutSource = readSource("apps/web/app/layout.tsx");
  assert(rootLayoutSource.includes("<TestModeBanner"), "a faixa deveria continuar renderizada no layout raiz, acima da TopBar");
  const topBarSource = readSource("apps/web/components/layout/top-bar.tsx");
  assert(!topBarSource.includes("TestModeBanner"), "a TopBar não deveria renderizar sua própria cópia da faixa");
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

check("sidebar: logo/ícone tem tamanho fixo pequeno (size-7) — nunca deforma ao encolher a sidebar", () => {
  const source = readSource("apps/web/components/layout/app-sidebar.tsx");
  assert(/className="size-7 shrink-0/.test(source), "ícone deveria ter tamanho fixo e shrink-0 (nunca deformar)");
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

restoreProviderEnv();

if (failed > 0) {
  process.exit(1);
}
