// Entrada "Ajuda e tutorial" do ACC: item de menu com ajuda, página, rota autenticada que entrega PDF/PPTX
// e arquivos fora de public/. Verificação estática do código-fonte (sem rede, sem banco, sem IA).
//
// Uso: node scripts/test-help-tutorial.mjs

import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = (p) => path.join(root, "apps/web", p);
const read = (p) => readFileSync(web(p), "utf8");
let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`OK   ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}\n     ${error.message}`);
    process.exitCode = 1;
  }
}

const nav = read("lib/ui/nav-items.ts");
const help = read("lib/ui/feature-help.ts");
const files = read("lib/help/tutorial-files.ts");
const route = read("app/[projectId]/ajuda/tutorial/[formato]/route.ts");
const page = read("app/[projectId]/ajuda/page.tsx");
const sidebar = read("components/layout/app-sidebar.tsx");
const nextConfig = read("next.config.ts");

check("menu da obra tem 'Ajuda e tutorial' com helpId existente", () => {
  assert.match(nav, /href: "ajuda", label: "Ajuda e tutorial", icon: "BookOpen", helpId: "ajuda-tutorial"/);
  assert.match(help, /id: "ajuda-tutorial"/);
  assert.match(sidebar, /BookOpen/);
});

check("a rota só aceita os formatos pdf e pptx e exige autenticação e acesso à obra", () => {
  assert.match(files, /pdf: \{/);
  assert.match(files, /pptx: \{/);
  assert.match(route, /isTutorialFormat\(formato\)/);
  assert.match(route, /auth\.getUser\(\)/);
  assert.match(route, /status: 401/);
  assert.match(route, /getProject\(projectId\)/);
  assert.match(route, /status: 404/);
});

check("a rota não monta o caminho do arquivo com entrada do usuário (sem path traversal)", () => {
  assert.doesNotMatch(route, /path\.join\([^)]*formato/);
  assert.match(route, /TUTORIAL_FILES\[formato\]/);
  assert.match(route, /file\.fileName/);
});

check("resposta privada, com nosniff, PDF inline e PPTX como download", () => {
  assert.match(route, /"cache-control": "private/);
  assert.match(route, /"x-content-type-options": "nosniff"/);
  assert.match(files, /disposition: "inline"/);
  assert.match(files, /disposition: "attachment"/);
});

check("os arquivos ficam em content/tutorial, fora de public/, e o Next os inclui no bundle", () => {
  assert.match(route, /path\.join\(process\.cwd\(\), "content", "tutorial", file\.fileName\)/);
  assert.doesNotMatch(route, /\.\.\.TUTORIAL/);
  assert.match(nextConfig, /content\/tutorial\/\*\*/);
  for (const name of ["ACC-apresentacao-e-tutorial.pdf", "ACC-apresentacao-e-tutorial.pptx"]) {
    assert.ok(existsSync(web(`content/tutorial/${name}`)), `${name} ausente em content/tutorial`);
    assert.ok(!existsSync(web(`public/${name}`)), `${name} NÃO pode estar em public/`);
  }
});

check("PDF e PPTX têm assinatura válida e tamanho razoável", () => {
  const pdf = readFileSync(web("content/tutorial/ACC-apresentacao-e-tutorial.pdf"));
  const pptx = readFileSync(web("content/tutorial/ACC-apresentacao-e-tutorial.pptx"));
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.equal(pptx.subarray(0, 2).toString(), "PK");
  for (const [n, f] of [["pdf", "ACC-apresentacao-e-tutorial.pdf"], ["pptx", "ACC-apresentacao-e-tutorial.pptx"]]) {
    const size = statSync(web(`content/tutorial/${f}`)).size;
    assert.ok(size > 100_000 && size < 40 * 1024 * 1024, `${n} com tamanho inesperado: ${size}`);
  }
});

check("a página confirma acesso à obra e oferece PDF e PowerPoint", () => {
  assert.match(page, /getProject\(projectId\)/);
  assert.match(page, /notFound\(\)/);
  assert.match(page, /TUTORIAL_FILES\.pdf\.label/);
  assert.match(page, /TUTORIAL_FILES\.pptx\.label/);
});

check("nenhum segredo nem dado real nos arquivos da entrada de ajuda", () => {
  for (const src of [files, route, page]) assert.doesNotMatch(src, /sk-ant|SUPABASE_SECRET|service_role|password/i);
});

console.log(`RESULTADO: ${passed} passaram, ${process.exitCode ? "com falhas" : "0 falharam"}`);
