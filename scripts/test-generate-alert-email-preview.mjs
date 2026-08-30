// Testes de integração do gerador de prévias estáveis
// (scripts/generate-alert-email-preview.mjs) — roda o gerador de verdade
// (só grava em disco, nunca rede/DB/Drive/e-mail real) e inspeciona a
// saída, cobrindo especificamente os dois bugs corrigidos nesta rodada:
//   1. From duplicado/aninhado no .eml (formatSenderHeader chamada 2x)
//   2. Logo repetido (cabeçalho + rodapé) e quebrado na prévia do
//      navegador (cid: não resolve fora de um cliente de e-mail real)
//
// Uso:
//   node scripts/test-generate-alert-email-preview.mjs

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const OUT_DIR = "C:\\Users\\User\\axion-acc-previews";

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
console.log("GERADOR DE PRÉVIAS DE E-MAIL — From/logo (correção pós-checkpoint)");
console.log("======================================");
console.log("");

execFileSync(process.execPath, [path.join(repoRoot, "scripts", "generate-alert-email-preview.mjs")], {
  cwd: repoRoot,
  stdio: "pipe",
});

const eml = readFileSync(path.join(OUT_DIR, "alert-email.eml"), "utf8");
const browserHtml = readFileSync(path.join(OUT_DIR, "alert-email.html"), "utf8");
const bodyHtml = readFileSync(path.join(OUT_DIR, "alert-email-body.html"), "utf8");

check("alert-email.eml: header From correto, exatamente 1 endereço, nunca aninhado/duplicado", () => {
  const fromLine = eml.split("\r\n").find((line) => line.startsWith("From: "));
  assert(fromLine, "header From não encontrado no .eml");
  // Remetente movido para domínio .invalid (RFC 2606) no Bloco 5 desta
  // rodada — a prévia (fixture DUX) nunca mais referencia um endereço
  // real (@axion.com.br), reforçando que nada aqui pode ser confundido
  // com um envio de produção.
  assert(fromLine === 'From: "ACC AXION CONTROLE DE CONTRATOS" <acc_ia_preview@example.invalid>', `From inesperado: ${fromLine}`);
  assert(!fromLine.includes('<"'), "From não deveria conter o padrão de aninhamento <\"");
  assert((fromLine.match(/</g) ?? []).length === 1, "From deveria ter só 1 '<' — nunca dois pares aninhados");
});

check("alert-email.eml: mecanismo cid: real preservado (Content-ID único, imagem anexada uma única vez)", () => {
  const contentIdLines = eml.split("\r\n").filter((line) => line.startsWith("Content-ID: "));
  assert(contentIdLines.length === 1, `esperado exatamente 1 Content-ID no .eml, encontrado ${contentIdLines.length}`);
  assert(contentIdLines[0] === "Content-ID: <acc-logo-signature>", `Content-ID inesperado: ${contentIdLines[0]}`);
});

check("alert-email-body.html (corpo exato como seria enviado): logo aparece 1 única vez (cabeçalho), rodapé só texto/disclaimer", () => {
  const imgCount = (bodyHtml.match(/<img\b/g) ?? []).length;
  assert(imgCount === 1, `esperada exatamente 1 <img> no corpo do e-mail (só o cabeçalho), encontrado ${imgCount}`);
  assert(bodyHtml.includes("cid:acc-logo-signature"), "a única <img> deveria referenciar cid:acc-logo-signature (mecanismo real, nunca alterado no corpo enviado)");
});

check("alert-email.html (prévia de navegador): SEM nenhuma referência cid: (nunca resolve fora de um cliente de e-mail — apareceria como ícone de imagem quebrada)", () => {
  assert(!browserHtml.includes("cid:acc-logo-signature"), "prévia de navegador não deveria conter cid: — precisa estar substituído por data: URI");
});

check("alert-email.html (prévia de navegador): logo visível via data:image/png;base64, exatamente 1 ocorrência (sem duplicar no rodapé)", () => {
  const dataUriCount = (browserHtml.match(/src="data:image\/png;base64,/g) ?? []).length;
  assert(dataUriCount === 1, `esperada exatamente 1 imagem data: URI (o logo do cabeçalho), encontrado ${dataUriCount}`);
  const imgCount = (browserHtml.match(/<img\b/g) ?? []).length;
  assert(imgCount === 1, `esperada exatamente 1 <img> na prévia de navegador, encontrado ${imgCount}`);
});

check("generate-alert-email-preview.mjs: passa o endereço PURO para buildMimeMessage (nunca formatSenderHeader pré-aplicado — o bug original)", () => {
  const scriptSource = readFileSync(path.join(repoRoot, "scripts", "generate-alert-email-preview.mjs"), "utf8");
  // Só verifica USO real (import/chamada) — o script tem um comentário
  // explicando o bug corrigido, que legitimamente menciona o nome da
  // função; isso nunca pode disparar falso positivo aqui.
  assert(!/from ["']\.\.\/apps\/web\/lib\/email\/sender-identity/.test(scriptSource), "generate-alert-email-preview.mjs não deveria mais importar sender-identity.ts — buildMimeMessage já chama formatSenderHeader sozinha");
  assert(!/\bformatSenderHeader\(/.test(scriptSource), "generate-alert-email-preview.mjs não deveria mais CHAMAR formatSenderHeader — buildMimeMessage já chama sozinha");
  assert(/buildMimeMessage\(\s*\{[\s\S]*?\},\s*FIXTURE_SENDER_EMAIL,/.test(scriptSource), "buildMimeMessage deveria receber a constante FIXTURE_SENDER_EMAIL (endereço puro, .invalid) diretamente");
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exitCode = 1;
}
