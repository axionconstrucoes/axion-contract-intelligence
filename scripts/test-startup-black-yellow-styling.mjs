// Bloco 9 (rodada "produção") — caixas-resumo do Start-up ACC em preto
// sólido/branco, +1 nível tipográfico. O antigo destaque amarelo forte
// exclusivo do BAIXO nesta página foi REMOVIDO pela padronização visual
// global de risco (RiskLegend/SeverityBadge usam sempre a mesma paleta,
// em qualquer tela, sem exceção — BAIXO é sempre verde-escuro sólido).
// Verificação estrutural do código-fonte real (mesmo padrão de toda a
// suíte, sem framework de DOM neste projeto).
//
// Uso:
//   node scripts/test-startup-black-yellow-styling.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
console.log("START-UP ACC — caixas preto/branco (BAIXO amarelo removido — RiskLegend usa a paleta global)");
console.log("======================================");
console.log("");

const startupSource = readSource("apps/web/app/[projectId]/startup/page.tsx");
const legendSource = readSource("apps/web/components/shared/risk-legend.tsx");
const badgesSource = readSource("apps/web/components/shared/badges.tsx");

check("Stat: fundo preto sólido (bg-black), nunca mais bg-neutral-500", () => {
  const classNameMatch = startupSource.match(/className="flex w-20[^"]*"/);
  assert(classNameMatch, "não encontrei a className da caixa Stat");
  assert(classNameMatch[0].includes("bg-black"), "caixa deveria usar bg-black");
  assert(!classNameMatch[0].includes("bg-neutral-500"), "não deveria mais usar o cinza antigo na className real (comentário explicando a mudança não conta)");
});

check("Stat: número e texto em branco (text-white em ambos)", () => {
  const statFn = startupSource.slice(startupSource.indexOf("function Stat"));
  assert((statFn.match(/text-white/g) ?? []).length >= 2, "tanto o número quanto o label deveriam usar text-white");
});

check("Stat: fontes internas +1 nível (text-2xl -> text-3xl; text-[10px] -> text-xs)", () => {
  const statFn = startupSource.slice(startupSource.indexOf("function Stat"));
  assert(statFn.includes("text-3xl"), "o número deveria subir de text-2xl para text-3xl");
  assert(!statFn.includes("text-2xl"), "não deveria mais usar o tamanho antigo do número");
  assert(statFn.includes("text-xs"), "o label deveria subir para text-xs (próximo degrau padrão)");
  assert(!statFn.includes("text-[10px]"), "não deveria mais usar o tamanho arbitrário antigo do label");
});

check("Stat: caixa continua compacta (w-20, padding pequeno) — só o texto cresceu, não a caixa", () => {
  const statFn = startupSource.slice(startupSource.indexOf("function Stat"));
  assert(statFn.includes("w-20"), "a largura compacta deveria ser preservada");
  assert(statFn.includes("px-1.5 py-1.5"), "o padding compacto deveria ser preservado");
});

// A padronizacao visual GLOBAL de risco (badges.tsx:severityClasses)
// cancelou o destaque amarelo exclusivo do BAIXO nesta pagina — agora
// BAIXO e' sempre verde-escuro solido, em qualquer tela, sem excecao.
// `strongBaixaHighlight` foi removido de RiskLegend por isso.
check("Start-up page: RiskLegend NAO recebe mais strongBaixaHighlight (paleta global, sem exceção por página)", () => {
  assert(startupSource.includes("<RiskLegend />"), "a página Start-up deveria usar <RiskLegend /> sem props");
  assert(!startupSource.includes("strongBaixaHighlight"), "strongBaixaHighlight não deveria mais existir nesta página");
});

check("RiskLegend: prop strongBaixaHighlight foi removida do componente (BAIXO nunca mais amarelo)", () => {
  assert(!/strongBaixaHighlight/.test(legendSource), "strongBaixaHighlight não deveria mais existir em risk-legend.tsx");
  assert(!/bg-yellow-400/.test(legendSource), "risk-legend.tsx não deveria mais ter override amarelo para nenhum item");
  assert(/<SeverityBadge severity="BAIXA" withInfo \/>/.test(legendSource), "BAIXA deveria renderizar sem className de override, herdando a paleta global");
});

check("SeverityBadge: aceita className opcional (usado só por dashboard/page.tsx para layout, w-fit — nunca para sobrescrever cor)", () => {
  assert(/className\?:\s*string/.test(badgesSource), "SeverityBadge deveria aceitar um className opcional");
  assert(badgesSource.includes("cn(severityClasses[severity], className)"), "o className deveria ser mesclado via cn/twMerge, nunca substituir o objeto de classes global");
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exitCode = 1;
}
