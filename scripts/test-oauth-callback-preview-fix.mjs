// Correção do OAuth do Preview (2026-08-30): /auth/callback deixou de
// passar pelo middleware (proxy.ts) — a própria rota já executa
// exchangeCodeForSession e valida o domínio @axion.com.br sozinha, então
// um segundo cliente Supabase (getClaims() do proxy) tocando o mesmo jar
// de cookies da requisição, antes do handler consumir o code_verifier do
// PKCE, era o candidato mais provável para a falha silenciosa observada
// só no Preview. Ao mesmo tempo, o erro de exchangeCodeForSession parou
// de ser descartado silenciosamente — agora é logado de forma
// estruturada e sanitizada (só error.code/status/message do GoTrue,
// nunca o code OAuth, cookies, tokens, query string, headers ou valor de
// variável), diferenciando "Supabase retornou erro" de "sessão ausente
// sem erro".
//
// Checagens estruturais no código-fonte (mesmo padrão já usado por
// scripts/test-email-actions.mjs e scripts/test-brand-background.mjs
// para este mesmo arquivo) — sem subir um servidor Next.js real.
//
// Uso:
//   node scripts/test-oauth-callback-preview-fix.mjs

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

const proxySource = readSource("apps/web/proxy.ts");
const callbackSource = readSource("apps/web/app/auth/callback/route.ts");

// ---------- 1. /auth/callback excluído do proxy ----------

check("proxy.ts: matcher exclui auth/callback (negative lookahead)", () => {
  const matcherMatch = proxySource.match(/matcher:\s*\[\s*([\s\S]*?)\]/);
  assert(matcherMatch, "config.matcher não encontrado em proxy.ts");
  const matcherBody = matcherMatch[1];
  assert(
    /\(\?![^)]*auth\/callback[^)]*\)/.test(matcherBody),
    "auth/callback precisa estar dentro do negative lookahead do matcher (excluído da execução do middleware)"
  );
});

check("proxy.ts: a exclusão de auth/callback está documentada com o motivo (PKCE/cookies)", () => {
  assert(
    /auth\/callback[\s\S]{0,400}(PKCE|code_verifier)/i.test(proxySource) ||
      /(PKCE|code_verifier)[\s\S]{0,400}auth\/callback/i.test(proxySource),
    "esperava um comentário perto da exclusão explicando por que (PKCE/code_verifier)"
  );
});

// Extrai o corpo de um bloco `if (COND) { ... }` por contagem de chaves
// (não por regex com âncora de linha, que quebra com objetos
// multi-linha aninhados dentro do próprio if).
function extractIfBody(source, condition) {
  const marker = `if (${condition}) {`;
  const start = source.indexOf(marker);
  if (start === -1) return null;
  let i = start + marker.length;
  let depth = 1;
  const bodyStart = i;
  while (depth > 0 && i < source.length) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") depth -= 1;
    i += 1;
  }
  return source.slice(bodyStart, i - 1);
}

// ---------- 2. erro de exchangeCodeForSession: log sanitizado + redirect ----------

const errorBranchBody = extractIfBody(callbackSource, "error");
const noSessionBranchBody = extractIfBody(callbackSource, "!data.session");

check("route.ts: branch de erro loga só errorCode/errorStatus/errorMessage e redireciona para oauth_exchange_failed", () => {
  assert(errorBranchBody, "branch 'if (error)' não encontrada");
  assert(errorBranchBody.includes("console.error"), "esperava console.error dentro da branch de erro");
  assert(errorBranchBody.includes("errorCode: error.code"), "esperava logar error.code como errorCode");
  assert(errorBranchBody.includes("errorStatus: error.status"), "esperava logar error.status como errorStatus");
  assert(errorBranchBody.includes("errorMessage: error.message"), "esperava logar error.message como errorMessage");
  assert(errorBranchBody.includes("oauth_exchange_failed"), "esperava redirect para oauth_exchange_failed");
});

// ---------- 3. sessão ausente sem error: registrada separadamente ----------

check("route.ts: branch 'sessão ausente sem erro' é distinta da branch de erro e também loga", () => {
  assert(noSessionBranchBody, "branch 'if (!data.session)' não encontrada — precisa ser um if separado do 'if (error)'");
  assert(noSessionBranchBody.includes("console.error"), "esperava console.error dentro da branch de sessão ausente");
  assert(noSessionBranchBody.includes("oauth_exchange_failed"), "esperava redirect para oauth_exchange_failed também aqui");
  assert(
    noSessionBranchBody.trim() !== errorBranchBody.trim(),
    "as duas branches (erro do provider vs. sessão ausente sem erro) precisam ter mensagens de log diferentes"
  );
});

check("route.ts: a checagem antiga 'error || !data.session' em um único if foi separada em dois ifs", () => {
  assert(
    !callbackSource.includes("if (error || !data.session)"),
    "a condição combinada não deveria mais existir — precisa ser 'if (error)' e 'if (!data.session)' separados, para diferenciar os dois casos no log"
  );
});

// ---------- 4. missing_code e domain_not_allowed inalterados ----------

check("route.ts: !code -> oauth_missing_code inalterado", () => {
  assert(callbackSource.includes('if (!code) {'));
  assert(callbackSource.includes("oauth_missing_code"));
});

check("route.ts: regra de domínio @axion.com.br inalterada (mesma constante, mesmo signOut, mesmo erro)", () => {
  assert(callbackSource.includes('const ALLOWED_EMAIL_DOMAIN = "axion.com.br";'));
  assert(callbackSource.includes("await supabase.auth.signOut();"));
  assert(callbackSource.includes("domain_not_allowed"));
});

check("route.ts: redirect de sucesso (nextDestination) inalterado", () => {
  assert(callbackSource.includes('NextResponse.redirect(new URL(nextDestination, url.origin));'));
  assert(callbackSource.includes("sanitizeInternalRedirect"));
});

// ---------- 5. nenhum valor sensível nos logs ----------

check("route.ts: nenhum console.error referencia o code OAuth, cookies, tokens, headers ou process.env", () => {
  const logCalls = [...callbackSource.matchAll(/console\.error\(([\s\S]*?)\);/g)].map((m) => m[1]);
  assert(logCalls.length >= 2, `esperava pelo menos 2 chamadas console.error, encontradas ${logCalls.length}`);
  const forbidden = [
    /cookie/i,
    /token(?!izer)/i,
    /header/i,
    /process\.env/,
    /request\.url/,
    /searchParams/,
  ];
  for (const call of logCalls) {
    // "error.code" é o campo do erro do GoTrue (esperado e exigido pelo
    // check 2 acima) — removido antes de checar a variável "code" (o
    // authorization code OAuth) isoladamente, que nunca pode aparecer.
    const withoutErrorCode = call.replace(/error\.code/g, "");
    assert(!/\bcode\b/.test(withoutErrorCode), `chamada console.error referencia "code" fora de "error.code": ${call.trim().slice(0, 160)}`);
    for (const pattern of forbidden) {
      assert(!pattern.test(call), `chamada console.error contém algo proibido (padrão ${pattern}): ${call.trim().slice(0, 160)}`);
    }
  }
});

check("route.ts: a variável 'code' (OAuth authorization code) só é lida na declaração, na checagem !code e na troca com o Supabase — nunca em log", () => {
  // Conta ocorrências da palavra "code" fora de comentários e fora de
  // "error.code" — deve sobrar exatamente 4: identificador na
  // declaração, a string literal "code" do searchParams.get, o !code, e
  // o uso dentro de exchangeCodeForSession(code).
  const withoutComments = callbackSource.replace(/\/\/.*$/gm, "");
  const withoutErrorCode = withoutComments.replace(/error\.code/g, "");
  const codeUsages = [...withoutErrorCode.matchAll(/\bcode\b/g)];
  assert(
    codeUsages.length === 4,
    `esperava exatamente 4 ocorrências de "code" fora de comentários/error.code (declaração, string "code", !code, exchangeCodeForSession) — encontradas ${codeUsages.length}`
  );
});

console.log("");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
if (failed > 0) process.exit(1);
