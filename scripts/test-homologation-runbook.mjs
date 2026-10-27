// Fase B (preparação LOCAL) — testa a trava de alvo, a cópia de trabalho das migrations e o SQL de
// verificação da homologação. Sem rede, sem Supabase: a trava é pura, a cópia vai para um diretório
// temporário e o SQL roda em PGlite após o replay das migrations.
//
// Uso: node scripts/test-homologation-runbook.mjs

import { PGlite } from "@electric-sql/pglite";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertStagingTarget, classifyDbTarget, CONFIRM_PHRASE, GuardError, refFingerprint } from "./homologation/staging-guard.mjs";
import { BOOTSTRAP_VERSION_FILE, prepareWorkdir } from "./homologation/prepare-workdir.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`OK   ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`FAIL ${name}\n     ${error.message}`);
    failed += 1;
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m ?? "assertion failed");
};
const refuses = (code, args) => {
  try {
    assertStagingTarget(args);
  } catch (error) {
    assert(error instanceof GuardError && error.code === code, `código obtido: ${error.code ?? error.message}`);
    return error;
  }
  throw new Error(`esperava recusa ${code}, mas foi aceito`);
};

// refs FICTÍCIOS (nunca refs reais)
const HML = "abcdefghijklmno12345";
const PROD = "zyxwvutsrqponml98765";
const urlFor = (ref, pass = "s3nh4-ficticia!") => `postgresql://postgres:${encodeURIComponent(pass)}@db.${ref}.supabase.co:5432/postgres`;
const ok = { dbUrl: urlFor(HML), stagingRef: HML, productionRefs: [PROD], confirm: CONFIRM_PHRASE };

console.log("== Trava de alvo (staging-guard)");
await check("G1 aceita somente o ref de homologação informado, com a lista de refs de produção e a confirmação", () => {
  const r = assertStagingTarget(ok);
  assert(r.ok && r.kind === "hosted" && r.fingerprint === refFingerprint(HML) && !r.fingerprint.includes(HML));
});
await check("G2 recusa sem a frase de confirmação", () => refuses("CONFIRM_MISSING", { ...ok, confirm: "yes" }));
await check("G3 recusa o ref de PRODUÇÃO (conexão direta e pooler)", () => {
  refuses("TARGET_IS_PRODUCTION", { ...ok, dbUrl: urlFor(PROD), stagingRef: PROD });
  refuses("TARGET_IS_PRODUCTION", { ...ok, dbUrl: `postgresql://postgres.${PROD}:x@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`, stagingRef: PROD });
});
await check("G4 recusa quando o ref do alvo difere de ACC_HML_PROJECT_REF", () => refuses("STAGING_REF_MISMATCH", { ...ok, stagingRef: "outroref1234567890" }));
await check("G5 falha fechado: sem a lista de refs de PRODUÇÃO a trava recusa", () => {
  refuses("PROD_REFS_MISSING", { ...ok, productionRefs: [] });
  refuses("PROD_REFS_MISSING", { ...ok, productionRefs: undefined });
});
await check("G6 recusa hosts desconhecidos, URL inválida e variável ausente", () => {
  refuses("TARGET_NOT_SUPABASE", { ...ok, dbUrl: "postgresql://u:p@banco.exemplo.com:5432/postgres" });
  refuses("DB_URL_INVALID", { ...ok, dbUrl: "isto não é uma url" });
  refuses("DB_URL_MISSING", { ...ok, dbUrl: undefined });
  refuses("STAGING_REF_MISSING", { ...ok, stagingRef: undefined });
});
await check("G7 alvo local só é aceito com allowLocal (uso de teste)", () => {
  refuses("LOCAL_NOT_ALLOWED", { ...ok, dbUrl: "postgresql://postgres:x@127.0.0.1:54322/postgres" });
  assert(assertStagingTarget({ ...ok, dbUrl: "postgresql://postgres:x@127.0.0.1:54322/postgres", allowLocal: true }).kind === "local");
});
await check("G8 nenhuma mensagem de erro ou saída revela host, usuário ou senha", () => {
  const secret = "SENHA-UNICA-123";
  const url = urlFor(PROD, secret);
  const cases = [
    () => assertStagingTarget({ ...ok, dbUrl: url, stagingRef: PROD }),
    () => assertStagingTarget({ ...ok, dbUrl: url, confirm: "" }),
    () => assertStagingTarget({ ...ok, dbUrl: url, productionRefs: [] }),
    () => assertStagingTarget({ ...ok, dbUrl: `postgresql://u:${secret}@x.example.com/db` }),
  ];
  for (const run of cases) {
    try {
      run();
    } catch (error) {
      assert(!error.message.includes(secret) && !error.message.includes(PROD) && !error.message.includes(".supabase.co"), `vazou: ${error.message}`);
    }
  }
  assert(classifyDbTarget(url).ref === PROD && !JSON.stringify(assertStagingTarget(ok)).includes("s3nh4"));
});

console.log("== Cópia de trabalho das migrations");
const tmp = mkdtempSync(path.join(os.tmpdir(), "acc-hml-"));
const repoMigrations = readdirSync(path.join(repo, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort();
await check("W1 copia as migrations do repositório + bootstrap versionado fora delas; bootstrap é a primeira; nada vinculado a projeto remoto", () => {
  const r = prepareWorkdir({ outDir: tmp });
  assert(r.count === repoMigrations.length + 1 && r.first === BOOTSTRAP_VERSION_FILE, `${r.count}/${r.first}`);
  assert(!existsSync(path.join(tmp, "supabase", ".temp")), "não pode haver .temp/project-ref");
  assert(!readdirSync(path.join(repo, "supabase", "migrations")).includes(BOOTSTRAP_VERSION_FILE), "o repositório não pode receber o bootstrap");
  const copied = readFileSync(path.join(tmp, "supabase", "migrations", repoMigrations.at(-1)), "utf8");
  assert(copied === readFileSync(path.join(repo, "supabase", "migrations", repoMigrations.at(-1)), "utf8"), "cópia idêntica");
});
await check("W2 --no-bootstrap mantém só as migrations; recusa diretório dentro de supabase/ ou vinculado", () => {
  assert(prepareWorkdir({ outDir: tmp, bootstrap: false }).count === repoMigrations.length);
  let threw = false;
  try {
    prepareWorkdir({ outDir: path.join(repo, "supabase", "x") });
  } catch {
    threw = true;
  }
  assert(threw, "deveria recusar dentro de supabase/");
});
await check("W3 o repositório tem as 117 migrations esperadas, sem versão duplicada", () => {
  assert(repoMigrations.length === 117, `migrations: ${repoMigrations.length}`);
  const versions = repoMigrations.map((f) => f.split("_")[0]);
  assert(new Set(versions).size === versions.length);
});
rmSync(tmp, { recursive: true, force: true });

console.log("== SQL de verificação (PGlite, após o replay das migrations)");
const replaySource = readFileSync(path.join(here, "test-migrations-full-replay.mjs"), "utf8");
const platform = /const PLATFORM = `([\s\S]*?)`;/.exec(replaySource)[1];
const db = new PGlite();
await db.exec(platform);
for (const file of repoMigrations) {
  await db.exec(readFileSync(path.join(repo, "supabase", "migrations", file), "utf8").replace(/^﻿/, "").replace(/create extension if not exists pgcrypto[^;]*;/gi, ""));
}
const verify = readFileSync(path.join(repo, "scripts", "sql", "homologation", "verify-staging.sql"), "utf8");
const rows = (await db.query(verify)).rows;
const byName = (prefix) => rows.find((r) => r.check_name.startsWith(prefix));
await check("V1 o SQL é somente leitura (sem INSERT/UPDATE/DELETE/DDL)", () => {
  assert(!/\b(insert\s+into|update\s+\w|delete\s+from|drop\s|alter\s|create\s|truncate\s|grant\s|revoke\s)/i.test(verify.replace(/--.*$/gm, "")));
});
await check("V2 todas as tabelas do schema public têm RLS ligada", () => {
  const r = byName("tables_without_rls");
  assert(r.ok === true && r.detail === "-", `sem RLS: ${r.detail}`);
  assert(Number(byName("public_tables").detail) >= 100);
});
await check("V3 toda função SECURITY DEFINER tem search_path definido", () => {
  const r = byName("security_definer_without_empty_search_path");
  assert(r.ok === true && r.detail === "-", `sem search_path: ${r.detail}`);
  assert(Number(byName("security_definer_functions").detail) > 0);
});
await check("V4 buckets de Storage esperados existem e as verificações informativas retornam", () => {
  const detail = byName("storage_buckets").detail;
  assert(/project-documents/.test(detail) && /construmanager-content/.test(detail), detail);
  assert(byName("rls_tables_without_any_policy").detail !== undefined && byName("default_privileges_postgres_public"));
  assert(rows.filter((r) => r.ok === false).length === 0, "nenhuma verificação obrigatória falhou");
});
await db.close();

console.log("== Documentação do roteiro");
await check("D1 o roteiro cobre as etapas e os 12 testes de isolamento (T1–T12)", () => {
  const doc = readFileSync(path.join(repo, "docs", "transicao-remota", "fase-b-roteiro-homologacao.md"), "utf8");
  for (let n = 1; n <= 12; n++) assert(new RegExp(`\\bT${n}\\b`).test(doc), `T${n} ausente`);
  for (const k of ["staging-guard", "prepare-workdir", "apply-migrations", "verify-staging.sql", "ACC_PROD_PROJECT_REF", "--include-all", "Reversão"]) assert(doc.includes(k), `ausente: ${k}`);
});
await check("D2 nenhum arquivo do roteiro contém project ref, URL ou senha reais", () => {
  const files = ["scripts/homologation/staging-guard.mjs", "scripts/homologation/prepare-workdir.mjs", "scripts/homologation/apply-migrations.mjs", "scripts/sql/homologation/verify-staging.sql", "docs/transicao-remota/fase-b-roteiro-homologacao.md"];
  for (const f of files) {
    const text = readFileSync(path.join(repo, f), "utf8");
    assert(!/db\.[a-z0-9]{15,30}\.supabase\.co/.test(text), `${f}: host real`);
    assert(!/postgres(ql)?:\/\/[^\s<]+:[^\s<@]{6,}@/.test(text), `${f}: connection string com senha`);
    assert(!/eyJ[A-Za-z0-9_-]{15,}/.test(text), `${f}: token`);
  }
});

console.log("");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
process.exit(failed > 0 ? 1 : 0);
