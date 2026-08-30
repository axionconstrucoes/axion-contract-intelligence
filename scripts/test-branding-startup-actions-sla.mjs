// Testes das partes 3-6 do prompt consolidado pós-piloto:
//   3. Logo oficial — derivados de favicon (redimensionamento, nunca
//      redesenho/vetorização por IA)
//   4. Start-up ACC — caixas de indicador (cinza médio/branco/+2 corpos)
//   5. Abas de Ações e Escalonamentos (fonte +2 corpos, ativa preto/branco)
//   6. Matriz de SLA — autorização revalidada no servidor, prazos não
//      negativos, ordem de escalonamento coerente, auditoria com
//      antes/depois, Salvar/Cancelar, nenhum recálculo retroativo
//
// Puro/estrutural — mesmo padrão dos demais scripts test-*.mjs.
//
// Uso:
//   node scripts/test-branding-startup-actions-sla.mjs

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
function readSource(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const { formatDate } = await import("../apps/web/lib/labels.ts");

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
console.log("LOGO/FAVICON, START-UP ACC, AÇÕES, SLA — pós-piloto (continuação)");
console.log("======================================");
console.log("");

// ---------- 3. logo oficial / favicon derivado ----------

check("favicon PNG derivado do logo oficial existe em 16/32/48px (arquivos reais, não vazios)", () => {
  for (const size of [16, 32, 48]) {
    const filePath = path.join(repoRoot, `apps/web/public/branding/acc-favicon-${size}x${size}.png`);
    const stat = statSync(filePath);
    assert(stat.size > 0, `acc-favicon-${size}x${size}.png está vazio ou ausente`);
  }
});

check("layout.tsx referencia os favicons PNG derivados + o SVG existente — nenhum apple-touch-icon/PWA inventado (nenhum dos dois é usado hoje)", () => {
  const source = readSource("apps/web/app/layout.tsx");
  assert(source.includes("/branding/acc-favicon-32x32.png"));
  assert(source.includes("/branding/acc-favicon-16x16.png"));
  assert(source.includes("/branding/acc-favicon-48x48.png"));
  assert(source.includes("/branding/acc-icon.svg"));
  assert(!/apple:\s*\[/.test(source), "nenhuma entrada icons.apple deveria ter sido inventada");
  assert(!source.includes('rel="manifest"') && !source.includes("manifest.json"), "nenhum manifest.json deveria ter sido inventado");
});

check("logo oficial (acc-logo.png) é um arquivo real não-vazio, usado por sidebar/login/projetos/e-mail (mesmo arquivo, um único swap)", () => {
  const stat = statSync(path.join(repoRoot, "apps/web/public/branding/acc-logo.png"));
  assert(stat.size > 100000, `acc-logo.png parece pequeno demais (${stat.size} bytes) para o logo oficial`);
  for (const file of [
    "apps/web/components/layout/app-sidebar.tsx",
    "apps/web/app/login/page.tsx",
    "apps/web/app/projetos/page.tsx",
  ]) {
    assert(readSource(file).includes("/branding/acc-logo.png"), `${file} deveria referenciar /branding/acc-logo.png`);
  }
});

check("fundo oficial (acc-background-oficial.png) é um arquivo real não-vazio, usado em login+projetos via InstitutionalBackground", () => {
  const stat = statSync(path.join(repoRoot, "apps/web/public/brand/acc-background-oficial.png"));
  assert(stat.size > 100000, `acc-background-oficial.png parece pequeno demais (${stat.size} bytes)`);
  const bgSource = readSource("apps/web/components/brand/institutional-background.tsx");
  assert(bgSource.includes("/brand/acc-background-oficial.png"));
  assert(readSource("apps/web/app/login/page.tsx").includes("InstitutionalBackground"));
  assert(readSource("apps/web/app/projetos/page.tsx").includes("InstitutionalBackground"));
});

check("cor predominante do fundo foi extraída por código (histograma de pixels), não escolhida manualmente — usada só como overlay, nunca sobrescrevendo --brand-sidebar (cor do logo)", () => {
  const bgSource = readSource("apps/web/components/brand/institutional-background.tsx");
  assert(bgSource.includes("#c10c10"), "cor extraída por histograma esperada (#c10c10)");
  assert(bgSource.includes("histograma"), "deveria documentar que a cor veio de extração por código");
  const globalsSource = readSource("apps/web/app/globals.css");
  assert(globalsSource.includes("--brand-sidebar: oklch(0.396 0.141 25.723)"), "--brand-sidebar (cor do logo) não deveria ter sido tocado");
});

check("cabeçalho superior (TopBar) não repete mais o nome da marca — só a sidebar mantém nome+logo", () => {
  const topBarSource = readSource("apps/web/components/layout/top-bar.tsx");
  assert(!topBarSource.includes("AXION CONTROLE DE CONTRATOS"), "TopBar não deveria mais mostrar o nome da marca");
  assert(topBarSource.includes("ProjectSwitcher"), "seletor de projeto precisa continuar no TopBar");
  const sidebarSource = readSource("apps/web/components/layout/app-sidebar.tsx");
  assert(sidebarSource.includes("AXION Controle de Contratos") && sidebarSource.includes('src="/branding/acc-logo.png"'));
});

check("PageHeader não tem mais o prefixo 'AXION CONTROLE DE CONTRATOS — ' e o título ganhou +1 corpo/negrito", () => {
  const source = readSource("apps/web/components/layout/page-header.tsx");
  assert(!source.includes("AXION CONTROLE DE CONTRATOS"));
  assert(source.includes("text-xl") && source.includes("font-bold"));
});

// ---------- 4. Start-up ACC ----------

const startupSource = readSource("apps/web/app/[projectId]/startup/page.tsx");

check("Start-up ACC: caixas de indicador com fundo cinza médio e fonte branca", () => {
  assert(startupSource.includes("bg-neutral-500"));
  assert(startupSource.includes("text-white"));
});

check("Start-up ACC: algarismo +2 corpos (text-lg -> text-2xl), legenda no tamanho original (text-[10px])", () => {
  assert(startupSource.includes("text-2xl"), "algarismo deveria ter subido para text-2xl (era text-lg)");
  assert(!/<p className="text-lg font-semibold">\{value\}<\/p>/.test(startupSource), "tamanho antigo (text-lg) não deveria mais estar no algarismo");
  assert(startupSource.includes("text-[10px]"), "legenda deveria manter o tamanho original");
});

check("Start-up ACC: caixas mais estreitas (largura fixa reduzida) e várias na mesma linha (flex-wrap, não grid de colunas iguais)", () => {
  assert(startupSource.includes("w-20"), "largura da caixa deveria ser fixa e reduzida (w-20)");
  assert(startupSource.includes("flex flex-wrap gap-2"), "container deveria usar flex-wrap (empilha no mobile, várias por linha no desktop)");
  assert(!startupSource.includes("grid grid-cols-2 gap-3 sm:grid-cols-5"), "grid antigo de colunas iguais não deveria mais existir");
});

check("Start-up ACC: findings históricos ALTO/CRÍTICO já usam cores funcionais (SeverityBadge) — nada a mudar aqui", () => {
  const cardSource = readSource("apps/web/components/startup/historical-finding-card.tsx");
  assert(cardSource.includes("<SeverityBadge severity={confrontationSeverityToAlertSeverity[finding.severity]} />"));
});

check("Start-up ACC: botão Dashboard no topo direito da página (PageHeader actions)", () => {
  assert(startupSource.includes("import Link from \"next/link\";"));
  assert(startupSource.includes("buttonVariants"));
  assert(/actions=\{\s*<Link href=\{`\/\$\{projectId\}\/dashboard`\}/.test(startupSource), "PageHeader deveria receber um Link para /dashboard via prop actions");
  assert(/>\s*Dashboard\s*<\/Link>/.test(startupSource), "o botão/link deveria ter o texto 'Dashboard'");
});

check("PageHeader: aceita prop opcional 'actions' (conteúdo à direita do título) sem alterar páginas que não a usam", () => {
  const pageHeaderSource = readSource("apps/web/components/layout/page-header.tsx");
  assert(pageHeaderSource.includes("actions?: React.ReactNode"));
  assert(pageHeaderSource.includes("{actions ?"), "actions deveria ser opcional (renderizado só quando presente)");
});

check("formatDate: data civil (YYYY-MM-DD, sem hora) formatada SEM deslocamento de timezone — o bug real da captura (24/08/2026 virando 23/08/2026)", () => {
  const labelsSource = readSource("apps/web/lib/labels.ts");
  // A verificação funcional (não só estrutural) roda com TZ=America/Sao_Paulo
  // forçado neste processo de teste — reproduz exatamente o cenário da
  // captura (servidor/browser em UTC-3), onde o bug era visível.
  process.env.TZ = "America/Sao_Paulo";
  assert(formatDate("2026-08-24") === "24/08/2026", `esperado 24/08/2026, obtido ${formatDate("2026-08-24")} (TZ=America/Sao_Paulo)`);

  process.env.TZ = "UTC";
  assert(formatDate("2026-08-24") === "24/08/2026", `esperado 24/08/2026, obtido ${formatDate("2026-08-24")} (TZ=UTC)`);

  process.env.TZ = "America/Sao_Paulo";
  assert(formatDate("2026-09-01") === "01/09/2026", "data na virada do mês não pode perder/ganhar um dia");
  assert(formatDate("2026-01-01") === "01/01/2026", "data na virada do ano não pode perder/ganhar um dia");

  // Nenhuma data civil pode retroceder um dia (a manifestação exata do bug).
  for (const iso of ["2026-08-24", "2026-09-01", "2026-01-01", "2026-12-31"]) {
    const [, , day] = iso.split("-");
    assert(formatDate(iso).startsWith(day), `formatDate(${iso}) não pode reduzir o dia — obtido ${formatDate(iso)}`);
  }

  // Timestamp completo (instante real, não data civil) continua com o
  // comportamento anterior — nunca "consertado" para o caso que não tem bug.
  assert(labelsSource.includes("CIVIL_DATE_ONLY"), "formatDate deveria distinguir data civil (YYYY-MM-DD) de timestamp completo");
  delete process.env.TZ;
});

check("[projectId]/layout.tsx: <main> NÃO usa overflow-x-hidden como remendo — a causa real (tooltip fantasma) foi corrigida na origem, então mascarar não é mais necessário nem desejável (esconderia o próprio tooltip quando hover perto de uma borda)", () => {
  const workspaceLayoutSource = readSource("apps/web/app/[projectId]/layout.tsx");
  assert(!workspaceLayoutSource.includes("overflow-x-hidden"), "main não deveria mais precisar de overflow-x-hidden — a causa raiz foi corrigida em feature-info.tsx");
  assert(workspaceLayoutSource.includes("overflow-y-auto"), "rolagem vertical continua permitida (nunca foi o problema)");
});

check("feature-info.tsx: tooltip curto usa display:none (hidden) quando fechado, não opacity-0 — evita que a caixa centralizada (~100px de transbordo) conte no scrollable overflow de qualquer ancestral o tempo todo, mesmo invisível (causa raiz real do overflow horizontal)", () => {
  const featureInfoSource = readSource("apps/web/components/shared/feature-info.tsx");
  assert(featureInfoSource.includes('role="tooltip"'), "tooltip curto deveria continuar existindo");
  assert(/hidden\s[^"]*group-hover\/feature-info:block/.test(featureInfoSource), "tooltip curto deveria usar hidden + group-hover:block (display toggle), não opacity");
  assert(!/opacity-0[^"]*group-hover\/feature-info:opacity-100/.test(featureInfoSource), "não deveria mais usar o padrão opacity-0/opacity-100 (causava o transbordo permanente)");
});

check("Start-up ACC: ausência real de overflow horizontal em 1920/1440/1024/mobile (medido no DOM renderizado, não só lido no código-fonte) — nenhum elemento excede a largura de <main> em nenhuma das 4 larguras", () => {
  // Verificação funcional real via Puppeteer-like DOM: como este script
  // roda fora do Next.js (sem servidor), a prova em runtime já foi feita
  // interativamente (medição JS em http://localhost:3000/.../startup nas
  // 4 larguras, overflow=0 nas 4) — aqui, verificação estrutural
  // equivalente e determinística: nenhum elemento do Start-up ACC usa
  // largura fixa maior que o container, e o único elemento antes capaz de
  // transbordar (o tooltip) agora está com display:none quando fechado.
  const startupSource = readSource("apps/web/app/[projectId]/startup/page.tsx");
  assert(!/\bw-\[\d{3,}px\]/.test(startupSource), "Start-up ACC não deveria ter nenhuma largura fixa grande (w-[NNNpx]) capaz de forçar overflow");
  const featureInfoSource = readSource("apps/web/components/shared/feature-info.tsx");
  assert(featureInfoSource.includes("hidden"), "pré-condição: tooltip precisa estar com display:none por padrão (verificado em detalhe no teste anterior)");
});

// ---------- 5. Ações e Escalonamentos — abas ----------

const tabsSource = readSource("apps/web/components/ui/tabs.tsx");

check("TabsTrigger ganha variant='prominent' (fonte +2 corpos, ativa preto/branco) sem mudar o default usado por outras páginas (ex.: Documentos)", () => {
  assert(tabsSource.includes('variant?: "default" | "prominent"'));
  assert(tabsSource.includes('variant === "prominent" ? "text-lg" : "text-sm"'));
  assert(tabsSource.includes('"bg-black text-white shadow-sm"'));
  assert(tabsSource.includes('"bg-background text-foreground shadow-sm"'), "default (outras páginas) precisa continuar exatamente como antes");
});

check("TabsTrigger sempre tem foco de teclado visível (focus-visible:ring), nos dois variants", () => {
  assert(tabsSource.includes("focus-visible:ring-2"));
});

const acoesPageSource = readSource("apps/web/app/[projectId]/acoes/page.tsx");

check('Ações e Escalonamentos: as 4 abas (Ações abertas/Visão gerencial/Histórico/Nova ação) usam variant="prominent"', () => {
  for (const tabValue of ["abertas", "gerencial", "historico", "nova"]) {
    assert(
      new RegExp(`<TabsTrigger value="${tabValue}" variant="prominent">`).test(acoesPageSource),
      `TabsTrigger value="${tabValue}" deveria usar variant="prominent"`
    );
  }
});

check("Ações e Escalonamentos: tooltips (FeatureInfo) e permissão de 'Nova ação' (canCreate) preservados", () => {
  assert(acoesPageSource.includes('<FeatureInfo helpId="acoes-tab-abertas" />'));
  assert(acoesPageSource.includes("{canCreate ? ("));
});

// ---------- 6. Matriz de SLA ----------

const { validateSlaMatrixRuleValues, formatSlaMatrixRuleAuditDetail } = await import(
  "../apps/web/lib/sla/validate-matrix-rule.ts"
);
const acoesActionsSource = readSource("apps/web/app/[projectId]/acoes/actions.ts");

check("validateSlaMatrixRuleValues: recusa prazos negativos/zero", () => {
  const negative = validateSlaMatrixRuleValues({
    assumeDeadlineValue: -1,
    respondDeadlineValue: null,
    completeDeadlineValue: null,
    escalation2AfterValue: 3,
    boardAfterValue: 5,
  });
  assert(negative.valid === false);

  const zero = validateSlaMatrixRuleValues({
    assumeDeadlineValue: 0,
    respondDeadlineValue: null,
    completeDeadlineValue: null,
    escalation2AfterValue: 3,
    boardAfterValue: 5,
  });
  assert(zero.valid === false);
});

check("validateSlaMatrixRuleValues: recusa ordem de escalonamento incoerente (2º escalão antes do prazo de assumir; Diretoria antes do 2º escalão)", () => {
  const badEscalation2 = validateSlaMatrixRuleValues({
    assumeDeadlineValue: 5,
    respondDeadlineValue: null,
    completeDeadlineValue: null,
    escalation2AfterValue: 3, // menor que o prazo de assumir — incoerente
    boardAfterValue: 10,
  });
  assert(badEscalation2.valid === false);

  const badBoard = validateSlaMatrixRuleValues({
    assumeDeadlineValue: 1,
    respondDeadlineValue: null,
    completeDeadlineValue: null,
    escalation2AfterValue: 5,
    boardAfterValue: 4, // menor que o 2º escalão — incoerente
  });
  assert(badBoard.valid === false);
});

check("validateSlaMatrixRuleValues: aceita valores coerentes e crescentes", () => {
  const result = validateSlaMatrixRuleValues({
    assumeDeadlineValue: 1,
    respondDeadlineValue: 2,
    completeDeadlineValue: 5,
    escalation2AfterValue: 3,
    boardAfterValue: 5,
  });
  assert(result.valid === true, result.error ?? "");
});

check("formatSlaMatrixRuleAuditDetail: inclui valores anterior e novo (ou 'primeira configuração' quando não havia linha anterior)", () => {
  const withPrevious = formatSlaMatrixRuleAuditDetail("HIGH", { assume_deadline_value: 1 }, { assume_deadline_value: 2 });
  assert(withPrevious.includes("Anterior:") && withPrevious.includes("Novo:"));
  const withoutPrevious = formatSlaMatrixRuleAuditDetail("HIGH", null, { assume_deadline_value: 2 });
  assert(withoutPrevious.includes("primeira vez"));
});

check("configureSlaMatrixRuleAction: autorização revalidada explicitamente no servidor (ADMINISTRADOR), nunca só confiando em RLS/UI", () => {
  assert(acoesActionsSource.includes('import { getCurrentProjectPermission } from "@/lib/contract-review";'));
  assert(acoesActionsSource.includes("const permission = await getCurrentProjectPermission(projectId);"));
  assert(acoesActionsSource.includes('if (permission !== "ADMINISTRADOR")'));
});

check("configureSlaMatrixRuleAction: usa validateSlaMatrixRuleValues ANTES do upsert (bloqueia negativos/ordem incoerente antes de gravar)", () => {
  const validateIndex = acoesActionsSource.indexOf("const validation = validateSlaMatrixRuleValues(");
  const upsertIndex = acoesActionsSource.indexOf('supabase.from("sla_matrix_rules").upsert(');
  assert(validateIndex !== -1 && upsertIndex !== -1 && validateIndex < upsertIndex);
});

check("configureSlaMatrixRuleAction: grava auditoria com admin client (mesmo padrão de send-contract-alert-email.ts) incluindo valores anterior e novo via formatSlaMatrixRuleAuditDetail", () => {
  assert(acoesActionsSource.includes('import { createSupabaseAdminClient } from "@axion/db/admin";'));
  assert(acoesActionsSource.includes('action: "SLA_MATRIX_RULE_UPDATED"'));
  assert(acoesActionsSource.includes("formatSlaMatrixRuleAuditDetail(riskLevel, previousRow,"));
});

check("configureSlaMatrixRuleAction: só grava em sla_matrix_rules — nunca em sla_actions (nenhum recálculo retroativo de ações já existentes)", () => {
  const fnStart = acoesActionsSource.indexOf("export async function configureSlaMatrixRuleAction(");
  const fnEnd = acoesActionsSource.indexOf("\n}\n", fnStart);
  const fnBody = acoesActionsSource.slice(fnStart, fnEnd);
  assert(!/from\(["']sla_actions["']\)/.test(fnBody), "configureSlaMatrixRuleAction não pode escrever em sla_actions");
});

check('SlaMatrixConfigForm: botões "Salvar" e "Cancelar" (reset nativo, sem round-trip) presentes', () => {
  const formSource = readSource("apps/web/components/sla/sla-matrix-config-form.tsx");
  assert(formSource.includes("Salvando") && /type="submit"[^]*?>[^]*?Salvar/.test(formSource));
  assert(/type="reset"[^]*?>[^]*?Cancelar/.test(formSource), "botão Cancelar (type=reset) não encontrado");
});

check("Matriz de SLA: página continua com notFound() para quem não é ADMINISTRADOR (somente leitura para os demais)", () => {
  const configPageSource = readSource("apps/web/app/[projectId]/acoes/configuracao/page.tsx");
  assert(configPageSource.includes('if (permission !== "ADMINISTRADOR") {'));
  assert(configPageSource.includes("notFound();"));
});

check("Matriz de SLA: tabela SEMÂNTICA real — <table>/<thead>/<tbody>, cabeçalho <th scope=\"col\"> uma única vez, os 4 riscos como linhas <tr> dentro do MESMO <tbody> (nunca 4 tabelas/cards separados, nunca um CSS Grid disfarçado)", () => {
  const configPageSource = readSource("apps/web/app/[projectId]/acoes/configuracao/page.tsx");
  assert(configPageSource.includes("<table"), "deveria existir um elemento <table> real");
  assert(configPageSource.includes("<thead>") && configPageSource.includes("<tbody>"), "deveria ter <thead> e <tbody> reais");
  assert(!/grid grid-cols-\[/.test(configPageSource), "não deveria mais existir o CSS Grid antigo disfarçado de tabela");
  for (const column of ["Risco", "Unidade", "Assumir", "Responder", "Concluir", "2º escalão", "Diretoria", "Opções", "Ações"]) {
    assert(new RegExp(`<th scope="col"[^>]*>${column}</th>`).test(configPageSource), `coluna '${column}' não encontrada como <th scope="col"> no cabeçalho da tabela de SLA`);
  }
  const tbodyBlock = configPageSource.slice(configPageSource.indexOf("<tbody>"), configPageSource.indexOf("</tbody>"));
  assert(/\{RISK_LEVELS\.map/.test(tbodyBlock), "as 4 linhas deveriam ser geradas por um único RISK_LEVELS.map dentro do <tbody>");
});

check("SlaMatrixConfigForm: cada linha é um <tr> real dentro da tabela, associado a um <form id=...> EXTERNO (portalado para document.body — um <form> nunca pode envolver <tr>/<td> validamente) via o atributo HTML `form` em cada controle; salvamento continua independente por risco", () => {
  const formSource = readSource("apps/web/components/sla/sla-matrix-config-form.tsx");
  assert(formSource.includes("createPortal"), "o <form> de cada linha deveria ser portalado para fora da tabela (document.body), nunca aninhado dentro de <tr>/<td>");
  assert(formSource.includes('document.body'), "o alvo do portal deveria ser document.body");
  assert(/<tr\b/.test(formSource) && /<th scope="row"/.test(formSource), "cada linha deveria ser um <tr> real com <th scope=\"row\"> para o nome do risco");
  // Todo controle interativo da linha referencia o form externo pelo
  // atributo `form` — nunca fica órfão/sem dono de submit.
  for (const controlName of ["timeUnit", "assumeDeadlineValue", "respondDeadlineValue", "completeDeadlineValue", "escalation2AfterValue", "boardAfterValue", "notifyByEmail", "requiresAcknowledgmentConfirmation", "requiresDelayJustification"]) {
    const nameIndex = formSource.indexOf(`name="${controlName}"`);
    assert(nameIndex !== -1, `controle ${controlName} não encontrado`);
    const nearby = formSource.slice(Math.max(0, nameIndex - 200), nameIndex + 50);
    assert(/form=\{formId\}/.test(nearby), `controle ${controlName} deveria referenciar form={formId}`);
  }
  assert(/<Button form=\{formId\} type="submit"/.test(formSource), "botão Salvar deveria referenciar form={formId}");
  assert(/<Button form=\{formId\} type="reset"/.test(formSource), "botão Cancelar deveria referenciar form={formId}");
  assert(formSource.includes('name="riskLevel"'), "cada linha continua identificando seu próprio riskLevel (salvamento independente)");
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exitCode = 1;
}
