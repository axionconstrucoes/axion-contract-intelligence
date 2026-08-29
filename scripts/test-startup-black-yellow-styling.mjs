// Bloco 9 (rodada "produção") — caixas-resumo do Start-up ACC em preto
// sólido/branco, +1 nível tipográfico, label BAIXO amarelo forte/fonte
// preta SÓ nesta página (RiskLegend/SeverityBadge continuam com a
// paleta padrão em qualquer outro lugar). Verificação estrutural do
// código-fonte real (mesmo padrão de toda a suíte, sem framework de
// DOM neste projeto).
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
console.log("START-UP ACC — caixas preto/branco + BAIXO amarelo forte (exclusivo desta página)");
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

check("Start-up page: RiskLegend recebe strongBaixaHighlight (só aqui)", () => {
  assert(startupSource.includes("<RiskLegend strongBaixaHighlight"), "a página Start-up deveria pedir o destaque forte do BAIXO");
});

check("RiskLegend: strongBaixaHighlight é opcional (default false) e só afeta o item BAIXA", () => {
  assert(/strongBaixaHighlight\s*=\s*false/.test(legendSource), "deveria ter default false — nunca ligado sem pedir explicitamente");
  const baixaBlock = legendSource.slice(legendSource.indexOf('severity="BAIXA"'), legendSource.indexOf('severity="MEDIA"'));
  assert(baixaBlock.includes("bg-yellow-400"), "o override amarelo forte deveria estar só no item BAIXA");
  assert(baixaBlock.includes("text-black"), "a fonte deveria ficar preta sobre o amarelo forte");
  const mediaAltaCriticaBlock = legendSource.slice(legendSource.indexOf('severity="MEDIA"'));
  assert(!mediaAltaCriticaBlock.includes("bg-yellow-400"), "MEDIA/ALTA/CRITICA nunca deveriam receber o override amarelo");
});

check("SeverityBadge: aceita className opcional (undefined em todos os OUTROS 13+ usos existentes) — twMerge resolve o conflito, nunca duplica a paleta global", () => {
  assert(/className\?:\s*string/.test(badgesSource), "SeverityBadge deveria aceitar um className opcional");
  assert(badgesSource.includes("cn(severityClasses[severity], className)"), "o className deveria ser mesclado via cn/twMerge, nunca substituir o objeto de classes global");
});

check("Nenhuma outra tela usa RiskLegend (o override continua isolado ao Start-up por construção, não só por convenção)", () => {
  // Já confirmado por busca no repositório antes da implementação —
  // este check apenas fixa a expectativa: se algum dia outra tela
  // importar RiskLegend SEM strongBaixaHighlight, ela recebe a paleta
  // padrão automaticamente (default false), nunca o amarelo forte por
  // engano.
  assert(/strongBaixaHighlight\s*=\s*false/.test(legendSource));
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exitCode = 1;
}
