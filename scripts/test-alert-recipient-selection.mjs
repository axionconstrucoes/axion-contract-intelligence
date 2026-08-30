// Correção: destinatário do alerta de contrato (SendContractAlertForm)
// passa a ser escolhido entre os usuários ACTIVE vinculados ao projeto,
// nunca digitado livremente — e o servidor nunca confia no nome (ou na
// capitalização do e-mail) vindos do navegador, resolvendo os dois de
// novo a partir da mesma fonte canônica de membros (getProjectMembers)
// já usada pela tela de Usuários.
//
// Sem stack Supabase local disponível neste ambiente (sem Docker), este
// script cobre o que É reproduzível sem banco: checagens estruturais no
// código-fonte de fato editado, seguindo o mesmo padrão já usado em
// scripts/test-email-actions.mjs.
//
// Uso:
//   node scripts/test-alert-recipient-selection.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
function readSource(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

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
console.log("ALERTA DE CONTRATO — destinatário ACTIVE (auto-fill de nome)");
console.log("======================================");
console.log("");

const actionsSource = readSource(
  "apps/web/app/[projectId]/ledger/[eventId]/send-alert-actions.ts"
);
const formSource = readSource("apps/web/components/ledger/send-contract-alert-form.tsx");
const pageSource = readSource("apps/web/app/[projectId]/ledger/[eventId]/page.tsx");

// ---------- servidor: nunca confia no navegador ----------

check("send-alert-actions.ts: usa getProjectMembers (fonte canônica), não uma query paralela", () => {
  assert(/import \{[^}]*\bgetProjectMembers\b[^}]*\} from "@\/lib\/data";/.test(actionsSource));
  assert(actionsSource.includes("getProjectMembers(projectId)"));
});

check("send-alert-actions.ts: filtra por status ACTIVE antes de aceitar o destinatário", () => {
  assert(/m\.status === ["']ACTIVE["']/.test(actionsSource));
});

check("send-alert-actions.ts: NUNCA lê recipientName do FormData vindo do navegador", () => {
  assert(!actionsSource.includes('formData.get("recipientName")'));
});

check("send-alert-actions.ts: recipientName/recipientEmail enviados ao provider vêm do membro resolvido no servidor, não do form", () => {
  assert(actionsSource.includes("const recipientEmail = recipientMember.user.email;"));
  assert(actionsSource.includes("const recipientName = recipientMember.user.name;"));
});

check("send-alert-actions.ts: e-mail que não pertence a um membro ACTIVE do projeto é rejeitado antes do envio", () => {
  assert(actionsSource.includes("if (!recipientMember) {"));
  const sendEmailIndex = actionsSource.indexOf("sendContractAlertEmail({");
  const rejectIndex = actionsSource.indexOf("if (!recipientMember) {");
  assert(rejectIndex !== -1 && sendEmailIndex !== -1 && rejectIndex < sendEmailIndex,
    "a checagem de destinatário elegível precisa vir ANTES da chamada de envio");
});

check("send-alert-actions.ts: comparação de e-mail é case-insensitive (evita bypass por capitalização)", () => {
  assert(actionsSource.includes("m.user.email.toLowerCase() === submittedRecipientEmail.toLowerCase()"));
});

check("send-alert-actions.ts: permanece 'use server', ADMINISTRADOR continua verificado em sendContractAlertEmail (não removido)", () => {
  assert(actionsSource.trimStart().startsWith('"use server"'));
  const emailLibSource = readSource("apps/web/lib/email/send-contract-alert-email.ts");
  assert(emailLibSource.includes('permission !== "ADMINISTRADOR"'),
    "a checagem de permissão ADMINISTRADOR em sendContractAlertEmail não pode ter sido removida");
});

// ---------- cliente: seleção, auto-fill, somente leitura ----------

check("send-contract-alert-form.tsx: recipientEmail é um <Select> alimentado por eligibleRecipients, não um <Input> livre", () => {
  assert(formSource.includes('<Select\n            name="recipientEmail"'));
  assert(formSource.includes("eligibleRecipients.map((r) => ("));
  assert(!/name="recipientEmail"[^>]*type="email"/.test(formSource), "não deveria mais existir um <Input type=email> livre para recipientEmail");
});

check("send-contract-alert-form.tsx: campo Nome é somente leitura E nunca é enviado no FormData (sem atributo name)", () => {
  const nameInputMatch = formSource.match(/<Input\s+type="text"[\s\S]*?\/>/);
  assert(nameInputMatch, "input de Nome não encontrado");
  const nameInput = nameInputMatch[0];
  assert(nameInput.includes("readOnly"), "o campo Nome precisa ser readOnly");
  assert(!/\bname=/.test(nameInput), "o campo Nome não pode ter atributo name (não pode ser submetido pelo cliente)");
});

check("send-contract-alert-form.tsx: Nome é derivado de selectedRecipient (o e-mail escolhido), nunca digitável", () => {
  assert(formSource.includes("selectedRecipient?.name"));
  assert(formSource.includes("eligibleRecipients.find((r) => r.email === recipientEmail)"));
});

check("send-contract-alert-form.tsx: sem destinatários ACTIVE elegíveis, o envio é desabilitado e uma mensagem clara aparece", () => {
  assert(formSource.includes("hasEligibleRecipients"));
  assert(formSource.includes("Nenhum usuário ativo elegível"));
  // O <Button type="submit"> só existe dentro do ramo hasEligibleRecipients — sem
  // destinatários, o formulário inteiro renderiza a mensagem no lugar do botão.
  const eligibleBranch = formSource.slice(
    formSource.indexOf("hasEligibleRecipients ? ("),
    formSource.indexOf(") : (")
  );
  assert(eligibleBranch.includes('type="submit"'), "o botão de envio deveria estar dentro do ramo com destinatários elegíveis");
});

// ---------- página: fonte canônica de membros ACTIVE ----------

check("page.tsx: importa getProjectMembers de @/lib/data (mesma fonte usada pela tela de Usuários)", () => {
  assert(pageSource.includes('import { getEvent, getProjectMembers, getUser } from "@/lib/data";'));
});

check("page.tsx: eligibleAlertRecipients é filtrado por status ACTIVE antes de ser passado ao formulário", () => {
  const filterIndex = pageSource.indexOf('m.status === "ACTIVE"');
  const propIndex = pageSource.indexOf("eligibleRecipients={eligibleAlertRecipients}");
  assert(filterIndex !== -1, "filtro por status ACTIVE não encontrado");
  assert(propIndex !== -1, "prop eligibleRecipients não encontrada no <SendContractAlertForm>");
  assert(filterIndex < propIndex, "o filtro ACTIVE precisa ser calculado antes de ser passado ao formulário");
});

check("page.tsx: SendContractAlertForm só é renderizado quando canReview (ADMINISTRADOR) — comportamento de permissão preservado", () => {
  assert(pageSource.includes("canReview && (") || pageSource.includes("canReview && <SendContractAlertForm"));
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exitCode = 1;
}
