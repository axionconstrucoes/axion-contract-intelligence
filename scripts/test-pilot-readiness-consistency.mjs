// Consistência de prontidão do piloto — cadeia única de escalonamento
// (RESPONSAVEL -> ESCALAO_1 -> DIRETORIA -> TOP_LEVEL_REACHED), boardAfter
// efetivo, ESCALAO_2 só como legado, rótulos, separação entre severidade
// de AUSÊNCIA (mapa do projeto) e severidade do MOTOR, e o alerta de
// ausência da planilha do relatório semanal (com resolução por evidência
// posterior). Funções REAIS (puras) com fixtures em memória; nenhuma
// chamada de rede, e-mail, workflow ou escrita remota.
//
// Uso:
//   node scripts/test-pilot-readiness-consistency.mjs

import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const { computeEscalation, SLA_ESCALATION_CHAIN } = await import("../apps/web/lib/sla/compute-escalation");
const { resolveEscalationDestination } = await import("../apps/web/lib/sla/resolve-escalation-destination");
const { slaEscalationLevelLabels, slaTopLevelReachedLabel } = await import("../apps/web/lib/labels");
const { applyAlertAction, applyScheduledTopLevel, nextHierarchyLevel, TOP_LEVEL_EVENT_DISCRIMINATOR } = await import("../apps/web/lib/risk-alerts/alert-state-machine");
const { planRiskAlerts } = await import("../apps/web/lib/risk-alerts/plan-risk-alerts");
const { resolveMatrixPolicy } = await import("../apps/web/lib/sla/resolve-matrix-policy");
const { ALERT_STATE_LABELS } = await import("../apps/web/lib/risk-alerts/types");
const readiness = await import("../apps/web/lib/risk-alerts/pilot-readiness");
const { collectIngestionAlertCases, collectSheetCases, resolveIngestionAlertSeverity, severitySourceOf } = await import("../apps/web/lib/risk-alerts/collect-risk-cases");
const { createWeeklyAbsenceAlert, createWeeklySCurveAbsenceAlert, createWeeklyWorkbookAbsenceAlert, resolveAbsenceAlertsWithEvidence } = await import("../apps/web/lib/schedule/weekly-ingestion/create-absence-alerts");

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const readSource = (relative) => readFileSync(path.join(repoRoot, relative), "utf8").replace(/\r\n?/g, "\n");

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

// ------------------------------------------------------------------ fixtures (ids sintéticos)
const PROJECT = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "cccccccc-0000-4000-8000-000000000001";
const U_L1 = "aaaaaaaa-0000-4000-8000-000000000001";
const U_L2 = "aaaaaaaa-0000-4000-8000-000000000002";
const U_L3 = "aaaaaaaa-0000-4000-8000-000000000003";
const U_LEGACY = "aaaaaaaa-0000-4000-8000-000000000007"; // escalation_2_user_id (legado)
const TZ = "America/Sao_Paulo";
const settings = { projectId: PROJECT, timezone: TZ, businessDayStartHour: 8, businessDayEndHour: 18, updatedAt: "" };
const responsibles = (o = {}) => [{ id: "r1", projectId: PROJECT, area: "PLANEJAMENTO", responsibleDirectUserId: U_L1, responsibleDirectInvitationId: null, responsibleDirectName: null, secondaryResponsibleUserId: null, secondaryResponsibleInvitationId: null, secondaryResponsibleName: null, escalation1UserId: U_L2, escalation1InvitationId: null, escalation1Name: null, escalation2UserId: U_LEGACY, escalation2Name: null, boardUserId: U_L3, boardInvitationId: null, boardName: null, updatedAt: "", ...o }];
const rule = (riskLevel, o = {}) => ({ id: `rule-${riskLevel}`, projectId: PROJECT, riskLevel, area: null, timeUnit: "CLOCK_HOURS", assumeDeadlineValue: 1, respondDeadlineValue: null, completeDeadlineValue: null, escalation2AfterValue: 1, boardAfterValue: 2, notifyByEmail: true, requiresAcknowledgmentConfirmation: true, requiresDelayJustification: true, isDefault: false, active: true, ...o });
const allRules = () => ["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((l) => rule(l));
const recipients = () => new Map([
  [U_L1, { userId: U_L1, name: "Nivel Um", email: "nivel.um@axion.com.br", membershipStatus: "ACTIVE" }],
  [U_L2, { userId: U_L2, name: "Nivel Dois", email: "nivel.dois@axion.com.br", membershipStatus: "ACTIVE" }],
  [U_L3, { userId: U_L3, name: "Nivel Tres", email: "nivel.tres@axion.com.br", membershipStatus: "ACTIVE" }],
  [U_LEGACY, { userId: U_LEGACY, name: "Legado", email: "legado@axion.com.br", membershipStatus: "ACTIVE" }],
]);
const config = (o = {}) => ({ enabled: true, riskAlertsEnabled: true, pilotRecipientAllowlistUserIds: [U_L1, U_L2, U_L3, U_LEGACY], senderDomain: "axion.com.br", severityMap: readiness.SUGGESTED_INGESTION_ALERT_SEVERITY, pilotProjectConfirmedAt: "2026-09-20T00:00:00.000Z", ...o });
const policyFor = (riskLevel, resp = responsibles()) => resolveMatrixPolicy({ rules: allRules(), responsibles: resp, settings, area: "PLANEJAMENTO", riskLevel });
const snapshot = (o = {}) => ({ id: CASE_ID, projectId: PROJECT, sourceType: "SCHEDULE_COMPARISON", sourceId: "cmp-1", riskLevel: "CRITICAL", state: "OPEN", currentLevel: "RESPONSAVEL", topLevelReachedAt: null, currentResponsibleUserId: U_L1, previousResponsibleUserId: null, slaActionId: "act-1", title: "t", reference: "r", activeForward: null, escalatedLevels: [], ...o });
const act = (action, payload, o = {}) => applyAlertAction({ now: o.now ?? "2026-09-22T15:00:00.000Z", snapshot: o.snapshot ?? snapshot(o.snap ?? {}), action, actorUserId: U_L1, origin: "WEB", payload, policy: policyFor("CRITICAL"), config: config(), recipients: recipients(), eligibleForwardUserIds: [U_L2, U_L3] });
const riskCase = (o = {}) => ({ sourceType: "SCHEDULE_COMPARISON", sourceId: "cmp-1", area: "PLANEJAMENTO", riskLevel: "CRITICAL", title: "t", summary: "s", impact: "", recommendation: null, fingerprint: "fp-1", originPath: "x", closed: false, reference: "W37", ...o });
const existingRecord = (o = {}) => ({ id: "case-1", sourceType: "SCHEDULE_COMPARISON", sourceId: "cmp-1", area: "PLANEJAMENTO", riskLevel: "CRITICAL", previousRiskLevel: null, fingerprint: "fp-1", status: "OPEN", slaActionId: "act-1", lastDigestWindow: null, firstSeenAt: "2026-09-21T12:00:00.000Z", lastChangedAt: "2026-09-21T12:00:00.000Z", closedAt: null, title: "t", summary: "s", impact: "", recommendation: null, originPath: "", reference: "", state: "OPEN", currentLevel: "RESPONSAVEL", currentResponsibleUserId: U_L1, previousResponsibleUserId: null, topLevelReachedAt: null, visibleCode: "ABCDEF12", ...o });
// criada 12:00Z, assumir até 13:00Z (CLOCK_HOURS 1h); escalation2After 1h => 14:00Z; boardAfter 2h => 16:00Z
const linkedAction = (o = {}) => ({ id: "act-1", status: "PENDING", currentEscalationLevel: "RESPONSAVEL", assumeDueAt: "2026-09-21T13:00:00.000Z", respondDueAt: null, completeDueAt: null, acknowledgedAt: null, completedAt: null, contractualDeadline: null, responsibleUserId: U_L1, ...o });
function plan(o = {}) {
  const resp = o.responsibles ?? responsibles();
  return planRiskAlerts({ now: o.now, projectId: PROJECT, projectName: "Piloto", featureEnabled: true, providerConfigured: true, dryRun: false, config: config(), timeZone: TZ, cases: o.cases ?? [riskCase()], existingCases: o.existingCases ?? [existingRecord()], linkedActions: o.linkedActions ?? new Map(), policyFor: (area, riskLevel) => resolveMatrixPolicy({ rules: allRules(), responsibles: resp, settings, area, riskLevel }), recipients: recipients(), existingIdempotencyKeys: o.existingIdempotencyKeys ?? new Set(), previousDigestSentAt: null });
}
const engineInput = (o = {}) => ({ status: "PENDING", currentEscalationLevel: "RESPONSAVEL", assumeDueAt: "2026-09-21T13:00:00.000Z", respondDueAt: null, completeDueAt: null, acknowledgedAt: null, completedAt: null, contractualDeadline: null, rule: { timeUnit: "CLOCK_HOURS", escalation2AfterValue: 1, boardAfterValue: 2 }, ...o });

console.log("");
console.log("PRONTIDÃO DO PILOTO — CADEIA, SEVERIDADE E AUSÊNCIAS");
console.log("=====================================================");
console.log("");

// ================================================================== CADEIA
await check("1. RESPONSAVEL → ESCALAO_1 ao vencer o prazo de assumir (motor por prazo e planejador)", () => {
  const r = computeEscalation(engineInput({ now: "2026-09-21T13:30:00.000Z" }));
  assert(r.shouldEscalate && r.recommendedLevel === "ESCALAO_1" && r.reason === "NO_ACKNOWLEDGMENT" && r.topLevelReached === false);
  const p = plan({ now: "2026-09-21T13:30:00.000Z", linkedActions: new Map([["act-1", linkedAction()]]) });
  assert(p.escalations.length === 1 && p.escalations[0].newLevel === "ESCALAO_1" && p.escalations[0].expectedCurrentLevel === "RESPONSAVEL");
  assert(p.outbox.find((e) => e.notificationType === "ESCALATION").recipient.userId === U_L2);
  assert(SLA_ESCALATION_CHAIN.join(">") === "RESPONSAVEL>ESCALAO_1>DIRETORIA");
});
await check("2. ESCALAO_1 → DIRETORIA após escalation2After (prazo do Nível 2) — nunca ESCALAO_2, mesmo com escalation_2_user_id preenchido", () => {
  const r = computeEscalation(engineInput({ currentEscalationLevel: "ESCALAO_1", now: "2026-09-21T14:30:00.000Z" }));
  assert(r.shouldEscalate && r.recommendedLevel === "DIRETORIA" && r.topLevelReached === false, JSON.stringify(r));
  const p = plan({ now: "2026-09-21T14:30:00.000Z", linkedActions: new Map([["act-1", linkedAction({ currentEscalationLevel: "ESCALAO_1", status: "ESCALATED" })]]) });
  assert(p.escalations.length === 1 && p.escalations[0].newLevel === "DIRETORIA");
  const esc = p.outbox.find((e) => e.notificationType === "ESCALATION");
  assert(esc.recipient.userId === U_L3 && esc.escalationLevel === "DIRETORIA", "destinatário = Diretoria, não o legado");
  assert(!p.outbox.some((e) => e.escalationLevel === "ESCALAO_2") && !p.escalations.some((e) => e.newLevel === "ESCALAO_2"));
});
await check("3. DIRETORIA → TOP_LEVEL_REACHED após boardAfter (prazo do Nível 3): registro único, sem destinatário, sem e-mail", () => {
  const before = computeEscalation(engineInput({ currentEscalationLevel: "DIRETORIA", now: "2026-09-21T15:30:00.000Z" })); // 14:00 + 2h = 16:00
  assert(before.shouldEscalate === false && before.topLevelReached === false, "antes do prazo da Diretoria nada acontece");
  const after = computeEscalation(engineInput({ currentEscalationLevel: "DIRETORIA", now: "2026-09-21T16:30:00.000Z" }));
  assert(after.shouldEscalate === false && after.recommendedLevel === "DIRETORIA" && after.topLevelReached === true);
  const p = plan({ now: "2026-09-21T16:30:00.000Z", existingCases: [existingRecord({ currentLevel: "DIRETORIA" })], linkedActions: new Map([["act-1", linkedAction({ currentEscalationLevel: "DIRETORIA", status: "ESCALATED" })]]) });
  assert(p.topLevelReached.length === 1 && p.topLevelReached[0].caseKey && p.escalations.length === 0, JSON.stringify(p.topLevelReached));
  assert(!p.outbox.some((e) => e.notificationType === "ESCALATION"), "nenhum e-mail adicional no limite");
  assert(p.audit.some((a) => a.action === "RISK_ALERT_TOP_LEVEL_REACHED"));
  const t = applyScheduledTopLevel({ now: "2026-09-21T16:30:00.000Z", snapshot: snapshot({ currentLevel: "DIRETORIA", state: "IN_PROGRESS" }), reasons: after.reasons });
  assert(t && t.events.length === 1 && t.events[0].actionType === "TOP_LEVEL_REACHED" && t.events[0].origin === "SYSTEM" && t.events[0].actorUserId === null);
  assert(t.outbox.length === 0 && t.caseUpdate.topLevelReached === true && t.caseUpdate.state === "IN_PROGRESS" && t.escalation === null);
  assert(t.events[0].idempotencyKey === `${CASE_ID}:TOP_LEVEL_REACHED:${TOP_LEVEL_EVENT_DISCRIMINATOR}`);
});
await check("4. ESCALAO_2 histórico → DIRETORIA (motor, destino, máquina de estados)", () => {
  const r = computeEscalation(engineInput({ currentEscalationLevel: "ESCALAO_2", now: "2026-09-21T14:30:00.000Z" }));
  assert(r.recommendedLevel === "DIRETORIA" && r.shouldEscalate === true);
  const notYet = computeEscalation(engineInput({ currentEscalationLevel: "ESCALAO_2", now: "2026-09-21T13:30:00.000Z" }));
  assert(notYet.shouldEscalate === false, "ESCALAO_2 conta como Nível 2: não volta para ESCALAO_1");
  assert(resolveEscalationDestination("ESCALAO_2", responsibles()[0]).level === "DIRETORIA" && resolveEscalationDestination("ESCALAO_2", responsibles()[0]).userId === U_L3);
  assert(nextHierarchyLevel("ESCALAO_2") === "DIRETORIA");
  const t = act("OTHER", { text: "x" }, { snap: { currentLevel: "ESCALAO_2" } });
  assert(t.ok && t.escalation.toLevel === "DIRETORIA" && t.escalation.fromLevel === "ESCALAO_2");
});
await check("5. Novos fluxos nunca produzem ESCALAO_2 (imediato, por prazo, destino, cadeia declarada)", () => {
  for (const level of ["RESPONSAVEL", "ESCALAO_1", "DIRETORIA"]) {
    const t = act("TAKING_ACTION", { text: "x" }, { snap: { currentLevel: level } });
    assert(t.ok && (t.escalation === null || t.escalation.toLevel !== "ESCALAO_2"), level);
    assert(!t.outbox.some((e) => e.escalationLevel === "ESCALAO_2"));
  }
  for (const now of ["2026-09-21T13:30:00.000Z", "2026-09-21T14:30:00.000Z", "2026-09-21T16:30:00.000Z", "2026-09-25T00:00:00.000Z"]) {
    for (const level of ["RESPONSAVEL", "ESCALAO_1", "ESCALAO_2", "DIRETORIA"]) {
      assert(computeEscalation(engineInput({ currentEscalationLevel: level, now })).recommendedLevel !== "ESCALAO_2", `${level}@${now}`);
    }
  }
  assert(resolveEscalationDestination("DIRETORIA", responsibles()[0]).level === "DIRETORIA" && !SLA_ESCALATION_CHAIN.includes("ESCALAO_2"));
  assert(readSource("apps/web/lib/sla/resolve-escalation-destination.ts").includes('if (recommendedLevel === "ESCALAO_2" || recommendedLevel === "DIRETORIA") {'));
});
await check("6. Automático e manual usam a mesma cadeia (mesmo motor + mesmo resolvedor; manual ignora escalation_2_user_id)", () => {
  const manual = readSource("apps/web/app/[projectId]/acoes/actions.ts");
  assert(manual.includes("resolveEscalationDestination(result.recommendedLevel, responsibles)") && manual.includes("computeEscalation({"));
  const planner = readSource("apps/web/lib/risk-alerts/plan-risk-alerts.ts");
  assert(planner.includes("resolveEscalationDestination(result.recommendedLevel, responsiblesLike(policy))") && planner.includes("computeEscalation({"));
  // Mesmos responsáveis reais (com legado preenchido) => mesmo destino que o planejador.
  const withLegacy = resolveEscalationDestination(computeEscalation(engineInput({ currentEscalationLevel: "ESCALAO_1", now: "2026-09-21T14:30:00.000Z" })).recommendedLevel, responsibles()[0]);
  const planned = plan({ now: "2026-09-21T14:30:00.000Z", linkedActions: new Map([["act-1", linkedAction({ currentEscalationLevel: "ESCALAO_1", status: "ESCALATED" })]]) }).escalations[0];
  assert(withLegacy.level === planned.newLevel && withLegacy.level === "DIRETORIA" && withLegacy.userId === U_L3);
  const sql = readSource("supabase/migrations/20260921090000_pilot_risk_alert_delivery.sql");
  assert(sql.includes("elsif p_new_level = 'ESCALAO_2' then"), "RPC continua aceitando o valor legado só para leitura/compatibilidade");
});
await check("7. TOP_LEVEL_REACHED não envia e-mail adicional (caminho imediato e por prazo)", () => {
  const t = act("OTHER", { text: "x" }, { snap: { currentLevel: "DIRETORIA" } });
  assert(t.ok && t.topLevelReached && !t.outbox.some((e) => e.notificationType === "ESCALATION") && t.events.some((e) => e.actionType === "TOP_LEVEL_REACHED"));
  const p = plan({ now: "2026-09-21T16:30:00.000Z", existingCases: [existingRecord({ currentLevel: "DIRETORIA" })], linkedActions: new Map([["act-1", linkedAction({ currentEscalationLevel: "DIRETORIA", status: "ESCALATED" })]]) });
  assert(p.outbox.filter((e) => e.notificationType !== "IMMEDIATE").length === 0);
  const cycle = readSource("apps/web/lib/risk-alerts/run-risk-alert-cycle.ts");
  assert(cycle.includes("applyScheduledTopLevel({ now: nowIso, snapshot: loaded.snapshot, reasons: item.reasons })") && cycle.includes("projectResult.topLevelReached += 1;"));
});
await check("8. Reexecução é idempotente: limite já registrado não repete; caso resolvido não registra; chave única compartilhada", () => {
  assert(applyScheduledTopLevel({ now: "2026-09-21T16:30:00.000Z", snapshot: snapshot({ currentLevel: "DIRETORIA", topLevelReachedAt: "2026-09-21T16:05:00.000Z" }), reasons: [] }) === null);
  assert(applyScheduledTopLevel({ now: "2026-09-21T16:30:00.000Z", snapshot: snapshot({ currentLevel: "DIRETORIA", state: "RESOLVED" }), reasons: [] }) === null);
  assert(applyScheduledTopLevel({ now: "2026-09-21T16:30:00.000Z", snapshot: snapshot({ currentLevel: "ESCALAO_1" }), reasons: [] }) === null, "só quando já está na Diretoria");
  const p = plan({ now: "2026-09-21T16:30:00.000Z", existingCases: [existingRecord({ currentLevel: "DIRETORIA", topLevelReachedAt: "2026-09-21T16:05:00.000Z" })], linkedActions: new Map([["act-1", linkedAction({ currentEscalationLevel: "DIRETORIA", status: "ESCALATED" })]]) });
  assert(p.topLevelReached.length === 0, "planejador não repete");
  const immediate = act("OTHER", { text: "x" }, { snap: { currentLevel: "DIRETORIA" } }).events.find((e) => e.actionType === "TOP_LEVEL_REACHED");
  const scheduled = applyScheduledTopLevel({ now: "2026-09-21T16:30:00.000Z", snapshot: snapshot({ currentLevel: "DIRETORIA" }), reasons: [] }).events[0];
  assert(immediate.idempotencyKey === scheduled.idempotencyKey, "mesma chave => o banco registra uma única vez");
  const alreadyDone = act("OTHER", { text: "x" }, { snap: { currentLevel: "DIRETORIA", topLevelReachedAt: "2026-09-21T16:05:00.000Z" } });
  assert(!alreadyDone.events.some((e) => e.actionType === "TOP_LEVEL_REACHED"));
});
await check("9. Rótulos não ambíguos", () => {
  assert(slaEscalationLevelLabels.ESCALAO_1 === "Nível 2 · Gerência" && slaEscalationLevelLabels.DIRETORIA === "Nível 3 · Diretoria");
  assert(slaEscalationLevelLabels.ESCALAO_2 === "Nível legado · Escalão 2" && slaEscalationLevelLabels.ESCALAO_2 !== slaEscalationLevelLabels.ESCALAO_1);
  assert(slaTopLevelReachedLabel === "Limite de escalonamento atingido" && ALERT_STATE_LABELS.TOP_LEVEL_REACHED === "Limite de escalonamento atingido");
  assert(new Set(Object.values(slaEscalationLevelLabels)).size === 4);
  assert(readSource("apps/web/lib/risk-alerts/alert-detail-data.ts").includes("slaTopLevelReachedLabel") && !readSource("apps/web/app/[projectId]/alertas/[caseId]/page.tsx").includes(">TOP_LEVEL_REACHED<"));
});

// ================================================================== SEVERIDADE
await check("10. Readiness exige mapa somente para os tipos de ausência produzidos (MPP, Curva S, planilha)", () => {
  assert(readiness.ABSENCE_ALERT_KINDS.join(",") === "MISSING_WEEKLY_SCHEDULE,MISSING_WEEKLY_REPORT_WORKBOOK,MISSING_S_CURVE");
  assert(readiness.ENGINE_CLASSIFIED_KINDS.join(",") === "S_CURVE_MPP_DIVERGENCE,BASELINE_SHEET_DIVERGENCE");
  assert(readiness.isSeverityMapComplete({ MISSING_WEEKLY_SCHEDULE: "HIGH", MISSING_WEEKLY_REPORT_WORKBOOK: "HIGH", MISSING_S_CURVE: "MEDIUM" }) === true);
  assert(readiness.isSeverityMapComplete({ MISSING_WEEKLY_SCHEDULE: "HIGH", MISSING_S_CURVE: "MEDIUM" }) === false, "planilha obrigatória (tem produtor)");
  assert(readiness.isSeverityMapComplete(null) === false && readiness.isSeverityMapComplete({}) === false);
  const problems = readiness.validateSeverityMap({ MISSING_WEEKLY_SCHEDULE: "HIGH", MISSING_WEEKLY_REPORT_WORKBOOK: "HIGH", MISSING_S_CURVE: "MEDIUM", S_CURVE_MPP_DIVERGENCE: "MEDIUM", OUTRO: "LOW" });
  assert(problems.some((p) => p.kind === "S_CURVE_MPP_DIVERGENCE" && p.problem === "ENGINE_CLASSIFIED_NOT_ALLOWED") && problems.some((p) => p.kind === "OUTRO" && p.problem === "UNKNOWN_KIND"));
  assert(readiness.isSeverityMapComplete(readiness.SUGGESTED_INGESTION_ALERT_SEVERITY) && Object.keys(readiness.SUGGESTED_INGESTION_ALERT_SEVERITY).length === 3);
  const produced = readSource("apps/web/lib/schedule/weekly-ingestion/create-absence-alerts.ts");
  for (const kind of readiness.ABSENCE_ALERT_KINDS) assert(produced.includes(`kind: "${kind}"`), `${kind} tem produtor`);
  for (const kind of readiness.ENGINE_CLASSIFIED_KINDS) assert(!produced.includes(`kind: "${kind}"`), `${kind} não é produzido como ausência`);
});
await check("11. Divergências usam a classificação do motor (mapa nunca consultado para abas/comparações)", () => {
  const sheet = collectSheetCases([{ id: "s1", project_id: PROJECT, category: "CURVA_S", risk_classification: "HIGH", risk_reasons: ["S_CURVE_MPP_DIVERGENCE_PP acima do limite"], alerts: [], work_week_label: "W37", email_id: null, created_at: "2026-09-18T10:00:00Z" }]);
  assert(sheet.length === 1 && sheet[0].riskLevel === "HIGH" && sheet[0].sourceType === "WEEKLY_REPORT_SHEET");
  const src = readSource("apps/web/lib/risk-alerts/collect-risk-cases.ts");
  const sheetFn = src.split("export function collectSheetCases")[1].split("export function")[0];
  const cmpFn = src.split("export function collectComparisonCases")[1].split("export function")[0];
  assert(!/severityMap|resolveIngestionAlertSeverity/.test(sheetFn) && !/severityMap|resolveIngestionAlertSeverity/.test(cmpFn), "motor não lê o mapa");
  assert(severitySourceOf("WEEKLY_REPORT_SHEET") === "ENGINE" && severitySourceOf("SCHEDULE_COMPARISON") === "ENGINE" && severitySourceOf("INGESTION_ALERT") === "PROJECT_SEVERITY_MAP");
});
await check("12. Mapa não rebaixa nem eleva a severidade do motor; tipos do motor num alerta de ausência => REVIEW_REQUIRED; sem mapa => REVIEW_REQUIRED", () => {
  const critical = collectSheetCases([{ id: "s2", project_id: PROJECT, category: "LINHA_BASE", risk_classification: "CRITICAL", risk_reasons: [], alerts: [], work_week_label: "W37", email_id: null, created_at: "2026-09-18T10:00:00Z" }]);
  assert(critical[0].riskLevel === "CRITICAL", "MEDIUM no mapa não rebaixa o CRÍTICO do motor");
  assert(resolveIngestionAlertSeverity({ S_CURVE_MPP_DIVERGENCE: "LOW" }, "S_CURVE_MPP_DIVERGENCE") === "REVIEW_REQUIRED");
  assert(resolveIngestionAlertSeverity({ BASELINE_SHEET_DIVERGENCE: "CRITICAL" }, "BASELINE_SHEET_DIVERGENCE") === "REVIEW_REQUIRED");
  assert(resolveIngestionAlertSeverity(null, "MISSING_WEEKLY_SCHEDULE") === "REVIEW_REQUIRED" && resolveIngestionAlertSeverity({ MISSING_WEEKLY_SCHEDULE: "HIGH" }, "MISSING_WEEKLY_SCHEDULE") === "HIGH");
  const cfg = readSource("scripts/configure-weekly-schedule-ingestion.mjs");
  assert(cfg.includes("tipo não admitido no mapa") && cfg.includes("--severity-map incompleto"));
});

// ================================================================== AUSÊNCIAS (store em memória; nada remoto)
const configRow = { id: "cfg-1", projectId: PROJECT, enabled: true, authorizedArea: "PLANEJAMENTO", authorizedTiers: ["FIRST_TIER", "SECOND_TIER"], senderDomain: "axion.com.br", clientRecipientDomains: [], clientRecipientAddresses: [], requireClientRecipient: false, cadence: "WEEKLY", deadlineWeekday: 5, deadlineTime: "18:00:00", timezone: TZ, monitoringStartAt: "2026-09-01T00:00:00.000Z", monitoringEndAt: null, targetDocumentId: null, attachmentNamePattern: null, alertRecipientUserIds: [U_L1], lastScannedSentAt: null };
function memoryStore(state) {
  const alerts = [];
  const audits = [];
  return {
    alerts,
    audits,
    async hasReceivedScheduleForWeek(_p, week) { return state.schedule.has(week); },
    async hasSCurveForWeek(_p, week) { return state.sCurve.has(week); },
    async hasWorkbookForWeek(_p, week) { return state.workbook.has(week); },
    async insertAlert(record) {
      if (alerts.some((a) => a.projectId === record.projectId && a.weekStart === record.weekStart && a.kind === record.kind)) return { created: false, id: null };
      const id = `alert-${alerts.length + 1}`;
      alerts.push({ id, resolvedAt: null, ...record });
      return { created: true, id };
    },
    async listOpenAbsenceAlerts(projectId) { return alerts.filter((a) => a.projectId === projectId && !a.resolvedAt).map((a) => ({ id: a.id, projectId: a.projectId, kind: a.kind, weekStart: a.weekStart })); },
    async resolveAbsenceAlert(id) { const a = alerts.find((x) => x.id === id && !x.resolvedAt); if (!a) return false; a.resolvedAt = "now"; return true; },
    async writeAudit(entry) { audits.push(entry); },
  };
}
const AFTER_DEADLINE = new Date("2026-09-18T22:00:00.000Z"); // sexta 18/09 19:00 SP (prazo sexta 18:00)
const BEFORE_DEADLINE = new Date("2026-09-18T15:00:00.000Z");
const WEEK = "2026-09-14";

await check("13. Ausência do MPP: alerta só após o prazo; recebido não alerta; mesma semana não duplica", async () => {
  const s = memoryStore({ schedule: new Set(), sCurve: new Set(), workbook: new Set() });
  assert((await createWeeklyAbsenceAlert(s, configRow, BEFORE_DEADLINE)).result === "NOT_DUE");
  const created = await createWeeklyAbsenceAlert(s, configRow, AFTER_DEADLINE);
  assert(created.result === "CREATED" && created.weekStart === WEEK && s.alerts[0].kind === "MISSING_WEEKLY_SCHEDULE");
  assert((await createWeeklyAbsenceAlert(s, configRow, AFTER_DEADLINE)).result === "ALREADY_ALERTED" && s.alerts.length === 1);
  const received = memoryStore({ schedule: new Set([WEEK]), sCurve: new Set(), workbook: new Set() });
  assert((await createWeeklyAbsenceAlert(received, configRow, AFTER_DEADLINE)).result === "RECEIVED" && received.alerts.length === 0);
});
await check("14. Ausência da Curva S: exige cronograma recebido; ausente => alerta; presente => RECEIVED", async () => {
  const noSchedule = memoryStore({ schedule: new Set(), sCurve: new Set(), workbook: new Set() });
  assert((await createWeeklySCurveAbsenceAlert(noSchedule, configRow, AFTER_DEADLINE)).result === "NO_SCHEDULE_YET");
  const s = memoryStore({ schedule: new Set([WEEK]), sCurve: new Set(), workbook: new Set() });
  assert((await createWeeklySCurveAbsenceAlert(s, configRow, AFTER_DEADLINE)).result === "CREATED" && s.alerts[0].kind === "MISSING_S_CURVE");
  const present = memoryStore({ schedule: new Set([WEEK]), sCurve: new Set([WEEK]), workbook: new Set() });
  assert((await createWeeklySCurveAbsenceAlert(present, configRow, AFTER_DEADLINE)).result === "RECEIVED");
});
await check("15. Ausência da planilha do relatório semanal: mesmas garantias; inválida ≠ ausente; nova semana => novo alerta; feature/config desligada não cria", async () => {
  const noSchedule = memoryStore({ schedule: new Set(), sCurve: new Set(), workbook: new Set() });
  assert((await createWeeklyWorkbookAbsenceAlert(noSchedule, configRow, AFTER_DEADLINE)).result === "NO_SCHEDULE_YET");
  const s = memoryStore({ schedule: new Set([WEEK]), sCurve: new Set(), workbook: new Set() });
  assert((await createWeeklyWorkbookAbsenceAlert(s, configRow, BEFORE_DEADLINE)).result === "NOT_DUE", "só após o prazo aplicável");
  const created = await createWeeklyWorkbookAbsenceAlert(s, configRow, AFTER_DEADLINE);
  assert(created.result === "CREATED" && s.alerts[0].kind === "MISSING_WEEKLY_REPORT_WORKBOOK" && s.alerts[0].weekStart === WEEK && s.alerts[0].detail.includes("planilha do relatório semanal"));
  assert((await createWeeklyWorkbookAbsenceAlert(s, configRow, AFTER_DEADLINE)).result === "ALREADY_ALERTED" && s.alerts.length === 1, "mesma semana não duplica");
  assert(s.audits.some((a) => a.action === "WEEKLY_REPORT_WORKBOOK_MISSING_ALERT_CREATED"));
  // Semana seguinte (25/09 sexta 19:00 SP), cronograma recebido, planilha ausente => novo alerta (fingerprint por semana).
  const nextWeek = new Date("2026-09-25T22:00:00.000Z");
  const s2 = memoryStore({ schedule: new Set([WEEK, "2026-09-21"]), sCurve: new Set(), workbook: new Set() });
  await createWeeklyWorkbookAbsenceAlert(s2, configRow, AFTER_DEADLINE);
  const second = await createWeeklyWorkbookAbsenceAlert(s2, configRow, nextWeek);
  assert(second.result === "CREATED" && second.weekStart === "2026-09-21" && s2.alerts.length === 2);
  // Planilha inválida/pendente de revisão conta como recebida (o store devolve true para qualquer status).
  const invalid = memoryStore({ schedule: new Set([WEEK]), sCurve: new Set(), workbook: new Set([WEEK]) });
  assert((await createWeeklyWorkbookAbsenceAlert(invalid, configRow, AFTER_DEADLINE)).result === "RECEIVED" && invalid.alerts.length === 0);
  const supa = readSource("apps/web/lib/schedule/weekly-ingestion/supabase-store.ts");
  const section = supa.split("async hasWorkbookForWeek(projectId, weekStart)")[1].split("async listOpenAbsenceAlerts")[0];
  assert(section.includes('from("weekly_report_workbooks").select("id", { count: "exact", head: true }).in("intake_id", ids)'));
  assert((section.match(/\.in\("status"/g) ?? []).length === 1, "só o filtro de intake recebido: planilha de qualquer status conta como recebida");
  assert((await createWeeklyWorkbookAbsenceAlert(s, { ...configRow, enabled: false }, AFTER_DEADLINE)).result === "DISABLED");
  assert((await createWeeklyWorkbookAbsenceAlert(s, { ...configRow, workbookAlertEnabled: false }, AFTER_DEADLINE)).result === "DISABLED");
  const legacyStore = { ...memoryStore({ schedule: new Set([WEEK]), sCurve: new Set(), workbook: new Set() }), hasWorkbookForWeek: undefined };
  assert((await createWeeklyWorkbookAbsenceAlert(legacyStore, configRow, AFTER_DEADLINE)).result === "STORE_UNSUPPORTED", "store sem evidência confiável => não inventa");
});
await check("16. Chegada posterior da evidência resolve o alerta (uma única vez) e o caso de risco correspondente fecha", async () => {
  const state = { schedule: new Set([WEEK]), sCurve: new Set(), workbook: new Set() };
  const s = memoryStore(state);
  await createWeeklyWorkbookAbsenceAlert(s, configRow, AFTER_DEADLINE);
  await createWeeklySCurveAbsenceAlert(s, configRow, AFTER_DEADLINE);
  assert(s.alerts.length === 2);
  const none = await resolveAbsenceAlertsWithEvidence(s, PROJECT);
  assert(none.examined === 2 && none.resolved === 0, "sem evidência nada é resolvido");
  state.workbook.add(WEEK);
  const first = await resolveAbsenceAlertsWithEvidence(s, PROJECT);
  assert(first.resolved === 1 && s.alerts.find((a) => a.kind === "MISSING_WEEKLY_REPORT_WORKBOOK").resolvedAt && !s.alerts.find((a) => a.kind === "MISSING_S_CURVE").resolvedAt);
  const again = await resolveAbsenceAlertsWithEvidence(s, PROJECT);
  assert(again.resolved === 0 && again.examined === 1, "idempotente");
  assert(s.audits.filter((a) => a.action === "WEEKLY_ABSENCE_ALERT_RESOLVED").length === 1);
  // Caso de risco: resolved_at => closed (fecha o caso no planejador).
  const cases = collectIngestionAlertCases([{ id: "a1", project_id: PROJECT, kind: "MISSING_WEEKLY_REPORT_WORKBOOK", week_start: WEEK, deadline_at: "2026-09-18T21:00:00Z", detail: "x", resolved_at: "2026-09-19T10:00:00Z", created_at: "2026-09-18T22:00:00Z" }], readiness.SUGGESTED_INGESTION_ALERT_SEVERITY);
  assert(cases[0].closed === true && cases[0].riskLevel === "HIGH");
  const worker = readSource("scripts/weekly-schedule-email-ingest.mjs");
  assert(worker.includes("createWeeklyWorkbookAbsenceAlert(alertStore, config, new Date())") && worker.includes("resolveAbsenceAlertsWithEvidence(alertStore, config.projectId)"));
  assert(worker.includes("if (phases.has(\"alerts\") && apply) {"), "só com --apply e dentro do gate da feature");
});
await check("17. Nenhuma chamada real, e-mail ou escrita remota neste teste", () => {
  assert(!process.env.CRON_SECRET && !process.env.GITHUB_ACTIONS && process.env.ACC_WEEKLY_REPORTS_ENABLED !== "true");
  const pure = ["apps/web/lib/sla/compute-escalation.ts", "apps/web/lib/sla/resolve-escalation-destination.ts", "apps/web/lib/risk-alerts/alert-state-machine.ts", "apps/web/lib/risk-alerts/plan-risk-alerts.ts", "apps/web/lib/schedule/weekly-ingestion/create-absence-alerts.ts", "apps/web/lib/risk-alerts/pilot-readiness.ts"];
  for (const f of pure) assert(!/fetch\(|createSupabase|process\.env/.test(readSource(f)), `${f} é puro`);
});

console.log("");
console.log(`Resultado: ${passed} OK, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
