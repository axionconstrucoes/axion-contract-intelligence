// Regras puras do SSMA PWA: mapeamento dos registros, resumo/atraso e URL de instalação (QR sem
// credenciais). Uso: node scripts/test-ssma-field-records-logic.mjs
import assert from "node:assert/strict";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);
const { mapFieldRecordRow, isActionOverdue, summarizeFieldRecords } = await import("../apps/web/lib/ssma/field-records/field-record-view.ts");
const { resolveSsmaInstallUrl, INSTALL_INSTRUCTIONS } = await import("../apps/web/lib/ssma/pwa-install.ts");
const { messageForServerError, extractServerErrorCode } = await import("../apps/web/lib/ssma/field-records/types.ts");

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); console.log(`OK   ${name}`); passed += 1; }
  catch (error) { console.log(`FAIL ${name}\n     ${error.message}`); failed += 1; }
}
const row = (over = {}) => ({
  id: "r1", kind: "OCORRENCIA", category: "EPI", description: "d", location: "l",
  occurred_at: "2026-10-27T10:00:00Z", client_created_at: "2026-10-27T10:05:00Z", received_at: "2026-10-27T18:00:00Z",
  risk_level: "ALTA", responsible_user_id: "u2", due_date: "2026-11-05", reported_by_user_id: "u1",
  ssma_corrective_actions: [{ id: "a1", status: "ABERTA", due_date: "2026-11-05", concluded_at: null, responsible_user_id: "u2" }],
  ssma_field_record_photos: [{ id: "p1", purpose: "REGISTRO" }, { id: "p2", purpose: "REGISTRO" }, { id: "p3", purpose: "EVIDENCIA_ACAO" }],
  ...over,
});
const names = new Map([["u1", "Ana"], ["u2", "Bruno"]]);

console.log("\n======================================\nSSMA PWA — regras puras\n======================================");
check("mapeia linha do banco (nomes, fotos de registro × evidência, ação)", () => {
  const v = mapFieldRecordRow(row(), names);
  assert.equal(v.reportedByName, "Ana");
  assert.equal(v.responsibleName, "Bruno");
  assert.equal(v.photoCount, 2);
  assert.equal(v.evidenceCount, 1);
  assert.equal(v.action?.status, "ABERTA");
  assert.equal(v.clientCreatedAt, "2026-10-27T10:05:00Z");
  assert.equal(v.receivedAt, "2026-10-27T18:00:00Z");
});
// O PostgREST devolve a relação embutida como OBJETO (e não array) quando a chave estrangeira é única
// (ssma_corrective_actions.record_id é unique). Defeito de produção: a ação nunca aparecia na lista nem no detalhe.
check("ação corretiva embutida como OBJETO (formato real do PostgREST) é reconhecida", () => {
  const action = { id: "a9", status: "EM_ANDAMENTO", due_date: "2026-11-05", concluded_at: null, responsible_user_id: "u2" };
  const v = mapFieldRecordRow(row({ ssma_corrective_actions: action }), names);
  assert.equal(v.action?.id, "a9");
  assert.equal(v.action?.status, "EM_ANDAMENTO");
  assert.equal(v.action?.dueDate, "2026-11-05");
  assert.equal(summarizeFieldRecords([v], "2026-10-27").openActions, 1);
});
check("ação corretiva ausente (null/undefined) continua sem ação", () => {
  assert.equal(mapFieldRecordRow(row({ ssma_corrective_actions: null }), names).action, null);
  assert.equal(mapFieldRecordRow(row({ ssma_corrective_actions: undefined }), names).action, null);
});
check("registro sem ação e usuário desconhecido", () => {
  const v = mapFieldRecordRow(row({ ssma_corrective_actions: [], responsible_user_id: null, reported_by_user_id: "zz" }), names);
  assert.equal(v.action, null);
  assert.equal(v.responsibleName, null);
  assert.equal(v.reportedByName, "Usuário");
});
check("atraso: só ação não concluída com prazo anterior a hoje", () => {
  const a = (status, dueDate) => ({ id: "a", status, dueDate, concludedAt: null });
  assert.equal(isActionOverdue(a("ABERTA", "2026-10-01"), "2026-10-27"), true);
  assert.equal(isActionOverdue(a("EM_ANDAMENTO", "2026-10-27"), "2026-10-27"), false);
  assert.equal(isActionOverdue(a("CONCLUIDA", "2026-10-01"), "2026-10-27"), false);
  assert.equal(isActionOverdue(null, "2026-10-27"), false);
});
check("resumo: abertas, atrasadas, críticas em aberto e por risco", () => {
  const list = [
    mapFieldRecordRow(row({ id: "a", risk_level: "CRITICA", due_date: "2026-10-01", ssma_corrective_actions: [{ id: "x", status: "ABERTA", due_date: "2026-10-01", concluded_at: null, responsible_user_id: "u2" }] }), names),
    mapFieldRecordRow(row({ id: "b", risk_level: "CRITICA", ssma_corrective_actions: [{ id: "y", status: "CONCLUIDA", due_date: "2026-11-01", concluded_at: "2026-10-20T00:00:00Z", responsible_user_id: "u2" }] }), names),
    mapFieldRecordRow(row({ id: "c", risk_level: "BAIXA", ssma_corrective_actions: [] }), names),
  ];
  const s = summarizeFieldRecords(list, "2026-10-27");
  assert.deepEqual([s.total, s.openActions, s.overdueActions, s.critical], [3, 1, 1, 1]);
  assert.deepEqual(s.byRisk, { CRITICA: 2, ALTA: 0, MEDIA: 0, BAIXA: 1 });
});
check("URL de instalação: configurada, derivada da base do app, ausente e inválida", () => {
  assert.deepEqual(resolveSsmaInstallUrl({ ACC_SSMA_PWA_URL: "https://acc.exemplo.invalid/ssma/" }), { ok: true, url: "https://acc.exemplo.invalid/ssma", source: "ACC_SSMA_PWA_URL" });
  assert.deepEqual(resolveSsmaInstallUrl({ AXION_APP_BASE_URL: "https://acc.exemplo.invalid/" }), { ok: true, url: "https://acc.exemplo.invalid/ssma", source: "AXION_APP_BASE_URL" });
  assert.equal(resolveSsmaInstallUrl({}).ok, false);
  assert.equal(resolveSsmaInstallUrl({}).reason, "NOT_CONFIGURED");
  assert.equal(resolveSsmaInstallUrl({ ACC_SSMA_PWA_URL: "ftp://x" }).reason, "INVALID");
  assert.equal(resolveSsmaInstallUrl({ ACC_SSMA_PWA_URL: "não é url" }).reason, "INVALID");
});
check("QR só leva a URL: recusa usuário/senha, query, fragmento e http fora de localhost", () => {
  for (const bad of ["https://u:p@acc.exemplo.invalid/ssma", "https://acc.exemplo.invalid/ssma?token=abc", "https://acc.exemplo.invalid/ssma#access_token=1", "http://acc.exemplo.invalid/ssma"]) {
    assert.equal(resolveSsmaInstallUrl({ ACC_SSMA_PWA_URL: bad }).ok, false, bad);
  }
  assert.equal(resolveSsmaInstallUrl({ ACC_SSMA_PWA_URL: "http://localhost:3000/ssma" }).ok, true);
});
check("instruções para iPhone (Safari) e Android (Chrome)", () => {
  assert.ok(INSTALL_INSTRUCTIONS.ios.some((s) => /Safari/.test(s)) && INSTALL_INSTRUCTIONS.ios.some((s) => /Tela de Início/.test(s)));
  assert.ok(INSTALL_INSTRUCTIONS.android.some((s) => /Chrome/.test(s)) && INSTALL_INSTRUCTIONS.android.some((s) => /Instalar app/.test(s)));
});
check("mensagens de erro do servidor: amigáveis, sem texto bruto do banco", () => {
  assert.equal(extractServerErrorCode("ERROR: USER_MISMATCH (P0001)"), "USER_MISMATCH");
  assert.equal(extractServerErrorCode("relation x does not exist"), null);
  assert.match(messageForServerError("EVIDENCE_REQUIRED"), /foto de evidência/);
  assert.equal(messageForServerError("DESCONHECIDO"), "Não foi possível enviar. Tente novamente.");
});

console.log(`\n${passed} OK, ${failed} falha(s)`);
process.exit(failed ? 1 : 0);
