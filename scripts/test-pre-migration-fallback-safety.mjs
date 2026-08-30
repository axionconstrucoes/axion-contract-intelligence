// FALLBACKS pré-migration (compatibilidade com um banco ainda sem as
// colunas contractual_*/deleted_at) — item 3 da rodada de estabilização
// final: o fallback só pode disparar para o código REAL e ESPECÍFICO
// que o Postgres/PostgREST devolve quando uma coluna/function não
// existe (42703 undefined_column, 42883 undefined_function, PGRST202
// função ausente no schema cache do PostgREST) — NUNCA um catch
// genérico que trataria permission denied/RLS/erro de rede/timeout/
// erro de programação como "banco antigo, seguir sem a coluna".
//
// Duas camadas de prova:
//   1. Estrutural: cada site de fallback checa o CÓDIGO específico
//      antes de decidir reexecutar sem a coluna, nunca um `if (error)`
//      genérico nem um `catch {}` vazio.
//   2. Comportamental REAL: resolveNonTrashedDocumentIds (exportada de
//      build-event-context.ts) chamada de verdade com um cliente
//      Supabase FALSO controlável — schema antigo (42703) usa
//      fallback; permission denied (42501)/network error (Error
//      lançado, não {error})/erro desconhecido (outro código) sempre
//      propagam, nunca viram "documento ativo" por padrão.
//
// Uso:
//   node scripts/test-pre-migration-fallback-safety.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

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

async function checkAsync(name, fn) {
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

function assert(condition, message) {
  if (!condition) throw new Error(message ?? "assertion failed");
}

console.log("");
console.log("======================================");
console.log("FALLBACKS PRÉ-MIGRATION — específicos por código, nunca genéricos");
console.log("======================================");
console.log("");

// ---------- 1. estrutural: cada site checa o código específico ----------

const activeDocumentFilterSource = readSource("apps/web/lib/documents/active-document-filter.ts");
const buildEventContextSource = readSource("apps/web/lib/ai/context/build-event-context.ts");
const documentManagementSource = readSource("apps/web/lib/document-management.ts");
const getContractBaseClausesSource = readSource("apps/web/lib/additionals/confrontation/get-contract-base-clauses.ts");
const suggestExistingSourcesSource = readSource("apps/web/lib/additionals/suggest-existing-sources.ts");
const dataSource = readSource("apps/web/lib/data.ts");
const clauseReviewSource = readSource("apps/web/lib/clause-review.ts");
const esgObligationsDataSource = readSource("apps/web/lib/esg/esg-obligations-data.ts");
const eventClauseConfrontationReviewSource = readSource("apps/web/lib/event-clause-confrontation-review.ts");

check("CRÍTICO — a regra CANÔNICA (apps/web/lib/documents/active-document-filter.ts) checa 42703 ESPECIFICAMENTE nos dois helpers (withActiveDocumentFilter e resolveNonTrashedDocumentIds), nunca um catch genérico — ÚNICA fonte de verdade, nunca replicada", () => {
  assert(activeDocumentFilterSource.includes('filtered.error.code !== "42703"'), "withActiveDocumentFilter deveria checar 42703 especificamente");
  assert(activeDocumentFilterSource.includes('error.code === "42703"'), "resolveNonTrashedDocumentIds deveria checar 42703 especificamente");
  assert(!/catch\s*\(\s*\)\s*{\s*}/.test(activeDocumentFilterSource) && !/catch\s*{\s*}/.test(activeDocumentFilterSource), "nenhum catch vazio");
});

// Todo site que precisa da regra de "documento ativo" agora importa um
// dos dois helpers canônicos — nunca reimplementa o filtro/fallback
// por conta própria. Isto substitui a checagem antiga (que procurava
// `error.code !== "42703"` em cada arquivo individualmente — esse
// padrão só deveria existir em active-document-filter.ts agora).
const canonicalConsumers = [
  { file: "build-event-context.ts", source: buildEventContextSource, needle: /import\s*{\s*resolveNonTrashedDocumentIds\s*}\s*from\s*"\.\.\/\.\.\/documents\/active-document-filter"/ },
  { file: "document-management.ts", source: documentManagementSource, needle: /import\s*{\s*withActiveDocumentFilter\s*}\s*from\s*"@\/lib\/documents\/active-document-filter"/ },
  { file: "suggest-existing-sources.ts", source: suggestExistingSourcesSource, needle: /import\s*{\s*withActiveDocumentFilter\s*}\s*from\s*"\.\.\/documents\/active-document-filter"/ },
  { file: "data.ts", source: dataSource, needle: /import\s*{\s*resolveNonTrashedDocumentIds,\s*withActiveDocumentFilter\s*}\s*from\s*"\.\/documents\/active-document-filter"/ },
  { file: "clause-review.ts", source: clauseReviewSource, needle: /import\s*{\s*withActiveDocumentFilter\s*}\s*from\s*"\.\/documents\/active-document-filter"/ },
  { file: "esg-obligations-data.ts", source: esgObligationsDataSource, needle: /import\s*{\s*withActiveDocumentFilter\s*}\s*from\s*"\.\.\/documents\/active-document-filter"/ },
  { file: "event-clause-confrontation-review.ts", source: eventClauseConfrontationReviewSource, needle: /import\s*{\s*resolveNonTrashedDocumentIds\s*}\s*from\s*"@\/lib\/documents\/active-document-filter"/ },
];

for (const site of canonicalConsumers) {
  check(`CANÔNICO — ${site.file} importa o helper de active-document-filter.ts, nunca reimplementa o filtro/fallback`, () => {
    assert(site.needle.test(site.source), `import esperado não encontrado em ${site.file}`);
  });
}

check("nenhum dos arquivos consumidores usa catch {} vazio — todo bloco de fallback continua qualificando o código real (agora dentro do helper canônico)", () => {
  for (const source of [buildEventContextSource, documentManagementSource, getContractBaseClausesSource, suggestExistingSourcesSource, dataSource, clauseReviewSource, esgObligationsDataSource, eventClauseConfrontationReviewSource]) {
    assert(!/catch\s*\(\s*\)\s*{\s*}/.test(source), "não deveria haver catch() vazio");
    assert(!/catch\s*{\s*}/.test(source), "não deveria haver catch {} vazio");
  }
});

check("get-contract-base-clauses.ts continua com seu próprio fallback (select aninhado, formato diferente dos demais) mas ainda checando 42703 especificamente — nunca migrado ao helper genérico por ter um shape de query incompatível, documentado aqui para não regredir por engano", () => {
  assert(getContractBaseClausesSource.includes('extended.error.code !== "42703"'));
});

check("getTrashedDocuments também discrimina PGRST202 (função ausente do schema cache do PostgREST) e 42883 (undefined_function) — não só 42703 — mas continua propagando qualquer OUTRO código, inclusive 42501 (permission denied)", () => {
  assert(documentManagementSource.includes('"PGRST202"'));
  assert(documentManagementSource.includes('"42883"'));
  assert(!documentManagementSource.includes('"42501"'), "42501 (permission denied) NUNCA deveria estar na lista de códigos que acionam fallback — precisa propagar como erro real");
});

check("data.ts: as 7 funções (getDocuments/getDocument/getDocumentVersion/getClauses/getClause/getScheduleActivities/getScheduleActivity) usam a regra canônica — nenhuma ficou de fora do levantamento exaustivo desta rodada", () => {
  const functionNames = [
    "getDocuments",
    "getDocument",
    "getDocumentVersion",
    "getClauses",
    "getClause",
    "getScheduleActivities",
    "getScheduleActivity",
  ];
  for (const name of functionNames) {
    const start = dataSource.indexOf(`export async function ${name}(`);
    assert(start !== -1, `função ${name} não encontrada em data.ts`);
    const nextExportIndex = dataSource.indexOf("\nexport ", start + 1);
    const body = dataSource.slice(start, nextExportIndex === -1 ? undefined : nextExportIndex);
    assert(
      body.includes("withActiveDocumentFilter") || body.includes("resolveNonTrashedDocumentIds"),
      `${name} deveria usar um dos dois helpers canônicos`
    );
  }
});

// ---------- 2. comportamental real: resolveNonTrashedDocumentIds ----------

const { resolveNonTrashedDocumentIds, withActiveDocumentFilter } = await import(
  "../apps/web/lib/documents/active-document-filter.ts"
);

// Cliente Supabase FALSO mínimo, controlável por teste — implementa só
// a cadeia .from().select().in().is() realmente usada por
// resolveNonTrashedDocumentIds, terminando num objeto "thenable"
// (mesmo padrão do supabase-js real) que resolve para {data, error}
// conforme configurado por cada teste.
function fakeSupabase(result) {
  const builder = {
    from: () => builder,
    select: () => builder,
    in: () => builder,
    is: () => builder,
    then: (resolve, reject) => {
      if (result instanceof Error) {
        return Promise.reject(result).then(resolve, reject);
      }
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return builder;
}

await checkAsync("CRÍTICO — schema ANTIGO legítimo (42703 undefined_column): fallback trata como 'nenhuma lixeira possível', devolve TODOS os ids como não-trashed — nunca lança", async () => {
  const supabase = fakeSupabase({ data: null, error: { code: "42703", message: "column documents.deleted_at does not exist" } });
  const result = await resolveNonTrashedDocumentIds(supabase, ["doc-1", "doc-2"]);
  assert(result.has("doc-1") && result.has("doc-2"), "com schema antigo, todo id deveria ser tratado como ativo (não-trashed)");
});

await checkAsync("CRÍTICO — schema NOVO: sem erro, devolve exatamente os ids que a consulta retornou (campos reais, não um fallback)", async () => {
  const supabase = fakeSupabase({ data: [{ id: "doc-1" }], error: null });
  const result = await resolveNonTrashedDocumentIds(supabase, ["doc-1", "doc-2"]);
  assert(result.has("doc-1") && !result.has("doc-2"), "doc-2 não veio na resposta (está na lixeira) — não deveria aparecer no resultado");
});

await checkAsync("CRÍTICO — permission denied (42501, RLS/grant): propagado como erro real, NUNCA tratado como 'documento ativo' por padrão", async () => {
  const supabase = fakeSupabase({ data: null, error: { code: "42501", message: "permission denied for table documents" } });
  let threw = false;
  try {
    await resolveNonTrashedDocumentIds(supabase, ["doc-1"]);
  } catch {
    threw = true;
  }
  assert(threw, "permission denied deveria lançar, nunca ser engolido pelo fallback de 42703");
});

await checkAsync("CRÍTICO — erro de rede (Error lançado pelo cliente, nunca um {error} do PostgREST): propagado, nunca capturado como se fosse um {data,error} normal", async () => {
  const supabase = fakeSupabase(new Error("fetch failed: ECONNREFUSED"));
  let threw = false;
  try {
    await resolveNonTrashedDocumentIds(supabase, ["doc-1"]);
  } catch (error) {
    threw = error instanceof Error && error.message.includes("ECONNREFUSED");
  }
  assert(threw, "um erro de rede (rejeição da Promise) deveria propagar, nunca ser silenciosamente tratado como resultado vazio");
});

await checkAsync("CRÍTICO — erro DESCONHECIDO (código PostgreSQL genuíno mas não relacionado a coluna/função ausente, ex.: 57014 statement timeout): propagado, nunca tratado como schema antigo", async () => {
  const supabase = fakeSupabase({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });
  let threw = false;
  try {
    await resolveNonTrashedDocumentIds(supabase, ["doc-1"]);
  } catch {
    threw = true;
  }
  assert(threw, "um erro desconhecido/timeout deveria lançar, nunca ser silenciosamente tratado como '42703'");
});

// ---------- 3. comportamental real: withActiveDocumentFilter ----------

await checkAsync("withActiveDocumentFilter — CRÍTICO — 42703 (filterActive=true falha): reexecuta com filterActive=false e devolve o resultado dessa segunda chamada", async () => {
  const calls = [];
  const result = await withActiveDocumentFilter(async (filterActive) => {
    calls.push(filterActive);
    if (filterActive) return { data: null, error: { code: "42703", message: "column does not exist" } };
    return { data: [{ id: "doc-1" }], error: null };
  });
  assert(calls.length === 2 && calls[0] === true && calls[1] === false, `esperado 2 chamadas (true, false), obtido: ${JSON.stringify(calls)}`);
  assert(!result.error && result.data.length === 1, "deveria devolver o resultado da segunda chamada (sem filtro)");
});

await checkAsync("withActiveDocumentFilter — CRÍTICO — sem erro: devolve direto, uma ÚNICA chamada (nunca reexecuta à toa)", async () => {
  let calls = 0;
  const result = await withActiveDocumentFilter(async (filterActive) => {
    calls += 1;
    assert(filterActive === true, "primeira chamada deveria pedir o filtro ativo");
    return { data: [{ id: "doc-1" }], error: null };
  });
  assert(calls === 1, `esperado 1 chamada, obtido ${calls}`);
  assert(!result.error && result.data.length === 1);
});

await checkAsync("withActiveDocumentFilter — CRÍTICO — permission denied (42501): devolvido tal como veio, NUNCA reexecutado sem o filtro", async () => {
  let calls = 0;
  const result = await withActiveDocumentFilter(async () => {
    calls += 1;
    return { data: null, error: { code: "42501", message: "permission denied" } };
  });
  assert(calls === 1, `42501 nunca deveria acionar uma segunda chamada, obtido ${calls}`);
  assert(result.error?.code === "42501", "o erro original deveria ser devolvido intacto para o caller decidir");
});

await checkAsync("withActiveDocumentFilter — CRÍTICO — erro de rede (Promise rejeitada): propaga, nunca vira um {data,error} silencioso", async () => {
  let threw = false;
  try {
    await withActiveDocumentFilter(async () => {
      throw new Error("fetch failed: ECONNREFUSED");
    });
  } catch (error) {
    threw = error instanceof Error && error.message.includes("ECONNREFUSED");
  }
  assert(threw, "um erro de rede deveria propagar como exceção, nunca ser absorvido");
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exitCode = 1;
}
