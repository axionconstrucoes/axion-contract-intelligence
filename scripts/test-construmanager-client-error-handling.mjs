// Testes de tratamento de erro do ConstrumanagerClient — SEM chamar a
// API real (fetch mockado neste processo, restaurado ao final). Cobre
// os casos que o teste ao vivo (test-construmanager-connection.mjs)
// não pode cobrir com segurança: credenciais inválidas, token
// ausente/malformado, obra não encontrada, resposta malformada, HTTP
// de erro e timeout. Nunca imprime nem inspeciona qualquer valor de
// senha/token real — este arquivo não lê apps/web/.env.local.
//
// Uso:
//   node scripts/test-construmanager-client-error-handling.mjs

import { register } from "node:module";
register("./ts-module-resolver.mjs", import.meta.url);

const { ConstrumanagerClient } = await import(
  "../apps/web/lib/integrations/construmanager/client.ts"
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

async function expectRejects(promise, matcher, label) {
  try {
    await promise;
    check(label, false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(label, matcher(message));
  }
}

const TEST_CONFIG = {
  baseUrl: "https://api.construmanager.invalid.test",
  login: "teste@axion.com.br",
  password: "senha-fake-nunca-real",
  timeoutMs: 50,
};

const originalFetch = globalThis.fetch;

function mockFetchOnce(responderOrError) {
  globalThis.fetch = async (_url, _init) => {
    globalThis.fetch = originalFetch;
    if (responderOrError instanceof Error) throw responderOrError;
    return responderOrError;
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

console.log("");
console.log("CONSTRUMANAGER CLIENT — TRATAMENTO DE ERRO (sem rede real)");
console.log("===========================================================");

// 1. Autenticação inválida — API responde 200 mas status.id !== 1
{
  const client = new ConstrumanagerClient(TEST_CONFIG);
  mockFetchOnce(jsonResponse(200, { status: { id: 0, description: "Usuário ou senha inválidos" } }));
  await expectRejects(
    client.authenticate(),
    (msg) => msg.includes("authentication failed") && msg.includes("Usuário ou senha inválidos"),
    "autenticação inválida (status.id !== 1) rejeita com mensagem da API"
  );
}

// 2. Autenticação com HTTP de erro explícito (401/500)
{
  const client = new ConstrumanagerClient(TEST_CONFIG);
  mockFetchOnce({ ok: false, status: 401, text: async () => "" });
  await expectRejects(
    client.authenticate(),
    (msg) => msg.includes("HTTP 401"),
    "autenticação com HTTP 401 é tratada como erro explícito (nunca silenciosa)"
  );
}

// 3. Autenticação com sessão de usuário inválida (token curto demais)
{
  const client = new ConstrumanagerClient(TEST_CONFIG);
  mockFetchOnce(
    jsonResponse(200, {
      status: { id: 1, description: "OK" },
      user: { id: 1, companyId: 1645, token: "abc" },
    })
  );
  await expectRejects(
    client.authenticate(),
    (msg) => msg.includes("invalid user session"),
    "authenticate() rejeita token intermediário curto demais (<10 chars)"
  );
}

// 4. getAccessToken com token ausente/malformado — nunca chega a chamar fetch
{
  const client = new ConstrumanagerClient(TEST_CONFIG);
  let fetchWasCalled = false;
  globalThis.fetch = async () => {
    fetchWasCalled = true;
    return jsonResponse(200, {});
  };
  await expectRejects(
    client.getAccessToken(""),
    (msg) => msg.includes("intermediate token is invalid"),
    "getAccessToken('') rejeita ANTES de chamar a rede"
  );
  check("getAccessToken('') nunca chega a chamar fetch", fetchWasCalled === false);
  globalThis.fetch = originalFetch;
}

{
  const client = new ConstrumanagerClient(TEST_CONFIG);
  await expectRejects(
    client.getAccessToken("curto"),
    (msg) => msg.includes("intermediate token is invalid"),
    "getAccessToken() rejeita token intermediário malformado (< 10 chars)"
  );
}

// 5. getAccessToken sem access_token válido na resposta
{
  const client = new ConstrumanagerClient(TEST_CONFIG);
  mockFetchOnce(jsonResponse(200, { access_token: "", expires_in: 0 }));
  await expectRejects(
    client.getAccessToken("token-intermediario-valido"),
    (msg) => msg.includes("did not return a valid access token"),
    "getAccessToken() rejeita quando access_token vem vazio"
  );
}

// 6. listWorks — obra/empresa não encontrada (status.id !== 0)
{
  const client = new ConstrumanagerClient(TEST_CONFIG);
  mockFetchOnce(
    jsonResponse(200, { status: { id: 1, description: "Empresa não encontrada" }, listWork: [] })
  );
  await expectRejects(
    client.listWorks("bearer-token-valido-1234567890", 1645),
    (msg) => msg.includes("Obra/List failed") && msg.includes("Empresa não encontrada"),
    "listWorks() rejeita quando a API reporta empresa/obra não encontrada"
  );
}

// 7. listWorks — companyId inválido nunca chega a chamar a rede
{
  const client = new ConstrumanagerClient(TEST_CONFIG);
  let fetchWasCalled = false;
  globalThis.fetch = async () => {
    fetchWasCalled = true;
    return jsonResponse(200, {});
  };
  await expectRejects(
    client.listWorks("bearer-token-valido-1234567890", -1),
    (msg) => msg.includes("companyId is invalid"),
    "listWorks() rejeita companyId inválido antes de chamar a rede"
  );
  check("listWorks() com companyId inválido nunca chama fetch", fetchWasCalled === false);
  globalThis.fetch = originalFetch;
}

// 8. listWorks — resposta com listWork ausente/malformada
{
  const client = new ConstrumanagerClient(TEST_CONFIG);
  mockFetchOnce(jsonResponse(200, { status: { id: 0, description: "OK" }, listWork: "não é um array" }));
  await expectRejects(
    client.listWorks("bearer-token-valido-1234567890", 1645),
    (msg) => msg.includes("invalid work list"),
    "listWorks() rejeita quando listWork não é um array"
  );
}

// 9. Timeout — nenhuma resposta chega antes do timeoutMs configurado
{
  const client = new ConstrumanagerClient(TEST_CONFIG);
  globalThis.fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const abortError = new Error("The operation was aborted.");
        abortError.name = "AbortError";
        reject(abortError);
      });
    });
  await expectRejects(
    client.authenticate(),
    (msg) => msg.includes("timed out after 50 ms"),
    "authenticate() trata timeout explicitamente (nunca trava indefinidamente)"
  );
  globalThis.fetch = originalFetch;
}

// 10. Nenhum segredo aparece em nenhuma mensagem de erro capturada acima
{
  const client = new ConstrumanagerClient(TEST_CONFIG);
  mockFetchOnce({ ok: false, status: 500, text: async () => "erro interno" });
  try {
    await client.authenticate();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(
      "mensagem de erro nunca contém a senha configurada",
      !message.includes(TEST_CONFIG.password)
    );
  }
}

globalThis.fetch = originalFetch;

console.log("");
console.log("===========================================================");
console.log(`RESULT: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exitCode = 1;
}
