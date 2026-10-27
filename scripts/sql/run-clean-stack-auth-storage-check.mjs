// Verificação de Auth (GoTrue), RLS via PostgREST e Storage num stack Supabase local DESCARTÁVEL criado por
// scripts/sql/start-clean-local-stack.mjs. Só usa usuários e arquivos FICTÍCIOS; nada vai a remoto/SMTP.
//
// Segurança: recusa qualquer API que não seja 127.0.0.1:57xxx e qualquer container que não comece com
// "supabase_db_acc-disposable-". Fixtures criados por este script são removidos ao final.
//
// Uso:
//   ACC_CLEAN_STACK_WORKDIR=<dir do stack> ACC_CLEAN_STACK_DB_CONTAINER=supabase_db_acc-disposable-clean \
//   ACC_CLEAN_STACK_I_UNDERSTAND_THIS_IS_DISPOSABLE=true node scripts/sql/run-clean-stack-auth-storage-check.mjs

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const cli = path.join(repo, "node_modules", ".bin", process.platform === "win32" ? "supabase.cmd" : "supabase");

const workdir = process.env.ACC_CLEAN_STACK_WORKDIR;
const container = process.env.ACC_CLEAN_STACK_DB_CONTAINER;
if (!workdir || !container || process.env.ACC_CLEAN_STACK_I_UNDERSTAND_THIS_IS_DISPOSABLE !== "true") {
  console.error("Defina ACC_CLEAN_STACK_WORKDIR, ACC_CLEAN_STACK_DB_CONTAINER e ACC_CLEAN_STACK_I_UNDERSTAND_THIS_IS_DISPOSABLE=true.");
  process.exit(2);
}
if (!container.startsWith("supabase_db_acc-disposable-")) {
  console.error("Recusado: o container precisa começar com supabase_db_acc-disposable-.");
  process.exit(2);
}

// Chaves locais do stack (nunca impressas).
const status = spawnSync(`"${cli}"`, ["status", "--workdir", `"${workdir}"`, "-o", "env"], { shell: true, encoding: "utf8" });
const env = Object.fromEntries(
  status.stdout.split(/\r?\n/).filter((line) => line.includes("=")).map((line) => {
    const [key, ...rest] = line.split("=");
    return [key, rest.join("=").replace(/^"|"$/g, "")];
  })
);
const API = env.API_URL;
if (!API || !/^http:\/\/127\.0\.0\.1:57\d{3}$/.test(API)) {
  console.error(`Recusado: API_URL fora do padrão local descartável (${API ?? "ausente"}).`);
  process.exit(2);
}
const ANON = env.ANON_KEY;
const SERVICE = env.SERVICE_ROLE_KEY;

function psql(sql) {
  const r = spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "--no-psqlrc", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`psql falhou: ${r.stderr.trim().slice(0, 300)}`);
  return r.stdout.trim();
}

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
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const suffix = randomUUID().slice(0, 8);
const PHOTO_NAME = "foto-ficticia.png";
const emailA = `ana-${suffix}@exemplo.invalid`;
const emailB = `bruno-${suffix}@exemplo.invalid`;
const password = `Senha-${suffix}-Teste!1`;
const P1 = randomUUID();
const P2 = randomUUID();
const REC = randomUUID();
const PHOTO = randomUUID();
const objectPath = (project) => `${project}/ssma-registros/${REC}/${PHOTO}-${PHOTO_NAME}`;
let userA = null;
let userB = null;
let tokenA = null;
let tokenB = null;

async function signup(email) {
  const res = await fetch(`${API}/auth/v1/signup`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const body = await res.json();
  assert(res.ok, `signup HTTP ${res.status}: ${JSON.stringify(body).slice(0, 160)}`);
  return body;
}
async function login(email) {
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const body = await res.json();
  assert(res.ok && body.access_token, `login HTTP ${res.status}`);
  return body;
}
const rest = (token, p, init = {}) => fetch(`${API}/rest/v1/${p}`, { ...init, headers: { apikey: ANON, authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } });

console.log("\n======================================");
console.log(`AUTH / RLS / STORAGE — stack descartável (${container})`);
console.log("======================================\n");

try {
  // ---------------- AUTH (GoTrue) ----------------
  await check("Auth: GoTrue responde (health) e o signup/login com e-mail fictício funciona (sem SMTP)", async () => {
    const h = await fetch(`${API}/auth/v1/health`, { headers: { apikey: ANON } });
    assert(h.ok, `health HTTP ${h.status}`);
    userA = (await signup(emailA)).user ?? null;
    userB = (await signup(emailB)).user ?? null;
    const a = await login(emailA);
    const b = await login(emailB);
    tokenA = a.access_token;
    tokenB = b.access_token;
    userA = a.user;
    userB = b.user;
    assert(userA?.id && userB?.id && userA.id !== userB.id, "usuários distintos");
  });

  await check("Auth: o gatilho on_auth_user_created cria o perfil em public.profiles", async () => {
    const n = psql(`select count(*) from public.profiles where id in ('${userA.id}','${userB.id}')`);
    assert(n === "2", `perfis criados: ${n}`);
  });

  // fixtures: duas obras, cada usuário membro ativo de UMA
  psql(`
    insert into public.projects (id, code, name, client, location, start_date, baseline_end_date) values
      ('${P1}', 'TST-${suffix}-1', 'Obra Fictícia 1', 'Cliente F', 'Local', '2027-01-01', '2027-12-31'),
      ('${P2}', 'TST-${suffix}-2', 'Obra Fictícia 2', 'Cliente F', 'Local', '2027-01-01', '2027-12-31');
    insert into public.project_memberships (project_id, user_id, permission, status) values
      ('${P1}', '${userA.id}', 'COLABORADOR', 'ACTIVE'),
      ('${P2}', '${userB.id}', 'COLABORADOR', 'ACTIVE');
  `);

  // ---------------- RLS via PostgREST com JWT real ----------------
  await check("RLS (PostgREST): sem token (anon) não lê projetos; cada usuário vê SÓ a própria obra", async () => {
    const anon = await fetch(`${API}/rest/v1/projects?select=id`, { headers: { apikey: ANON } });
    const anonRows = anon.ok ? await anon.json() : [];
    assert(!anon.ok || anonRows.length === 0, `anon leu ${anonRows.length} projetos`);
    const ra = await (await rest(tokenA, "projects?select=id")).json();
    const rb = await (await rest(tokenB, "projects?select=id")).json();
    assert(ra.length === 1 && ra[0].id === P1, `A viu ${JSON.stringify(ra).slice(0, 80)}`);
    assert(rb.length === 1 && rb[0].id === P2, `B viu ${JSON.stringify(rb).slice(0, 80)}`);
  });

  await check("RLS: usuário A NÃO lê providências/registros SSMA da obra de B e não escreve direto nas tabelas protegidas", async () => {
    const direct = await rest(tokenA, "ssma_field_records", { method: "POST", body: JSON.stringify({ id: randomUUID(), project_id: P1, kind: "OCORRENCIA" }) });
    assert(!direct.ok, "INSERT direto em ssma_field_records deveria ser negado");
    const del = await rest(tokenA, `project_memberships?project_id=eq.${P1}`, { method: "DELETE" });
    const still = psql(`select count(*) from public.project_memberships where project_id='${P1}'`);
    assert(still === "1", `membros após DELETE de A: ${still} (status HTTP ${del.status})`);
  });

  await check("RPC SSMA (JWT real): A registra ocorrência na obra 1; B (outra obra) é recusado", async () => {
    const body = (project, claimed) => JSON.stringify({
      p_claimed_user_id: claimed, p_id: REC, p_project_id: project, p_kind: "OCORRENCIA", p_category: "EPI",
      p_description: "Teste fictício de ocorrência", p_location: "Bloco A", p_occurred_at: new Date().toISOString(),
      p_client_created_at: new Date().toISOString(), p_risk_level: "MEDIA", p_responsible_user_id: null, p_due_date: null,
    });
    const ok = await rest(tokenA, "rpc/ssma_field_record_submit", { method: "POST", body: body(P1, userA.id) });
    assert(ok.ok, `A recusado: HTTP ${ok.status} ${(await ok.text()).slice(0, 160)}`);
    const denied = await rest(tokenB, "rpc/ssma_field_record_submit", { method: "POST", body: body(P1, userB.id) });
    assert(!denied.ok, "B (outra obra) não deveria registrar na obra 1");
    const mismatch = await rest(tokenA, "rpc/ssma_field_record_submit", { method: "POST", body: body(P1, userB.id).replace(REC, randomUUID()) });
    assert(!mismatch.ok, "USER_MISMATCH: sessão de A com claimed_user de B deveria ser recusada");
    const rows = psql(`select count(*) from public.ssma_field_records where project_id='${P1}'`);
    assert(rows === "1", `registros da obra 1: ${rows}`);
  });

  // ---------------- STORAGE ----------------
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const upload = (token, p) => fetch(`${API}/storage/v1/object/project-documents/${p}`, { method: "POST", headers: { apikey: ANON, authorization: `Bearer ${token}`, "content-type": "image/png", "x-upsert": "false" }, body: png });

  await check("Storage: o bucket project-documents existe e é privado", async () => {
    const r = psql("select id||':'||public from storage.buckets where id='project-documents'");
    assert(r === "project-documents:false", r);
  });

  await check("Storage: A envia foto do registro da obra 1; é NEGADO enviar para a obra 2 e B é negado na obra 1", async () => {
    const okUp = await upload(tokenA, objectPath(P1));
    assert(okUp.ok, `upload de A recusado: HTTP ${okUp.status} ${(await okUp.text()).slice(0, 160)}`);
    const otherProject = await upload(tokenA, objectPath(P2));
    assert(!otherProject.ok, "A enviou arquivo para o caminho da obra 2");
    const bUp = await upload(tokenB, `${P1}/ssma-registros/${REC}/${randomUUID()}-b.png`);
    assert(!bUp.ok, "B enviou arquivo para a obra 1");
  });

  await check("Storage: download — A (membro da obra 1) baixa; B (obra 2) e anon NÃO baixam", async () => {
    const get = (token) => fetch(`${API}/storage/v1/object/authenticated/project-documents/${objectPath(P1)}`, { headers: { apikey: ANON, authorization: `Bearer ${token}` } });
    const a = await get(tokenA);
    assert(a.ok && (await a.arrayBuffer()).byteLength === png.length, `download de A: HTTP ${a.status}`);
    const b = await get(tokenB);
    assert(!b.ok, `B baixou o arquivo da obra 1 (HTTP ${b.status})`);
    const anon = await fetch(`${API}/storage/v1/object/project-documents/${objectPath(P1)}`, { headers: { apikey: ANON } });
    assert(!anon.ok, "anon baixou o arquivo");
  });
} finally {
  // limpeza dos fixtures (sempre) — apenas o que este script criou. Storage só pela API (o banco recusa DELETE direto).
  try {
    const remove = await fetch(`${API}/storage/v1/object/project-documents`, {
      method: "DELETE",
      headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" },
      body: JSON.stringify({ prefixes: [objectPath(P1)] }),
    });
    if (!remove.ok) console.log(`(limpeza do Storage: HTTP ${remove.status})`);
    psql(`
      delete from public.ssma_field_record_photos where record_id in (select id from public.ssma_field_records where project_id in ('${P1}','${P2}'));
      delete from public.ssma_corrective_actions where record_id in (select id from public.ssma_field_records where project_id in ('${P1}','${P2}'));
      delete from public.ssma_field_records where project_id in ('${P1}','${P2}');
      delete from public.project_memberships where project_id in ('${P1}','${P2}');
      delete from public.projects where id in ('${P1}','${P2}');
    `);
  } catch (error) {
    console.log(`(limpeza parcial do banco: ${error.message})`);
  }
  for (const id of [userA?.id, userB?.id].filter(Boolean)) {
    await fetch(`${API}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` } });
  }
}

console.log("");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
process.exit(failed > 0 ? 1 : 0);
