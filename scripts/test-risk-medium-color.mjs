// Teste estrutural dedicado — "Atualização global — cor do risco MÉDIO".
// Garante que o badge de risco MÉDIO nunca volte a usar âmbar/amarelo/
// laranja-claro (token dedicado --risk-media, azul, separado de
// --severity-media que continua âmbar só para estados não relacionados
// a risco), que ALTO continua laranja e não foi afetado, e que a
// duplicação de mapeamento de cor por página foi eliminada. Puramente
// estrutural (leitura de código-fonte), mesmo padrão já usado em
// scripts/test-feature-info.mjs e scripts/test-global-test-mode-banner.mjs.
//
// Uso:
//   node scripts/test-risk-medium-color.mjs

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
console.log("COR DO RISCO MÉDIO (AZUL) — TESTES ESTRUTURAIS");
console.log("======================================");
console.log("");

// --- Token dedicado em globals.css ---

const globalsCss = readSource("apps/web/app/globals.css");

check("globals.css: existe token dedicado --risk-media, separado de --severity-media", () => {
  assert(/--risk-media:\s*oklch\(/.test(globalsCss), "--risk-media não encontrado");
  assert(/--color-risk-media:\s*var\(--risk-media\)/.test(globalsCss), "--color-risk-media não exposto ao Tailwind");
});

check("globals.css: --risk-media está na faixa de matiz AZUL (oklch hue ~200-280), nunca amarelo/laranja (~30-95)", () => {
  const match = globalsCss.match(/--risk-media:\s*oklch\([^)]*\s(\d+(?:\.\d+)?)\)/);
  assert(match, "não foi possível extrair o hue de --risk-media");
  const hue = Number(match[1]);
  assert(hue >= 200 && hue <= 280, `hue ${hue} fora da faixa azul esperada (200-280)`);
});

check("globals.css: --severity-media (âmbar) permanece intocado — outros estados não relacionados a risco (EM_ANALISE, PENDENTE, etc.) não devem mudar de cor", () => {
  assert(/--severity-media:\s*oklch\(0\.75 0\.14 85\)/.test(globalsCss), "--severity-media deveria continuar exatamente oklch(0.75 0.14 85)");
});

// --- Componente compartilhado de severidade (badges.tsx) ---

const badgesSource = readSource("apps/web/components/shared/badges.tsx");

check("badges.tsx: severityClasses.MEDIA usa bg-risk-media sólido + text-white + font-bold", () => {
  assert(
    /MEDIA:\s*"[^"]*bg-risk-media\s+text-white\s+font-bold[^"]*"/.test(badgesSource),
    "MEDIA deveria usar bg-risk-media + text-white + font-bold"
  );
});

check("badges.tsx: severityClasses.MEDIA nunca referencia severity-media/amber/yellow/orange (impede regressão)", () => {
  const mediaLine = badgesSource.match(/MEDIA:\s*"[^"]*"/)?.[0] ?? "";
  assert(mediaLine.length > 0, "linha MEDIA não encontrada em severityClasses");
  assert(!/severity-media|amber|yellow|orange/i.test(mediaLine), `MEDIA não pode referenciar âmbar/amarelo/laranja: "${mediaLine}"`);
});

check("badges.tsx: severityClasses.ALTA continua bg-severity-alta + text-white + font-bold — não afetado pela mudança do MÉDIO", () => {
  assert(
    /ALTA:\s*"border-transparent bg-severity-alta text-white font-bold"/.test(badgesSource),
    "ALTA deveria permanecer exatamente como antes (bg-severity-alta, laranja)"
  );
});

check("badges.tsx: severityClasses.CRITICA continua bg-severity-critica — não afetado", () => {
  assert(
    /CRITICA:\s*"border-transparent bg-severity-critica text-white font-bold"/.test(badgesSource),
    "CRITICA deveria permanecer exatamente como antes"
  );
});

// --- Templates de e-mail (fonte única: contract-alert-template.ts) ---

const contractAlertSource = readSource("apps/web/lib/email/templates/contract-alert-template.ts");
const slaEscalationSource = readSource("apps/web/lib/email/templates/sla-escalation-template.ts");

check("contract-alert-template.ts: BADGE_STYLES.MEDIA é azul (#2563eb) com texto branco, exportado (fonte única)", () => {
  assert(/export const BADGE_STYLES/.test(contractAlertSource), "BADGE_STYLES deveria ser exportado para reaproveitamento");
  const mediaMatch = contractAlertSource.match(/MEDIA:\s*\{[^}]*\}/)?.[0] ?? "";
  assert(mediaMatch.includes("#2563eb"), `MEDIA deveria usar #2563eb: "${mediaMatch}"`);
  assert(mediaMatch.includes('color: "#ffffff"'), `MEDIA deveria usar texto branco: "${mediaMatch}"`);
  assert(!/#f59e0b|#eab308|#fbbf24|#f97316/.test(mediaMatch), `MEDIA não pode usar âmbar/amarelo/laranja: "${mediaMatch}"`);
});

check("contract-alert-template.ts: BADGE_STYLES.ALTA permanece #f97316 (laranja) — não afetado", () => {
  const altaMatch = contractAlertSource.match(/ALTA:\s*\{[^}]*\}/)?.[0] ?? "";
  assert(altaMatch.includes("#f97316"), `ALTA deveria continuar #f97316: "${altaMatch}"`);
});

check("sla-escalation-template.ts: reaproveita BADGE_STYLES de contract-alert-template.ts — nunca duplica o mapa de cores", () => {
  assert(
    slaEscalationSource.includes('BADGE_STYLES } from "./contract-alert-template"') ||
      /import\s*\{[^}]*BADGE_STYLES[^}]*\}\s*from\s*"\.\/contract-alert-template"/.test(slaEscalationSource),
    "sla-escalation-template.ts deveria importar BADGE_STYLES, nunca declarar sua própria cópia"
  );
  assert(!/MEDIA:\s*\{\s*background:/.test(slaEscalationSource), "sla-escalation-template.ts não deveria ter seu próprio BADGE_STYLES.MEDIA — duplicação reintroduzida");
});

// --- Eliminação de duplicação por página (Análise Contratual) ---

check("Análise Contratual (revisao-contratual/page.tsx): não tem mais mapeamento de cor de severidade local — usa o componente compartilhado", () => {
  const source = readSource("apps/web/app/[projectId]/revisao-contratual/page.tsx");
  assert(!/priorityClasses/.test(source), "priorityClasses (mapeamento local duplicado) deveria ter sido removido");
  assert(!/yellow-500|amber-500/.test(source), "não deveria haver mais amarelo/âmbar hardcoded nesta página");
  assert(source.includes("<SeverityBadge"), "deveria usar o componente centralizado SeverityBadge");
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
