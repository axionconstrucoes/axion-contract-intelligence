// Migration 20260920052000_add_email_document_kind — teste anti-drift.
//
// A primeira versão desta migration reconstruía documents_kind_check a
// partir de uma lista desatualizada e removia silenciosamente
// QUESTIONARIO_BID e COMPLEMENTO_CIRCULAR (adicionados por
// 20260829180000), além de trocar o search_path da RPC SECURITY DEFINER
// de '' para 'public, storage'. Este teste deriva a expectativa de duas
// fontes existentes — sem terceira lista manual:
//   1. o tipo canônico TypeScript DocumentKind (packages/types);
//   2. a ÚLTIMA definição de documents_kind_check nas migrations
//      anteriores (= constraint vigente no banco antes desta migration).
// Esperado = união das duas. Nada pode sumir; EMAIL tem de entrar.
//
// Uso:
//   node scripts/test-email-document-kind-migration.mjs

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const readSource = (relative) => readFileSync(path.join(repoRoot, relative), "utf8");

const MIGRATION = "supabase/migrations/20260920052000_add_email_document_kind.sql";
const MIGRATIONS_DIR = "supabase/migrations";
const FUNCTION_NAME = "register_project_document_upload";

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message ?? "assertion failed");
}
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
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const sorted = (set) => [...set].sort();

// ------------------------------------------------------------------
// Fontes
// ------------------------------------------------------------------
const migration = readSource(MIGRATION);

/** Literais do tipo canônico DocumentKind em packages/types. */
function canonicalTsKinds() {
  const types = readSource("packages/types/src/index.ts");
  const match = types.match(/export type DocumentKind =([\s\S]*?);/);
  assert(match, "DocumentKind não encontrado em packages/types");
  return new Set([...match[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]));
}

/** Extrai a lista de um `check (kind in (...))` de documents_kind_check. */
function constraintKinds(sql) {
  const match = sql.match(/add constraint documents_kind_check\s+check \(kind in \(([\s\S]*?)\)\);/);
  assert(match, "documents_kind_check não encontrada");
  return new Set([...match[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]));
}

/** Última definição de documents_kind_check ANTES desta migration (= vigente). */
function previousConstraintKinds() {
  const files = readdirSync(path.join(repoRoot, MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql") && f < path.basename(MIGRATION))
    .sort();
  let last = null;
  for (const file of files) {
    const sql = readSource(`${MIGRATIONS_DIR}/${file}`);
    if (/add constraint documents_kind_check\s+check \(kind in \(/.test(sql)) last = { file, kinds: constraintKinds(sql) };
  }
  assert(last, "nenhuma definição anterior de documents_kind_check");
  return last;
}

/** Bloco `create or replace function public.<name>(...)` até o fim do corpo. */
function functionBlock(sql, name) {
  const re = new RegExp(`create or replace function public\\.${name}\\(([\\s\\S]*?)\\)\\s*returns\\s+([^\\n]+)\\n([\\s\\S]*?)\\bas \\$\\$([\\s\\S]*?)\\$\\$;`);
  const match = sql.match(re);
  assert(match, `função ${name} não encontrada`);
  return { args: match[1].replace(/\s+/g, " ").trim(), returns: match[2].trim(), header: match[3], body: match[4] };
}

function functionAllowlist(body) {
  const match = body.match(/if p_kind not in \(([\s\S]*?)\) then/);
  assert(match, "allowlist p_kind não encontrada");
  return new Set([...match[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]));
}

const tsKinds = canonicalTsKinds();
const previous = previousConstraintKinds();
const expected = new Set([...tsKinds, ...previous.kinds]);
const constraint = constraintKinds(migration);
const fn = functionBlock(migration, FUNCTION_NAME);
const allowlist = functionAllowlist(fn.body);

// ------------------------------------------------------------------
// 1–7. Conjunto de kinds
// ------------------------------------------------------------------
check("1. Constraint contém exatamente os tipos canônicos (TS DocumentKind ∪ constraint vigente)", () => {
  assert(sameSet(constraint, expected), `constraint=${sorted(constraint).join(",")}\n     esperado=${sorted(expected).join(",")}`);
  assert(constraint.size === 25, `esperava 25 valores, há ${constraint.size}`);
});
check("2. Allowlist da RPC contém exatamente os mesmos tipos canônicos", () => {
  assert(sameSet(allowlist, expected), `allowlist=${sorted(allowlist).join(",")}`);
});
check("3. Constraint e função têm conjuntos idênticos (paridade)", () => {
  assert(sameSet(constraint, allowlist));
});
check("4. EMAIL presente (constraint, função e tipo TS)", () => {
  assert(constraint.has("EMAIL") && allowlist.has("EMAIL") && tsKinds.has("EMAIL"));
});
check("5. QUESTIONARIO_BID presente (constraint e função)", () => {
  assert(constraint.has("QUESTIONARIO_BID") && allowlist.has("QUESTIONARIO_BID"));
});
check("6. COMPLEMENTO_CIRCULAR presente (constraint e função)", () => {
  assert(constraint.has("COMPLEMENTO_CIRCULAR") && allowlist.has("COMPLEMENTO_CIRCULAR"));
});
check(`7. Nenhum tipo removido em relação à constraint vigente (${previous.file}) nem ao tipo TS`, () => {
  const removed = [...previous.kinds].filter((k) => !constraint.has(k));
  assert(removed.length === 0, `removidos: ${removed.join(",")}`);
  const missingTs = [...tsKinds].filter((k) => !constraint.has(k));
  assert(missingTs.length === 0, `tipos TS ausentes: ${missingTs.join(",")}`);
  assert(previous.kinds.size === 24, `constraint vigente deveria ter 24 valores (tem ${previous.kinds.size})`);
});

// ------------------------------------------------------------------
// 8–9. search_path e referências qualificadas
// ------------------------------------------------------------------
check("8. search_path da função é vazio ('') e a função é SECURITY DEFINER", () => {
  assert(/^\s*set search_path = ''\s*$/m.test(fn.header), `header: ${fn.header.trim()}`);
  assert(!/set search_path = public/.test(fn.header), "não pode voltar a 'public, storage'");
  assert(/security definer/.test(fn.header));
});
check("9. Toda referência a relação/função dentro do corpo é qualificada (public./storage./auth.)", () => {
  const relations = [...fn.body.matchAll(/\b(?:from|join|update|delete from|insert into)\s+([a-z_][a-z0-9_.]*)/g)].map((m) => m[1]);
  const unqualified = relations.filter((r) => !r.includes("."));
  assert(unqualified.length === 0, `relações sem schema: ${unqualified.join(",")}`);
  const expectedRelations = ["public.documents", "public.document_versions", "public.audit_log_entries", "storage.objects"];
  for (const rel of expectedRelations) assert(relations.includes(rel), `${rel} deveria ser referenciada qualificada`);
  assert(fn.body.includes("public.can_manage_project_documents(") && fn.body.includes("auth.uid()"), "funções de schema qualificadas");
  const bare = fn.body.match(/\b(?<![.\w])(can_manage_project_documents|uid)\s*\(/g);
  assert(!bare, `chamadas sem schema: ${bare}`);
});

// ------------------------------------------------------------------
// 10–12. Assinatura, privilégios, ausência de operações destrutivas
// ------------------------------------------------------------------
check("10. Assinatura permanece compatível com a definição vigente (20260825130000): argumentos, tipos, defaults e retorno", () => {
  const previousFn = functionBlock(readSource(`${MIGRATIONS_DIR}/20260825130000_multi_document_upload_foundation.sql`), FUNCTION_NAME);
  assert(fn.args === previousFn.args, `args mudaram:\n     antes=${previousFn.args}\n     agora=${fn.args}`);
  assert(fn.returns === previousFn.returns && fn.returns === "uuid", `retorno: ${fn.returns}`);
  const argNames = fn.args.split(",").map((a) => a.trim().split(" ")[0]);
  assert(argNames.length === 16 && argNames[0] === "p_project_id" && argNames[15] === "p_sha256_hash");
  assert(/p_notes text default null,\s*p_sha256_hash text default null/.test(fn.args));
  assert(fn.body.includes("if not public.can_manage_project_documents(p_project_id) then"), "regra de autorização preservada");
  assert(fn.body.includes("DUPLICATE_FILE_HASH") && fn.body.includes("pg_advisory_xact_lock"), "comportamento de dedup/serialização preservado");
});
check("11. Owner postgres; REVOKE public/anon; GRANT só para authenticated e service_role", () => {
  const sig = "uuid, uuid, uuid, text, text, text, date, text, text, text,\\s*text, text, text, bigint, text, text";
  assert(new RegExp(`alter function public\\.${FUNCTION_NAME}\\(\\s*${sig}\\s*\\) owner to postgres;`).test(migration), "owner postgres");
  assert(new RegExp(`revoke all\\s+on function public\\.${FUNCTION_NAME}\\(\\s*${sig}\\s*\\)\\s+from public;`).test(migration), "revoke public");
  assert(new RegExp(`revoke all\\s+on function public\\.${FUNCTION_NAME}\\(\\s*${sig}\\s*\\)\\s+from anon;`).test(migration), "revoke anon");
  assert(new RegExp(`grant execute\\s+on function public\\.${FUNCTION_NAME}\\(\\s*${sig}\\s*\\)\\s+to authenticated;`).test(migration), "grant authenticated");
  assert(new RegExp(`grant execute\\s+on function public\\.${FUNCTION_NAME}\\(\\s*${sig}\\s*\\)\\s+to service_role;`).test(migration), "grant service_role");
  assert(!/grant[\s\S]*?to (anon|public)\b/.test(migration), "nenhum grant a anon/public");
});
check("12. Nenhum DROP (além da própria constraint), DELETE, UPDATE ou TRUNCATE de dados", () => {
  const code = migration.replace(/--.*$/gm, ""); // ignora comentários
  const drops = [...code.matchAll(/^\s*(drop\s+\w+)/gim)].map((m) => m[0].trim());
  assert(drops.length === 1 && /drop constraint documents_kind_check/.test(code), `drops: ${drops.join(" | ")}`);
  assert(!/^\s*(delete from|update |truncate )/im.test(code), "DML de dados no nível superior");
  assert(!/drop function|drop table|drop column|alter column/i.test(code), "DDL destrutiva");
});

console.log("");
console.log(`Resultado: ${passed} OK, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
