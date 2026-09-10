import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { buildWeeklyAlertDigestEmail } = await import(
  "../apps/web/lib/email/templates/weekly-alert-digest-template.ts"
);

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`OK ${name}`);
}

const email = buildWeeklyAlertDigestEmail({
  recipientName: "Reynaldo",
  projectName: "Obra Piloto",
  responseUrl: "https://acc.exemplo/obra/acoes/resumo-semanal/123",
  items: [
    { actionId: "low", title: "Baixo primeiro na entrada", description: "Detalhe baixo", riskLevel: "LOW", dueAt: null },
    { actionId: "medium", title: "RFI pendente", description: "Responder sobre condutores pluviais", riskLevel: "MEDIUM", dueAt: "16/09/2026 07:00" },
  ],
});

check("assunto identifica o resumo e evita depender de cor de fonte", () => {
  assert.match(email.subject, /^🔵 \[RESUMO SEMANAL\] RISCOS MÉDIOS E BAIXOS/);
});

check("ordem do e-mail é Médio antes de Baixo", () => {
  assert(email.html.indexOf("RFI pendente") < email.html.indexOf("Baixo primeiro"));
  assert(email.text.indexOf("RFI pendente") < email.text.indexOf("Baixo primeiro"));
});

check("e-mail é curto e possui um único chamado para responder tudo", () => {
  assert.equal((email.html.match(/Responder todos os itens no ACC/g) ?? []).length, 1);
  assert(email.text.includes("Ciente, Estudando solução, Resolvido ou Direcionar"));
});

const form = readFileSync("apps/web/app/[projectId]/acoes/resumo-semanal/[digestId]/weekly-digest-form.tsx", "utf8");
const action = readFileSync("apps/web/app/[projectId]/acoes/resumo-semanal/[digestId]/actions.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260910230000_weekly_risk_alert_digest.sql", "utf8");
const route = readFileSync("apps/web/app/api/cron/weekly-alert-digest/route.ts", "utf8");
const proxy = readFileSync("apps/web/proxy.ts", "utf8");
const schedule = JSON.parse(readFileSync("apps/web/vercel.json", "utf8"));

check("interface bloqueia envio enquanto faltar resposta ou destinatário", () => {
  assert(form.includes('disabled={!complete || pending}'));
  assert(form.includes('answer !== "FORWARDED" || Boolean(directions[item.actionId])'));
  assert(form.includes("Responda todos os itens para liberar o envio."));
});

check("servidor também recusa item incompleto", () => {
  assert(action.includes("Responda todos os itens antes de enviar."));
  assert(action.includes('resolution === "FORWARDED" && !directedToUserId'));
});

check("RPC grava todas as respostas na mesma transação", () => {
  assert(migration.includes("v_received_count <> v_expected_count"));
  assert(migration.includes("v_distinct_count <> v_expected_count"));
  assert(migration.includes("submit_weekly_alert_digest"));
});

check("direcionamento altera somente o responsável", () => {
  const forwardBlock = migration.slice(
    migration.indexOf("if v_response = 'FORWARDED'"),
    migration.indexOf("elsif v_response = 'RESOLVED'")
  );
  assert(forwardBlock.includes("set responsible_user_id = v_directed_to"));
  assert(!/due_at|current_escalation_level/.test(forwardBlock));
});

check("agendamento é quarta-feira às 07:00 de São Paulo (10:00 UTC)", () => {
  assert.equal(schedule.crons[0].schedule, "0 10 * * 3");
});

check("rota agendada exige CRON_SECRET", () => {
  assert(route.includes("process.env.CRON_SECRET"));
  assert(route.includes('request.headers.get("authorization")'));
  assert(proxy.includes('request.nextUrl.pathname === "/api/cron/weekly-alert-digest"'));
});

check("texto usa português do Brasil", () => {
  const combined = `${form}\n${action}\n${migration}`.toLowerCase();
  for (const forbidden of ["ficheiro", "utilizador", "planeou"]) {
    assert(!combined.includes(forbidden), `termo não brasileiro encontrado: ${forbidden}`);
  }
});

console.log(`\n${passed} verificações concluídas.`);
