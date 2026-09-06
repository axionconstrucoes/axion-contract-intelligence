// Validacao isolada do SUPABASE_SECRET_KEY — prova sem rede e sem
// credencial real.
//
// O fetch e um duble que registra a chamada recebida. Nenhuma requisicao
// sai da maquina, e todos os segredos usados aqui sao explicitamente
// falsos.
//
// Uso: node scripts/test-github-secret-validation.mjs

import { readFileSync } from "node:fs";

const {
  validateSupabaseSecret,
  maskSecret,
  extractProjectRef,
  looksLikeJwt,
  sanitizeBody,
  EXPECTED_PROJECT_REF,
  VALIDATION_PATH,
  MAX_BODY_CHARS,
} = await import("./validate-github-supabase-secret.mjs");

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

// Valores claramente falsos — nenhum segredo real neste arquivo.
const SEGREDO_FALSO = "sb_secret_VALOR_INTEIRAMENTE_FALSO_DE_TESTE";
const URL_OK = `https://${EXPECTED_PROJECT_REF}.supabase.co`;
const ENV_OK = {
  NEXT_PUBLIC_SUPABASE_URL: URL_OK,
  SUPABASE_SECRET_KEY: SEGREDO_FALSO,
};

/** Dublê de fetch: registra a chamada e devolve a resposta combinada. */
function fakeFetch(resposta, registro) {
  return async (url, init) => {
    if (registro) {
      registro.url = url;
      registro.init = init;
      registro.chamadas = (registro.chamadas ?? 0) + 1;
    }
    if (resposta instanceof Error) throw resposta;
    return {
      status: resposta.status,
      text: async () => resposta.body ?? "",
    };
  };
}

const juntar = (r) => r.lines.join("\n");

console.log("");
console.log("VALIDACAO DA SECRET DO GITHUB ACTIONS");
console.log("=====================================");
console.log("");
console.log("-- 1. a requisicao e somente GET, com apikey e SEM Authorization --");

{
  const reg = {};
  const r = await validateSupabaseSecret(
    ENV_OK,
    fakeFetch({ status: 200, body: '{"id":"construmanager-content","public":false}' }, reg)
  );

  check("exatamente UMA requisicao", reg.chamadas === 1);
  check("metodo GET", reg.init.method === "GET");
  check("URL do projeto esperado", reg.url === `${URL_OK}${VALIDATION_PATH}`);
  check("caminho do bucket correto", reg.url.endsWith("/storage/v1/bucket/construmanager-content"));
  check("apikey presente", reg.init.headers.apikey === SEGREDO_FALSO);

  check(
    "Authorization ABSOLUTAMENTE ausente",
    !Object.keys(reg.init.headers).some((h) => h.toLowerCase() === "authorization")
  );

  check(
    "nenhum outro cabecalho alem de apikey",
    Object.keys(reg.init.headers).length === 1
  );

  check("nenhum corpo", reg.init.body === undefined);
  check("nenhuma query string", !reg.url.includes("?"));
  check("redirecionamento NAO e seguido", reg.init.redirect === "error");
  check("ha timeout via AbortSignal", reg.init.signal !== undefined);
  check("HTTP 200 => CONFERE", r.outcome === "CONFERE" && r.exitCode === 0);
}

console.log("");
console.log("-- 2. o segredo nunca aparece --");

{
  const reg = {};
  const r = await validateSupabaseSecret(ENV_OK, fakeFetch({ status: 200, body: "{}" }, reg));
  const saida = juntar(r);

  check("o valor da chave nao aparece na saida", !saida.includes(SEGREDO_FALSO));

  check(
    "nem um pedaco identificavel da chave aparece",
    !saida.includes(SEGREDO_FALSO.slice(10, 16))
  );

  check(
    "so o tipo e o comprimento sao exibidos",
    /sb_secret_… \(comprimento \d+\)/.test(saida)
  );

  check(
    "o mascaramento nao revela caractere do material secreto",
    maskSecret(SEGREDO_FALSO) === `sb_secret_… (comprimento ${SEGREDO_FALSO.length})`
  );

  check("a saida declara apikey presente e Authorization ausente",
    /apikey\s+: PRESENTE/.test(saida) && /Authorization\s+: AUSENTE/.test(saida));

  check(
    "nenhum header completo, cookie, token ou variavel de ambiente na saida",
    !/cookie|set-cookie|bearer|process\.env|NEXT_PUBLIC_SUPABASE_URL=/i.test(saida)
  );
}

console.log("");
console.log("-- 3. bloqueios ANTES de qualquer rede --");

{
  const reg = {};
  const r = await validateSupabaseSecret(
    { NEXT_PUBLIC_SUPABASE_URL: "https://outroprojetoqualquer1.supabase.co", SUPABASE_SECRET_KEY: SEGREDO_FALSO },
    fakeFetch({ status: 200 }, reg)
  );

  check("project ref incorreto => NAO CONFERE", r.outcome === "NAO_CONFERE" && r.exitCode === 1);
  check("e NENHUMA requisicao e feita", reg.chamadas === undefined);
}

{
  const reg = {};
  const r = await validateSupabaseSecret(
    { NEXT_PUBLIC_SUPABASE_URL: URL_OK, SUPABASE_SECRET_KEY: "chave-sem-prefixo-esperado" },
    fakeFetch({ status: 200 }, reg)
  );

  check("chave sem sb_secret_ => NAO CONFERE", r.outcome === "NAO_CONFERE");
  check("e NENHUMA requisicao e feita", reg.chamadas === undefined);
}

{
  const reg = {};
  const r = await validateSupabaseSecret(
    {
      NEXT_PUBLIC_SUPABASE_URL: URL_OK,
      SUPABASE_SECRET_KEY: "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiZmFrZSJ9.assinatura_falsa",
    },
    fakeFetch({ status: 200 }, reg)
  );

  check("chave em formato JWT => NAO CONFERE", r.outcome === "NAO_CONFERE");
  check("e NENHUMA requisicao e feita", reg.chamadas === undefined);
}

{
  const reg = {};
  const r = await validateSupabaseSecret({}, fakeFetch({ status: 200 }, reg));
  check("ambiente vazio => NAO CONFERE", r.outcome === "NAO_CONFERE");
  check("e NENHUMA requisicao e feita", reg.chamadas === undefined);
}

console.log("");
console.log("-- 4. interpretacao de cada status --");

for (const [status, esperado, code] of [
  [200, "CONFERE", 0],
  [400, "NAO_CONFERE", 1],
  [401, "NAO_CONFERE", 1],
  [403, "NAO_CONFERE", 1],
  [500, "INCONCLUSIVO", 2],
]) {
  const r = await validateSupabaseSecret(ENV_OK, fakeFetch({ status, body: "{}" }));
  check(
    `HTTP ${status} => ${esperado} (exit ${code})`,
    r.outcome === esperado && r.exitCode === code
  );
}

{
  const r = await validateSupabaseSecret(
    ENV_OK,
    fakeFetch({ status: 400, body: '{"message":"headers must have required property \'authorization\'"}' })
  );
  check(
    "HTTP 400 explica que o gateway exigiu authorization",
    /exigiu authorization/.test(juntar(r))
  );
}

console.log("");
console.log("-- 5. rede: recusa de redirect, timeout e erro --");

{
  const erro = new Error("unexpected redirect");
  erro.name = "TypeError";
  const r = await validateSupabaseSecret(ENV_OK, fakeFetch(erro));

  check("redirecionamento recusado nao vira NAO CONFERE", r.outcome === "INCONCLUSIVO");
  check("redirecionamento recusado => exit 2", r.exitCode === 2);
}

{
  const erro = new Error("aborted");
  erro.name = "AbortError";
  const r = await validateSupabaseSecret(ENV_OK, fakeFetch(erro));

  check("timeout => INCONCLUSIVO", r.outcome === "INCONCLUSIVO" && r.exitCode === 2);
  check("timeout e identificado como tal", /timeout/.test(juntar(r)));
  check(
    "timeout NAO declara a chave invalida",
    /ausencia de evidencia nao e evidencia de ausencia/i.test(juntar(r))
  );
}

{
  const erro = new Error("fetch failed");
  erro.name = "TypeError";
  const r = await validateSupabaseSecret(ENV_OK, fakeFetch(erro));
  check("erro de rede => INCONCLUSIVO", r.outcome === "INCONCLUSIVO" && r.exitCode === 2);
}

console.log("");
console.log("-- 6. sanitizacao do corpo --");

check(`corpo e limitado a ${MAX_BODY_CHARS} caracteres`,
  sanitizeBody("x".repeat(1000)).length === MAX_BODY_CHARS);
check("quebras de linha viram espaco", sanitizeBody("a\n\nb") === "a b");

{
  const r = await validateSupabaseSecret(
    ENV_OK,
    fakeFetch({ status: 200, body: "y".repeat(5000) })
  );
  const linhaCorpo = r.lines.find((l) => l.startsWith("corpo (sanitizado)"));
  check("o corpo ecoado no log respeita o limite", linhaCorpo.length < MAX_BODY_CHARS + 40);
}

console.log("");
console.log("-- 7. auxiliares --");

check("extrai o ref de uma URL valida", extractProjectRef(URL_OK) === EXPECTED_PROJECT_REF);
check("recusa URL sem https", extractProjectRef(`http://${EXPECTED_PROJECT_REF}.supabase.co`) === null);
check("recusa host diferente", extractProjectRef("https://exemplo.com") === null);
check("detecta formato JWT", looksLikeJwt("a.b.c") === true);
check("sb_secret nao e JWT", looksLikeJwt(SEGREDO_FALSO) === false);

// ---------------------------------------------------------------------
// Auditoria do workflow e do script reais
// ---------------------------------------------------------------------

const WF = readFileSync(".github/workflows/construmanager-credential-validation.yml", "utf8");
const SCRIPT = readFileSync("scripts/validate-github-supabase-secret.mjs", "utf8");

console.log("");
console.log("-- 8. workflow isolado --");

check("workflow_dispatch e o UNICO trigger",
  /^on:\s*\n\s*workflow_dispatch:\s*$/m.test(WF));
check("nenhum schedule", !/^\s*schedule:/m.test(WF));
check("nenhum push", !/^\s*push:/m.test(WF));
check("nenhum pull_request", !/^\s*pull_request:/m.test(WF));
check("permissions contents: read", /permissions:\s*\n\s*contents: read/.test(WF));
check("nenhuma permissao de escrita", !/:\s*write/.test(WF));
check("timeout de ate 5 minutos", /timeout-minutes:\s*5\b/.test(WF));
check("tem concurrency propria",
  /concurrency:\s*\n\s*group: construmanager-credential-validation/.test(WF));
check("nenhum environment de deployment", !/^\s*environment:/m.test(WF));
check("nenhum artifact", !/upload-artifact|download-artifact/.test(WF));

check(
  "nenhum cache configurado",
  // Ignora comentarios: a prosa que EXPLICA por que nao ha cache nao
  // pode ser confundida com a configuracao de um.
  !WF.split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n")
    .includes("cache:")
);

check(
  "estruturalmente incapaz de rodar os tres workers",
  !/construmanager-metadata-worker|construmanager-version-monitor|construmanager-content-worker/.test(WF)
);

check(
  "nao recebe credenciais do Construmanager",
  !/CONSTRUMANAGER_LOGIN|CONSTRUMANAGER_PASSWORD|CONSTRUMANAGER_BASE_URL/.test(WF)
);

check(
  "nao recebe os interruptores de ativacao",
  !/CONSTRUMANAGER_AUTO_DOWNLOAD_ENABLED|CONSTRUMANAGER_METADATA_SYNC_ENABLED|CONSTRUMANAGER_VERSION_MONITORING_ENABLED/.test(WF)
);

check("nenhum acesso a Vercel", !/vercel|VERCEL/.test(WF));
check("segredo chega por env, nunca em argv", /run: node scripts\/validate-github-supabase-secret\.mjs\s*\n\s*env:/.test(WF));
check("nenhum segredo literal no workflow",
  !/sb_secret_[A-Za-z0-9]{6,}|eyJ[A-Za-z0-9_-]{20,}\./.test(WF));
check("nenhum echo de secret", !/echo .*secrets\./.test(WF));
check("nenhum shell trace habilitado", !/set -x|ACTIONS_STEP_DEBUG|ACTIONS_RUNNER_DEBUG/.test(WF));

console.log("");
console.log("-- 9. script: somente leitura --");

check("nenhuma escrita HTTP no script",
  !/method:\s*["'](POST|PUT|PATCH|DELETE)["']/.test(SCRIPT));
check("nao usa o SDK do Supabase", !/@supabase\/supabase-js|createClient/.test(SCRIPT));
check("nao chama RPC", !/\.rpc\(/.test(SCRIPT));
check("nenhum INSERT/UPDATE/DELETE", !/\b(insert|update|delete)\s+(into|from|set)\b/i.test(SCRIPT));
check("nao toca no Storage por upload", !/\.upload\(|storage\.from\(/.test(SCRIPT));
check("nao le argv", !/process\.argv\[2\]|argv\.slice\(2\)/.test(SCRIPT));
check("le o segredo somente de env", /env\.SUPABASE_SECRET_KEY/.test(SCRIPT));
check("nenhum segredo literal no script",
  !/sb_secret_[A-Za-z0-9]{6,}(?!VALOR)/.test(SCRIPT.replace(/sb_secret_…/g, "")));

check(
  "importar o modulo NAO dispara requisicao (guarda de execucao direta)",
  /executadoDiretamente/.test(SCRIPT) && /if \(executadoDiretamente\)/.test(SCRIPT)
);

check(
  "o script nao referencia os workers operacionais",
  !/metadata-worker|version-monitor|content-worker|collectConstrumanagerMetadata|downloadConstrumanagerContent/.test(
    SCRIPT
  )
);

console.log("");
console.log("=====================================================================");
console.log(`Resultado: ${passed} passaram, ${failed} falharam.`);

process.exit(failed === 0 ? 0 : 1);
