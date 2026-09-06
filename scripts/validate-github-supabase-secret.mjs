// Prova funcional de que o SUPABASE_SECRET_KEY guardado nos secrets do
// GitHub Actions e uma sb_secret VALIDA do projeto esperado.
//
// POR QUE ISTO EXISTE
//
// O primeiro download do piloto morreu com "Invalid Compact JWS" porque
// a chave configurada na Vercel nao era reconhecida pelo projeto. O
// worker headless usa o MESMO segredo, guardado agora no GitHub. Secrets
// do GitHub sao write-only pela API: nao da para conferir de fora. A
// unica forma honesta de saber e' de dentro de um run — e sem nunca
// imprimir o valor.
//
// GARANTIAS ESTRUTURAIS
//
//   - uma unica requisicao, sempre GET;
//   - `apikey` presente, `Authorization` DELIBERADAMENTE AUSENTE. E'
//     exatamente essa combinacao que prova que o gateway reconhece a
//     chave e a traduz via secret_jwt_template, sem depender de JWT;
//   - sem corpo, sem query string, sem redirecionamento seguido;
//   - fetch direto, NAO o SDK do Supabase: o SDK injeta
//     `Authorization: Bearer <chave>` sozinho, e e' justamente esse
//     cabecalho extra que precisamos garantir que nao vai;
//   - nenhuma escrita: GET num endpoint de leitura de bucket;
//   - o valor da chave nunca aparece em log, argv ou mensagem de erro.
//
// Exit codes:
//   0  CONFERE
//   1  NAO CONFERE
//   2  INCONCLUSIVO (rede/timeout — ausencia de evidencia nao e' prova
//      de chave invalida)
//
// Uso (o segredo vem SO do ambiente, nunca de argv):
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SECRET_KEY=... \
//     node scripts/validate-github-supabase-secret.mjs

/** Project ref que o segredo precisa atender. */
export const EXPECTED_PROJECT_REF = "plbcvwostmdmdmrziwmd";

/** Bucket usado como alvo da leitura. Endpoint administrativo, sem escrita. */
export const VALIDATION_PATH = "/storage/v1/bucket/construmanager-content";

/** Teto do corpo ecoado no log. Resposta de terceiro pode ser verbosa. */
export const MAX_BODY_CHARS = 200;

const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Mascara a chave para exibicao.
 *
 * Devolve SOMENTE o tipo e o comprimento. Nao expoe nenhum caractere do
 * material secreto — nem os primeiros: um prefixo de 5 caracteres ja
 * identifica qual das chaves do projeto esta em uso, e essa e' uma
 * informacao que o log nao precisa carregar.
 */
export function maskSecret(secret) {
  return `sb_secret_… (comprimento ${secret.length})`;
}

/** Extrai o project ref de uma URL `https://<ref>.supabase.co`. */
export function extractProjectRef(url) {
  const match = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/i.exec(String(url).trim());
  return match ? match[1] : null;
}

/** Formato de JWT compacto: tres partes separadas por ponto. */
export function looksLikeJwt(value) {
  return String(value).split(".").length === 3;
}

/** Corta e higieniza o corpo da resposta antes de qualquer log. */
export function sanitizeBody(body) {
  return String(body).replace(/\s+/g, " ").slice(0, MAX_BODY_CHARS).trim();
}

/**
 * Executa a validacao.
 *
 * `fetchImpl` e injetavel para que o teste exercite todos os desfechos
 * sem rede e sem credencial real.
 */
export async function validateSupabaseSecret(env, fetchImpl = fetch) {
  const lines = [];
  const say = (line) => lines.push(line);

  const url = String(env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const secret = String(env.SUPABASE_SECRET_KEY ?? "").trim();

  say(`project ref esperado : ${EXPECTED_PROJECT_REF}`);

  // ---- Checagens locais, ANTES de qualquer rede ----

  if (url === "" || secret === "") {
    say("resultado            : NAO CONFERE (URL ou segredo ausente no ambiente)");
    return { outcome: "NAO_CONFERE", exitCode: 1, lines };
  }

  const ref = extractProjectRef(url);

  if (ref === null) {
    say("resultado            : NAO CONFERE (NEXT_PUBLIC_SUPABASE_URL nao e uma URL de projeto Supabase)");
    return { outcome: "NAO_CONFERE", exitCode: 1, lines };
  }

  if (ref !== EXPECTED_PROJECT_REF) {
    // O ref e' publico (vai no bundle do navegador), entao pode aparecer.
    say(`project ref recebido : ${ref}`);
    say("resultado            : NAO CONFERE (a URL aponta para OUTRO projeto)");
    return { outcome: "NAO_CONFERE", exitCode: 1, lines };
  }

  if (!secret.startsWith("sb_secret_")) {
    say("formato do segredo   : NAO comeca com sb_secret_");
    say("resultado            : NAO CONFERE (formato inesperado — nao e uma secret key nova)");
    return { outcome: "NAO_CONFERE", exitCode: 1, lines };
  }

  if (looksLikeJwt(secret)) {
    say("formato do segredo   : tem estrutura de JWT");
    say("resultado            : NAO CONFERE (esperada sb_secret, recebida chave em formato JWT)");
    return { outcome: "NAO_CONFERE", exitCode: 1, lines };
  }

  say(`formato do segredo   : ${maskSecret(secret)}`);
  say("metodo               : GET");
  say(`caminho              : ${VALIDATION_PATH}`);
  say("apikey               : PRESENTE (mascarada)");
  say("Authorization        : AUSENTE");
  say("corpo                : nenhum");
  say("query string         : nenhuma");

  // ---- Requisicao ----

  const alvo = `https://${EXPECTED_PROJECT_REF}.supabase.co${VALIDATION_PATH}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let resposta;

  try {
    resposta = await fetchImpl(alvo, {
      method: "GET",
      // `apikey` e' o UNICO cabecalho de credencial. Authorization nao e'
      // definido em lugar nenhum deste objeto — de proposito.
      headers: { apikey: secret },
      // Redirecionamento nao e' seguido: um 3xx para outro host levaria a
      // chave junto. Vira erro, e o erro e' o resultado correto.
      redirect: "error",
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);

    const abortado = error instanceof Error && error.name === "AbortError";
    const nome = error instanceof Error ? error.name : "erro";

    say(`falha de transporte  : ${abortado ? "timeout" : nome}`);
    say("resultado            : INCONCLUSIVO (sem resposta utilizavel do servidor)");
    say("A chave NAO e declarada invalida: ausencia de evidencia nao e evidencia de ausencia.");

    return { outcome: "INCONCLUSIVO", exitCode: 2, lines };
  }

  clearTimeout(timeout);

  const status = resposta.status;
  let corpo = "";

  try {
    corpo = sanitizeBody(await resposta.text());
  } catch {
    corpo = "(corpo ilegivel)";
  }

  say(`status HTTP          : ${status}`);
  say(`corpo (sanitizado)   : ${corpo}`);

  if (status === 200) {
    say("resultado            : CONFERE");
    say("A chave e aceita pelo Storage do projeto esperado, usando apenas o cabecalho apikey.");
    return { outcome: "CONFERE", exitCode: 0, lines };
  }

  if (status === 400) {
    say("resultado            : NAO CONFERE");
    say("O gateway exigiu authorization — sinal de chave nao reconhecida pelo projeto.");
    return { outcome: "NAO_CONFERE", exitCode: 1, lines };
  }

  if (status === 401 || status === 403) {
    say("resultado            : NAO CONFERE");
    say("Credencial ausente, invalida, revogada ou incompativel com este projeto.");
    return { outcome: "NAO_CONFERE", exitCode: 1, lines };
  }

  say("resultado            : INCONCLUSIVO (status inesperado)");
  return { outcome: "INCONCLUSIVO", exitCode: 2, lines };
}

// ---------------------------------------------------------------------
// CLI — só roda quando o arquivo é executado diretamente.
//
// O `import` do teste não dispara nada: sem esta guarda, importar o
// módulo para testar faria uma requisição real.
// ---------------------------------------------------------------------

const executadoDiretamente =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (executadoDiretamente) {
  const relatorio = await validateSupabaseSecret(process.env);

  console.log("");
  console.log("VALIDACAO DO SUPABASE_SECRET_KEY DO GITHUB ACTIONS");
  console.log("==================================================");
  for (const linha of relatorio.lines) console.log(linha);
  console.log("");

  process.exit(relatorio.exitCode);
}
