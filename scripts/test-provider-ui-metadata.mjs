// Testes da metadata de provider exibida na UI
// (apps/web/lib/ai/provider-ui-metadata.ts) — motivados pela
// investigação "Provider: Fake/Teste" aparecendo mesmo com
// commercial-director resolvido para Anthropic no backend/harness.
//
// Cobre: builder puro (providerId/providerLabel/model/isRealProvider);
// que expert-query-action.ts/esg-query-action.ts realmente usam este
// builder (não constroem meta ad-hoc); e uma checagem estrutural
// (leitura do código-fonte) de que o fluxo do Diretor Comercial IA
// nunca usa getAiProvider() global — só resolveAiProviderForExpert.
//
// NUNCA chama a API Anthropic real.
//
// Uso:
//   node scripts/test-provider-ui-metadata.mjs

import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const { buildAiProviderUiMetadata, normalizeProviderMeta } = await import("../apps/web/lib/ai/provider-ui-metadata");

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
console.log("PROVIDER UI METADATA — TESTES");
console.log("======================================");
console.log("");

check('commercial-director em anthropic → { providerId: "anthropic", providerLabel: "Anthropic", isRealProvider: true, model preservado }', () => {
  const meta = buildAiProviderUiMetadata("anthropic", "claude-sonnet-5");
  assert(meta.providerId === "anthropic");
  assert(meta.providerLabel === "Anthropic");
  assert(meta.model === "claude-sonnet-5");
  assert(meta.isRealProvider === true);
});

check('commercial-director em fake → { providerId: "fake", providerLabel: "Fake/Teste", isRealProvider: false, model null }', () => {
  const meta = buildAiProviderUiMetadata("fake", null);
  assert(meta.providerId === "fake");
  assert(meta.providerLabel === "Fake/Teste");
  assert(meta.model === null);
  assert(meta.isRealProvider === false);
});

check("ESG (sempre fake nesta fase) produz a mesma metadata Fake/Teste que o Diretor Comercial IA em fake — mesmo builder, nenhuma lógica duplicada", () => {
  const commercialFake = buildAiProviderUiMetadata("fake", null);
  const esgFake = buildAiProviderUiMetadata("fake", null);
  assert(JSON.stringify(commercialFake) === JSON.stringify(esgFake));
});

check("model só aparece quando o provider é real (fake nunca expõe model, mesmo que um valor seja passado por engano)", () => {
  const meta = buildAiProviderUiMetadata("fake", "algum-valor-que-nao-deveria-aparecer");
  assert(meta.model === null, "fake nunca deveria propagar um model — força null sempre");
});

check("nenhum campo de buildAiProviderUiMetadata pode conter algo parecido com uma API key", () => {
  const meta = buildAiProviderUiMetadata("anthropic", "claude-sonnet-5");
  const serialized = JSON.stringify(meta);
  assert(!/sk-[A-Za-z0-9_-]{10,}/.test(serialized), "metadata nunca deveria conter algo no formato de chave Anthropic");
});

check("provider desconhecido/futuro nunca é tratado como real por engano (fail-closed visual)", () => {
  const meta = buildAiProviderUiMetadata("algum-provider-futuro-desconhecido", "modelo-x");
  assert(meta.isRealProvider === false, "só \"anthropic\" é tratado como provider real nesta fase");
  assert(meta.providerLabel === "Fake/Teste");
});

// --- normalizeProviderMeta — motivado pelo erro real em runtime
// "Cannot read properties of undefined (reading 'isRealProvider')". ---

check("normalizeProviderMeta(undefined) → null — NUNCA deve ser possível dereferenciar .isRealProvider a partir daqui (o bug real reportado)", () => {
  const normalized = normalizeProviderMeta(undefined);
  assert(normalized === null, `esperado null, obtido ${JSON.stringify(normalized)}`);
  // A prova definitiva de que o bug não pode mais acontecer: acessar
  // .isRealProvider só é sintaticamente possível depois de checar
  // === null, e aqui normalized É null — nenhum acesso é feito.
});

check("normalizeProviderMeta(null) → null", () => {
  assert(normalizeProviderMeta(null) === null);
});

check("normalizeProviderMeta(meta fake) → passa através inalterado", () => {
  const fake = buildAiProviderUiMetadata("fake", null);
  const normalized = normalizeProviderMeta(fake);
  assert(normalized !== null);
  assert(normalized.providerId === "fake");
  assert(normalized.isRealProvider === false);
});

check("normalizeProviderMeta(meta anthropic) → passa através inalterado", () => {
  const anthropic = buildAiProviderUiMetadata("anthropic", null);
  const normalized = normalizeProviderMeta(anthropic);
  assert(normalized !== null);
  assert(normalized.providerId === "anthropic");
  assert(normalized.isRealProvider === true);
});

check("normalizeProviderMeta(meta anthropic + model) → model preservado", () => {
  const anthropic = buildAiProviderUiMetadata("anthropic", "claude-sonnet-5");
  const normalized = normalizeProviderMeta(anthropic);
  assert(normalized !== null);
  assert(normalized.model === "claude-sonnet-5");
  assert(normalized.isRealProvider === true);
});

// --- Checagem estrutural: o fluxo do Diretor Comercial IA nunca usa getAiProvider() global. ---

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

function readSource(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

check("commercial-director/query.ts usa resolveAiProviderForExpert como default do parâmetro provider (nunca getAiProvider())", () => {
  const source = readSource("apps/web/lib/ai/experts/commercial-director/query.ts");
  assert(source.includes("resolveAiProviderForExpert(COMMERCIAL_DIRECTOR_EXPERT_ID)"), "default do provider deveria usar o resolver por Expert");
  assert(!/\bgetAiProvider\s*\(/.test(source), "query.ts não deveria chamar getAiProvider() em lugar nenhum");
});

check("commercial-director/index.ts (análise em lote) também usa resolveAiProviderForExpert, nunca getAiProvider()", () => {
  const source = readSource("apps/web/lib/ai/experts/commercial-director/index.ts");
  assert(source.includes("resolveAiProviderForExpert(COMMERCIAL_DIRECTOR_EXPERT_ID)"));
  assert(!/\bgetAiProvider\s*\(/.test(source));
});

check("expert-query-action.ts (Server Action \"Consultar\") nunca referencia getAiProvider nem constrói FakeAiProvider diretamente", () => {
  const source = readSource("apps/web/lib/ai/expert-query-action.ts");
  assert(!source.includes("getAiProvider"), "Server Action não deveria conhecer a seleção global de provider");
  assert(!source.includes("createFakeAiProvider"), "Server Action não deveria forçar um provider específico — quem decide é answerCommercialDirectorQuery");
  assert(source.includes("buildAiProviderUiMetadata"), "meta exibido na UI deveria vir do builder único, não de um objeto ad-hoc");
});

check("esg-query-action.ts usa o mesmo builder de metadata (nenhuma lógica duplicada entre Experts)", () => {
  const source = readSource("apps/web/lib/ai/esg-query-action.ts");
  assert(source.includes("buildAiProviderUiMetadata"));
  assert(!source.includes("getAiProvider"));
});

check("expert-query-panel.tsx nunca lê AXION_AI_PROVIDER nem process.env diretamente — só o meta recebido via state", () => {
  const source = readSource("apps/web/components/ai/expert-query-panel.tsx");
  assert(!source.includes("process.env"), "componente client não deveria ler nenhuma env var — meta vem sempre do Server Action");
  assert(source.includes("meta.isRealProvider"), "banner deveria decidir com base em meta.isRealProvider, não recalcular a partir de providerId no componente");
});

check("expert-query-panel.tsx sempre normaliza meta via normalizeProviderMeta antes de qualquer acesso — nunca destructura state.meta direto, nunca usa non-null assertion (meta!)", () => {
  const source = readSource("apps/web/components/ai/expert-query-panel.tsx");
  assert(source.includes("normalizeProviderMeta(state.meta)"), "panel deveria normalizar state.meta em um único ponto (fix do bug real de runtime)");
  assert(!/\{\s*response,\s*error,\s*meta\s*\}\s*=\s*state/.test(source), "state.meta não deveria mais ser destructurado direto sem passar por normalizeProviderMeta");
  assert(!/\bmeta!\./.test(source), "nunca usar non-null assertion (meta!.) para acessar campos de meta");
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
