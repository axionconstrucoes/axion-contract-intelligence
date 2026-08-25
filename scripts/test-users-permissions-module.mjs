// Testes estruturais do módulo Usuários & Permissões (ACC).
//
// Não sobe um banco (sem Docker neste ambiente) — os testes de
// RLS/triggers/RPCs ficam em
// supabase/tests/database/users_permissions_module_test.sql (pgTAP,
// requer `supabase test db`). Este script cobre o que dá para
// verificar estaticamente, sem banco: remoção completa do login por
// senha e ausência de literais de papel antigos (ADMIN/EDITOR/VIEWER)
// fora do mapeamento de compatibilidade da migration.
//
// Uso:
//   node scripts/test-users-permissions-module.mjs

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

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

function readSource(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const EXCLUDED_DIRS = new Set(["node_modules", ".next", ".git", ".temp"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

console.log("");
console.log("======================================");
console.log("USUÁRIOS & PERMISSÕES — TESTES ESTRUTURAIS");
console.log("======================================");
console.log("");

// ---------- 1. login por senha completamente removido ----------

check("app/login/actions.ts (login por senha) foi removido", () => {
  assert(!existsSync(path.join(repoRoot, "apps/web/app/login/actions.ts")), "arquivo ainda existe");
});

check('app/login/page.tsx não referencia mais "./actions" (login por senha)', () => {
  const source = readSource("apps/web/app/login/page.tsx");
  assert(!source.includes("./actions"), 'ainda importa "./actions"');
});

check('app/login/page.tsx não tem mais campo type="password"', () => {
  const source = readSource("apps/web/app/login/page.tsx");
  assert(!source.includes('type="password"'), 'ainda contém type="password"');
});

const webTsFiles = walk(path.join(repoRoot, "apps/web"));

check("nenhum arquivo .ts/.tsx de apps/web chama signInWithPassword", () => {
  const offenders = webTsFiles.filter((file) => readFileSync(file, "utf8").includes("signInWithPassword"));
  assert(offenders.length === 0, `encontrado em: ${offenders.map((f) => path.relative(repoRoot, f)).join(", ")}`);
});

check("nenhum arquivo .ts/.tsx de apps/web chama auth.signUp( (cadastro por senha)", () => {
  const offenders = webTsFiles.filter((file) => readFileSync(file, "utf8").includes("auth.signUp("));
  assert(offenders.length === 0, `encontrado em: ${offenders.map((f) => path.relative(repoRoot, f)).join(", ")}`);
});

// ---------- 2. validação de domínio @axion.com.br preservada ----------

check("auth/callback/route.ts ainda valida ALLOWED_EMAIL_DOMAIN = axion.com.br", () => {
  const source = readSource("apps/web/app/auth/callback/route.ts");
  assert(source.includes('ALLOWED_EMAIL_DOMAIN = "axion.com.br"'), "validação de domínio não encontrada");
});

// ---------- 3. nenhum literal de papel antigo (ADMIN/EDITOR/VIEWER) sobrando em apps/web ----------
// A migration mantém 'ADMIN'/'EDITOR'/'VIEWER' apenas como mapeamento
// de COMPATIBILIDADE dentro de has_project_permission() (SQL) — o
// TypeScript não deve mais comparar contra esses literais em nenhum
// lugar; os 4 papéis novos (ADMINISTRADOR/GERENTE/COLABORADOR/LEITURA)
// são a única fonte de verdade no app.

check("nenhum arquivo .ts/.tsx de apps/web compara permission contra 'ADMIN'/'EDITOR'/'VIEWER' (literais antigos)", () => {
  const pattern = /["']ADMIN["']|["']EDITOR["']|["']VIEWER["']/;
  const offenders = webTsFiles.filter((file) => pattern.test(readFileSync(file, "utf8")));
  assert(offenders.length === 0, `encontrado em: ${offenders.map((f) => path.relative(repoRoot, f)).join(", ")}`);
});

// ---------- 4. packages/types com os 4 papéis novos ----------

check("packages/types define ProjectPermission com os 4 papéis do ACC", () => {
  const source = readSource("packages/types/src/index.ts");
  assert(source.includes('"ADMINISTRADOR" | "GERENTE" | "COLABORADOR" | "LEITURA"'), "union de ProjectPermission não encontrada");
});

check("nenhum arquivo .ts/.tsx de apps/web usa o literal 'GESTOR' (papel renomeado para GERENTE)", () => {
  const offenders = webTsFiles.filter((file) => /["']GESTOR["']/.test(readFileSync(file, "utf8")));
  assert(offenders.length === 0, `encontrado em: ${offenders.map((f) => path.relative(repoRoot, f)).join(", ")}`);
});

check("packages/types não referencia mais os papéis antigos (VIEWER/EDITOR/ADMIN) em ProjectPermission", () => {
  const source = readSource("packages/types/src/index.ts");
  assert(!/ProjectPermission = "VIEWER"/.test(source), "ainda define ProjectPermission com valores antigos");
});

// ---------- 5. migration presente com as peças-chave do módulo ----------

const migrationDir = path.join(repoRoot, "supabase/migrations");
const migrationFile = readdirSync(migrationDir).find((f) => f.includes("project_membership_roles_status_area"));

check("migration do módulo Usuários & Permissões existe em supabase/migrations", () => {
  assert(Boolean(migrationFile), "arquivo de migration não encontrado");
});

if (migrationFile) {
  const migrationSource = readSource(path.join("supabase/migrations", migrationFile));

  for (const piece of [
    "ADMINISTRADOR', 'GESTOR', 'COLABORADOR', 'LEITURA'",
    "prevent_last_administrator_removal",
    "add_project_member",
    "update_project_member_role",
    "set_project_member_status",
    "remove_project_member",
    "find_profile_by_email",
    "profiles_email_unique_idx",
    "MEMBER_ADDED",
    "MEMBER_ROLE_CHANGED",
    "MEMBER_DEACTIVATED",
    "MEMBER_REACTIVATED",
    "MEMBER_REMOVED",
  ]) {
    check(`migration contém "${piece}"`, () => {
      assert(migrationSource.includes(piece), "trecho não encontrado na migration");
    });
  }

  // ---------- 6. revisão de segurança (SECURITY DEFINER, autoalteração, concorrência) ----------

  check("toda função SECURITY DEFINER da migration fixa search_path explicitamente (nenhuma órfã)", () => {
    // Ignora ocorrências dentro de comentários (linhas iniciadas com --)
    // — só interessam as cláusulas reais de definição de função.
    const codeLines = migrationSource.split("\n").filter((line) => !line.trim().startsWith("--"));
    const definerCount = codeLines.filter((line) => line.trim() === "security definer").length;
    const searchPathCount = codeLines.filter((line) => line.trim() === "set search_path = ''").length;
    assert(
      definerCount === searchPathCount,
      `${definerCount} função(ões) "security definer" mas ${searchPathCount} "set search_path = ''" — deveriam ser iguais`
    );
  });

  check("nome do CHECK constraint de permission não é mais presumido (descoberta dinâmica via pg_constraint/conkey)", () => {
    assert(!migrationSource.includes("drop constraint if exists project_memberships_permission_check"), "ainda presume o nome antigo no DROP");
    assert(migrationSource.includes("con.conkey"), "descoberta dinâmica via pg_constraint.conkey não encontrada");
  });

  check("add_project_member bloqueia explicitamente autoalteração (p_user_id = auth.uid())", () => {
    const fnStart = migrationSource.indexOf("create function public.add_project_member");
    const fnEnd = migrationSource.indexOf("\n$$;", fnStart);
    const fnBody = migrationSource.slice(fnStart, fnEnd);
    assert(fnBody.includes("if p_user_id = auth.uid() then"), "bloqueio de autoalteração não encontrado no corpo da função");
  });

  check("prevent_last_administrator_removal toma lock de linha em projects antes de contar administradores restantes (proteção de concorrência)", () => {
    const occurrences = (migrationSource.match(/from public\.projects where id = v_project_id for update/g) ?? []).length;
    assert(occurrences === 2, `esperado 1 lock por ramo (DELETE e UPDATE) = 2 ocorrências, encontrado ${occurrences}`);
  });

  check("find_profile_by_email restringe a busca ao domínio @axion.com.br (não é oráculo de e-mail genérico)", () => {
    assert(migrationSource.includes("lower(split_part(p_email, '@', 2)) <> 'axion.com.br'"), "restrição de domínio não encontrada");
  });

  check("função de trigger do último Administrador não é executável diretamente (revoke all from public)", () => {
    assert(migrationSource.includes("revoke all on function public.prevent_last_administrator_removal() from public;"), "revoke não encontrado");
  });

  check("profiles.email tem índice UNIQUE case-insensitive (lower(email))", () => {
    assert(migrationSource.includes("create unique index profiles_email_unique_idx") && migrationSource.includes("on public.profiles (lower(email))"), "índice case-insensitive não encontrado");
  });
}

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} OK, ${failed} FAIL`);
console.log("======================================");
console.log("");

if (failed > 0) process.exit(1);
