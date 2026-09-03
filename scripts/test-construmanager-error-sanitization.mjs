// Testes puros de sanitize-error.ts (sem rede, sem sessão Supabase).
// Garante que nenhum token/senha escapa para UI/banco e que a
// classificação ATENCAO/ERRO usada por validateConstrumanagerConnectionAction
// está correta.
//
// Uso:
//   node scripts/test-construmanager-error-sanitization.mjs

import { register } from "node:module";
register("./ts-module-resolver.mjs", import.meta.url);

const { sanitizeIntegrationConnectionError, classifyConstrumanagerConnectionFailure } = await import(
  "../apps/web/lib/integrations/construmanager/sanitize-error.ts"
);

let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) {
    console.log(`OK   ${name}`);
    passed += 1;
  } else {
    console.log(`FAIL ${name}`);
    failed += 1;
  }
}

console.log("");
console.log("CONSTRUMANAGER — SANITIZAÇÃO E CLASSIFICAÇÃO DE ERRO");
console.log("======================================================");

check(
  "redige 'Bearer <token>' de dentro de uma mensagem de erro",
  sanitizeIntegrationConnectionError(new Error("failed with Authorization: Bearer abc123def456ghi")) ===
    "failed with Authorization: Bearer [REDACTED]"
);

check(
  "redige 'token=<valor>' de dentro de uma mensagem de erro",
  sanitizeIntegrationConnectionError(new Error("bad token=abc123def456")).includes("token=[REDACTED]")
);

check(
  "redige 'token: <valor>' (com dois-pontos) também",
  sanitizeIntegrationConnectionError(new Error("invalid token: abc123def456")).includes("token=[REDACTED]")
);

check(
  "trunca mensagens muito longas em 500 caracteres",
  sanitizeIntegrationConnectionError(new Error("x".repeat(2000))).length === 500
);

check(
  "converte valores não-Error em string sem lançar",
  sanitizeIntegrationConnectionError("uma string qualquer") === "uma string qualquer"
);

check(
  "timeout é classificado como ATENCAO (falha transitória)",
  classifyConstrumanagerConnectionFailure("Construmanager request /Login/Auth timed out after 15000 ms.") === "ATENCAO"
);

check(
  "HTTP 500 é classificado como ATENCAO",
  classifyConstrumanagerConnectionFailure("Construmanager request /Obra/List failed with HTTP 503.") === "ATENCAO"
);

check(
  "HTTP 429 (rate limit) é classificado como ATENCAO",
  classifyConstrumanagerConnectionFailure("Construmanager request /Login/Auth failed with HTTP 429.") === "ATENCAO"
);

check(
  "credencial inválida (sem sinal de rede) é classificada como ERRO",
  classifyConstrumanagerConnectionFailure("Construmanager authentication failed: Usuário ou senha inválidos") === "ERRO"
);

check(
  "obra não encontrada é classificada como ERRO (config, não rede)",
  classifyConstrumanagerConnectionFailure("A obra configurada (34164) não está disponível para este usuário no Construmanager.") ===
    "ERRO"
);

console.log("");
console.log("======================================================");
console.log(`RESULT: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exitCode = 1;
}
