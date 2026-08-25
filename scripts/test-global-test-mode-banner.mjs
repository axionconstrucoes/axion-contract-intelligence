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

// --- Regra fail-safe (seção 3 do requisito) ---

check("exibição por padrão: valor ausente (undefined) mostra a etiqueta", () => {
  assert(isTestModeBannerVisible(undefined) === true);
});

check('exibição com "true": mostra a etiqueta', () => {
  assert(isTestModeBannerVisible("true") === true);
});

check("ocultação somente com \"false\" (exato): qualquer outro valor mostra", () => {
  assert(isTestModeBannerVisible("false") === false, 'exatamente "false" deveria ocultar');
  assert(isTestModeBannerVisible("") === true, "vazio deveria mostrar");
  assert(isTestModeBannerVisible("FALSE") === true, '"FALSE" (caixa diferente) é inválido — deveria mostrar');
  assert(isTestModeBannerVisible("0") === true, '"0" é inválido — deveria mostrar');
  assert(isTestModeBannerVisible("nao") === true, "qualquer valor inválido deveria mostrar");
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

// --- Classes visuais essenciais: fundo vermelho, texto branco, sem cantos arredondados ---

const bannerSource = readSource("apps/web/components/layout/test-mode-banner.tsx");

check("banner: fundo vermelho de alto contraste (bg-red-*)", () => {
  assert(/bg-red-\d{3}/.test(bannerSource), "classe bg-red-* não encontrada");
});

check("banner: texto branco e em negrito", () => {
  assert(bannerSource.includes("text-white"), "classe text-white não encontrada");
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
