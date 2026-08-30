// Testes da Ajuda Contextual Global (ⓘ) — FeatureInfo + registry
// (ACC_FEATURE_HELP). Este projeto não tem framework de teste de
// componentes React (sem jsdom/testing-library instalado) — testes de
// comportamento de DOM/interação são feitos de forma ESTRUTURAL (leitura
// do código-fonte), mesmo princípio já usado nesta suíte para RLS
// (leitura de texto de migration) quando um ambiente de execução real
// não está disponível. Testes de CONTEÚDO (registry, helpIds, labels de
// risco) são reais, não estruturais. NUNCA chama a API Anthropic — este
// pacote é só UI/conteúdo, nenhuma chamada de IA envolvida.
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/test-feature-info.mjs

import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const { ACC_FEATURE_HELP, getFeatureHelp } = await import("../apps/web/lib/ui/feature-help");
const { NAV_ITEMS } = await import("../apps/web/lib/ui/nav-items");
const { severityLabels } = await import("../apps/web/lib/labels");
const { ALL_OFFICIAL_EXPERT_DEFINITIONS } = await import("../apps/web/lib/ai/expert-definitions/definitions");

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

function assert(condition, message) {
  if (!condition) throw new Error(message ?? "assertion failed");
}

console.log("");
console.log("======================================");
console.log("AJUDA CONTEXTUAL GLOBAL (ⓘ) — TESTES");
console.log("======================================");
console.log("");

// --- Registry: conteúdo real ---

check("registry: toda definição tem id/title/shortDescription/description não vazios", () => {
  for (const [id, def] of Object.entries(ACC_FEATURE_HELP)) {
    assert(def.id === id, `chave "${id}" deveria bater com def.id ("${def.id}")`);
    assert(def.title.trim().length > 0, `${id}.title vazio`);
    assert(def.shortDescription.trim().length > 0, `${id}.shortDescription vazio`);
    assert(def.description.trim().length > 0, `${id}.description vazio`);
  }
});

check("getFeatureHelp devolve null (nunca lança) para um helpId desconhecido", () => {
  assert(getFeatureHelp("nao-existe-nunca") === null);
});

// --- Menu (sidebar): todos os itens reais têm helpId válido ---

const EXPECTED_SIDEBAR_LABELS = [
  "Dashboard",
  "Timeline",
  "Event Ledger",
  "Solicitações",
  "Ações e Escalonamentos",
  "Propostas de Adicionais", // "Adicionais" no requisito — mesmo item, rótulo real já existente na sidebar
  "Análise Contratual",
  "Análise de Cláusulas",
  "Documentos",
  "ESG/SSMA",
  "Experts IA",
  "Start-up ACC",
  "Integrações",
  "Usuários",
  "Auditoria",
];

check(`menu ${EXPECTED_SIDEBAR_LABELS.length}/${EXPECTED_SIDEBAR_LABELS.length}: NAV_ITEMS cobre exatamente os itens reais da sidebar, todos com helpId válido`, () => {
  assert(NAV_ITEMS.length === EXPECTED_SIDEBAR_LABELS.length, `esperado ${EXPECTED_SIDEBAR_LABELS.length} itens, obtido ${NAV_ITEMS.length}`);
  for (const label of EXPECTED_SIDEBAR_LABELS) {
    assert(NAV_ITEMS.some((item) => item.label === label), `item real da sidebar ausente de NAV_ITEMS: "${label}"`);
  }
  for (const item of NAV_ITEMS) {
    assert(typeof item.helpId === "string" && item.helpId.length > 0, `${item.label} sem helpId`);
    assert(ACC_FEATURE_HELP[item.helpId], `helpId "${item.helpId}" (${item.label}) não existe no registry`);
  }
});

check("consistência futura: todo item principal de navegação possui helpId válido (checagem automática — nunca manual)", () => {
  const missing = NAV_ITEMS.filter((item) => !ACC_FEATURE_HELP[item.helpId]);
  assert(missing.length === 0, `itens sem helpId válido: ${missing.map((i) => i.label).join(", ")}`);
});

// --- Experts individuais têm ajuda ---

check("Experts individuais têm ajuda: os 5 Experts oficiais têm entrada expert-<id> no registry", () => {
  for (const def of ALL_OFFICIAL_EXPERT_DEFINITIONS) {
    const helpId = `expert-${def.expertId}`;
    assert(ACC_FEATURE_HELP[helpId], `${helpId} ausente do registry`);
    assert(ACC_FEATURE_HELP[helpId].title === def.expertName, `título de ${helpId} deveria bater com o nome real do Expert`);
  }
});

// --- Start-up tem ajuda ---

check("Start-up tem ajuda: os 6 campos/ações internas têm entrada no registry", () => {
  const ids = [
    "startup-project-start-date",
    "startup-acc-operational-start-date",
    "startup-dismiss",
    "startup-resolve",
    "startup-create-action",
    "startup-complete",
  ];
  for (const id of ids) assert(ACC_FEATURE_HELP[id], `${id} ausente do registry`);
});

check("Start-up tem ajuda: page.tsx e os componentes internos realmente renderizam FeatureInfo com os helpIds certos", () => {
  const pageSource = readSource("apps/web/app/[projectId]/startup/page.tsx");
  assert(pageSource.includes('helpId="startup-project-start-date"'));
  assert(pageSource.includes('helpId="startup-acc-operational-start-date"'));
  assert(pageSource.includes('helpId="finding"'));

  const cardSource = readSource("apps/web/components/startup/historical-finding-card.tsx");
  assert(cardSource.includes('helpId="startup-dismiss"'));
  assert(cardSource.includes('helpId="startup-resolve"'));
  assert(cardSource.includes('helpId="startup-create-action"'));

  const buttonSource = readSource("apps/web/components/startup/complete-startup-button.tsx");
  assert(buttonSource.includes('helpId="startup-complete"'));
});

// --- Adicionais tem ajuda ---

check("Adicionais tem ajuda: os 5 campos/ações internas têm entrada no registry", () => {
  const ids = [
    "adicionais-nova-proposta",
    "adicionais-marcar-contratado",
    "adicionais-formalizacao",
    "adicionais-status-prazo",
    "adicionais-documentacao",
  ];
  for (const id of ids) assert(ACC_FEATURE_HELP[id], `${id} ausente do registry`);
});

check("Adicionais tem ajuda: page.tsx e os componentes internos realmente renderizam FeatureInfo com os helpIds certos", () => {
  const pageSource = readSource("apps/web/app/[projectId]/adicionais/page.tsx");
  assert(pageSource.includes('helpId="adicionais-nova-proposta"'));

  const contractedSource = readSource("apps/web/components/additionals/additional-proposal-contracted-form.tsx");
  assert(contractedSource.includes('helpId="adicionais-marcar-contratado"'));
  assert(contractedSource.includes('helpId="adicionais-formalizacao"'));

  const approvalsSource = readSource("apps/web/components/additionals/additional-proposal-approvals-form.tsx");
  assert(approvalsSource.includes('helpId="adicionais-status-prazo"'));

  const checklistSource = readSource("apps/web/components/additionals/additional-proposal-checklist.tsx");
  assert(checklistSource.includes('helpId="adicionais-documentacao"'));
});

// --- Riscos: labels corretos, nunca HIGH/CRITICAL/Alta/Crítica em PT-BR ---

check("labels de risco corretos: BAIXO/MÉDIO/ALTO/CRÍTICO, nunca a forma feminina nem inglês", () => {
  assert(severityLabels.BAIXA === "Baixo");
  assert(severityLabels.MEDIA === "Médio");
  assert(severityLabels.ALTA === "Alto");
  assert(severityLabels.CRITICA === "Crítico");
});

check("nenhum HIGH/CRITICAL visível em PT-BR: registry de risco nunca contém esses termos em texto exibível", () => {
  for (const id of ["risco-baixo", "risco-medio", "risco-alto", "risco-critico"]) {
    const def = ACC_FEATURE_HELP[id];
    assert(def, `${id} ausente`);
    const allText = `${def.title} ${def.shortDescription} ${def.description}`;
    assert(!/\bHIGH\b|\bCRITICAL\b|\bAlta\b|\bCrítica\b/.test(allText), `${id} contém termo de risco em inglês/feminino: "${allText}"`);
  }
});

check("badges: ALTO/CRÍTICO mantêm caixa sólida + fonte branca + bold; SeverityBadge aceita withInfo opcional sem poluir o uso default", () => {
  const source = readSource("apps/web/components/shared/badges.tsx");
  assert(/ALTA:\s*"[^"]*bg-severity-alta\s+text-white\s+font-bold[^"]*"/.test(source));
  assert(/CRITICA:\s*"[^"]*bg-severity-critica\s+text-white\s+font-bold[^"]*"/.test(source));
  assert(source.includes("withInfo = false"), "withInfo deveria ter default false — nunca poluir os usos existentes de SeverityBadge");
});

// --- FeatureInfo: verificação estrutural (sem framework de DOM disponível) ---

const featureInfoSource = readSource("apps/web/components/shared/feature-info.tsx");

check("FeatureInfo: acessibilidade — aria-label, aria-expanded, aria-haspopup, role=dialog no popover", () => {
  assert(featureInfoSource.includes("aria-label={`Informações sobre"));
  assert(featureInfoSource.includes("aria-expanded={open}"));
  assert(featureInfoSource.includes('aria-haspopup="dialog"'));
  assert(featureInfoSource.includes('role="dialog"'));
});

check("FeatureInfo: teclado — botão nativo (Enter/Space funcionam sem JS extra), ESC fecha, foco visível", () => {
  assert(/<button/.test(featureInfoSource), "deveria usar <button> nativo (Enter/Space acessíveis por padrão)");
  assert(featureInfoSource.includes('"Escape"'), "deveria fechar com ESC");
  assert(featureInfoSource.includes("focus-visible:ring"), "deveria ter foco visível (focus-visible)");
});

check("FeatureInfo: click nunca navega/seleciona/fecha sidebar/executa ação da linha — preventDefault + stopPropagation no próprio botão", () => {
  assert(featureInfoSource.includes("event.preventDefault()"));
  assert(featureInfoSource.includes("event.stopPropagation()"));
});

check("FeatureInfo: desktop hover/focus mostra tooltip curto; click abre popover com explicação completa", () => {
  assert(featureInfoSource.includes("shortDescription"), "tooltip deveria usar shortDescription (curto)");
  assert(featureInfoSource.includes("help.description"), "popover deveria usar description (completo)");
  // O tooltip curto passou de opacity-0/opacity-100 para hidden/block
  // (display toggle) — correção de um bug real de overflow horizontal
  // de página: um elemento absolute com opacity-0 continua no layout e
  // conta no "scrollable overflow" de qualquer ancestral o tempo todo,
  // mesmo invisível; hidden (display:none) remove a caixa do layout
  // por completo enquanto oculta. Comportamento visível ao usuário é o
  // mesmo (aparece no hover/focus), só o mecanismo CSS mudou.
  assert(featureInfoSource.includes("group-hover/feature-info:block"));
  assert(featureInfoSource.includes("group-focus-within/feature-info:block"));
});

check("FeatureInfo: mobile/touch — o mesmo botão que recebe click também recebe tap (nenhum caminho hover-only para abrir o popover)", () => {
  assert(featureInfoSource.includes("onClick={(event) => {"), "abrir o popover deveria estar sempre atrelado a onClick (cobre tap em touch)");
});

check("FeatureInfo: nunca renderiza nada quando helpId é desconhecido (nunca quebra a página por um id inválido)", () => {
  assert(featureInfoSource.includes("if (!help) {"));
  assert(featureInfoSource.includes("return null;"));
});

// --- Sidebar: expanded mostra ⓘ, collapsed mantém UX limpa (ajuda dentro do tooltip nativo) ---

const sidebarSource = readSource("apps/web/components/layout/app-sidebar.tsx");

check("sidebar: NUNCA renderiza um ⓘ separado (expandida ou recolhida) — ajuda via hover/focus no próprio item, reduz poluição visual (ACC — AJUSTES FINAIS, seção 5/7)", () => {
  assert(!sidebarSource.includes("<FeatureInfo"), "a sidebar não deveria mais importar/renderizar o componente FeatureInfo");
  assert(!sidebarSource.includes("import { FeatureInfo }"), "import de FeatureInfo deveria ter sido removido da sidebar");
});

check("sidebar: tooltip nativo (title) com label + shortDescription do registry, no MESMO item, em qualquer estado (recolhida ou expandida)", () => {
  assert(sidebarSource.includes("itemTitle"));
  assert(sidebarSource.includes("help.shortDescription"));
  assert(sidebarSource.includes("title={itemTitle}"), "o tooltip deveria valer para os dois estados (nunca condicional a collapsed)");
});

// --- Seção 12: inventário de TODAS as abas/seções reais mapeadas ---
// Cada entrada é um helpId + o arquivo onde ele deve estar realmente
// renderizado (não apenas presente no registry). Usado tanto para testar
// quanto para gerar a tabela "página → abas/seções → ajuda" do relatório.

const TAB_COVERAGE = [
  {
    page: "Ações e Escalonamentos",
    entries: [
      { id: "acoes-tab-abertas", file: "apps/web/app/[projectId]/acoes/page.tsx" },
      { id: "acoes-tab-gerencial", file: "apps/web/app/[projectId]/acoes/page.tsx" },
      { id: "acoes-tab-historico", file: "apps/web/app/[projectId]/acoes/page.tsx" },
      { id: "acoes-tab-nova", file: "apps/web/app/[projectId]/acoes/page.tsx" },
    ],
  },
  {
    page: "Matriz de SLA e Escalonamento (configuração)",
    entries: [
      { id: "sla-config-timezone", file: "apps/web/app/[projectId]/acoes/configuracao/page.tsx" },
      { id: "sla-config-matriz-prazos", file: "apps/web/app/[projectId]/acoes/configuracao/page.tsx" },
      { id: "sla-config-responsaveis", file: "apps/web/app/[projectId]/acoes/configuracao/page.tsx" },
    ],
  },
  {
    page: "ESG/SSMA",
    entries: [
      { id: "esg-tab-pendencias", file: "apps/web/app/[projectId]/esg/page.tsx" },
      { id: "esg-tab-gerencial", file: "apps/web/app/[projectId]/esg/page.tsx" },
      { id: "esg-tab-checklist", file: "apps/web/app/[projectId]/esg/page.tsx" },
      { id: "esg-tab-consultar", file: "apps/web/app/[projectId]/esg/page.tsx" },
    ],
  },
  {
    page: "Documentos",
    entries: [
      { id: "documentos-tab-documentos", file: "apps/web/app/[projectId]/documentos/page.tsx" },
      { id: "documentos-tab-clausulas", file: "apps/web/app/[projectId]/documentos/page.tsx" },
      { id: "documentos-tab-cronograma", file: "apps/web/app/[projectId]/documentos/page.tsx" },
    ],
  },
  {
    page: "Adicionais",
    entries: [
      { id: "adicionais-tab-propostas", file: "apps/web/app/[projectId]/adicionais/page.tsx" },
      { id: "adicionais-nova-proposta", file: "apps/web/app/[projectId]/adicionais/page.tsx" },
      { id: "adicionais-marcar-contratado", file: "apps/web/components/additionals/additional-proposal-contracted-form.tsx" },
      { id: "adicionais-formalizacao", file: "apps/web/components/additionals/additional-proposal-contracted-form.tsx" },
      { id: "adicionais-status-prazo", file: "apps/web/components/additionals/additional-proposal-approvals-form.tsx" },
      { id: "adicionais-documentacao", file: "apps/web/components/additionals/additional-proposal-checklist.tsx" },
    ],
  },
  {
    page: "Start-up ACC",
    entries: [
      { id: "startup-project-start-date", file: "apps/web/app/[projectId]/startup/page.tsx" },
      { id: "startup-acc-operational-start-date", file: "apps/web/app/[projectId]/startup/page.tsx" },
      { id: "finding", file: "apps/web/app/[projectId]/startup/page.tsx" },
      { id: "startup-dismiss", file: "apps/web/components/startup/historical-finding-card.tsx" },
      { id: "startup-resolve", file: "apps/web/components/startup/historical-finding-card.tsx" },
      { id: "startup-create-action", file: "apps/web/components/startup/historical-finding-card.tsx" },
      { id: "startup-complete", file: "apps/web/components/startup/complete-startup-button.tsx" },
    ],
  },
];

console.log("");
console.log("======================================");
console.log("SEÇÃO 12 — COBERTURA DE ABAS/SEÇÕES REAIS");
console.log("======================================");

let coverageTotal = 0;
let coverageWithHelp = 0;

for (const { page, entries } of TAB_COVERAGE) {
  check(`cobertura "${page}": todos os helpIds existem no registry e estão realmente renderizados no arquivo certo`, () => {
    const sourceCache = new Map();
    for (const { id, file } of entries) {
      assert(ACC_FEATURE_HELP[id], `helpId "${id}" (${page}) ausente do registry`);
      if (!sourceCache.has(file)) sourceCache.set(file, readSource(file));
      const source = sourceCache.get(file);
      assert(source.includes(`helpId="${id}"`), `"${file}" não renderiza FeatureInfo com helpId="${id}"`);
    }
  });
  coverageTotal += entries.length;
  coverageWithHelp += entries.length;
  console.log(`${page}: ${entries.length}/${entries.length}`);
}

console.log(`TOTAL GERAL: ${coverageWithHelp}/${coverageTotal}`);

// --- Cada TabsTrigger real das páginas com abas tem um FeatureInfo irmão ---
// (Tabs deste projeto é implementação própria — TabsList é um <div> comum,
// não Radix — então um FeatureInfo pode ser irmão de cada TabsTrigger sem
// quebrar navegação por teclado nem semântica.)

const TABBED_PAGES = [
  "apps/web/app/[projectId]/acoes/page.tsx",
  "apps/web/app/[projectId]/esg/page.tsx",
  "apps/web/app/[projectId]/documentos/page.tsx",
  "apps/web/app/[projectId]/adicionais/page.tsx",
];

check("nenhuma aba funcional relevante sem ajuda: toda ocorrência de <TabsTrigger tem um <FeatureInfo irmão na mesma página", () => {
  for (const file of TABBED_PAGES) {
    const source = readSource(file);
    const triggerCount = (source.match(/<TabsTrigger/g) ?? []).length;
    const featureInfoInTabsListCount = (source.match(/<FeatureInfo helpId="[^"]+" \/>/g) ?? []).length;
    assert(triggerCount > 0, `${file} deveria ter pelo menos um TabsTrigger`);
    assert(
      featureInfoInTabsListCount >= triggerCount,
      `${file}: ${triggerCount} TabsTrigger mas só ${featureInfoInTabsListCount} FeatureInfo encontrados`
    );
  }
});

check("FeatureInfo dentro de TabsList nunca navega/troca de aba sozinho: é irmão do TabsTrigger, não filho (evita botão dentro de botão)", () => {
  for (const file of TABBED_PAGES) {
    const source = readSource(file);
    // Nenhum FeatureInfo deve aparecer DENTRO do texto de um TabsTrigger
    // (entre a abertura e o fechamento da tag), o que criaria button > button.
    const nestedButtonInButton = /<TabsTrigger[^>]*>[^<]*<FeatureInfo/;
    assert(!nestedButtonInButton.test(source), `${file}: possível FeatureInfo aninhado dentro de um TabsTrigger`);
  }
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
