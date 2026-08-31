// Testes da etiqueta global "SISTEMA EM TESTE" (banner de topo,
// controlado por NEXT_PUBLIC_ACC_TEST_MODE). Este projeto não tem
// framework de teste de componentes React (sem jsdom/testing-library
// instalado) — testes de CONTEÚDO (regra fail-safe da variável) são
// reais; testes de presença no layout global e das classes visuais
// essenciais são ESTRUTURAIS (leitura do código-fonte), mesmo padrão
// já usado em scripts/test-feature-info.mjs.
//
// Uso:
//   node scripts/test-global-test-mode-banner.mjs

import { readdirSync, readFileSync, statSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const { isTestModeBannerVisible, ACC_TEST_MODE_BANNER_TEXT } = await import("../apps/web/lib/test-mode");

// Instante de referência ANTES do marco de startup/go-live
// (2026-09-07T12:00:00.000Z = 09:00 America/Sao_Paulo — ver
// apps/web/lib/acc-go-live.ts) — usado explicitamente nos testes da
// regra fail-safe abaixo para que continuem corretos mesmo depois que o
// relógio real ultrapassar o marco (sem isso, os testes começariam a
// falhar silenciosamente a partir de 07/09/2026 09:00, já que o
// go-live passaria a desligar a etiqueta incondicionalmente).
const BEFORE_GO_LIVE = new Date("2026-09-07T11:59:59.000Z");

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
console.log('ETIQUETA GLOBAL "SISTEMA EM TESTE" — TESTES');
console.log("======================================");
console.log("");

// --- Texto correto ---

check('texto exato é "SISTEMA EM TESTE"', () => {
  assert(ACC_TEST_MODE_BANNER_TEXT === "SISTEMA EM TESTE", `texto obtido: "${ACC_TEST_MODE_BANNER_TEXT}"`);
});

// --- Regra fail-safe (seção 3 do requisito) — sempre avaliada ANTES do
// marco de startup/go-live (ver BEFORE_GO_LIVE acima); o comportamento
// A PARTIR do marco tem sua própria seção logo abaixo. ---

check("exibição por padrão: valor ausente (undefined) mostra a etiqueta", () => {
  assert(isTestModeBannerVisible(undefined, BEFORE_GO_LIVE) === true);
});

check('exibição com "true": mostra a etiqueta', () => {
  assert(isTestModeBannerVisible("true", BEFORE_GO_LIVE) === true);
});

check("ocultação somente com \"false\" (exato): qualquer outro valor mostra", () => {
  assert(isTestModeBannerVisible("false", BEFORE_GO_LIVE) === false, 'exatamente "false" deveria ocultar');
  assert(isTestModeBannerVisible("", BEFORE_GO_LIVE) === true, "vazio deveria mostrar");
  assert(isTestModeBannerVisible("FALSE", BEFORE_GO_LIVE) === true, '"FALSE" (caixa diferente) é inválido — deveria mostrar');
  assert(isTestModeBannerVisible("0", BEFORE_GO_LIVE) === true, '"0" é inválido — deveria mostrar');
  assert(isTestModeBannerVisible("nao", BEFORE_GO_LIVE) === true, "qualquer valor inválido deveria mostrar");
});

// --- A PARTIR do marco de startup/go-live: desligamento automático e
// incondicional, independente do valor de NEXT_PUBLIC_ACC_TEST_MODE ---

check("no instante exato do go-live (09:00 America/Sao_Paulo), a etiqueta some mesmo com valor ausente/inválido", () => {
  const exactlyGoLive = new Date("2026-09-07T12:00:00.000Z");
  assert(isTestModeBannerVisible(undefined, exactlyGoLive) === false);
  assert(isTestModeBannerVisible("true", exactlyGoLive) === false);
  assert(isTestModeBannerVisible("nao-e-um-valor-valido", exactlyGoLive) === false);
});

check("após o go-live, a etiqueta permanece oculta mesmo se NEXT_PUBLIC_ACC_TEST_MODE for reintroduzida como \"true\" (o marco de negócio já ocorrido não é reversível por env var)", () => {
  const afterGoLive = new Date("2026-09-07T12:00:01.000Z");
  assert(isTestModeBannerVisible("true", afterGoLive) === false);
});

check("um segundo antes do go-live, a regra fail-safe de antes do marco ainda vale integralmente", () => {
  assert(isTestModeBannerVisible(undefined, BEFORE_GO_LIVE) === true);
  assert(isTestModeBannerVisible("false", BEFORE_GO_LIVE) === false);
});

// --- Presença no layout global (nunca por página) ---

const rootLayoutSource = readSource("apps/web/app/layout.tsx");

check("layout raiz importa e renderiza <TestModeBanner /> uma única vez", () => {
  assert(rootLayoutSource.includes('import { TestModeBanner } from "@/components/layout/test-mode-banner"'));
  assert(rootLayoutSource.includes("<TestModeBanner />"));
  const occurrences = (rootLayoutSource.match(/<TestModeBanner \/>/g) ?? []).length;
  assert(occurrences === 1, `<TestModeBanner /> deveria aparecer exatamente 1 vez no layout raiz, encontrado ${occurrences}`);
});

function listFilesRecursive(dir) {
  const result = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      result.push(...listFilesRecursive(full));
    } else if (entry === "page.tsx") {
      result.push(full);
    }
  }
  return result;
}

check("nenhuma page.tsx renderiza TestModeBanner manualmente (implementação centralizada, seção 1)", () => {
  const pageFiles = listFilesRecursive(path.join(repoRoot, "apps/web/app"));
  assert(pageFiles.length > 0, "nenhuma page.tsx encontrada — verificação inconclusiva");
  const offenders = pageFiles.filter((file) => readFileSync(file, "utf8").includes("TestModeBanner"));
  assert(offenders.length === 0, `page.tsx renderizando TestModeBanner manualmente: ${offenders.join(", ")}`);
});

// --- Classes visuais essenciais: faixas diagonais amarelo/preto, texto sobre placa preta, sem cantos arredondados ---

const bannerSource = readSource("apps/web/components/layout/test-mode-banner.tsx");

check("banner: fundo com faixas diagonais amarelo/preto via repeating-linear-gradient (nunca cor sólida)", () => {
  assert(/repeating-linear-gradient\(45deg/.test(bannerSource), "repeating-linear-gradient 45deg não encontrado");
  assert(/#facc15/i.test(bannerSource), "amarelo (#facc15) não encontrado no gradiente");
  assert(/#000000/.test(bannerSource), "preto (#000000) não encontrado no gradiente");
});

check("banner: texto SISTEMA EM TESTE fica sobre uma placa preta sólida central (proteção de contraste contra as diagonais)", () => {
  assert(/bg-black/.test(bannerSource), "classe bg-black (placa central) não encontrada");
});

check("banner: texto branco ou amarelo, em negrito (contraste garantido sobre a placa preta)", () => {
  assert(/text-white|text-yellow-\d{3}/.test(bannerSource), "texto deveria ser branco ou amarelo");
  assert(bannerSource.includes("font-bold"), "classe font-bold não encontrada");
});

check("banner: retangular — nenhuma classe rounded-* aplicada", () => {
  assert(!/rounded(-[a-z0-9]+)?/.test(bannerSource), "banner não deveria ter cantos arredondados");
});

check("banner: centralizado horizontalmente (justify-center) e responsivo (largura total, nunca fixa em px)", () => {
  assert(bannerSource.includes("justify-center"), "conteúdo deveria estar centralizado horizontalmente");
  assert(bannerSource.includes("w-full"), "banner deveria ocupar a largura total (responsivo)");
  assert(!/\bw-\[\d+px\]/.test(bannerSource), "banner não deveria ter largura fixa em pixels");
});

check("banner: sempre visível no topo, sem sobrepor conteúdo (fluxo normal + sticky, nunca fixed/absolute)", () => {
  assert(bannerSource.includes("sticky top-0"), "banner deveria ser sticky no topo");
  assert(!/\bfixed\b/.test(bannerSource), "banner nunca deveria usar position:fixed (sairia do fluxo e poderia sobrepor conteúdo)");
  assert(!/\babsolute\b/.test(bannerSource), "banner nunca deveria usar position:absolute (sairia do fluxo e poderia sobrepor conteúdo)");
});

// --- Regra fail-safe: nunca esconder por engano quando ausente/inválido ---

check("banner: quando visível, retorna elemento; quando oculto (false exato), retorna null (nunca lança)", () => {
  assert(bannerSource.includes("if (!isTestModeBannerVisible()) return null;"));
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
