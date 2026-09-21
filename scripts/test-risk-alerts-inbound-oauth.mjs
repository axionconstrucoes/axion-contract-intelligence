// OAuth DEDICADO da caixa de respostas aos alertas de risco (piloto:
// axion@axion.com.br) — a fase `replies` do worker usa EXCLUSIVAMENTE
// ACC_RISK_ALERTS_INBOUND_*, sem fallback para GOOGLE_GMAIL_INBOUND_*
// (Gmail Inbound Sync, intocado). Funções REAIS (puras) + inspeção de
// fonte do worker/workflow/helper; nenhum OAuth real, nenhum acesso a
// banco, nenhum e-mail.
//
// Uso:
//   node scripts/test-risk-alerts-inbound-oauth.mjs

import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const creds = await import("../apps/web/lib/risk-alerts/replies/inbound-credentials");
const { filterInboundMessage } = await import("../apps/web/lib/risk-alerts/replies/reply-pipeline");
const { extractInboundFromGmail } = await import("../apps/web/lib/risk-alerts/replies/gmail-reply-extract");

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const readSource = (relative) => readFileSync(path.join(repoRoot, relative), "utf8").replace(/\r\n?/g, "\n");
// Só código (sem comentários de linha) — os comentários citam nomes legados de propósito.
const codeOnly = (source) => source.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message ?? "assertion failed");
}
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

// ------------------------------------------------------------------ fixtures (valores FICTÍCIOS; nenhum segredo real)
const BOX = "axion@axion.com.br";
const ENV = creds.RISK_ALERTS_INBOUND_ENV;
const fullEnv = () => ({
  [ENV.clientId]: "fake-client-id.apps.googleusercontent.com",
  [ENV.clientSecret]: "fake-client-secret",
  [ENV.refreshToken]: "fake-refresh-token",
  [ENV.mailbox]: "  Axion@Axion.com.br ",
});
const legacyEnv = () => ({
  GOOGLE_GMAIL_INBOUND_CLIENT_ID: "legacy-id",
  GOOGLE_GMAIL_INBOUND_CLIENT_SECRET: "legacy-secret",
  GOOGLE_GMAIL_INBOUND_REFRESH_TOKEN: "legacy-token",
  GOOGLE_GMAIL_INBOUND_MAILBOX: "inbound@axion.com.br",
});
const worker = readSource("scripts/weekly-schedule-email-ingest.mjs");
const phase7 = worker.slice(worker.indexOf("// FASE 7 — RESPOSTAS POR E-MAIL"), worker.indexOf('console.log("RESULTADO")'));
const workflow = readSource(".github/workflows/weekly-schedule-email-ingestion.yml");
const ingestJob = workflow.slice(workflow.indexOf("\n  ingest:"), workflow.indexOf("\n  risk-alerts:"));
const riskAlertsJob = workflow.slice(workflow.indexOf("\n  risk-alerts:"));
const helper = readSource("scripts/gmail-inbound-oauth.mjs");

// ------------------------------------------------------------------ 1. resolução das credenciais dedicadas
await check("1. Quatro variáveis dedicadas presentes => fase habilitada; caixa normalizada (lowercase/trim)", () => {
  const result = creds.resolveRiskAlertInboundCredentials(fullEnv());
  assert(result.ok === true, "esperado ok");
  assert(result.credentials.mailbox === BOX, result.credentials.mailbox);
  assert(result.credentials.clientId === "fake-client-id.apps.googleusercontent.com");
  assert(result.credentials.clientSecret === "fake-client-secret" && result.credentials.refreshToken === "fake-refresh-token");
});
await check("2. Qualquer variável ausente ou vazia => SKIPPED_NOT_CONFIGURED com o NOME da variável (nunca valores)", () => {
  for (const name of Object.values(ENV)) {
    for (const blank of [undefined, "", "   "]) {
      const env = fullEnv();
      if (blank === undefined) delete env[name];
      else env[name] = blank;
      const result = creds.resolveRiskAlertInboundCredentials(env);
      assert(result.ok === false && result.status === "SKIPPED_NOT_CONFIGURED", `${name} em branco deveria pular a fase`);
      assert(result.missing.length === 1 && result.missing[0] === name, `missing=${JSON.stringify(result.missing)}`);
      assert(!JSON.stringify(result).includes("fake-"), "nenhum valor de credencial no resultado");
    }
  }
  const none = creds.resolveRiskAlertInboundCredentials({});
  assert(none.ok === false && none.missing.length === 4 && none.missing.every((n) => n.startsWith("ACC_RISK_ALERTS_INBOUND_")));
});
await check("3. Sem fallback: somente GOOGLE_GMAIL_INBOUND_* presentes => SKIPPED_NOT_CONFIGURED", () => {
  const result = creds.resolveRiskAlertInboundCredentials(legacyEnv());
  assert(result.ok === false && result.status === "SKIPPED_NOT_CONFIGURED" && result.missing.length === 4);
  const mixed = creds.resolveRiskAlertInboundCredentials({ ...legacyEnv(), [ENV.mailbox]: BOX });
  assert(mixed.ok === false && mixed.missing.length === 3 && !mixed.missing.includes(ENV.mailbox), "as legadas não completam as dedicadas");
  assert(!codeOnly(readSource("apps/web/lib/risk-alerts/replies/inbound-credentials.ts")).includes("GOOGLE_GMAIL_INBOUND_"), "módulo não conhece as variáveis legadas");
});
await check("4. Caixa dedicada inválida (não é e-mail) => SKIPPED_NOT_CONFIGURED", () => {
  for (const bad of ["axion", "axion@", "@axion.com.br", "axion axion@axion.com.br", "Axion <axion@axion.com.br>"]) {
    const result = creds.resolveRiskAlertInboundCredentials({ ...fullEnv(), [ENV.mailbox]: bad });
    assert(result.ok === false && result.missing.length === 1 && result.missing[0] === ENV.mailbox, `mailbox=${JSON.stringify(bad)}`);
  }
});

// ------------------------------------------------------------------ 2. falha fechada: perfil autenticado ≠ caixa
await check("5. Perfil Gmail autenticado ≠ caixa dedicada => bloqueado (null, vazio, outra caixa, sub-endereço)", () => {
  assert(creds.inboundProfileMatchesMailbox(BOX, BOX) === true);
  assert(creds.inboundProfileMatchesMailbox(" AXION@axion.com.br ", BOX) === true, "comparação normalizada");
  for (const other of [null, undefined, "", "   ", "inbound@axion.com.br", "axion+alerta-x@axion.com.br", "axion@axion.com", "reynaldo@axion.com.br"]) {
    assert(creds.inboundProfileMatchesMailbox(other, BOX) === false, `perfil ${JSON.stringify(other)} deveria bloquear`);
  }
});
await check("6. Worker: users.getProfile obrigatório; divergência => BLOCKED_MAILBOX_MISMATCH, nenhum projeto processado, exitCode=1 só nesse caso", () => {
  assert(phase7.includes("gmailClient.users.getProfile({ userId: \"me\" })"), "getProfile na fase 7");
  assert(phase7.includes("inboundProfileMatchesMailbox(profileEmail, inbound.credentials.mailbox)"));
  assert(phase7.includes('status: "BLOCKED_MAILBOX_MISMATCH"') && phase7.includes("repliesBlocked = true;"));
  assert(phase7.includes("const gmail = repliesBlocked ? null : gmailClient;") && phase7.includes("for (const config of gmail ? configs : [])"), "nenhum projeto é lido quando bloqueado/pulado");
  assert(worker.includes("if (repliesBlocked) process.exitCode = 1;"), "job termina com erro visível apenas no bloqueio");
  assert(!/SKIPPED_NOT_CONFIGURED[^\n]*exitCode|exitCode[^\n]*SKIPPED_NOT_CONFIGURED/.test(worker), "credenciais ausentes NÃO falham o job");
  assert(!phase7.includes("process.exit("), "nenhuma saída abrupta dentro da fase 7 (demais fases já concluídas; resumo ainda é impresso)");
  const exitIdx = worker.indexOf("if (repliesBlocked) process.exitCode = 1;");
  assert(exitIdx > worker.indexOf('console.log("RESULTADO")'), "exitCode definido após o resumo de todas as fases");
});

// ------------------------------------------------------------------ 3. override de entrega do projeto
await check("7. Override de entrega ≠ caixa dedicada => BLOCKED_OVERRIDE_MISMATCH (projeto pulado); NULL ou igual => ok", () => {
  assert(creds.checkOverrideCompatibility(BOX, null).ok === true);
  assert(creds.checkOverrideCompatibility(BOX, undefined).ok === true);
  assert(creds.checkOverrideCompatibility(BOX, "").ok === true);
  assert(creds.checkOverrideCompatibility(BOX, " AXION@axion.com.br ").ok === true);
  const blocked = creds.checkOverrideCompatibility(BOX, "outra@axion.com.br");
  assert(blocked.ok === false && blocked.status === "BLOCKED_OVERRIDE_MISMATCH");
  assert(creds.checkOverrideCompatibility(BOX, "reynaldo@axion.com.br").ok === false);
  assert(phase7.includes('select("pilot_delivery_override_email")') && phase7.includes("checkOverrideCompatibility(mailbox, overrideRow?.pilot_delivery_override_email ?? null)"));
  assert(phase7.includes("summary.replies.skippedProjects.push({ projectId: config.projectId, status: compat.status });") && phase7.includes("continue;"), "projeto incompatível é pulado antes de qualquer leitura de Gmail");
});

// ------------------------------------------------------------------ 4. filtros preservados (self, auto-reply, bounce, Message-ID duplicado)
const baseHeaders = (o = {}) => ({ from: "fornecedor@exemplo.com", messageId: "<m1@exemplo.com>", references: [], inReplyTo: null, autoSubmitted: null, precedence: null, xAutoReply: null, xAutoRespond: null, returnPath: null, contentType: "text/plain", authenticationResults: null, subject: "Re: alerta", ...o });
await check("8. Mensagens da própria caixa dedicada (self / sub-endereço) são ignoradas", () => {
  const ctx = { accMailboxes: [BOX], seenMessageIds: new Set() };
  assert(filterInboundMessage(baseHeaders({ from: BOX }), ctx) === "IGNORED_SELF");
  assert(filterInboundMessage(baseHeaders({ from: "axion+alerta-abc@axion.com.br" }), ctx) === "IGNORED_SELF");
  assert(filterInboundMessage(baseHeaders(), ctx) === "OK");
  const sent = extractInboundFromGmail({ id: "g1", threadId: "t1", labelIds: ["SENT"], payload: { headers: [{ name: "From", value: BOX }, { name: "To", value: "x@exemplo.com" }, { name: "Message-ID", value: "<s@axion.com.br>" }], mimeType: "text/plain", body: { data: "" } } }, BOX);
  assert(sent && sent.isSentByMailbox === true, "mensagem enviada pela caixa nunca vira resposta");
  assert(phase7.includes("if (!extracted || extracted.isSentByMailbox) return;"), "worker descarta mensagens do próprio ACC");
});
await check("9. Auto-reply e bounce continuam ignorados", () => {
  const ctx = { accMailboxes: [BOX], seenMessageIds: new Set() };
  assert(filterInboundMessage(baseHeaders({ autoSubmitted: "auto-replied" }), ctx) === "IGNORED_AUTO_REPLY");
  assert(filterInboundMessage(baseHeaders({ subject: "Resposta automática: ausente" }), ctx) === "IGNORED_AUTO_REPLY");
  assert(filterInboundMessage(baseHeaders({ from: "mailer-daemon@googlemail.com" }), ctx) === "IGNORED_BOUNCE");
  assert(filterInboundMessage(baseHeaders({ returnPath: "<>" }), ctx) === "IGNORED_BOUNCE");
  assert(filterInboundMessage(baseHeaders({ contentType: "multipart/report; report-type=delivery-status" }), ctx) === "IGNORED_BOUNCE");
});
await check("10. Message-ID duplicado é ignorado; worker deduplica por provider_message_id (knownIds)", () => {
  const ctx = { accMailboxes: [BOX], seenMessageIds: new Set(["<m1@exemplo.com>"]) };
  assert(filterInboundMessage(baseHeaders(), ctx) === "IGNORED_LOOP");
  assert(phase7.includes("if (!message.id || knownIds.has(message.id)) return;") && phase7.includes("knownIds.add(message.id);"));
});

// ------------------------------------------------------------------ 5. worker: exclusividade, sem segredos em log, demais fases intactas
await check("11. Fase 7 não referencia GOOGLE_GMAIL_INBOUND_* nem required(); só credenciais dedicadas", () => {
  assert(!codeOnly(phase7).includes("GOOGLE_GMAIL_INBOUND"), "fase 7 não usa as credenciais do Gmail Inbound Sync");
  assert(!phase7.includes("required("), "fase 7 não exige variáveis (ausência => pulada)");
  assert(phase7.includes("resolveRiskAlertInboundCredentials(process.env)"));
  assert(phase7.includes("new google.auth.OAuth2(inbound.credentials.clientId, inbound.credentials.clientSecret)") && phase7.includes("refresh_token: inbound.credentials.refreshToken"));
  assert(phase7.includes('status: inbound.status, missing: inbound.missing'), "resumo registra SKIPPED_NOT_CONFIGURED e os nomes ausentes");
});
await check("12. Nenhum token/client secret/Authorization em logs da fase 7; erro de getProfile não é reproduzido", () => {
  const logLines = phase7.split("\n").filter((line) => /console\.(log|error|warn|table)/.test(line));
  assert(logLines.length > 0);
  for (const line of logLines) assert(!/refreshToken|clientSecret|clientId|Authorization|credentials\./.test(line), `log suspeito: ${line.trim()}`);
  assert(/catch \{\s*\n\s*profileEmail = null;/.test(phase7), "falha do getProfile => tratada como divergência, sem imprimir o erro");
});
await check("13. Fase de intake (Gmail Inbound Sync) permanece com GOOGLE_GMAIL_INBOUND_* e inalterada em essência", () => {
  const intake = worker.slice(worker.indexOf("// FASE 1"), worker.indexOf("// FASE 2"));
  assert(intake.includes('required("GOOGLE_GMAIL_INBOUND_CLIENT_ID")') && intake.includes('required("GOOGLE_GMAIL_INBOUND_MAILBOX")'), "intake segue com as credenciais do Inbound Sync");
  assert(!intake.includes("ACC_RISK_ALERTS_INBOUND"), "as dedicadas não vazam para o intake");
  assert(worker.indexOf("let repliesBlocked = false;") > worker.indexOf("// FASE 6"), "flag declarada só na fase 7");
});

// ------------------------------------------------------------------ 6. workflow e helper OAuth
await check("14. Workflow: os 4 secrets dedicados só no job `ingest`; job `risk-alerts` e gmail-inbound-sync.yml intocados", () => {
  for (const name of Object.values(ENV)) {
    assert(ingestJob.includes(`${name}: \${{ secrets.${name} }}`), `${name} no job ingest`);
    assert(!riskAlertsJob.includes(name), `${name} não deve ir ao job risk-alerts`);
  }
  assert(ingestJob.includes("GOOGLE_GMAIL_INBOUND_MAILBOX: ${{ secrets.GOOGLE_GMAIL_INBOUND_MAILBOX }}"), "legadas preservadas para o intake");
  assert(!workflow.includes("vars.ACC_RISK_ALERTS_INBOUND"), "credenciais nunca como vars");
  const sync = readSource(".github/workflows/gmail-inbound-sync.yml");
  assert(!sync.includes("ACC_RISK_ALERTS_INBOUND"), "gmail-inbound-sync.yml não é tocado");
});
await check("15. Helper OAuth: --prefix=ACC_RISK_ALERTS_INBOUND (default GOOGLE_GMAIL_INBOUND), escopo gmail.readonly, grava <PREFIXO>_REFRESH_TOKEN", () => {
  assert(helper.includes('"--prefix=GOOGLE_GMAIL_INBOUND"'), "default legado preservado");
  assert(helper.includes("process.env[`${PREFIX}_CLIENT_ID`]") && helper.includes("process.env[`${PREFIX}_CLIENT_SECRET`]") && helper.includes("process.env[`${PREFIX}_MAILBOX`]"));
  assert(helper.includes("`${PREFIX}_REFRESH_TOKEN`"), "refresh token gravado sob o prefixo escolhido, sem sobrescrever o legado");
  assert(helper.includes("https://www.googleapis.com/auth/gmail.readonly") && !/gmail\.modify|mail\.google\.com|gmail\.send/.test(helper), "escopo mínimo de leitura");
  assert(/replace\(\/\[\^A-Z0-9_\]\/g, ""\)/.test(helper), "prefixo saneado");
  assert(creds.RISK_ALERTS_INBOUND_GMAIL_SCOPE === "https://www.googleapis.com/auth/gmail.readonly");
});
await check("16. Módulo de credenciais é puro; nenhum OAuth real, banco ou e-mail neste teste", () => {
  const src = codeOnly(readSource("apps/web/lib/risk-alerts/replies/inbound-credentials.ts"));
  assert(!/from "googleapis"|import\(|fetch\(|createSupabase|process\.env/.test(src), "sem I/O e sem leitura implícita do ambiente");
  assert(!process.env.ACC_RISK_ALERTS_INBOUND_REFRESH_TOKEN && !process.env.ACC_RISK_ALERTS_INBOUND_CLIENT_SECRET, "teste não depende de credenciais reais");
  assert(!process.env.ACC_WEEKLY_REPORTS_ENABLED && !process.env.ACC_OUTBOUND_MODE);
});

console.log("");
console.log(`Resultado: ${passed} OK, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
