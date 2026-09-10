import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const readSource = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");

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

const usersPage = readSource("apps/web/app/[projectId]/usuarios/page.tsx");
const configurationPage = readSource("apps/web/app/[projectId]/acoes/configuracao/page.tsx");
const form = readSource("apps/web/components/sla/sla-area-responsibles-form.tsx");
const action = readSource("apps/web/app/[projectId]/acoes/actions.ts");
const migration = readSource("supabase/migrations/20260911121000_allow_pending_members_in_sla_matrix.sql");

console.log("\nMATRIZ SLA — USUÁRIOS PRÉ-CADASTRADOS\n");

check("as duas páginas incluem pré-cadastros pendentes nos seletores", () => {
  for (const source of [usersPage, configurationPage]) {
    assert(source.includes('invitation.status === "PENDING"'));
    assert(source.includes("formatInvitationSelection(invitation.id)"));
    assert(source.includes("Aguardando primeiro login"));
  }
});

check("somente memberships ativas e pré-cadastros pendentes são elegíveis", () => {
  for (const source of [usersPage, configurationPage]) {
    assert(source.includes('member.status === "ACTIVE"'));
    assert(!source.includes('invitation.status === "CANCELLED"'));
  }
});

check("formulário aceita referências de membership e de pré-cadastro", () => {
  assert(form.includes("formatMemberSelection"));
  assert(form.includes("formatInvitationSelection"));
  assert(form.includes("people.map"));
});

check("Server Action revalida projeto/status antes de gravar", () => {
  assert(action.includes('eq("project_id", projectId)'));
  assert(action.includes('eq("status", "ACTIVE")'));
  assert(action.includes('eq("status", "PENDING")'));
  assert(action.includes("responsible_direct_invitation_id"));
  assert(action.includes("board_invitation_id"));
});

check("banco impede convite de outro projeto e converte no primeiro login", () => {
  assert(migration.includes("validate_sla_area_responsible_invitations"));
  assert(migration.includes("project_id = new.project_id"));
  assert(migration.includes("status = 'PENDING'"));
  assert(migration.includes("resolve_sla_matrix_invitation_on_activation"));
  assert(migration.includes("new.status = 'ACTIVATED'"));
  assert(migration.includes("responsible_direct_user_id = case"));
  assert(migration.includes("board_user_id = case"));
});

console.log(`\nRESULTADO: ${passed} passaram, ${failed} falharam`);
if (failed > 0) process.exitCode = 1;
