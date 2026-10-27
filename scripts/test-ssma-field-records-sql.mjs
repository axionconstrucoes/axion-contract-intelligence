// Migration 20261028130000_ssma_field_records.sql contra PostgreSQL LOCAL descartável (PGlite).
// Nada toca banco real. Schema do Supabase é um STUB mínimo (scripts/lib/pglite-supabase-stub.mjs +
// extras abaixo: is_project_member e storage.objects/foldername).
//
// Uso: node scripts/test-ssma-field-records-sql.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import { as, createLocalDb, expectError, migrationsDir } from "./lib/pglite-supabase-stub.mjs";

const U = {
  ana: "00000000-0000-4000-8000-0000000000a1", // colaboradora (autora) — obra 1
  bruno: "00000000-0000-4000-8000-0000000000b2", // colaborador (responsável) — obra 1
  caio: "00000000-0000-4000-8000-0000000000c3", // colaborador sem relação com o registro — obra 1
  ger: "00000000-0000-4000-8000-0000000000f7", // gerente — obra 1
  fora: "00000000-0000-4000-8000-0000000000e6", // só da obra 2
  inativo: "00000000-0000-4000-8000-0000000000e7", // INATIVO na obra 1
  dani: "00000000-0000-4000-8000-0000000000d8", // LEITURA na obra 1
};
const P1 = "00000000-0000-4000-8000-000000000001";
const P2 = "00000000-0000-4000-8000-000000000002";
const R1 = "10000000-0000-4000-8000-000000000001";
const R2 = "10000000-0000-4000-8000-000000000002";
const R3 = "10000000-0000-4000-8000-000000000003";
const PH = (n) => `20000000-0000-4000-8000-00000000000${n}`;
const SHA = (c) => c.repeat(64);

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
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };

const pre = `
create schema storage;
create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant usage on schema storage to authenticated, service_role;
grant select, insert, delete on storage.objects to authenticated, service_role;
create function public.is_project_member(p_project_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.project_memberships pm where pm.project_id = p_project_id and pm.user_id = auth.uid() and pm.status = 'ACTIVE')
$$;
grant execute on function public.is_project_member(uuid) to authenticated, service_role;
`;
const db = await createLocalDb(["20261028130000_ssma_field_records.sql"], pre);
// O stub concede privilégios a todas as tabelas DEPOIS das migrations; no Supabase real os REVOKEs da
// migration valem. Reaplica aqui só os REVOKEs da própria migration para testar o comportamento real.
const migrationSql = readFileSync(path.join(migrationsDir, "20261028130000_ssma_field_records.sql"), "utf8");
for (const stmt of migrationSql.match(/^revoke insert, update, delete on [^;]+;/gm) ?? []) await db.exec(stmt);
for (const [k, id] of Object.entries(U)) await db.query("insert into public.profiles (id,name,email) values ($1,$2,$3)", [id, k, `${k}@exemplo.invalid`]);
await db.query("insert into public.projects (id,name) values ($1,'Obra 1'),($2,'Obra 2')", [P1, P2]);
const member = (p, u, perm, status = "ACTIVE") => db.query("insert into public.project_memberships (project_id,user_id,permission,status) values ($1,$2,$3,$4)", [p, u, perm, status]);
await member(P1, U.ana, "COLABORADOR");
await member(P1, U.bruno, "COLABORADOR");
await member(P1, U.caio, "COLABORADOR");
await member(P1, U.ger, "GERENTE");
await member(P1, U.inativo, "COLABORADOR", "INACTIVE");
await member(P1, U.dani, "LEITURA");
await member(P2, U.fora, "COLABORADOR");

const auth = (uid, fn) => as(db, { role: "authenticated", uid }, fn);
const submit = (uid, over = {}) => {
  const a = { claimed: uid, id: R1, project: P1, kind: "OCORRENCIA", category: "Condição de risco", description: "Fio exposto no pavimento 2", location: "Pavimento 2",
    occurred: "2026-10-27T10:00:00Z", created: "2026-10-27T10:05:00Z", risk: "ALTA", responsible: U.bruno, due: "2026-11-05", ...over };
  return db.query("select public.ssma_field_record_submit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as id",
    [a.claimed, a.id, a.project, a.kind, a.category, a.description, a.location, a.occurred, a.created, a.risk, a.responsible, a.due]);
};
const register = (uid, { id, record = R1, purpose = "REGISTRO", path, sha = SHA("a"), project = P1 } = {}) =>
  db.query("select public.ssma_field_record_register_photo($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [uid, id, record, purpose, path ?? `${project}/ssma-registros/${record}/${id}-foto.jpg`, "foto.jpg", "image/jpeg", 1000, sha]);
const putObject = (path) => db.query("insert into storage.objects (bucket_id, name) values ('project-documents', $1)", [path]);
const update = (uid, actionId, event, note = null, evidence = null) =>
  auth(uid, () => db.query("select public.ssma_corrective_action_update($1,$2,$3,$4)", [actionId, event, note, evidence]));

console.log("\n======================================\nSSMA REGISTROS DE CAMPO — MIGRATION (PGlite local)\n======================================");

await check("membro envia registro; ação corretiva aberta com histórico CRIADA", async () => {
  await auth(U.ana, () => submit(U.ana));
  const rec = (await db.query("select * from public.ssma_field_records where id=$1", [R1])).rows[0];
  ok(rec.reported_by_user_id === U.ana, "autoria deve ser auth.uid()");
  ok(new Date(rec.client_created_at).toISOString() === "2026-10-27T10:05:00.000Z", "horário real do aparelho preservado");
  ok(Math.abs(Date.now() - new Date(rec.received_at).getTime()) < 60_000, "received_at é do servidor (agora), não do aparelho");
  const act = (await db.query("select * from public.ssma_corrective_actions where record_id=$1", [R1])).rows;
  ok(act.length === 1 && act[0].status === "ABERTA" && act[0].responsible_user_id === U.bruno, "ação ABERTA para o responsável");
  const ev = (await db.query("select kind from public.ssma_corrective_action_events where action_id=$1", [act[0].id])).rows;
  ok(ev.length === 1 && ev[0].kind === "CRIADA", "histórico CRIADA");
});

await check("reenvio do mesmo id é idempotente (sem duplicar registro nem ação)", async () => {
  const r = await auth(U.ana, () => submit(U.ana, { description: "texto diferente no reenvio" }));
  ok(r.rows[0].id === R1, "devolve o mesmo id");
  const rows = (await db.query("select description from public.ssma_field_records where id=$1", [R1])).rows;
  ok(rows.length === 1 && rows[0].description === "Fio exposto no pavimento 2", "registro original não é sobrescrito");
  ok((await db.query("select 1 from public.ssma_corrective_actions where record_id=$1", [R1])).rows.length === 1, "uma única ação");
});

await check("mesmo id por OUTRO usuário é recusado (RECORD_ID_CONFLICT)", async () => {
  await expectError(auth(U.caio, () => submit(U.caio)), /RECORD_ID_CONFLICT/);
});

await check("troca de conta: usuário da sessão diferente do esperado pelo aparelho (USER_MISMATCH)", async () => {
  await expectError(auth(U.caio, () => submit(U.ana, { id: R2 })), /USER_MISMATCH/);
  ok((await db.query("select 1 from public.ssma_field_records where id=$1", [R2])).rows.length === 0, "nada gravado");
});

await check("sem sessão (AUTH_REQUIRED)", async () => {
  await expectError(as(db, { role: "authenticated", uid: null }, () => submit(U.ana, { id: R2 })), /AUTH_REQUIRED|USER_MISMATCH/);
});

await check("acesso entre obras: membro só da obra 2 e inativo da obra 1 não enviam para a obra 1", async () => {
  await expectError(auth(U.fora, () => submit(U.fora, { id: R2 })), /PROJECT_ACCESS_DENIED/);
  await expectError(auth(U.inativo, () => submit(U.inativo, { id: R2 })), /PROJECT_ACCESS_DENIED/);
});

await check("perfil LEITURA não registra nem pode ser responsável por ação", async () => {
  await expectError(auth(U.dani, () => submit(U.dani, { id: R2 })), /READ_ONLY_MEMBER/);
  await expectError(auth(U.ana, () => submit(U.ana, { id: R2, responsible: U.dani })), /RESPONSIBLE_NOT_PROJECT_MEMBER/);
});

await check("responsável precisa ser membro ATIVO da obra e prazo é obrigatório com responsável", async () => {
  await expectError(auth(U.ana, () => submit(U.ana, { id: R2, responsible: U.fora })), /RESPONSIBLE_NOT_PROJECT_MEMBER/);
  await expectError(auth(U.ana, () => submit(U.ana, { id: R2, due: null })), /DUE_DATE_REQUIRED/);
});

await check("validações: tipo, risco, descrição curta e data futura", async () => {
  await expectError(auth(U.ana, () => submit(U.ana, { id: R2, kind: "OUTRO" })), /check|violates/i);
  await expectError(auth(U.ana, () => submit(U.ana, { id: R2, risk: "EXTREMA" })), /check|violates/i);
  await expectError(auth(U.ana, () => submit(U.ana, { id: R2, description: "ab" })), /check|violates/i);
  await expectError(auth(U.ana, () => submit(U.ana, { id: R2, occurred: "2999-01-01T00:00:00Z" })), /INVALID_FUTURE_DATE/);
});

await check("registro sem responsável não cria ação corretiva", async () => {
  await auth(U.ana, () => submit(U.ana, { id: R3, kind: "INSPECAO", risk: "BAIXA", responsible: null, due: null }));
  ok((await db.query("select 1 from public.ssma_corrective_actions where record_id=$1", [R3])).rows.length === 0, "sem ação");
});

await check("RLS: leitura só por membro ativo da obra; escrita direta negada", async () => {
  const seen = async (uid) => (await auth(uid, () => db.query("select id from public.ssma_field_records"))).rows.length;
  ok((await seen(U.caio)) === 2, "membro da obra 1 vê os registros");
  ok((await seen(U.dani)) === 2, "perfil LEITURA consulta");
  ok((await seen(U.fora)) === 0, "membro de outra obra não vê");
  ok((await seen(U.inativo)) === 0, "inativo não vê");
  await expectError(auth(U.ana, () => db.query("update public.ssma_field_records set description='x' where id=$1", [R1])), /permission denied/i);
  await expectError(auth(U.ana, () => db.query("delete from public.ssma_field_records where id=$1", [R1])), /permission denied/i);
  await expectError(auth(U.ana, () => db.query("insert into public.ssma_corrective_actions (record_id,project_id,responsible_user_id,due_date) values ($1,$2,$3,'2026-12-01')", [R3, P1, U.ana])), /permission denied/i);
});

await check("foto: exige objeto no Storage; idempotente; caminho/ tipo / hash validados", async () => {
  const path = `${P1}/ssma-registros/${R1}/${PH(1)}-foto.jpg`;
  await expectError(auth(U.ana, () => register(U.ana, { id: PH(1) })), /STORAGE_OBJECT_NOT_FOUND/);
  await putObject(path);
  await auth(U.ana, () => register(U.ana, { id: PH(1) }));
  const again = await auth(U.ana, () => register(U.ana, { id: PH(1) }));
  ok(again.rows[0] && (await db.query("select 1 from public.ssma_field_record_photos where record_id=$1", [R1])).rows.length === 1, "reenvio não duplica");
  await expectError(auth(U.ana, () => register(U.ana, { id: PH(2), path: `${P1}/ssma-registros/${R1}/outro-foto.jpg` })), /INVALID_STORAGE_PATH/);
  await expectError(auth(U.ana, () => register(U.ana, { id: PH(2), sha: "xyz" })), /STORAGE_OBJECT_NOT_FOUND|INVALID_PHOTO_HASH/);
});

await check("foto de REGISTRO só pelo autor; outro membro da obra é recusado", async () => {
  await putObject(`${P1}/ssma-registros/${R1}/${PH(3)}-foto.jpg`);
  await expectError(auth(U.caio, () => register(U.caio, { id: PH(3), sha: SHA("c") })), /RECORD_ACCESS_DENIED/);
  await expectError(auth(U.fora, () => register(U.fora, { id: PH(3), sha: SHA("c") })), /PROJECT_ACCESS_DENIED/);
});

await check("política de upload no Storage: autor, responsável e gestor; terceiros e outra obra não", async () => {
  const can = async (uid, name) => (await auth(uid, () => db.query("select public.can_upload_ssma_field_photo_object($1) as v", [name]))).rows[0].v;
  const name = `${P1}/ssma-registros/${R1}/${PH(9)}-x.jpg`;
  ok((await can(U.ana, name)) === true, "autor");
  ok((await can(U.bruno, name)) === true, "responsável");
  ok((await can(U.ger, name)) === true, "gerente");
  ok((await can(U.caio, name)) === false, "colaborador sem relação");
  ok((await can(U.fora, name)) === false, "outra obra");
  ok((await can(U.ana, `${P2}/ssma-registros/${R1}/${PH(9)}-x.jpg`)) === false, "caminho com obra errada");
  ok((await can(U.ana, `${P1}/ssma-registros/nao-uuid/x.jpg`)) === false, "id inválido");
});

const actionId = async () => (await db.query("select id from public.ssma_corrective_actions where record_id=$1", [R1])).rows[0].id;

await check("andamento: só responsável ou gestor; exige anotação; histórico gravado", async () => {
  const id = await actionId();
  await expectError(update(U.caio, id, "ANDAMENTO", "tentando"), /ACTION_ACCESS_DENIED/);
  await expectError(update(U.fora, id, "ANDAMENTO", "tentando"), /PROJECT_ACCESS_DENIED/);
  await expectError(update(U.bruno, id, "ANDAMENTO", "  "), /NOTE_REQUIRED/);
  await update(U.bruno, id, "ANDAMENTO", "Eletricista acionado");
  const act = (await db.query("select status from public.ssma_corrective_actions where id=$1", [id])).rows[0];
  ok(act.status === "EM_ANDAMENTO", "status em andamento");
});

await check("conclusão: responsável sem foto é recusado; justificativa não basta para colaborador", async () => {
  const id = await actionId();
  await expectError(update(U.bruno, id, "CONCLUIDA", "Fio isolado e área liberada"), /EVIDENCE_REQUIRED/);
});

await check("conclusão: foto de evidência de OUTRO registro não vale; foto do próprio registro vale", async () => {
  const id = await actionId();
  // foto de evidência do responsável (purpose EVIDENCIA_ACAO) — Bruno tem acesso ao registro como responsável.
  const evPath = `${P1}/ssma-registros/${R1}/${PH(4)}-evidencia.jpg`;
  await putObject(evPath);
  await auth(U.bruno, () => register(U.bruno, { id: PH(4), purpose: "EVIDENCIA_ACAO", sha: SHA("d"), path: evPath }));
  // foto 'REGISTRO' do autor não serve como evidência da ação
  await expectError(update(U.bruno, id, "CONCLUIDA", "ok", PH(1)), /EVIDENCE_NOT_FOUND/);
  // evidência em registro de outra ação: cria outro registro com foto
  await auth(U.ana, () => submit(U.ana, { id: R2, description: "Outro registro com ação", responsible: U.bruno }));
  const p5 = `${P1}/ssma-registros/${R2}/${PH(5)}-evidencia.jpg`;
  await putObject(p5);
  await auth(U.bruno, () => register(U.bruno, { id: PH(5), record: R2, purpose: "EVIDENCIA_ACAO", sha: SHA("e"), path: p5 }));
  await expectError(update(U.bruno, id, "CONCLUIDA", "ok", PH(5)), /EVIDENCE_NOT_FOUND/);
  await update(U.bruno, id, "CONCLUIDA", "Fio isolado e área liberada", PH(4));
  const act = (await db.query("select status, concluded_at, concluded_by_user_id from public.ssma_corrective_actions where id=$1", [id])).rows[0];
  ok(act.status === "CONCLUIDA" && act.concluded_at && act.concluded_by_user_id === U.bruno, "concluída por Bruno");
  const ev = (await db.query("select kind, evidence_photo_id from public.ssma_corrective_action_events where action_id=$1 order by created_at, id", [id])).rows;
  ok(ev.map((e) => e.kind).join(",") === "CRIADA,ANDAMENTO,CONCLUIDA", "histórico completo");
  ok(ev[2].evidence_photo_id === PH(4), "evidência vinculada ao evento");
});

await check("ação concluída não aceita novo andamento nem nova conclusão", async () => {
  await expectError(update(U.ger, await actionId(), "ANDAMENTO", "mais uma"), /ACTION_ALREADY_CONCLUDED/);
});

await check("gestor conclui com justificativa (≥10 caracteres) e sem foto; curta é recusada", async () => {
  const id = (await db.query("select id from public.ssma_corrective_actions where record_id=$1", [R2])).rows[0].id;
  await expectError(update(U.ger, id, "CONCLUIDA", "ok"), /JUSTIFICATION_REQUIRED/);
  await update(U.ger, id, "CONCLUIDA", "Verificado em vistoria presencial pelo gerente");
  ok((await db.query("select status from public.ssma_corrective_actions where id=$1", [id])).rows[0].status === "CONCLUIDA", "concluída");
});

await check("evento inválido e ação inexistente", async () => {
  await expectError(update(U.ger, await actionId(), "REABRIR"), /INVALID_EVENT/);
  await expectError(update(U.ger, "99999999-0000-4000-8000-000000000000", "ANDAMENTO", "x"), /ACTION_NOT_FOUND/);
});

console.log(`\n${passed} OK, ${failed} falha(s)`);
process.exit(failed ? 1 : 0);
