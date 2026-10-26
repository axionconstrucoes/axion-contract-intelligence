// Integração do acompanhamento recorrente com os fluxos existentes (verificações estruturais
// no código-fonte — sem banco, rede ou envio) e segurança das páginas de ação (GET nunca
// altera estado).
//
// Uso: node scripts/test-alert-followup-integration.mjs

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);
const policy = await import("../apps/web/lib/alerts/repeat-policy.ts");

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(path.join(here, "..", p), "utf8").replace(/\r\n/g, "\n");

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

const COMPACT_DIR = "apps/web/app/alertas/acao/[projectId]/[batchId]/[eventId]";
const BATCH_FORM = "apps/web/app/[projectId]/ledger/lote-alertas/[batchId]/contract-alert-batch-form.tsx";

console.log("");
console.log("======================================");
console.log("ACOMPANHAMENTO — INTEGRAÇÃO E SEGURANÇA");
console.log("======================================");
console.log("");

check("GET não altera estado: o formulário de ação rápida NÃO envia sozinho (sem requestSubmit/useEffect/window.close)", () => {
  const form = src(`${COMPACT_DIR}/compact-action-form.tsx`);
  assert.ok(!/requestSubmit|useEffect|window\.close|autoSubmit/.test(form), "auto-envio removido");
  assert.ok(form.includes("CONFIRMAR"), "confirmação explícita");
  assert.ok(form.includes("AlertActionNotice"), "aviso antes da confirmação");
  assert.match(form, /<form action=\{formAction\}/);
});

check("páginas de ação (server components) não gravam nada ao renderizar", () => {
  for (const p of [`${COMPACT_DIR}/page.tsx`, "apps/web/app/alertas/lote/[projectId]/[batchId]/page.tsx", "apps/web/app/[projectId]/ledger/lote-alertas/[batchId]/page.tsx"]) {
    const page = src(p);
    assert.ok(!/respondToContractAlertBatch\(|\.rpc\(|\.insert\(|\.update\(|\.delete\(/.test(page), `${p} não deve mutar`);
  }
});

check("avisos exatos antes da confirmação: EM ANDAMENTO e ENVIADO P/ por grau de risco (intervalos 1/2/4/7 dias)", () => {
  assert.equal(policy.inProgressConfirmationNotice("CRITICA"), "Este alerta será repetido a cada 1 dia até a conclusão.");
  assert.equal(policy.inProgressConfirmationNotice("ALTA"), "Este alerta será repetido a cada 2 dias até a conclusão.");
  assert.equal(policy.inProgressConfirmationNotice("MEDIA"), "Este alerta será repetido a cada 4 dias até a conclusão.");
  assert.equal(policy.inProgressConfirmationNotice("BAIXA"), "Este alerta será repetido a cada 7 dias até a conclusão.");
  assert.equal(policy.forwardConfirmationNotice("ALTA"), "O destinatário receberá este alerta a cada 2 dias até a conclusão.");
  assert.match(policy.resolvedConfirmationNotice(), /lembretes futuros serão interrompidos/);
  const notice = src("apps/web/components/alerts/alert-action-notice.tsx");
  assert.ok(notice.includes('action === "EM_ANDAMENTO"') && notice.includes('action === "ENVIADO_PARA"') && notice.includes('action === "RESOLVIDO"'));
});

check("o formulário do lote (vários alertas) mostra o aviso da ação escolhida em cada alerta", () => {
  const form = src(BATCH_FORM);
  assert.ok(form.includes("<AlertActionNotice action={actions[item.eventId]} severity={item.severity} />"));
  assert.ok(form.includes("RESPONDER AO ACC"), "envio explícito preservado");
});

check("ENVIADO P/: lista só colaboradores ATIVOS da obra (página) e o banco confere de novo (função SQL)", () => {
  assert.ok(src(`${COMPACT_DIR}/page.tsx`).includes('.filter((member) => member.status === "ACTIVE")'));
  assert.ok(src("supabase/migrations/20261027120000_alert_followups.sql").includes("pm.status = 'ACTIVE'"));
});

check("acompanhamento abre DEPOIS do aceite do provedor e do SENT persistido, em try/catch, sem desfazer o envio", () => {
  const s = src("apps/web/lib/email/create-and-send-contract-alert-batch.ts");
  const sentIdx = s.indexOf('status: "SENT"');
  const auditIdx = s.indexOf('action: "CONTRACT_ALERT_BATCH_SENT"');
  const openIdx = s.indexOf("openFollowupsForSentBatch(admin");
  assert.ok(sentIdx > 0 && auditIdx > sentIdx && openIdx > auditIdx, "ordem: SENT -> auditoria -> acompanhamento");
  assert.match(s.slice(openIdx - 200, openIdx), /try \{/);
  assert.ok(s.includes("ALERT_FOLLOWUP_OPEN_FAILED"), "falha ao abrir fica na auditoria");
});

check("a resposta do lote é espelhada no acompanhamento DEPOIS da RPC atômica, sem desfazê-la", () => {
  const s = src("apps/web/lib/email-actions/respond-to-contract-alert-batch.ts");
  const rpcIdx = s.indexOf('rpc("submit_contract_alert_batch_response"');
  const applyIdx = s.indexOf("applyBatchResponsesToFollowups(supabase");
  assert.ok(rpcIdx > 0 && applyIdx > rpcIdx);
  assert.match(s.slice(applyIdx - 120, applyIdx), /try \{/);
});

check("serviço de acompanhamento: ações do usuário usam a sessão dele (apply_action); abertura usa service role", () => {
  const s = src("apps/web/lib/alerts/followup-service.ts");
  assert.ok(s.includes('admin.rpc("alert_followup_open"'));
  assert.ok(s.includes('supabase.rpc("alert_followup_apply_action"'));
});

check("store do ciclo só usa funções SQL (rpc) e leitura — nenhuma escrita direta em tabela", () => {
  const s = src("apps/web/lib/alerts/followup-supabase-store.ts");
  assert.ok(!/\.(insert|update|delete|upsert)\(/.test(s));
  for (const fn of ["alert_followup_claim_due", "alert_followup_mark_sent", "alert_followup_mark_failed", "alert_followup_release"]) assert.ok(s.includes(fn), fn);
});

check("lembrete vai ao responsável ATUAL e reaproveita o envio do lote (guard do piloto, caixas, botões)", () => {
  const s = src("apps/web/lib/alerts/contract-event-reminder-mailer.ts");
  assert.ok(s.includes("recipientUserId: message.recipientUserId"));
  assert.ok(s.includes("createAndSendContractAlertBatch("));
  assert.ok(!/process\.env/.test(s));
});

check("rota /api/cron/alert-reminders exige CRON_SECRET (fail-closed), está na allowlist exata e não vaza detalhes", () => {
  const route = src("apps/web/app/api/cron/alert-reminders/route.ts");
  assert.ok(route.includes("isCronRequestAuthorized(request, process.env.CRON_SECRET)"));
  assert.ok(route.includes("status: 401"));
  assert.ok(!/error\.message|String\(error\)/.test(route));
  assert.ok(src("apps/web/lib/cron/public-cron-routes.ts").includes('"/api/cron/alert-reminders"'));
});

check("workflow de lembretes: agendador existente (GitHub Actions + CRON_SECRET), concorrência serializada, frequência real documentada", () => {
  const wf = src(".github/workflows/alert-reminders.yml");
  assert.ok(existsSync(path.join(here, "..", ".github/workflows/alert-reminders.yml")));
  assert.ok(wf.includes("secrets.CRON_SECRET") && wf.includes("/api/cron/alert-reminders"));
  assert.match(wf, /concurrency:\n  group: alert-reminders\n  cancel-in-progress: false/);
  assert.match(wf, /2 a 5 horas/);
});

check("migration só adiciona (sem DROP/ALTER de tabelas existentes)", () => {
  const sql = src("supabase/migrations/20261027120000_alert_followups.sql");
  assert.ok(!/\bdrop (table|column)\b/i.test(sql));
  assert.ok(!/alter table public\.(projects|project_memberships|contract_events|contract_alert)/i.test(sql));
});

console.log("");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
if (failed > 0) process.exit(1);
