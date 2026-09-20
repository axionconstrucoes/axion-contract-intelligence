// Migration 20260920170000_harden_weekly_report_database_permissions —
// teste estático. Deriva os nomes das 9 tabelas, das 10 funções e das 13
// policies da PRÓPRIA migration 120000 (nenhuma lista paralela) e confirma
// que a migration de hardening só revoga o que deve, preserva o que a
// aplicação usa e não toca em dados, RLS, policies, corpos ou assinaturas.
//
// Uso:
//   node scripts/test-harden-weekly-report-permissions.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const readSource = (relative) => readFileSync(path.join(repoRoot, relative), "utf8").replace(/\r\n?/g, "\n");

const FOUNDATION = "supabase/migrations/20260920120000_weekly_schedule_email_ingestion_foundation.sql";
const HARDENING = "supabase/migrations/20260920170000_harden_weekly_report_database_permissions.sql";
const TRIGGER_FUNCTIONS = ["set_weekly_schedule_row_updated_at", "audit_weekly_schedule_config_change"];
const ADMIN_WRITE_TABLES = ["project_weekly_schedule_ingestion_configs", "project_schedule_risk_thresholds"];

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

const foundation = readSource(FOUNDATION);
const hardening = readSource(HARDENING);
const code = hardening.replace(/--.*$/gm, ""); // sem comentários
const doBlockStart = code.indexOf("do $$");
const statements = code.slice(0, doBlockStart >= 0 ? doBlockStart : undefined); // só os REVOKEs

const tables = [...foundation.matchAll(/^create table public\.([a-z_]+)/gm)].map((m) => m[1]);
const functions = [...foundation.matchAll(/^create or replace function public\.([a-z_]+)/gm)].map((m) => m[1]);
const policies = [...foundation.matchAll(/^create policy "([a-z_]+)"/gm)].map((m) => m[1]);
const readOnlyTables = tables.filter((t) => !ADMIN_WRITE_TABLES.includes(t));

const revokeRe = (privs, table, roles) => new RegExp(`^revoke ${privs} on table public\\.${table} from ${roles};`, "m");

check("0. Fontes derivadas da migration 120000: 9 tabelas, 10 funções, 13 policies, 2 trigger functions", () => {
  assert(tables.length === 9, `tabelas: ${tables.length}`);
  assert(functions.length === 10, `funções: ${functions.length}`);
  assert(policies.length === 13, `policies: ${policies.length}`);
  for (const fn of TRIGGER_FUNCTIONS) assert(functions.includes(fn) && new RegExp(`function public\\.${fn}\\(\\)\\s*returns trigger`).test(foundation), `${fn} é trigger function`);
  assert(ADMIN_WRITE_TABLES.every((t) => tables.includes(t)));
});

check("1. As nove tabelas revogam TODOS os privilégios de anon", () => {
  for (const t of tables) assert(revokeRe("all", t, "public, anon").test(statements), `falta revoke all ... from public, anon em ${t}`);
});
check("2. As nove tabelas revogam TODOS os privilégios de PUBLIC", () => {
  for (const t of tables) assert(revokeRe("all", t, "public, anon").test(statements), t);
  assert(!/grant\b/i.test(statements), "hardening não concede nada");
});
check("3. authenticated mantém só o esperado: SELECT nas nove; INSERT/UPDATE apenas em configs e thresholds", () => {
  for (const t of readOnlyTables) {
    assert(revokeRe("insert, update, delete, truncate, references, trigger, maintain", t, "authenticated").test(statements), `${t}: authenticated deve ficar só com SELECT`);
  }
  for (const t of ADMIN_WRITE_TABLES) {
    assert(revokeRe("delete, truncate, references, trigger, maintain", t, "authenticated").test(statements), `${t}: authenticated preserva INSERT/UPDATE`);
    assert(!new RegExp(`revoke [^\\n]*\\b(insert|update|select)\\b[^\\n]* on table public\\.${t} from authenticated`).test(statements), `${t}: INSERT/UPDATE/SELECT de authenticated não podem ser revogados`);
  }
  for (const t of tables) assert(!new RegExp(`revoke (all|[^\\n]*\\bselect\\b[^\\n]*) on table public\\.${t} from authenticated`).test(statements), `${t}: SELECT de authenticated preservado`);
  // O GRANT UPDATE por coluna da 120000 (configs) não é tocado.
  assert(!/revoke update \(/.test(statements) && !/revoke all on table public\.project_weekly_schedule_ingestion_configs from authenticated/.test(statements));
  assert(foundation.includes("grant update (\n  enabled, authorized_area"), "grant por coluna continua na 120000");
});
check("4. service_role mantém os privilégios nas nove tabelas (worker)", () => {
  assert(!/on table public\.[a-z_]+ from [^\n]*service_role/.test(statements), "nenhum revoke de tabela para service_role");
  assert(/has_table_privilege\('service_role', 'public\.' \|\| v_table, 'SELECT, INSERT, UPDATE, DELETE'\)/.test(hardening), "auto-verificação exige service_role íntegro");
});
check("5. Trigger functions sem EXECUTE para PUBLIC", () => {
  for (const fn of TRIGGER_FUNCTIONS) assert(new RegExp(`^revoke all on function public\\.${fn}\\(\\) from public;`, "m").test(statements), fn);
});
check("6. Trigger functions sem EXECUTE para anon", () => {
  for (const fn of TRIGGER_FUNCTIONS) assert(new RegExp(`^revoke all on function public\\.${fn}\\(\\) from anon;`, "m").test(statements), fn);
});
check("7. Trigger functions sem EXECUTE para authenticated (e service_role — trigger dispara sem EXECUTE)", () => {
  for (const fn of TRIGGER_FUNCTIONS) {
    assert(new RegExp(`^revoke all on function public\\.${fn}\\(\\) from authenticated;`, "m").test(statements), fn);
    assert(new RegExp(`^revoke all on function public\\.${fn}\\(\\) from service_role;`, "m").test(statements), fn);
  }
  assert(!/grant execute on function/.test(statements));
});
check("8. Corpos, assinaturas, search_path, owner e triggers das trigger functions não são alterados", () => {
  assert(!/create or replace function/.test(code) && !/alter function/.test(code), "nenhuma (re)definição de função");
  assert(!/create trigger|drop trigger|alter trigger|owner to/.test(code));
  // As RPCs expostas não são tocadas (já têm ACL postgres/authenticated/service_role).
  const rpcs = functions.filter((fn) => !TRIGGER_FUNCTIONS.includes(fn));
  for (const fn of rpcs) assert(!new RegExp(`function public\\.${fn}\\b`).test(statements), `${fn} não deve ser tocada`);
  assert(rpcs.length === 8);
});
check("9. RLS permanece habilitada (nenhum disable; auto-verificação exige relrowsecurity)", () => {
  assert(!/disable row level security|force row level security/.test(code));
  assert(/relrowsecurity from pg_class/.test(hardening) && /RLS desabilitada/.test(hardening));
});
check("10. As 13 policies continuam (nenhum drop/alter policy; auto-verificação exige 13)", () => {
  assert(!/drop policy|alter policy|create policy/.test(code));
  assert(/<> 13 then/.test(hardening));
  for (const p of policies) assert(foundation.includes(`create policy "${p}"`));
});
check("11. Nenhuma tabela ou coluna é apagada (nenhum DDL destrutivo)", () => {
  assert(!/drop table|drop column|alter table|drop function|drop index|drop schema/.test(code));
});
check("12. Nenhum dado é alterado (sem INSERT/UPDATE/DELETE/TRUNCATE) e a migration é autoverificável", () => {
  assert(!/^\s*(insert into|update |delete from|truncate )/im.test(code));
  assert(/raise exception 'hardening falhou/.test(hardening), "DO block aborta (rollback total) se algo ficar aberto");
  assert(/notify pgrst, 'reload schema';/.test(code));
  assert(hardening.includes("-- ============================================================\n-- 20260920170000_harden_weekly_report_database_permissions.sql"));
});

console.log("");
console.log(`Resultado: ${passed} OK, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
