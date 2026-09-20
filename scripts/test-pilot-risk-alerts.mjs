// Alertas de risco do piloto — 35 itens. Executa as funções REAIS
// (resolveMatrixPolicy, planRiskAlerts, janela do consolidado, coleta de
// casos, templates, FakeEmailProvider) com fixtures em memória e valida
// por leitura estática a migration, o cron, o painel e o script de
// configuração. Nenhum e-mail real, nenhum banco.
//
// Uso:
//   node scripts/test-pilot-risk-alerts.mjs

import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const { resolveMatrixPolicy, computePolicyDeadlines } = await import("../apps/web/lib/sla/resolve-matrix-policy");
const { DEFAULT_SLA_MATRIX } = await import("../apps/web/lib/sla/default-matrix");
const { planRiskAlerts, evaluateRecipient } = await import("../apps/web/lib/risk-alerts/plan-risk-alerts");
const { resolveDigestWindow, toLocalDateParts } = await import("../apps/web/lib/risk-alerts/digest-window");
const { collectComparisonCases, collectSheetCases, collectIngestionAlertCases, caseKeyOf } = await import("../apps/web/lib/risk-alerts/collect-risk-cases");
const { SUGGESTED_INGESTION_ALERT_SEVERITY } = await import("../apps/web/lib/risk-alerts/pilot-readiness");
const { buildImmediateRiskAlertEmail, buildRiskDigestEmail, buildProjectLink } = await import("../apps/web/lib/risk-alerts/build-risk-alert-emails");
const { FakeEmailProvider } = await import("../apps/web/lib/email/fake-email-provider");
const { addTimeUnits } = await import("../apps/web/lib/sla/time-units");

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const readSource = (relative) => readFileSync(path.join(repoRoot, relative), "utf8").replace(/\r\n?/g, "\n");
const MIGRATION = "supabase/migrations/20260921090000_pilot_risk_alert_delivery.sql";

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

// ------------------------------------------------------------------
// Fixtures (ids sintéticos — nenhuma pessoa real)
// ------------------------------------------------------------------
const PROJECT = "11111111-1111-4111-8111-111111111111";
const U_L1 = "aaaaaaaa-0000-4000-8000-000000000001"; // Nível 1 PLANEJAMENTO (fora da allowlist)
const U_PILOT_A = "aaaaaaaa-0000-4000-8000-000000000002"; // piloto A (Nível 2 PLANEJAMENTO)
const U_PILOT_B = "aaaaaaaa-0000-4000-8000-000000000003"; // piloto B (Nível 3 / Nível 1 FINANCEIRO)
const U_INACTIVE = "aaaaaaaa-0000-4000-8000-000000000004";
const U_NO_EMAIL = "aaaaaaaa-0000-4000-8000-000000000005";
const TZ = "America/Sao_Paulo";
const WEDNESDAY_0730_SP = "2026-09-23T10:30:00.000Z"; // quarta 07:30 em São Paulo
const TUESDAY_NOON_SP = "2026-09-22T15:00:00.000Z";
const WEDNESDAY_0630_SP = "2026-09-23T09:30:00.000Z";

const settings = { projectId: PROJECT, timezone: TZ, businessDayStartHour: 8, businessDayEndHour: 18, updatedAt: "" };
const responsibles = (overrides = {}) => [
  {
    id: "r1", projectId: PROJECT, area: "PLANEJAMENTO",
    responsibleDirectUserId: U_L1, responsibleDirectInvitationId: null, responsibleDirectName: null,
    secondaryResponsibleUserId: null, secondaryResponsibleInvitationId: null, secondaryResponsibleName: null,
    escalation1UserId: U_PILOT_A, escalation1InvitationId: null, escalation1Name: null,
    escalation2UserId: null, escalation2Name: null,
    boardUserId: U_PILOT_B, boardInvitationId: null, boardName: null, updatedAt: "",
    ...overrides,
  },
  {
    id: "r2", projectId: PROJECT, area: "FINANCEIRO",
    responsibleDirectUserId: U_PILOT_B, responsibleDirectInvitationId: null, responsibleDirectName: null,
    secondaryResponsibleUserId: null, secondaryResponsibleInvitationId: null, secondaryResponsibleName: null,
    escalation1UserId: U_PILOT_A, escalation1InvitationId: null, escalation1Name: null,
    escalation2UserId: null, escalation2Name: null,
    boardUserId: U_PILOT_B, boardInvitationId: null, boardName: null, updatedAt: "",
  },
];
const rule = (riskLevel, overrides = {}) => ({
  id: `rule-${riskLevel}`, projectId: PROJECT, riskLevel, area: null, timeUnit: "BUSINESS_HOURS",
  assumeDeadlineValue: 4, respondDeadlineValue: null, completeDeadlineValue: null, escalation2AfterValue: 4, boardAfterValue: 4,
  notifyByEmail: true, requiresAcknowledgmentConfirmation: true, requiresDelayJustification: true, isDefault: false, active: true,
  ...overrides,
});
const recipients = () =>
  new Map([
    [U_L1, { userId: U_L1, name: "Nivel Um", email: "nivel.um@axion.com.br", membershipStatus: "ACTIVE" }],
    [U_PILOT_A, { userId: U_PILOT_A, name: "Piloto A", email: "piloto.a@axion.com.br", membershipStatus: "ACTIVE" }],
    [U_PILOT_B, { userId: U_PILOT_B, name: "Piloto B", email: "piloto.b@axion.com.br", membershipStatus: "ACTIVE" }],
    [U_INACTIVE, { userId: U_INACTIVE, name: "Inativo", email: "inativo@axion.com.br", membershipStatus: "INACTIVE" }],
    [U_NO_EMAIL, { userId: U_NO_EMAIL, name: "Sem Email", email: null, membershipStatus: "ACTIVE" }],
  ]);
const config = (overrides = {}) => ({ enabled: true, riskAlertsEnabled: true, pilotRecipientAllowlistUserIds: [U_PILOT_A, U_PILOT_B], senderDomain: "axion.com.br", ...overrides });
const riskCase = (overrides = {}) => ({
  sourceType: "SCHEDULE_COMPARISON", sourceId: "cmp-1", area: "PLANEJAMENTO", riskLevel: "HIGH",
  title: "Cronograma semanal vs semana anterior (W37)", summary: "Data final deslocada 9 dias", impact: "Marcos deslocados: 2",
  recommendation: "Revisar caminho crítico", fingerprint: "fp-high-1", originPath: "documentos/emails/e1", closed: false, reference: "W37 · vs semana anterior",
  ...overrides,
});
function plan(overrides = {}) {
  const rules = overrides.rules ?? [rule("LOW", { timeUnit: "BUSINESS_DAYS", assumeDeadlineValue: 3, requiresAcknowledgmentConfirmation: false }), rule("MEDIUM", { timeUnit: "BUSINESS_DAYS", assumeDeadlineValue: 1 }), rule("HIGH"), rule("CRITICAL", { timeUnit: "CLOCK_HOURS", assumeDeadlineValue: 1, escalation2AfterValue: 1, boardAfterValue: 2 })];
  const resp = overrides.responsibles ?? responsibles();
  return planRiskAlerts({
    now: overrides.now ?? TUESDAY_NOON_SP,
    projectId: PROJECT,
    projectName: "Obra Piloto",
    featureEnabled: overrides.featureEnabled ?? true,
    providerConfigured: overrides.providerConfigured ?? true,
    dryRun: overrides.dryRun ?? false,
    config: "config" in overrides ? overrides.config : config(),
    timeZone: TZ,
    cases: overrides.cases ?? [riskCase()],
    existingCases: overrides.existingCases ?? [],
    linkedActions: overrides.linkedActions ?? new Map(),
    policyFor: (area, riskLevel) => resolveMatrixPolicy({ rules, responsibles: resp, settings, area, riskLevel }),
    recipients: overrides.recipients ?? recipients(),
    existingIdempotencyKeys: overrides.existingIdempotencyKeys ?? new Set(),
    previousDigestSentAt: overrides.previousDigestSentAt ?? null,
  });
}
const existingRecord = (overrides = {}) => ({
  id: "case-1", sourceType: "SCHEDULE_COMPARISON", sourceId: "cmp-1", area: "PLANEJAMENTO", riskLevel: "HIGH", previousRiskLevel: null,
  fingerprint: "fp-high-1", status: "OPEN", slaActionId: "act-1", lastDigestWindow: null, firstSeenAt: "2026-09-21T12:00:00.000Z",
  lastChangedAt: "2026-09-21T12:00:00.000Z", closedAt: null, title: "t", summary: "s", impact: "", recommendation: null, originPath: "", reference: "",
  ...overrides,
});
const linkedAction = (overrides = {}) => ({
  id: "act-1", status: "PENDING", currentEscalationLevel: "RESPONSAVEL", assumeDueAt: "2026-09-21T16:00:00.000Z", respondDueAt: null, completeDueAt: null,
  acknowledgedAt: null, completedAt: null, contractualDeadline: null, responsibleUserId: U_L1, ...overrides,
});

// ------------------------------------------------------------------
// 1–8. Matriz como fonte única, níveis, unidades
// ------------------------------------------------------------------
await check("1. Matriz é a fonte dos prazos (regra do projeto sobrepõe default; sem regra usa o DEFAULT institucional e marca usingDefaultRule)", () => {
  const custom = resolveMatrixPolicy({ rules: [rule("HIGH", { assumeDeadlineValue: 2, timeUnit: "CLOCK_HOURS" })], responsibles: responsibles(), settings, area: "PLANEJAMENTO", riskLevel: "HIGH" });
  assert(custom.assumeDeadlineValue === 2 && custom.timeUnit === "CLOCK_HOURS" && custom.usingDefaultRule === false);
  const dflt = resolveMatrixPolicy({ rules: [], responsibles: responsibles(), settings, area: "PLANEJAMENTO", riskLevel: "HIGH" });
  assert(dflt.assumeDeadlineValue === DEFAULT_SLA_MATRIX.HIGH.assumeDeadlineValue && dflt.usingDefaultRule === true);
  assert(dflt.requiresAcknowledgmentConfirmation === DEFAULT_SLA_MATRIX.HIGH.requiresAcknowledgmentConfirmation && dflt.requiresDelayJustification === DEFAULT_SLA_MATRIX.HIGH.requiresDelayJustification && dflt.notifyByEmail === DEFAULT_SLA_MATRIX.HIGH.notifyByEmail);
  const planner = readSource("apps/web/lib/risk-alerts/plan-risk-alerts.ts");
  assert(!/\b(assumeDeadlineValue|escalation2AfterValue|boardAfterValue)\s*[:=]\s*\d/.test(planner), "planejador não carrega prazo próprio");
  const migration = readSource(MIGRATION);
  assert(!/\b(assume|respond|complete)_deadline\w*|escalation_2_after|board_after|time_unit\b/.test(migration.replace(/--.*$/gm, "")), "migration não duplica as REGRAS de prazo da Matriz (instâncias *_due_at são prazos concretos, como em sla_actions)");
});
await check("2. Nível 1 correto (responsible_direct + corresponsável) — alerta imediato vai ao Nível 1", () => {
  const p = resolveMatrixPolicy({ rules: [], responsibles: responsibles({ secondaryResponsibleUserId: U_PILOT_A }), settings, area: "PLANEJAMENTO", riskLevel: "HIGH" });
  assert(p.level1UserId === U_L1 && p.level1SecondaryUserId === U_PILOT_A);
  const result = plan({ responsibles: responsibles({ secondaryResponsibleUserId: U_PILOT_A }) });
  const immediate = result.outbox.filter((e) => e.notificationType === "IMMEDIATE");
  assert(immediate.length === 2 && immediate.every((e) => e.escalationLevel === "RESPONSAVEL"));
  assert(new Set(immediate.map((e) => e.recipient.userId)).size === 2 && immediate.some((e) => e.recipient.userId === U_L1) && immediate.some((e) => e.recipient.userId === U_PILOT_A));
  assert(result.slaActionCreates.length === 1 && result.slaActionCreates[0].responsibleUserId === U_L1);
});
await check("3. Nível 2 correto (escalation_1_user_id) ao vencer o prazo de assumir", () => {
  const p = resolveMatrixPolicy({ rules: [], responsibles: responsibles(), settings, area: "PLANEJAMENTO", riskLevel: "HIGH" });
  assert(p.level2UserId === U_PILOT_A);
  const result = plan({ now: "2026-09-21T17:00:00.000Z", existingCases: [existingRecord()], linkedActions: new Map([["act-1", linkedAction()]]) });
  assert(result.escalations.length === 1 && result.escalations[0].newLevel === "ESCALAO_1" && result.escalations[0].reason === "NO_ACKNOWLEDGMENT");
  const esc = result.outbox.find((e) => e.notificationType === "ESCALATION");
  assert(esc && esc.recipient.userId === U_PILOT_A && esc.escalationLevel === "ESCALAO_1" && esc.recipient.status === "PENDING");
});
await check("4. Nível 3 correto (board_user_id) após o intervalo da Matriz; Nível 2 ausente ⇒ vai direto ao Nível 3", () => {
  const p = resolveMatrixPolicy({ rules: [], responsibles: responsibles(), settings, area: "PLANEJAMENTO", riskLevel: "HIGH" });
  assert(p.level3UserId === U_PILOT_B);
  // vencido 16:00 seg; +4h úteis => ter 10:00 (ESCALAO_2 legado => DIRETORIA); agora ter 11:00
  const late = plan({ now: "2026-09-22T14:00:00.000Z", existingCases: [existingRecord()], linkedActions: new Map([["act-1", linkedAction({ currentEscalationLevel: "ESCALAO_1", status: "ESCALATED" })]]) });
  assert(late.escalations.length === 1 && late.escalations[0].newLevel === "DIRETORIA", JSON.stringify(late.escalations));
  assert(late.outbox.find((e) => e.notificationType === "ESCALATION").recipient.userId === U_PILOT_B);
  const noLevel2 = plan({ now: "2026-09-21T17:00:00.000Z", responsibles: responsibles({ escalation1UserId: null }), existingCases: [existingRecord()], linkedActions: new Map([["act-1", linkedAction()]]) });
  assert(noLevel2.escalations[0].newLevel === "DIRETORIA" && noLevel2.outbox.find((e) => e.notificationType === "ESCALATION").recipient.userId === U_PILOT_B);
});
await check("5. Horas úteis: prazo respeita expediente 08–18 e timezone do projeto", () => {
  const p = resolveMatrixPolicy({ rules: [rule("HIGH", { timeUnit: "BUSINESS_HOURS", assumeDeadlineValue: 4 })], responsibles: responsibles(), settings, area: "PLANEJAMENTO", riskLevel: "HIGH" });
  // seg 21/09 16:00 SP (19:00Z) + 4h úteis => ter 22/09 10:00 SP (13:00Z)
  const d = computePolicyDeadlines(p, "2026-09-21T19:00:00.000Z");
  assert(d.assumeDueAt === "2026-09-22T13:00:00.000Z", d.assumeDueAt);
  assert(d.assumeDueAt === addTimeUnits(new Date("2026-09-21T19:00:00.000Z"), 4, "BUSINESS_HOURS", p.businessHours).toISOString());
});
await check("6. Horas corridas: independente de expediente/fim de semana", () => {
  const p = resolveMatrixPolicy({ rules: [rule("CRITICAL", { timeUnit: "CLOCK_HOURS", assumeDeadlineValue: 1 })], responsibles: responsibles(), settings, area: "PLANEJAMENTO", riskLevel: "CRITICAL" });
  const d = computePolicyDeadlines(p, "2026-09-19T23:30:00.000Z"); // sábado
  assert(d.assumeDueAt === "2026-09-20T00:30:00.000Z", d.assumeDueAt);
});
await check("7. Dias úteis: pula fim de semana", () => {
  const p = resolveMatrixPolicy({ rules: [rule("LOW", { timeUnit: "BUSINESS_DAYS", assumeDeadlineValue: 1 })], responsibles: responsibles(), settings, area: "PLANEJAMENTO", riskLevel: "LOW" });
  const d = computePolicyDeadlines(p, "2026-09-25T13:00:00.000Z"); // sexta 10:00 SP
  assert(toLocalDateParts(d.assumeDueAt, TZ).weekday === 1, `esperava segunda-feira: ${d.assumeDueAt}`);
});
await check("8. Dias corridos: conta fim de semana", () => {
  const p = resolveMatrixPolicy({ rules: [rule("LOW", { timeUnit: "CALENDAR_DAYS", assumeDeadlineValue: 2 })], responsibles: responsibles(), settings, area: "PLANEJAMENTO", riskLevel: "LOW" });
  const d = computePolicyDeadlines(p, "2026-09-25T13:00:00.000Z");
  assert(d.assumeDueAt === "2026-09-27T13:00:00.000Z", d.assumeDueAt);
});

// ------------------------------------------------------------------
// 9–14. Política Low/Medium (digest) × High/Critical (imediato)
// ------------------------------------------------------------------
await check("9. Low não envia imediatamente", () => {
  const result = plan({ cases: [riskCase({ riskLevel: "LOW", fingerprint: "fp-low" })] });
  assert(result.outbox.every((e) => e.notificationType !== "IMMEDIATE") && result.slaActionCreates.length === 0);
  assert(result.outbox.length === 0, "fora da janela não há nada");
});
await check("10. Medium não envia imediatamente", () => {
  const result = plan({ cases: [riskCase({ riskLevel: "MEDIUM", fingerprint: "fp-med" })] });
  assert(result.outbox.every((e) => e.notificationType !== "IMMEDIATE") && result.slaActionCreates.length === 0 && result.outbox.length === 0);
});
await check("11. Low/Medium entram no consolidado (seções separadas, ordenados por criticidade e prazo, com prazos e responsáveis)", () => {
  const result = plan({
    now: WEDNESDAY_0730_SP,
    responsibles: responsibles({ responsibleDirectUserId: U_PILOT_A }),
    cases: [riskCase({ riskLevel: "LOW", sourceId: "c-low", fingerprint: "fp-low", title: "Baixo A" }), riskCase({ riskLevel: "MEDIUM", sourceId: "c-med", fingerprint: "fp-med", title: "Médio B" })],
  });
  const digest = result.outbox.filter((e) => e.notificationType === "DIGEST");
  assert(digest.length === 1 && digest[0].recipient.userId === U_PILOT_A && digest[0].recipient.status === "PENDING");
  const content = digest[0].content;
  assert(content.mediumItems.length === 1 && content.lowItems.length === 1 && content.mediumItems[0].title === "Médio B");
  assert(content.mediumItems[0].deadlineAt && content.mediumItems[0].responsibleName === "Piloto A");
  assert(digest[0].payloadSummary.medium === 1 && digest[0].payloadSummary.low === 1);
});
await check("12. Consolidado só na quarta-feira ≥ 07:00 America/Sao_Paulo (UTC do cron não fixa o horário local); chave = data local da quarta", () => {
  assert(resolveDigestWindow(WEDNESDAY_0730_SP, TZ).isOpen === true && resolveDigestWindow(WEDNESDAY_0730_SP, TZ).key === "2026-09-23");
  assert(resolveDigestWindow(WEDNESDAY_0630_SP, TZ).isOpen === false, "06:30 local ainda fechado");
  assert(resolveDigestWindow(TUESDAY_NOON_SP, TZ).isOpen === false && resolveDigestWindow(TUESDAY_NOON_SP, TZ).key === "2026-09-23");
  assert(resolveDigestWindow("2026-09-23T07:00:00.000Z", "UTC").isOpen === true && resolveDigestWindow("2026-09-23T06:59:00.000Z", "UTC").isOpen === false, "outro timezone respeitado");
  // Horário de verão: timezone com DST muda o instante UTC da janela.
  assert(resolveDigestWindow("2026-07-01T10:30:00.000Z", "America/New_York").isOpen === false && resolveDigestWindow("2026-07-01T11:30:00.000Z", "America/New_York").isOpen === true);
  const early = plan({ now: WEDNESDAY_0630_SP, responsibles: responsibles({ responsibleDirectUserId: U_PILOT_A }), cases: [riskCase({ riskLevel: "MEDIUM", fingerprint: "fp-med" })] });
  assert(early.outbox.length === 0 && early.digestWindow.isOpen === false);
  const vercel = JSON.parse(readSource("apps/web/vercel.json"));
  assert(!vercel.crons.some((c) => c.path === "/api/cron/risk-alerts"), "sem cron Vercel (limite do plano) — gatilho pelo workflow GitHub");
  const workflow = readSource(".github/workflows/weekly-schedule-email-ingestion.yml");
  assert(/cron: "\d+ \* \* \* \*"/.test(workflow) && workflow.includes("/api/cron/risk-alerts"), "gatilho horário (a janela local é decidida pelo ciclo)");
});
await check("13. High envia imediatamente (cria ação SLA com prazos da Matriz)", () => {
  const result = plan();
  const immediate = result.outbox.filter((e) => e.notificationType === "IMMEDIATE");
  assert(immediate.length === 1 && immediate[0].riskLevel === "HIGH" && immediate[0].scheduledFor === TUESDAY_NOON_SP);
  assert(result.slaActionCreates.length === 1 && result.slaActionCreates[0].riskLevel === "HIGH" && result.slaActionCreates[0].area === "PLANEJAMENTO");
  assert(result.slaActionCreates[0].assumeDueAt === computePolicyDeadlines(resolveMatrixPolicy({ rules: [rule("HIGH")], responsibles: responsibles(), settings, area: "PLANEJAMENTO", riskLevel: "HIGH" }), TUESDAY_NOON_SP).assumeDueAt);
});
await check("14. Critical envia imediatamente (também ao SUBIR de Médio para Crítico)", () => {
  const result = plan({ cases: [riskCase({ riskLevel: "CRITICAL", fingerprint: "fp-crit" })] });
  assert(result.outbox.filter((e) => e.notificationType === "IMMEDIATE" && e.riskLevel === "CRITICAL").length === 1);
  const raised = plan({ cases: [riskCase({ riskLevel: "CRITICAL", fingerprint: "fp-crit-2" })], existingCases: [existingRecord({ riskLevel: "MEDIUM", fingerprint: "fp-med", slaActionId: null })] });
  assert(raised.caseUpserts[0].change === "RAISED" && raised.outbox.filter((e) => e.notificationType === "IMMEDIATE").length === 1 && raised.slaActionCreates.length === 1);
});

// ------------------------------------------------------------------
// 15–17. Escalonamento, confirmação e justificativa pela Matriz
// ------------------------------------------------------------------
await check("15. Escalonamento respeita a Matriz (antes do prazo nada; depois sobe; ação assumida/concluída interrompe)", () => {
  const before = plan({ now: "2026-09-21T15:00:00.000Z", existingCases: [existingRecord()], linkedActions: new Map([["act-1", linkedAction()]]) });
  assert(before.escalations.length === 0 && before.outbox.length === 0);
  const after = plan({ now: "2026-09-21T17:00:00.000Z", existingCases: [existingRecord()], linkedActions: new Map([["act-1", linkedAction()]]) });
  assert(after.escalations.length === 1 && after.audit.some((a) => a.action === "RISK_ALERT_DEADLINE_EXPIRED"));
  const acknowledged = plan({ now: "2026-09-21T17:00:00.000Z", existingCases: [existingRecord()], linkedActions: new Map([["act-1", linkedAction({ acknowledgedAt: "2026-09-21T15:30:00.000Z", status: "ACKNOWLEDGED" })]]) });
  assert(acknowledged.escalations.length === 0, "assumida dentro do prazo (sem responder/concluir na regra) não escala");
  const completed = plan({ now: "2026-09-25T17:00:00.000Z", existingCases: [existingRecord()], linkedActions: new Map([["act-1", linkedAction({ status: "COMPLETED", completedAt: "2026-09-21T15:00:00.000Z", acknowledgedAt: "2026-09-21T14:00:00.000Z" })]]) });
  assert(completed.escalations.length === 0 && completed.outbox.length === 0);
  const sql = readSource(MIGRATION);
  assert(sql.includes("create or replace function public.escalate_sla_action_system") && sql.includes("grant execute on function public.escalate_sla_action_system(uuid, text, text, text) to service_role") && sql.includes("revoke all on function public.escalate_sla_action_system(uuid, text, text, text) from authenticated"));
  assert(sql.includes("perform set_config('acc.allow_escalation_update', 'true', true);") && sql.includes("insert into public.sla_action_escalations"));
});
await check("16. Confirmação obrigatória vem da Matriz e aparece no e-mail/outbox", () => {
  const result = plan();
  const entry = result.outbox.find((e) => e.notificationType === "IMMEDIATE");
  assert(entry.content.requiresAcknowledgment === true && entry.matrixRuleSnapshot.requiresAcknowledgmentConfirmation === true);
  const email = buildImmediateRiskAlertEmail({ content: entry.content, projectId: PROJECT, projectName: "Obra Piloto", recipientName: "Piloto", baseUrl: "https://acc.example", timeZone: TZ, generatedAt: TUESDAY_NOON_SP, actionButtons: [] });
  assert(email.text.includes("confirmação de ciência obrigatória") && email.html.includes("confirmação de ciência obrigatória"));
  const off = plan({ rules: [rule("HIGH", { requiresAcknowledgmentConfirmation: false })] });
  assert(off.outbox.find((e) => e.notificationType === "IMMEDIATE").content.requiresAcknowledgment === false);
});
await check("17. Justificativa obrigatória vem da Matriz e aparece no e-mail/outbox", () => {
  const result = plan();
  const entry = result.outbox.find((e) => e.notificationType === "IMMEDIATE");
  assert(entry.content.requiresJustification === true && entry.matrixRuleSnapshot.requiresDelayJustification === true);
  const email = buildImmediateRiskAlertEmail({ content: entry.content, projectId: PROJECT, projectName: "Obra Piloto", recipientName: null, baseUrl: "https://acc.example", timeZone: TZ, generatedAt: TUESDAY_NOON_SP, actionButtons: [] });
  assert(email.text.includes("justificativa obrigatória em caso de atraso"));
  const off = plan({ rules: [rule("HIGH", { requiresDelayJustification: false })] });
  assert(off.outbox.find((e) => e.notificationType === "IMMEDIATE").content.requiresJustification === false);
});

// ------------------------------------------------------------------
// 18–22. Restrição do piloto e validade do destinatário
// ------------------------------------------------------------------
await check("18. Somente os user_ids da allowlist do piloto ficam PENDING (allowlist por user_id, nunca por texto de e-mail)", () => {
  const result = plan({ now: "2026-09-21T17:00:00.000Z", existingCases: [existingRecord()], linkedActions: new Map([["act-1", linkedAction()]]) });
  const esc = result.outbox.find((e) => e.notificationType === "ESCALATION");
  assert(esc.recipient.userId === U_PILOT_A && esc.recipient.status === "PENDING");
  assert(evaluateRecipient(U_PILOT_B, config(), recipients()).status === "PENDING");
  const planner = readSource("apps/web/lib/risk-alerts/plan-risk-alerts.ts");
  assert(planner.includes("allowlist.includes(userId)") && !/allowlist\.includes\([^)]*email/i.test(planner));
  assert(/pilotRecipientAllowlistUserIds/.test(planner));
  const script = readSource("scripts/configure-weekly-schedule-ingestion.mjs");
  assert(script.includes("--pilot-recipients aceita somente user_ids (uuid), nunca e-mails"));
});
await check("19. Terceiro destinatário (Nível 1 fora da allowlist) é suprimido como PILOT_RECIPIENT_SUPPRESSED e auditado — nunca enviado", () => {
  const result = plan();
  const entry = result.outbox.find((e) => e.notificationType === "IMMEDIATE");
  assert(entry.recipient.userId === U_L1 && entry.recipient.status === "SUPPRESSED" && entry.recipient.suppressionReason === "PILOT_RECIPIENT_SUPPRESSED");
  assert(result.audit.some((a) => a.action === "RISK_ALERT_RECIPIENT_SUPPRESSED" && a.detail.includes(U_L1)));
  const sql = readSource(MIGRATION);
  assert(sql.includes("'PILOT_RECIPIENT_SUPPRESSED'") && sql.includes("check (status <> 'SUPPRESSED' or suppression_reason is not null)"));
  const missing = plan({ config: config({ pilotRecipientAllowlistUserIds: null }) });
  assert(missing.outbox.every((e) => e.recipient.status === "SUPPRESSED" && e.recipient.suppressionReason === "PILOT_ALLOWLIST_MISSING"), "allowlist ausente => nenhum envio");
});
await check("20. Usuário inativo não recebe (USER_NOT_ACTIVE)", () => {
  const r = evaluateRecipient(U_INACTIVE, config({ pilotRecipientAllowlistUserIds: [U_INACTIVE] }), recipients());
  assert(r.status === "SUPPRESSED" && r.suppressionReason === "USER_NOT_ACTIVE");
  const unknown = evaluateRecipient("aaaaaaaa-0000-4000-8000-0000000000ff", config({ pilotRecipientAllowlistUserIds: ["aaaaaaaa-0000-4000-8000-0000000000ff"] }), recipients());
  assert(unknown.suppressionReason === "USER_NOT_ACTIVE", "sem membership no projeto");
});
await check("21. E-mail ausente ou fora do domínio corporativo não recebe", () => {
  const r = evaluateRecipient(U_NO_EMAIL, config({ pilotRecipientAllowlistUserIds: [U_NO_EMAIL] }), recipients());
  assert(r.status === "SUPPRESSED" && r.suppressionReason === "EMAIL_MISSING");
  const personal = new Map(recipients());
  personal.set(U_PILOT_A, { ...personal.get(U_PILOT_A), email: "piloto.a@gmail.com" });
  assert(evaluateRecipient(U_PILOT_A, config(), personal).suppressionReason === "EMAIL_NOT_CORPORATE");
});
await check("22. Matriz ambígua/insuficiente não envia (CONFIGURATION_REVIEW_REQUIRED, auditado)", () => {
  const ambiguous = resolveMatrixPolicy({ rules: [], responsibles: responsibles({ escalation2UserId: U_NO_EMAIL }), settings, area: "PLANEJAMENTO", riskLevel: "HIGH" });
  assert(ambiguous.status === "CONFIGURATION_REVIEW_REQUIRED" && ambiguous.missing.includes("LEGACY_LEVEL_2_AMBIGUOUS"));
  const noArea = resolveMatrixPolicy({ rules: [], responsibles: [], settings, area: "PLANEJAMENTO", riskLevel: "HIGH" });
  assert(noArea.status === "CONFIGURATION_REVIEW_REQUIRED" && noArea.missing.includes("AREA_RESPONSIBLES_NOT_CONFIGURED"));
  const result = plan({ responsibles: [] });
  assert(result.outbox.length === 0 && result.slaActionCreates.length === 0);
  assert(result.audit.some((a) => a.action === "RISK_ALERT_CONFIGURATION_REVIEW_REQUIRED"));
  assert(result.caseUpserts[0].policy.status === "CONFIGURATION_REVIEW_REQUIRED", "caso registrado para revisão, sem envio");
});

// ------------------------------------------------------------------
// 23–26. Outbox, idempotência, retry, alteração/encerramento
// ------------------------------------------------------------------
await check("23. Outbox idempotente: mesma chave nunca é replanejada; constraint UNIQUE na migration", () => {
  const first = plan();
  const key = first.outbox[0].idempotencyKey;
  assert(key === `SCHEDULE_COMPARISON:cmp-1:IMMEDIATE:fp-high-1:${U_L1}`);
  const again = plan({ existingIdempotencyKeys: new Set([key]) });
  assert(again.outbox.length === 0);
  const sql = readSource(MIGRATION);
  assert(sql.includes("idempotency_key text not null unique"));
  const store = readSource("apps/web/lib/risk-alerts/supabase-store.ts");
  assert(store.includes('onConflict: "idempotency_key", ignoreDuplicates: true'));
});
await check("24. Retry não duplica: PENDING com falha transitória é retentado pela MESMA chave, com limite de tentativas", () => {
  const store = readSource("apps/web/lib/risk-alerts/supabase-store.ts");
  assert(store.includes('.neq("status", "PENDING")'), "chaves PENDING não bloqueiam o replanejamento (retry)");
  assert(store.includes("attempts >= MAX_SEND_ATTEMPTS ? \"FAILED\" : \"PENDING\"") && store.includes(".lt(\"attempt_count\", MAX_SEND_ATTEMPTS)"));
  const types = readSource("apps/web/lib/risk-alerts/types.ts");
  assert(/MAX_SEND_ATTEMPTS = 3/.test(types));
  const sql = readSource(MIGRATION);
  assert(sql.includes("attempt_count integer not null default 0"));
});
await check("25. Risco alterado (fingerprint) gera novo alerta válido com nova chave; risco inalterado não gera nada", () => {
  const changed = plan({ cases: [riskCase({ fingerprint: "fp-high-2", summary: "Data final deslocada 15 dias" })], existingCases: [existingRecord()], linkedActions: new Map([["act-1", linkedAction({ acknowledgedAt: "2026-09-21T15:00:00.000Z", status: "ACKNOWLEDGED" })]]) });
  assert(changed.caseUpserts[0].change === "CHANGED");
  const entry = changed.outbox.find((e) => e.notificationType === "IMMEDIATE");
  assert(entry && entry.idempotencyKey.includes(":fp-high-2:") && entry.content.changed === true && entry.slaActionId === "act-1");
  assert(changed.slaActionCreates.length === 0, "reutiliza a ação SLA vinculada");
  const same = plan({ existingCases: [existingRecord()], linkedActions: new Map([["act-1", linkedAction({ acknowledgedAt: "2026-09-21T15:00:00.000Z", status: "ACKNOWLEDGED" })]]) });
  assert(same.caseUpserts[0].change === "UNCHANGED" && same.outbox.length === 0);
});
await check("26. Risco encerrado não reaparece sem mudança (uma vez como encerrado no consolidado; depois nunca mais)", () => {
  const closing = plan({
    now: WEDNESDAY_0730_SP,
    responsibles: responsibles({ responsibleDirectUserId: U_PILOT_A }),
    cases: [riskCase({ riskLevel: "MEDIUM", fingerprint: "fp-med", closed: true })],
    existingCases: [existingRecord({ riskLevel: "MEDIUM", fingerprint: "fp-med", slaActionId: null })],
  });
  assert(closing.caseUpserts[0].change === "CLOSED");
  const digest = closing.outbox.find((e) => e.notificationType === "DIGEST");
  assert(digest && digest.content.closedItems.length === 1 && digest.content.mediumItems.length === 0);
  const nextWeek = plan({
    now: "2026-09-30T10:30:00.000Z",
    responsibles: responsibles({ responsibleDirectUserId: U_PILOT_A }),
    cases: [riskCase({ riskLevel: "MEDIUM", fingerprint: "fp-med", closed: true })],
    existingCases: [existingRecord({ riskLevel: "MEDIUM", fingerprint: "fp-med", slaActionId: null, status: "CLOSED", closedAt: "2026-09-23T09:00:00.000Z" })],
    previousDigestSentAt: "2026-09-23T10:31:00.000Z",
  });
  assert(nextWeek.outbox.length === 0, "encerrado já reportado não volta");
  const neverSeen = plan({ cases: [riskCase({ riskLevel: "HIGH", closed: true, sourceId: "old" })] });
  assert(neverSeen.caseUpserts.length === 0 && neverSeen.outbox.length === 0, "fonte já superada nunca vira alerta");
});

// ------------------------------------------------------------------
// 27–31. Gates globais, provider fake, To/Cc/Bcc, timezone
// ------------------------------------------------------------------
await check("27. Feature desligada não envia (planejador bloqueia; cron responde 204 sem consultar; ciclo retorna antes do banco)", () => {
  const result = plan({ featureEnabled: false });
  assert(result.blockedReason === "FEATURE_DISABLED" && result.outbox.length === 0 && result.caseUpserts.length === 0);
  const route = readSource("apps/web/app/api/cron/risk-alerts/route.ts");
  assert(route.includes("if (!isWeeklyReportsEnabled())") && route.includes("status: 204") && route.includes("isCronRequestAuthorized(request, process.env[RISK_ALERTS_CRON_SECRET_ENV])"));
  const cycle = readSource("apps/web/lib/risk-alerts/run-risk-alert-cycle.ts");
  assert(/if \(!featureEnabled\) return result;/.test(cycle) && cycle.indexOf("if (!featureEnabled) return result;") < cycle.indexOf("createSupabaseRiskAlertStore("));
});
await check("28. Projeto desabilitado não envia (config ausente, enabled=false ou risk_alerts_enabled=false)", () => {
  assert(plan({ config: null }).blockedReason === "PROJECT_DISABLED");
  assert(plan({ config: config({ enabled: false }) }).blockedReason === "PROJECT_DISABLED");
  assert(plan({ config: config({ riskAlertsEnabled: false }) }).blockedReason === "PROJECT_DISABLED");
  const sql = readSource(MIGRATION);
  assert(sql.includes("add column risk_alerts_enabled boolean not null default false"));
  const store = readSource("apps/web/lib/risk-alerts/supabase-store.ts");
  assert(store.includes('.eq("enabled", true)') && store.includes('.eq("risk_alerts_enabled", true)'));
  assert(plan({ providerConfigured: false }).blockedReason === "PROVIDER_NOT_CONFIGURED" && plan({ providerConfigured: false, dryRun: true }).blockedReason === null);
});
await check("29. Provider fake não envia externamente (sem rede; ids determinísticos; guard do piloto aplicado); dry-run não grava", async () => {
  process.env.ACC_OUTBOUND_MODE = "pilot";
  process.env.ACC_PILOT_RECIPIENT = "reynaldo@axion.com.br";
  const provider = new FakeEmailProvider();
  const result = await provider.send({ to: "piloto.a@axion.com.br", subject: "x", text: "y", correlationId: "corr-1" });
  assert(result.provider === "FAKE" && result.providerMessageId.startsWith("fake-message-"));
  const source = readSource("apps/web/lib/email/fake-email-provider.ts");
  assert(!/fetch\(|https?:\/\//.test(source.replace(/\/\/.*$/gm, "")), "sem rede");
  const cycle = readSource("apps/web/lib/risk-alerts/run-risk-alert-cycle.ts");
  assert(cycle.includes("const provider = dryRun ? new FakeEmailProvider()") && /if \(dryRun\) \{[\s\S]*?continue;\s*\}/.test(cycle));
  const dry = cycle.slice(cycle.indexOf("if (dryRun) {"), cycle.indexOf("// ---- persistência do plano ----"));
  assert(!/store\.(upsertCases|createSlaActions|applyEscalations|enqueue|audit|markSent)/.test(dry), "dry-run não escreve");
});
await check("30. Nenhum To/Cc/Bcc adicional: um destinatário por entrada; provider recebe só `to`", () => {
  const result = plan({ responsibles: responsibles({ responsibleDirectUserId: U_PILOT_A, secondaryResponsibleUserId: U_PILOT_B }) });
  const immediate = result.outbox.filter((e) => e.notificationType === "IMMEDIATE");
  assert(immediate.length === 2 && immediate.every((e) => typeof e.recipient.userId === "string"));
  const cycle = readSource("apps/web/lib/risk-alerts/run-risk-alert-cycle.ts");
  assert(cycle.includes("to: recipientEmail,") && !/\bcc:|\bbcc:/.test(cycle));
  const sql = readSource(MIGRATION);
  assert(sql.includes("recipient_user_id uuid not null"));
});
await check("31. Timezone correto: janela e prazos usam o timezone do projeto (sla_project_settings), default America/Sao_Paulo", () => {
  const p = resolveMatrixPolicy({ rules: [], responsibles: responsibles(), settings: { ...settings, timezone: "America/Manaus" }, area: "PLANEJAMENTO", riskLevel: "HIGH" });
  assert(p.businessHours.timeZone === "America/Manaus");
  const dflt = resolveMatrixPolicy({ rules: [], responsibles: responsibles(), settings: null, area: "PLANEJAMENTO", riskLevel: "HIGH" });
  assert(dflt.businessHours.timeZone === "America/Sao_Paulo");
  assert(toLocalDateParts(WEDNESDAY_0730_SP, TZ).hour === 7 && toLocalDateParts(WEDNESDAY_0730_SP, "America/Manaus").hour === 6);
  const cycle = readSource("apps/web/lib/risk-alerts/run-risk-alert-cycle.ts");
  assert(cycle.includes("snapshot.settings?.timezone ?? DEFAULT_PROJECT_TIMEZONE"));
});

// ------------------------------------------------------------------
// 32–35. Auditoria, RLS, conteúdo, links
// ------------------------------------------------------------------
await check("32. Auditoria completa: regra usada, destinatários calculados/permitidos/suprimidos, agendamento, envio, escalonamento, falha/retry, chave", () => {
  const result = plan({ now: "2026-09-21T17:00:00.000Z", existingCases: [existingRecord()], linkedActions: new Map([["act-1", linkedAction()]]) });
  const entry = result.outbox[0];
  assert(entry.matrixRuleSnapshot.timeUnit && entry.matrixRuleSnapshot.level2UserId === U_PILOT_A && entry.matrixRuleSnapshot.timeZone === TZ, "regra da Matriz gravada na outbox");
  assert(result.audit.some((a) => a.action === "RISK_ALERT_DEADLINE_EXPIRED"));
  const cycle = readSource("apps/web/lib/risk-alerts/run-risk-alert-cycle.ts");
  for (const action of ["RISK_ALERT_PLANNED", "RISK_ALERT_EMAIL_SENT", "RISK_ALERT_EMAIL_FAILED"]) assert(cycle.includes(`"${action}"`), action);
  const planner = readSource("apps/web/lib/risk-alerts/plan-risk-alerts.ts");
  for (const action of ["RISK_ALERT_RECIPIENT_SUPPRESSED", "RISK_ALERT_CONFIGURATION_REVIEW_REQUIRED", "RISK_ALERT_DEADLINE_EXPIRED"]) assert(planner.includes(`"${action}"`), action);
  const sql = readSource(MIGRATION);
  assert(sql.includes("matrix_rule_snapshot jsonb") && sql.includes("scheduled_for timestamptz not null") && sql.includes("provider_message_id text") && sql.includes("last_error text"));
  assert(sql.includes("'ACTION_ESCALATED', 'SLA_ACTION'"), "escalonamento automático auditado na RPC");
  const store = readSource("apps/web/lib/risk-alerts/supabase-store.ts");
  assert(store.includes('actor_type: "SYSTEM"') && store.includes("actor_label: null"));
});
await check("33. RLS impede acesso cruzado: SELECT por membership do projeto; sem anon/PUBLIC; escrita só pelo worker", () => {
  const sql = readSource(MIGRATION);
  for (const t of ["risk_alert_cases", "risk_alert_outbox"]) {
    assert(sql.includes(`alter table public.${t} enable row level security`), t);
    assert(new RegExp(`on public\\.${t} for select\\s+using \\(public\\.is_project_member\\(project_id\\)\\)`).test(sql), `policy ${t}`);
    assert(sql.includes(`revoke all on table public.${t} from public, anon;`));
    assert(sql.includes(`revoke insert, update, delete, truncate, references, trigger, maintain on table public.${t} from authenticated;`));
    assert(!new RegExp(`on public\\.${t} for (insert|update|delete)`).test(sql), "sem policy de escrita para authenticated");
  }
  const view = readSource("apps/web/lib/risk-alerts/pilot-risk-alerts-view-data.ts");
  assert(view.includes("createSupabaseServerClient") && !view.includes("createSupabaseAdminClient") && view.includes('.eq("project_id", projectId)'));
  const store = readSource("apps/web/lib/risk-alerts/supabase-store.ts");
  const reads = [...store.matchAll(/from\("risk_alert_(?:cases|outbox)"\)\s*\.select\([^)]*\)([\s\S]{0,160})/g)];
  assert(reads.length >= 5 && reads.every((m) => /\.eq\("(project_id|idempotency_key|id|case_id|token_hash)"/.test(m[1])), "leituras escopadas por projeto/chave/caso");
});
await check("34. Conteúdo não inclui secrets/tokens/URLs assinadas/anexos; erros sanitizados", () => {
  const result = plan();
  const entry = result.outbox[0];
  const email = buildImmediateRiskAlertEmail({ content: entry.content, projectId: PROJECT, projectName: "Obra Piloto", recipientName: "Piloto", baseUrl: "https://acc.example", timeZone: TZ, generatedAt: TUESDAY_NOON_SP, actionButtons: [] });
  assert(!/token|sb_secret|service_role|Bearer|signature=|X-Amz|\?token=/i.test(email.html + email.text));
  assert(email.text.includes("Obra Piloto") && email.text.includes("Grau de risco: ALTO") && email.text.includes("Origem: W37") && email.text.includes("Impacto:") && email.text.includes("Recomendação do Expert") && email.text.includes("Gerado em:"));
  const digest = buildRiskDigestEmail({ content: { kind: "DIGEST", window: "2026-09-23", mediumItems: [], lowItems: [], closedItems: [] }, projectId: PROJECT, projectName: "Obra Piloto", recipientName: null, baseUrl: "https://acc.example", timeZone: TZ, generatedAt: WEDNESDAY_0730_SP });
  assert(digest.subject.includes("CONSOLIDADO SEMANAL") && digest.text.includes("Resumo executivo"));
  const cycle = readSource("apps/web/lib/risk-alerts/run-risk-alert-cycle.ts");
  assert(!/attachments/.test(cycle) && cycle.includes("sanitizeError("));
  const store = readSource("apps/web/lib/risk-alerts/supabase-store.ts");
  assert(store.includes('.replace(/(bearer|token|secret|key)[^\\s]*/gi, "<redacted>")'));
  assert(!/pilotRecipientAllowlistUserIds.*@|"[a-z.]+@axion\.com\.br"/.test(readSource("apps/web/lib/risk-alerts/plan-risk-alerts.ts")), "nenhum e-mail pessoal no código");
});
await check("35. Link aponta para o projeto/evento correto (rota interna, sem token) — ação SLA e evidência de origem", () => {
  assert(buildProjectLink("https://acc.example/", PROJECT, "/acoes/act-1") === `https://acc.example/${PROJECT}/acoes/act-1`);
  const result = plan({ existingCases: [existingRecord({ fingerprint: "old" })], linkedActions: new Map([["act-1", linkedAction()]]) });
  const entry = result.outbox.find((e) => e.notificationType === "IMMEDIATE");
  const email = buildImmediateRiskAlertEmail({ content: entry.content, projectId: PROJECT, projectName: "Obra Piloto", recipientName: null, baseUrl: "https://acc.example", timeZone: TZ, generatedAt: TUESDAY_NOON_SP, actionButtons: [] });
  assert(email.text.includes(`https://acc.example/${PROJECT}/acoes/act-1`) && email.text.includes(`https://acc.example/${PROJECT}/documentos/emails/e1`));
  assert(!email.text.includes("22222222"), "nunca outro projeto");
  const cases = collectComparisonCases([{ id: "c1", project_id: PROJECT, comparison_type: "PREVIOUS_WEEKLY", status: "COMPUTED", risk_classification: "HIGH", risk_reasons: ["FINAL_DATE_SLIP_DAYS: HIGH (9 dias)"], metrics: { finalDate: { slipDays: 9 } }, computed_at: "2026-09-20T00:00:00Z", created_at: "2026-09-20T00:00:00Z", current_schedule_version_id: "v1", work_week_label: "W37", email_id: "e1" }]);
  assert(cases[0].originPath === "documentos/emails/e1" && cases[0].reference === "W37 · vs semana anterior" && caseKeyOf(cases[0]) === "SCHEDULE_COMPARISON:c1");
  const sheets = collectSheetCases([{ id: "s1", project_id: PROJECT, category: "FINANCEIRO", status: "EXTRACTED", risk_classification: "MEDIUM", risk_reasons: [], alerts: [{ code: "X", detail: "y", severity: "WARNING" }], cutoff_date: null, created_at: "2026-09-20T00:00:00Z", work_week_label: "W37", email_id: "e2" }]);
  assert(sheets[0].area === "FINANCEIRO" && sheets[0].originPath === "documentos/emails/e2");
  const alerts = collectIngestionAlertCases([{ id: "a1", project_id: PROJECT, kind: "MISSING_WEEKLY_SCHEDULE", week_start: "2026-09-14", deadline_at: "2026-09-18T21:00:00Z", detail: "sem cronograma", resolved_at: null, created_at: "2026-09-18T22:00:00Z" }], SUGGESTED_INGESTION_ALERT_SEVERITY);
  assert(alerts[0].riskLevel === SUGGESTED_INGESTION_ALERT_SEVERITY.MISSING_WEEKLY_SCHEDULE && alerts[0].closed === false);
  const panel = readSource("apps/web/components/sla/pilot-risk-alerts-panel.tsx");
  assert(panel.includes("Próximo consolidado") && panel.includes("Último consolidado") && panel.includes("PILOT_RECIPIENT_SUPPRESSED") && panel.includes("edite-os somente na própria Matriz"));
  const page = readSource("apps/web/app/[projectId]/acoes/configuracao/page.tsx");
  assert(page.includes("isWeeklyReportsEnabled() ? await getPilotRiskAlertsView(projectId) : null"));
});

console.log("");
console.log(`Resultado: ${passed} OK, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
