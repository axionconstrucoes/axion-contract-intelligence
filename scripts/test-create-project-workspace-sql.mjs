// RPC create_project_workspace (migration 20261014190000) contra PostgreSQL LOCAL descartável (PGlite).
// Cobre: só ADMINISTRADOR ativo cria; o projeto nasce com a associação ADMINISTRADOR do criador;
// validações de campos/datas/tamanho; sessão obrigatória; código único. Nada toca banco real.
//
// Uso: node scripts/test-create-project-workspace-sql.mjs

import assert from "node:assert/strict";
import { as, createLocalDb, expectError } from "./lib/pglite-supabase-stub.mjs";

const U = {
  adm: "00000000-0000-4000-8000-0000000000d4", // administrador ativo de uma obra existente
  colab: "00000000-0000-4000-8000-0000000000a1", // colaborador
  admInativo: "00000000-0000-4000-8000-0000000000d9", // administrador INATIVO
  semVinculo: "00000000-0000-4000-8000-0000000000e6",
};
const P0 = "00000000-0000-4000-8000-000000000001";

let passed = 0;
let failed = 0;
async function check(name, fn) {
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

const db = await createLocalDb(["20261014190000_create_project_workspace.sql"]);
for (const [k, id] of Object.entries(U)) await db.query("insert into public.profiles (id,name,email) values ($1,$2,$3)", [id, k, `${k}@exemplo.invalid`]);
await db.query("insert into public.projects (id,name,code) values ($1,'Obra existente','EX-000')", [P0]);
const member = (u, perm, status = "ACTIVE") => db.query("insert into public.project_memberships (project_id,user_id,permission,status) values ($1,$2,$3,$4)", [P0, u, perm, status]);
await member(U.adm, "ADMINISTRADOR");
await member(U.colab, "COLABORADOR");
await member(U.admInativo, "ADMINISTRADOR", "INACTIVE");

const auth = (uid, fn) => as(db, { role: "authenticated", uid }, fn);
const create = (uid, o = {}) =>
  auth(uid, async () =>
    (await db.query("select public.create_project_workspace($1,$2,$3,$4,$5::date,$6::date) as id", [
      o.code ?? "EX-100", o.name ?? "Obra Exemplo", o.client ?? "Cliente Exemplo", o.location ?? "Cidade",
      o.start ?? "2027-01-10", o.end ?? "2027-12-20",
    ])).rows[0].id
  );

console.log("\n======================================");
console.log("CRIAÇÃO DE PROJETO — RPC (PGlite local)");
console.log("======================================\n");

await check("administrador ativo cria o projeto: dados normalizados e associação ADMINISTRADOR/DIRETORIA do criador na mesma transação", async () => {
  const id = await create(U.adm, { code: " EX-100 ", name: " Obra Exemplo " });
  const p = (await db.query("select code,name,status,workspace_type,project_start_date,start_date,baseline_end_date from public.projects where id=$1", [id])).rows[0];
  assert.equal(p.code, "EX-100");
  assert.equal(p.name, "Obra Exemplo");
  assert.equal(p.status, "ATIVO");
  assert.equal(p.workspace_type, "OBRA");
  assert.equal(String(p.start_date).slice(0, 10) || "x", String(p.project_start_date).slice(0, 10) || "x");
  const m = (await db.query("select user_id,permission,status,area from public.project_memberships where project_id=$1", [id])).rows;
  assert.deepEqual(m.map((r) => [r.user_id, r.permission, r.status, r.area]), [[U.adm, "ADMINISTRADOR", "ACTIVE", "DIRETORIA"]]);
});

await check("colaborador, administrador INATIVO e usuário sem vínculo NÃO criam projeto", async () => {
  for (const [who, code] of [[U.colab, "EX-201"], [U.admInativo, "EX-202"], [U.semVinculo, "EX-203"]]) {
    await expectError(create(who, { code }), /Somente administradores ativos/);
    assert.equal((await db.query("select count(*)::int c from public.projects where code=$1", [code])).rows[0].c, 0, who);
  }
});

await check("sem sessão: autenticação obrigatória", async () => {
  await expectError(auth(null, () => db.query("select public.create_project_workspace('X','N','C','L','2027-01-01','2027-02-01')")), /Autenticação obrigatória/);
});

await check("validações: campos obrigatórios, tamanhos e término anterior ao início (nada é gravado)", async () => {
  const before = (await db.query("select count(*)::int c from public.projects")).rows[0].c;
  await expectError(create(U.adm, { code: "  " }), /Preencha todos os campos/);
  await expectError(create(U.adm, { location: "" }), /Preencha todos os campos/);
  await expectError(create(U.adm, { name: "x".repeat(161) }), /excede o tamanho/);
  await expectError(create(U.adm, { start: "2027-06-01", end: "2027-05-31" }), /igual ou posterior/);
  assert.equal((await db.query("select count(*)::int c from public.projects")).rows[0].c, before);
});

await check("a função não é executável por anon e exige search_path vazio (SECURITY DEFINER auditado)", async () => {
  await expectError(as(db, { role: "anon" }, () => db.query("select public.create_project_workspace('X','N','C','L','2027-01-01','2027-02-01')")), /permission denied|must be owner|denied/i);
  const def = (await db.query("select pg_get_functiondef('public.create_project_workspace(text,text,text,text,date,date)'::regprocedure) as d")).rows[0].d;
  assert.match(def, /SET search_path TO ''/i);
});

console.log("");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
await db.close();
if (failed > 0) process.exit(1);
