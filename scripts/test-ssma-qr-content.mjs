// O QR Code de instalação do app de campo SSMA contém SOMENTE a URL configurada: sem credencial,
// token, sessão nem parâmetro. Verifica o conteúdo codificado de verdade (segmentos do QR), sem rede.
//
// Uso: node scripts/test-ssma-qr-content.mjs

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);
const require = createRequire(import.meta.url);
const QRCode = require("qrcode");
const { resolveSsmaInstallUrl } = await import("../apps/web/lib/ssma/pwa-install.ts");

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`OK   ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`FAIL ${name}`);
    console.log(`     ${error.message}`);
    failed += 1;
  }
}

const decodeQr = (text) => {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  return qr.segments.map((segment) => Buffer.from(segment.data).toString("utf8")).join("");
};

console.log("\n======================================");
console.log("SSMA — CONTEÚDO DO QR CODE");
console.log("======================================\n");

await check("o QR gerado para a URL ilustrativa codifica exatamente a URL (nada além dela)", () => {
  const install = resolveSsmaInstallUrl({ ACC_SSMA_PWA_URL: "https://acc.exemplo.invalid/ssma" });
  assert.equal(install.ok, true);
  assert.equal(decodeQr(install.url), "https://acc.exemplo.invalid/ssma");
});

await check("URL com usuário/senha, parâmetros ou fragmento é RECUSADA — nenhuma credencial entra no QR", () => {
  for (const url of ["https://user:senha@acc.exemplo.invalid/ssma", "https://acc.exemplo.invalid/ssma?token=abc", "https://acc.exemplo.invalid/ssma#sessao"]) {
    const install = resolveSsmaInstallUrl({ ACC_SSMA_PWA_URL: url });
    assert.equal(install.ok, false, url);
    assert.ok(!("url" in install), "sem URL, sem QR");
  }
});

await check("sem configuração não há endereço inventado: a tela avisa e o QR não é gerado", () => {
  const install = resolveSsmaInstallUrl({});
  assert.equal(install.ok, false);
  assert.equal(install.reason, "NOT_CONFIGURED");
});

await check("a base do app gera <base>/ssma e nunca leva segredo (a URL ainda é só origem + caminho)", () => {
  const install = resolveSsmaInstallUrl({ AXION_APP_BASE_URL: "https://acc.exemplo.invalid/" });
  assert.equal(install.ok, true);
  assert.equal(install.url, "https://acc.exemplo.invalid/ssma");
  assert.equal(new URL(install.url).search, "");
  assert.equal(decodeQr(install.url), install.url);
});

console.log("");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
if (failed > 0) process.exit(1);
