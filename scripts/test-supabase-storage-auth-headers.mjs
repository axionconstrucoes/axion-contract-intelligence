// Cabeçalhos de autenticação do Storage no cliente Supabase instalado.
//
// Registra, de forma verificável e permanente, que @supabase/supabase-js
// envia a chave secreta de formato novo (sb_secret_...) SIMULTANEAMENTE
// em `apikey` e em `Authorization: Bearer` no caminho do Storage — a
// supressão do Bearer (omitApiKeyAsBearer) só é aplicada ao fetch de
// Functions.
//
// ATENÇÃO — o que este comportamento NÃO é:
//
// Ele NÃO é a causa do "Invalid Compact JWS" observado em produção.
// Prova feita contra o projeto real, somente GET, com chave sb_secret
// VÁLIDA obtida da CLI e nunca impressa:
//
//   chave VÁLIDA, só apikey ................. HTTP 200
//   chave VÁLIDA, apikey + Bearer ........... HTTP 200   <- o caminho do SDK
//   chave sb_secret ESTRANHA, só apikey ..... HTTP 400 "authorization obrigatório"
//   chave sb_secret ESTRANHA, apikey+Bearer . HTTP 403 "Invalid Compact JWS"
//
// Ou seja: o gateway reconhece a chave pelo `apikey` e a traduz via
// secret_jwt_template (role=service_role); quando reconhece, o Bearer
// extra é inofensivo. O erro de produção é a assinatura de uma chave
// NÃO RECONHECIDA pelo projeto — problema de configuração da variável
// SUPABASE_SECRET_KEY, não de cabeçalho e não de código.
//
// Este arquivo é mantido porque o comportamento de cabeçalhos do SDK
// segue sendo verdadeiro e vale documentar; só não é o culpado.
//
// Não usa credencial real, não faz rede e não toca no Supabase: lê o
// código realmente instalado em node_modules e exercita a mesma lógica
// de montagem de cabeçalhos com um valor falso.
//
// Uso: node scripts/test-supabase-storage-auth-headers.mjs

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

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

const sdkPath = require.resolve("@supabase/supabase-js/package.json");
const sdkVersion = JSON.parse(readFileSync(sdkPath, "utf8")).version;
const sdkDir = sdkPath.replace(/package\.json$/, "");
const sdkSource = readFileSync(`${sdkDir}dist/index.mjs`, "utf8");

// Valor claramente falso — nenhuma credencial real neste arquivo.
const FAKE_SECRET = "sb_secret_VALOR_FALSO_APENAS_PARA_TESTE";
const FAKE_PUBLISHABLE = "sb_publishable_VALOR_FALSO_APENAS_PARA_TESTE";
const FAKE_LEGACY_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiZmFrZSJ9.assinatura_falsa";

console.log("");
console.log("ETAPA 1 — CABEÇALHOS DE AUTENTICAÇÃO DO STORAGE");
console.log("===============================================");
console.log(`@supabase/supabase-js instalado: ${sdkVersion}`);
console.log("");
console.log("-- 1. o SDK reconhece o formato novo de chave --");

check(
  "o SDK identifica sb_publishable_ / sb_secret_ como chaves de formato novo",
  /isNewApiKey\s*=\s*\(key\)\s*=>\s*key\.startsWith\("sb_publishable_"\)\s*\|\|\s*key\.startsWith\("sb_secret_"\)/.test(
    sdkSource
  )
);

check(
  "o próprio SDK documenta que essas chaves NUNCA devem ir como Bearer",
  /must never be sent as a Bearer token/.test(sdkSource) &&
    /they belong only in the `apikey` header/.test(sdkSource)
);

console.log("");
console.log("-- 2. mas a supressão do Bearer é opcional e NÃO vale para o Storage --");

check(
  "existe a opção interna omitApiKeyAsBearer",
  /omitApiKeyAsBearer/.test(sdkSource)
);

check(
  "o Bearer só é suprimido quando a opção é passada E a chave é de formato novo",
  /const allowKeyAsBearer = !\(\(options[^)]*\)\s*\?[^:]*:[^,]*options\.omitApiKeyAsBearer\) && isNewApiKey\(supabaseKey\)\)/.test(
    sdkSource
  ) || /allowKeyAsBearer = !\(\(options[\s\S]{0,120}omitApiKeyAsBearer\) && isNewApiKey\(supabaseKey\)\)/.test(sdkSource)
);

check(
  "o fetch de Functions PASSA omitApiKeyAsBearer: true",
  /this\.functionsFetch = fetchWithAuth\([\s\S]{0,200}?\{ omitApiKeyAsBearer: true \}\)/.test(
    sdkSource
  )
);

check(
  "o fetch GERAL (this.fetch) NÃO passa a opção",
  (() => {
    const linha = sdkSource
      .split("\n")
      .find((l) => l.includes("this.fetch = fetchWithAuth("));
    return Boolean(linha) && !linha.includes("omitApiKeyAsBearer");
  })()
);

check(
  "o StorageClient usa justamente esse fetch geral",
  /new StorageClient\(this\.storageUrl\.href, this\.headers, this\.fetch/.test(
    sdkSource
  )
);

console.log("");
console.log("-- 3. reprodução da montagem de cabeçalhos (sem rede) --");

// Reprodução fiel do trecho de fetchWithAuth do SDK instalado:
//   if (!headers.has("apikey")) headers.set("apikey", supabaseKey);
//   if (!headers.has("Authorization")) {
//     const bearer = realToken ?? (allowKeyAsBearer ? supabaseKey : null);
//     if (bearer) headers.set("Authorization", `Bearer ${bearer}`);
//   }
function montarCabecalhos(supabaseKey, { omitApiKeyAsBearer = false, sessionToken = null } = {}) {
  const isNewApiKey =
    supabaseKey.startsWith("sb_publishable_") || supabaseKey.startsWith("sb_secret_");
  const allowKeyAsBearer = !(omitApiKeyAsBearer && isNewApiKey);

  const headers = new Headers();
  if (!headers.has("apikey")) headers.set("apikey", supabaseKey);
  if (!headers.has("Authorization")) {
    const bearer = sessionToken ?? (allowKeyAsBearer ? supabaseKey : null);
    if (bearer) headers.set("Authorization", `Bearer ${bearer}`);
  }
  return headers;
}

const storageHeaders = montarCabecalhos(FAKE_SECRET);

check(
  "caminho ATUAL do Storage: apikey recebe a chave secreta",
  storageHeaders.get("apikey") === FAKE_SECRET
);

check(
  "caminho ATUAL do Storage: Authorization TAMBÉM recebe a chave secreta",
  storageHeaders.get("authorization") === `Bearer ${FAKE_SECRET}`
);

check(
  "o valor enviado no Authorization não tem as 3 partes de um JWS compacto",
  FAKE_SECRET.split(".").length !== 3
);

const functionsHeaders = montarCabecalhos(FAKE_SECRET, { omitApiKeyAsBearer: true });

check(
  "com omitApiKeyAsBearer (como em Functions): apikey mantido",
  functionsHeaders.get("apikey") === FAKE_SECRET
);

check(
  "com omitApiKeyAsBearer: nenhum Authorization é enviado",
  functionsHeaders.get("authorization") === null
);

const sessaoHeaders = montarCabecalhos(FAKE_PUBLISHABLE, {
  sessionToken: FAKE_LEGACY_JWT,
});

check(
  "cliente de sessão: Authorization leva o JWT do usuário, não a chave",
  sessaoHeaders.get("authorization") === `Bearer ${FAKE_LEGACY_JWT}` &&
    sessaoHeaders.get("apikey") === FAKE_PUBLISHABLE
);

check(
  "por isso os uploads existentes (documentos, ESG) sempre funcionaram",
  sessaoHeaders.get("authorization").split(" ")[1].split(".").length === 3
);

console.log("");
console.log("-- 4. o upload do Pacote C é o único admin + Storage --");

const storeSource = readFileSync(
  "apps/web/lib/integrations/construmanager/store-content.ts",
  "utf8"
);

check(
  "store-content.ts usa o cliente admin para o Storage",
  /createSupabaseAdminClient\(\)/.test(storeSource) &&
    /admin\.storage/.test(storeSource)
);

check(
  "a mensagem de erro observada nasce do upload, não do download",
  /Falha ao armazenar o conteúdo: \$\{error\.message\}/.test(storeSource)
);

check(
  "nenhuma credencial real aparece neste teste",
  !/eyJ[A-Za-z0-9_-]{20,}\./.test(readFileSync("scripts/test-supabase-storage-auth-headers.mjs", "utf8").replace(FAKE_LEGACY_JWT, ""))
);

console.log("");
console.log("=====================================================================");
console.log(`Resultado: ${passed} passaram, ${failed} falharam.`);

process.exit(failed === 0 ? 0 : 1);
