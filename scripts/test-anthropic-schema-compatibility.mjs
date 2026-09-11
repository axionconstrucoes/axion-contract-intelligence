// Compatibilidade entre os JSON Schemas enviados ao Anthropic e o que a
// API realmente aceita.
//
// Incidente que originou este arquivo: `strict: true` foi ativado no
// PR #54 e derrubou 100% das consultas em producao —
//
//   HTTP 400 invalid_request_error
//   tools.0.custom: Schema type 'oneOf' is not supported
//   request_id req_011Cew2sDM1vPmb5oaXW52VE
//
// Nenhum teste percebeu porque `test-anthropic-provider` usa client
// MOCKADO, e um mock aceita qualquer input_schema. O mock testa o nosso
// codigo; ninguem testava o contrato com a API.
//
// Esta suite guarda o invariante sem gastar chamada: se `strict` estiver
// ativo, NENHUM schema enviado pode usar as construcoes que o modo
// estrito recusa. E cobre os TRES schemas reais, nao so o de consulta —
// o incidente quebrou junto ESG, comercial e curadoria.
//
// Uso:
//   node scripts/test-anthropic-schema-compatibility.mjs

import { readFileSync } from "node:fs";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const repoRoot = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (rel) => readFileSync(nodePath.join(repoRoot, rel), "utf8");

const { EXPERT_QUERY_RESPONSE_JSON_SCHEMA } = await import("../apps/web/lib/ai/query/json-schema");
const { COMMERCIAL_DIRECTOR_ASSESSMENT_JSON_SCHEMA } = await import(
  "../apps/web/lib/ai/experts/commercial-director/json-schema"
);
const { CEO_CURATION_JSON_SCHEMA } = await import("../apps/web/lib/ai/experts/ceo/json-schema").catch(() => ({
  CEO_CURATION_JSON_SCHEMA: null,
}));

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

/** Construcoes que a API recusa quando `strict: true` esta ativo. */
const NAO_SUPORTADAS_EM_STRICT = ["oneOf", "anyOf", "allOf", "not", "$ref", "patternProperties"];

/** Caminhos (dot-path) onde cada construcao aparece no schema. */
function encontrarConstrucoes(schema, prefixo = "raiz") {
  const achados = [];

  if (Array.isArray(schema)) {
    schema.forEach((item, i) => achados.push(...encontrarConstrucoes(item, `${prefixo}[${i}]`)));
    return achados;
  }

  if (typeof schema !== "object" || schema === null) return achados;

  for (const [chave, valor] of Object.entries(schema)) {
    if (NAO_SUPORTADAS_EM_STRICT.includes(chave)) {
      achados.push({ construcao: chave, caminho: `${prefixo}.${chave}` });
    }
    achados.push(...encontrarConstrucoes(valor, `${prefixo}.${chave}`));
  }

  return achados;
}

const providerSource = readSource("apps/web/lib/ai/providers/anthropic-provider.ts");

/** `strict: true` ATIVO significa fora de comentario. */
function strictEstaAtivo(source) {
  return source
    .split("\n")
    .map((linha) => linha.trim())
    .filter((linha) => !linha.startsWith("//") && !linha.startsWith("*") && !linha.startsWith("/*"))
    .some((linha) => /\bstrict\s*:\s*true\b/.test(linha));
}

const SCHEMAS = [
  ["EXPERT_QUERY_RESPONSE_JSON_SCHEMA (5 Experts, consulta)", EXPERT_QUERY_RESPONSE_JSON_SCHEMA],
  ["COMMERCIAL_DIRECTOR_ASSESSMENT_JSON_SCHEMA (assessment)", COMMERCIAL_DIRECTOR_ASSESSMENT_JSON_SCHEMA],
];
if (CEO_CURATION_JSON_SCHEMA) SCHEMAS.push(["CEO_CURATION_JSON_SCHEMA (curadoria)", CEO_CURATION_JSON_SCHEMA]);

console.log("");
console.log("======================================");
console.log("SCHEMAS x API ANTHROPIC — COMPATIBILIDADE");
console.log("======================================");
console.log("");

const strictAtivo = strictEstaAtivo(providerSource);
console.log(`  strict: true ativo no provider? ${strictAtivo ? "SIM" : "NAO"}`);
console.log("");

// --- O invariante central --------------------------------------------

for (const [nome, schema] of SCHEMAS) {
  check(`INVARIANTE: ${nome} e compativel com o modo escolhido`, () => {
    const achados = encontrarConstrucoes(schema);

    if (!strictAtivo) {
      // Sem strict, `oneOf` e legitimo — e usado de proposito para
      // impedir combinacoes invalidas de campos.
      return;
    }

    assert(
      achados.length === 0,
      `strict: true esta ativo, mas o schema usa construcao nao suportada pela API: ` +
        achados.map((a) => `${a.construcao} em ${a.caminho}`).join("; ") +
        ". Foi exatamente isto que devolveu HTTP 400 " +
        `"tools.0.custom: Schema type 'oneOf' is not supported" em producao.`
    );
  });
}

// --- Documenta o estado atual, para a decisao ser consciente ---------

check("ESTADO: os schemas usam oneOf de proposito — reativar strict exige reescreve-los", () => {
  const porSchema = SCHEMAS.map(([nome, schema]) => [nome, encontrarConstrucoes(schema)]);
  const comOneOf = porSchema.filter(([, achados]) => achados.some((a) => a.construcao === "oneOf"));

  assert(
    comOneOf.length > 0,
    "nenhum schema usa oneOf — se isso mudou, strict pode ser reavaliado (e este teste, atualizado)"
  );

  for (const [nome, achados] of comOneOf) {
    console.log(`     ${nome}: ${achados.filter((a) => a.construcao === "oneOf").length} uso(s) de oneOf`);
  }
});

check("ESTADO: strict: true NAO esta ativo (hotfix do HTTP 400)", () => {
  assert(
    !strictAtivo,
    "strict: true voltou a ficar ativo — confira antes se os tres schemas foram reescritos sem oneOf"
  );
  // A explicacao precisa continuar no codigo, para ninguem religar sem contexto.
  assert(
    providerSource.includes("Schema type 'oneOf' is not supported"),
    "o motivo de strict estar desligado precisa estar documentado no provider"
  );
});

// --- As duas camadas que substituem o strict continuam ativas --------

check("MITIGACAO: a repeticao unica controlada continua ativa", () => {
  assert(
    providerSource.includes("findSchemaViolations(first.output, outputSchema)"),
    "a deteccao estrutural que decide a repeticao precisa continuar"
  );
  assert(
    /callAnthropicOnce\(/.test(providerSource),
    "a chamada unica precisa continuar isolada da repeticao"
  );
});

check("MITIGACAO: severity segue obrigatorio e nunca e preenchido pelo provider", () => {
  assert(
    EXPERT_QUERY_RESPONSE_JSON_SCHEMA.required.includes("severity"),
    "severity precisa continuar em required"
  );
  assert(
    !/severity\s*[:=]\s*["'`]/.test(providerSource),
    "o provider nunca pode atribuir um valor a severity"
  );
});

check("MITIGACAO: o validador TypeScript final continua fail-closed", () => {
  const validador = readSource("apps/web/lib/ai/query/validate-expert-query-response.ts");
  assert(validador.includes('requireString(candidate.severity, "severity")'), "severity validado na saida");
  assert(validador.includes("requireHumanReviewTrue"), "revisao humana obrigatoria preservada");
});

// --- Regressao direta do incidente -----------------------------------

check("REGRESSAO: rascunhoSugerido continua expressando objeto-ou-null", () => {
  const draft = EXPERT_QUERY_RESPONSE_JSON_SCHEMA.properties.rascunhoSugerido;
  const achados = encontrarConstrucoes(draft);

  // Sem strict, o oneOf e a forma correta. O que nao pode e o par
  // (strict ativo + oneOf), coberto pelo invariante acima.
  assert(
    achados.some((a) => a.construcao === "oneOf") || draft.type?.includes?.("null"),
    "rascunhoSugerido precisa admitir null de alguma forma explicita"
  );
});

check("REGRESSAO: fieldValueSchema mantem a garantia de status x value", () => {
  const fonte = readSource("apps/web/lib/ai/schemas/json-schema-fragments.ts");
  assert(fonte.includes("oneOf"), "a garantia de combinacao valida usa oneOf");
  assert(
    fonte.includes('status: { const: "AVAILABLE" }') && fonte.includes('status: { const: "UNAVAILABLE" }'),
    "os estados explicitos precisam continuar separados"
  );
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
