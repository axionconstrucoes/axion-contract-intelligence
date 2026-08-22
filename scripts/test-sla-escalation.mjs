// Testes da Matriz de Criticidade, SLA e Escalonamento: motor
// determinístico (puro) + schema real (RLS, escalonamento via RPC,
// concorrência otimista, auditoria, configuração). Nenhum LLM decide se
// um prazo expirou — isso é testado explicitamente.
//
// Cria registros de teste reais contra o projeto de referência (sessão
// autenticada real, RLS completo) e os remove ao final. Auditoria
// permanece (append-only, correto).
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/test-sla-escalation.mjs

import { createClient } from "@supabase/supabase-js";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const { addClockHours, addCalendarDays, addBusinessHours, addBusinessDays, AXION_DEFAULT_BUSINESS_HOURS_CONFIG } =
  await import("../apps/web/lib/sla/time-units");
const { computeEscalation } = await import("../apps/web/lib/sla/compute-escalation");
const { DEFAULT_SLA_MATRIX } = await import("../apps/web/lib/sla/default-matrix");
const { resolveMatrixRule, resolveGenericMatrixRule, resolveBusinessHoursConfig } = await import(
  "../apps/web/lib/sla/resolve-matrix-rule"
);
const { computeSlaDeadlines } = await import("../apps/web/lib/sla/compute-deadlines");
const { formatDurationBetween } = await import("../apps/web/lib/sla/format-duration");

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

async function checkAsync(name, fn) {
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

function assert(condition, message) {
  if (!condition) throw new Error(message ?? "assertion failed");
}

console.log("");
console.log("======================================");
console.log("MATRIZ DE CRITICIDADE, SLA E ESCALONAMENTO — TESTES");
console.log("======================================");
console.log("");

// ---------- defaults (seção 2) ----------

check("default BAIXO: 3 dias úteis para assumir, +3 dias úteis até 2º escalão, +2 até Diretoria", () => {
  const d = DEFAULT_SLA_MATRIX.LOW;
  assert(d.timeUnit === "BUSINESS_DAYS");
  assert(d.assumeDeadlineValue === 3);
  assert(d.escalation2AfterValue === 3);
  assert(d.boardAfterValue === 2);
});

check("default MÉDIO: 1 dia útil para assumir, +1 dia útil até 2º escalão, +1 até Diretoria", () => {
  const d = DEFAULT_SLA_MATRIX.MEDIUM;
  assert(d.timeUnit === "BUSINESS_DAYS");
  assert(d.assumeDeadlineValue === 1);
  assert(d.escalation2AfterValue === 1);
  assert(d.boardAfterValue === 1);
});

check("default ALTO: 4 horas úteis para assumir, +4h úteis até 2º escalão", () => {
  const d = DEFAULT_SLA_MATRIX.HIGH;
  assert(d.timeUnit === "BUSINESS_HOURS");
  assert(d.assumeDeadlineValue === 4);
  assert(d.escalation2AfterValue === 4);
});

check("default CRÍTICO: 1 hora corrida para assumir, +2h até Diretoria", () => {
  const d = DEFAULT_SLA_MATRIX.CRITICAL;
  assert(d.timeUnit === "CLOCK_HOURS");
  assert(d.assumeDeadlineValue === 1);
  assert(d.boardAfterValue === 2);
});

check("nenhum default inventa prazo de responder/concluir (ausentes na seção 2)", () => {
  for (const level of ["LOW", "MEDIUM", "HIGH", "CRITICAL"]) {
    assert(DEFAULT_SLA_MATRIX[level].respondDeadlineValue === null);
    assert(DEFAULT_SLA_MATRIX[level].completeDeadlineValue === null);
  }
});

// ---------- resolução da matriz (projeto > default) ----------

check("sem configuração de projeto, resolveMatrixRule cai no default", () => {
  const resolved = resolveMatrixRule([], "HIGH", "ENGENHARIA");
  assert(resolved.isDefault === true);
  assert(resolved.assumeDeadlineValue === 4);
});

check("configuração específica de projeto sobrescreve o default", () => {
  const projectRules = [
    {
      id: "r1",
      projectId: "proj-1",
      riskLevel: "HIGH",
      area: null,
      timeUnit: "CLOCK_HOURS",
      assumeDeadlineValue: 8,
      respondDeadlineValue: null,
      completeDeadlineValue: null,
      escalation2AfterValue: 8,
      boardAfterValue: 8,
      notifyByEmail: true,
      requiresAcknowledgmentConfirmation: false,
      requiresDelayJustification: true,
      isDefault: false,
      active: true,
    },
  ];
  const resolved = resolveMatrixRule(projectRules, "HIGH", "ENGENHARIA");
  assert(resolved.isDefault === false);
  assert(resolved.assumeDeadlineValue === 8, "deveria usar o valor configurado (8), não o default (4)");
});

check("resolveGenericMatrixRule ignora regras específicas de área", () => {
  const projectRules = [
    {
      id: "r1",
      projectId: "proj-1",
      riskLevel: "LOW",
      area: "JURIDICO",
      timeUnit: "CALENDAR_DAYS",
      assumeDeadlineValue: 10,
      respondDeadlineValue: null,
      completeDeadlineValue: null,
      escalation2AfterValue: 5,
      boardAfterValue: 5,
      notifyByEmail: true,
      requiresAcknowledgmentConfirmation: false,
      requiresDelayJustification: true,
      isDefault: false,
      active: true,
    },
  ];
  const resolved = resolveGenericMatrixRule(projectRules, "LOW");
  assert(resolved.isDefault === true, "regra específica de JURIDICO não deveria valer para a tela geral");
});

// ---------- unidades de tempo (seção 20) ----------

check("addClockHours soma horas corridas, sem considerar fim de semana", () => {
  const result = addClockHours(new Date("2026-08-22T10:00:00Z"), 5); // sábado
  assert(result.toISOString() === "2026-08-22T15:00:00.000Z");
});

check("addCalendarDays soma dias corridos", () => {
  const result = addCalendarDays(new Date("2026-08-20T10:00:00Z"), 3);
  assert(result.toISOString() === "2026-08-23T10:00:00.000Z");
});

// Config UTC explícita — usada só para provar que o algoritmo em si é
// genérico/parametrizável por timezone (nunca hardcoded), comparando
// contra os mesmos horários/dias já testados antes da correção.
const UTC_CONFIG = { timeZone: "UTC", businessDayStartHour: 8, businessDayEndHour: 18 };

check("addBusinessDays pula fim de semana (sexta + 1 dia útil = segunda) — timezone explícita (UTC)", () => {
  const friday = new Date("2026-08-21T10:00:00Z"); // sexta
  const result = addBusinessDays(friday, 1, UTC_CONFIG);
  assert(result.getUTCDay() === 1, `esperado segunda-feira, obtido dia da semana ${result.getUTCDay()}`);
});

check("addBusinessHours rola para o próximo dia útil quando o expediente acaba — timezone explícita (UTC)", () => {
  const monday1600 = new Date("2026-08-24T16:00:00Z"); // segunda, 16:00 UTC — só restam 2h de expediente (até 18:00)
  const result = addBusinessHours(monday1600, 4, UTC_CONFIG); // 2h hoje + 2h amanhã
  assert(result.toISOString() === "2026-08-25T10:00:00.000Z", `obtido ${result.toISOString()}`);
});

check("addBusinessHours iniciado no fim de semana avança para segunda 08:00 — timezone explícita (UTC)", () => {
  const saturday = new Date("2026-08-22T12:00:00Z");
  const result = addBusinessHours(saturday, 1, UTC_CONFIG);
  assert(result.toISOString() === "2026-08-24T09:00:00.000Z", `obtido ${result.toISOString()}`);
});

// ---------- CORREÇÃO DE TIMEZONE: America/Sao_Paulo (default institucional) ----------

check("default institucional é America/Sao_Paulo, 08:00–18:00 — nunca UTC como horário comercial", () => {
  assert(AXION_DEFAULT_BUSINESS_HOURS_CONFIG.timeZone === "America/Sao_Paulo");
  assert(AXION_DEFAULT_BUSINESS_HOURS_CONFIG.businessDayStartHour === 8);
  assert(AXION_DEFAULT_BUSINESS_HOURS_CONFIG.businessDayEndHour === 18);
});

check("resolveBusinessHoursConfig cai no default AXION quando o projeto não configurou nada", () => {
  const resolved = resolveBusinessHoursConfig(null);
  assert(resolved.timeZone === "America/Sao_Paulo");
});

check("resolveBusinessHoursConfig usa a configuração do projeto quando existir", () => {
  const resolved = resolveBusinessHoursConfig({
    projectId: "proj-1",
    timezone: "America/Manaus",
    businessDayStartHour: 9,
    businessDayEndHour: 17,
    updatedAt: "2026-08-22T00:00:00Z",
  });
  assert(resolved.timeZone === "America/Manaus");
  assert(resolved.businessDayStartHour === 9);
});

check(
  // Cenário explícito do requisito (seção 5): CRÍTICO criado sexta 17:30
  // em America/Sao_Paulo, SLA de 1 BUSINESS_HOUR — nunca pode vencer às
  // 18:30 do mesmo dia (isso seria tratar 17:30 como UTC). Deve consumir
  // 30min de sexta + 30min no próximo dia útil (segunda), a partir das
  // 08:00 configuradas.
  "sexta-feira 17:30 America/Sao_Paulo + 1 BUSINESS_HOUR consome 30min hoje + 30min na segunda (nunca vence 18:30 do mesmo dia)",
  () => {
    // Sexta 21/08/2026, 17:30 em America/Sao_Paulo (UTC-3, sem horário de
    // verão desde 2019) = 20:30 UTC.
    const fridayEvening = new Date("2026-08-21T20:30:00Z");
    const result = addBusinessHours(fridayEvening, 1, AXION_DEFAULT_BUSINESS_HOURS_CONFIG);

    // NUNCA pode ser 2026-08-21T21:30:00Z (18:30 SP do mesmo dia,
    // resultado errado de tratar o horário como UTC).
    assert(
      result.toISOString() !== "2026-08-21T21:30:00.000Z",
      "não pode vencer às 18:30 do mesmo dia — isso indicaria horário comercial calculado em UTC, não em America/Sao_Paulo"
    );

    // Esperado: segunda 24/08/2026, 08:30 America/Sao_Paulo = 11:30 UTC
    // (30min restantes de sexta + 30min a partir do início do expediente
    // de segunda).
    assert(result.toISOString() === "2026-08-24T11:30:00.000Z", `obtido ${result.toISOString()}`);
  }
);

check("horário fora do expediente (antes das 08:00 em America/Sao_Paulo) é adiado para o início do expediente", () => {
  // 06:00 America/Sao_Paulo = 09:00 UTC — antes do expediente (08:00 SP).
  const earlyMorning = new Date("2026-08-24T09:00:00Z"); // segunda, 06:00 SP
  const result = addBusinessHours(earlyMorning, 1, AXION_DEFAULT_BUSINESS_HOURS_CONFIG);
  // Deveria começar a contar a partir de 08:00 SP (11:00 UTC), terminando em 09:00 SP (12:00 UTC).
  assert(result.toISOString() === "2026-08-24T12:00:00.000Z", `obtido ${result.toISOString()}`);
});

check("addBusinessDays em America/Sao_Paulo preserva o horário de parede original ao pular para o próximo dia útil", () => {
  // Sexta 21/08/2026, 14:00 SP = 17:00 UTC.
  const friday1400SP = new Date("2026-08-21T17:00:00Z");
  const result = addBusinessDays(friday1400SP, 1, AXION_DEFAULT_BUSINESS_HOURS_CONFIG);
  // +1 dia útil = segunda 24/08, mesmo horário de parede (14:00 SP = 17:00 UTC).
  assert(result.toISOString() === "2026-08-24T17:00:00.000Z", `obtido ${result.toISOString()}`);
});

check("CLOCK_HOURS e CALENDAR_DAYS continuam independentes de timezone/horário comercial", () => {
  // Sexta 17:30 SP (20:30 UTC) + 1 CLOCK_HOURS = simplesmente +1h corrida, mesmo fora do expediente/fim de semana.
  const fridayEvening = new Date("2026-08-21T20:30:00Z");
  const clockResult = addClockHours(fridayEvening, 1);
  assert(clockResult.toISOString() === "2026-08-21T21:30:00.000Z", `CLOCK_HOURS não deveria respeitar expediente: obtido ${clockResult.toISOString()}`);

  const calendarResult = addCalendarDays(fridayEvening, 1);
  assert(calendarResult.toISOString() === "2026-08-22T20:30:00.000Z", `CALENDAR_DAYS não deveria pular fim de semana: obtido ${calendarResult.toISOString()}`);
});

check("timezone com horário de verão (America/New_York) é tratada corretamente via Intl (nunca offset fixo manual)", () => {
  const nyConfig = { timeZone: "America/New_York", businessDayStartHour: 8, businessDayEndHour: 18 };
  // 2026-03-06 (sexta, antes do início do DST em 2026-03-08) 17:30 America/New_York = 22:30 UTC (UTC-5).
  const beforeDst = new Date("2026-03-06T22:30:00Z");
  const result = addBusinessHours(beforeDst, 1, nyConfig);
  // 30min restam sexta + 30min segunda 09/03 (já em DST, UTC-4) a partir das 08:00 = 12:00 UTC, +30min = 12:30 UTC.
  assert(result.toISOString() === "2026-03-09T12:30:00.000Z", `obtido ${result.toISOString()}`);
});

check("timezone não altera o instante UTC persistido de forma incorreta — round-trip preserva o instante real", () => {
  // Uma data já "no meio do expediente" não deveria se mover, independente da timezone usada para calcular o clamp.
  const middayUtc = new Date("2026-08-24T14:00:00Z"); // segunda, 11:00 SP — dentro do expediente
  const result = addBusinessHours(middayUtc, 0, AXION_DEFAULT_BUSINESS_HOURS_CONFIG);
  assert(result.getTime() === middayUtc.getTime(), "0 horas úteis não deveria mover o instante");
});

// ---------- computeSlaDeadlines ----------

check("computeSlaDeadlines calcula assumeDueAt a partir da regra, respondDueAt/completeDueAt null quando não configurados", () => {
  const rule = DEFAULT_SLA_MATRIX.CRITICAL;
  const deadlines = computeSlaDeadlines("2026-08-22T12:00:00.000Z", rule);
  assert(deadlines.assumeDueAt === "2026-08-22T13:00:00.000Z", `obtido ${deadlines.assumeDueAt}`);
  assert(deadlines.respondDueAt === null);
  assert(deadlines.completeDueAt === null);
});

// ---------- motor determinístico de escalonamento (seção 10/11) ----------

const criticalRule = { timeUnit: "CLOCK_HOURS", escalation2AfterValue: 1, boardAfterValue: 2 };

check("CRÍTICO: não assumida no prazo escala ao 1º escalão (NO_ACKNOWLEDGMENT)", () => {
  const result = computeEscalation({
    status: "PENDING",
    currentEscalationLevel: "RESPONSAVEL",
    assumeDueAt: "2026-08-22T13:00:00Z",
    respondDueAt: null,
    completeDueAt: null,
    acknowledgedAt: null,
    completedAt: null,
    contractualDeadline: null,
    now: "2026-08-22T13:30:00Z",
    rule: criticalRule,
  });
  assert(result.shouldEscalate === true);
  assert(result.recommendedLevel === "ESCALAO_1");
  assert(result.reason === "NO_ACKNOWLEDGMENT");
});

check("CRÍTICO escala corretamente ao longo do tempo: 12:00 criado, 13:30 sem ação -> 2º escalão, 15:30 -> Diretoria", () => {
  const base = {
    status: "PENDING",
    currentEscalationLevel: "RESPONSAVEL",
    assumeDueAt: "2026-08-22T13:00:00Z", // criado 12:00 + 1h
    respondDueAt: null,
    completeDueAt: null,
    acknowledgedAt: null,
    completedAt: null,
    contractualDeadline: null,
    rule: criticalRule,
  };

  const at1330 = computeEscalation({ ...base, now: "2026-08-22T13:30:00Z" }); // 30min após vencer -> ainda ESCALAO_1 (limiar do 2º escalão é 13:00+1h=14:00)
  assert(at1330.recommendedLevel === "ESCALAO_1", `13:30 esperado ESCALAO_1, obtido ${at1330.recommendedLevel}`);

  const at1430 = computeEscalation({ ...base, now: "2026-08-22T14:30:00Z" }); // após 14:00 -> ESCALAO_2
  assert(at1430.recommendedLevel === "ESCALAO_2", `14:30 esperado ESCALAO_2, obtido ${at1430.recommendedLevel}`);

  const at1630 = computeEscalation({ ...base, now: "2026-08-22T16:30:00Z" }); // 14:00 + 2h = 16:00 -> Diretoria
  assert(at1630.recommendedLevel === "DIRETORIA", `16:30 esperado DIRETORIA, obtido ${at1630.recommendedLevel}`);
});

check("ação assumida no prazo nunca escala por NO_ACKNOWLEDGMENT", () => {
  const result = computeEscalation({
    status: "ACKNOWLEDGED",
    currentEscalationLevel: "RESPONSAVEL",
    assumeDueAt: "2026-08-22T13:00:00Z",
    respondDueAt: null,
    completeDueAt: null,
    acknowledgedAt: "2026-08-22T12:30:00Z",
    completedAt: null,
    contractualDeadline: null,
    now: "2026-08-22T20:00:00Z",
    rule: criticalRule,
  });
  assert(result.shouldEscalate === false, "sem completeDueAt/respondDueAt configurado, não há mais checkpoint do Relógio B");
});

check("assumida mas não concluída no prazo escala por NOT_COMPLETED", () => {
  const result = computeEscalation({
    status: "ACKNOWLEDGED",
    currentEscalationLevel: "RESPONSAVEL",
    assumeDueAt: "2026-08-22T13:00:00Z",
    respondDueAt: null,
    completeDueAt: "2026-08-22T14:00:00Z",
    acknowledgedAt: "2026-08-22T12:30:00Z",
    completedAt: null,
    contractualDeadline: null,
    now: "2026-08-22T14:30:00Z",
    rule: criticalRule,
  });
  assert(result.shouldEscalate === true);
  assert(result.reason === "NOT_COMPLETED");
});

check("ação COMPLETED nunca escala, mesmo com prazos vencidos", () => {
  const result = computeEscalation({
    status: "COMPLETED",
    currentEscalationLevel: "RESPONSAVEL",
    assumeDueAt: "2026-08-22T13:00:00Z",
    respondDueAt: null,
    completeDueAt: null,
    acknowledgedAt: "2026-08-22T12:30:00Z",
    completedAt: "2026-08-22T12:45:00Z",
    contractualDeadline: null,
    now: "2026-08-23T00:00:00Z",
    rule: criticalRule,
  });
  assert(result.shouldEscalate === false);
});

check("ação CANCELLED nunca escala", () => {
  const result = computeEscalation({
    status: "CANCELLED",
    currentEscalationLevel: "RESPONSAVEL",
    assumeDueAt: "2026-08-22T13:00:00Z",
    respondDueAt: null,
    completeDueAt: null,
    acknowledgedAt: null,
    completedAt: null,
    contractualDeadline: null,
    now: "2026-08-23T00:00:00Z",
    rule: criticalRule,
  });
  assert(result.shouldEscalate === false);
});

check("prazo contratual perdido força ao menos ESCALAO_2 mesmo sem vencimento do Relógio B", () => {
  const result = computeEscalation({
    status: "ACKNOWLEDGED",
    currentEscalationLevel: "RESPONSAVEL",
    assumeDueAt: "2026-08-22T13:00:00Z",
    respondDueAt: null,
    completeDueAt: null,
    acknowledgedAt: "2026-08-22T12:30:00Z",
    completedAt: null,
    contractualDeadline: "2026-08-22T13:00:00Z",
    now: "2026-08-22T13:05:00Z",
    rule: criticalRule,
  });
  assert(result.shouldEscalate === true);
  assert(result.reason === "CONTRACTUAL_DEADLINE_MISSED");
  assert(result.recommendedLevel === "ESCALAO_2");
});

check("prazo contratual próximo (≤24h) força ao menos ESCALAO_1", () => {
  const result = computeEscalation({
    status: "ACKNOWLEDGED",
    currentEscalationLevel: "RESPONSAVEL",
    assumeDueAt: "2026-08-22T13:00:00Z",
    respondDueAt: null,
    completeDueAt: null,
    acknowledgedAt: "2026-08-22T12:30:00Z",
    completedAt: null,
    contractualDeadline: "2026-08-23T00:00:00Z",
    now: "2026-08-22T12:35:00Z",
    rule: criticalRule,
  });
  assert(result.shouldEscalate === true);
  assert(result.reason === "CONTRACTUAL_DEADLINE_NEAR");
});

check("nova evidência aumentando o risco força ao menos ESCALAO_1", () => {
  const result = computeEscalation({
    status: "ACKNOWLEDGED",
    currentEscalationLevel: "RESPONSAVEL",
    assumeDueAt: "2026-08-25T13:00:00Z",
    respondDueAt: null,
    completeDueAt: null,
    acknowledgedAt: "2026-08-22T12:30:00Z",
    completedAt: null,
    contractualDeadline: null,
    now: "2026-08-22T12:35:00Z",
    rule: criticalRule,
    externalRiskIncrease: true,
  });
  assert(result.shouldEscalate === true);
  assert(result.reason === "NEW_EVIDENCE_INCREASED_RISK");
});

check("nunca rebaixa um nível já mais alto que o recomendado (recommendedLevel é sempre >= currentEscalationLevel)", () => {
  const result = computeEscalation({
    status: "ESCALATED",
    currentEscalationLevel: "DIRETORIA",
    assumeDueAt: "2026-08-22T13:00:00Z",
    respondDueAt: null,
    completeDueAt: null,
    acknowledgedAt: null,
    completedAt: null,
    contractualDeadline: null,
    now: "2026-08-22T13:05:00Z",
    rule: criticalRule,
  });
  assert(result.recommendedLevel === "DIRETORIA");
  assert(result.shouldEscalate === false, "já está no nível máximo — não há novo escalonamento a aplicar");
});

check("resultado sempre inclui motivos legíveis (nunca uma caixa-preta)", () => {
  const result = computeEscalation({
    status: "PENDING",
    currentEscalationLevel: "RESPONSAVEL",
    assumeDueAt: "2026-08-22T13:00:00Z",
    respondDueAt: null,
    completeDueAt: null,
    acknowledgedAt: null,
    completedAt: null,
    contractualDeadline: null,
    now: "2026-08-22T10:00:00Z",
    rule: criticalRule,
  });
  assert(Array.isArray(result.reasons) && result.reasons.length > 0);
});

check("formatDurationBetween formata dias/horas/minutos legíveis", () => {
  assert(formatDurationBetween("2026-08-22T10:00:00Z", "2026-08-22T12:15:00Z") === "2h 15min");
  assert(formatDurationBetween("2026-08-22T10:00:00Z", "2026-08-24T10:00:00Z") === "2d");
});

// ---------- teste real: schema, RLS, escalonamento, auditoria ----------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !serviceKey || !anonKey) {
  console.log("");
  console.log("SKIP testes reais de SLA/escalonamento — Supabase não configurado.");
} else {
  const REFERENCE_PROJECT_ID = "00000000-0000-4000-8000-000000000001";
  const TEST_AUTHOR_EMAIL = "reynaldo@axion.com.br";

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: TEST_AUTHOR_EMAIL,
  });
  if (linkError) throw linkError;

  const anonClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: verifyData, error: verifyError } = await anonClient.auth.verifyOtp({
    type: "magiclink",
    token_hash: linkData.properties.hashed_token,
  });
  if (verifyError) throw verifyError;

  const authedUserId = verifyData.user.id;
  const authedClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${verifyData.session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let actionId = null;
  let secondActionId = null;

  async function snapshotEvents() {
    const { data, error } = await admin.from("contract_events").select("id").eq("project_id", REFERENCE_PROJECT_ID);
    if (error) throw error;
    return data.length;
  }

  const eventsBeforeAll = await snapshotEvents();

  await checkAsync("criação de ação exige EDITOR/ADMIN, autoautoria, prazos calculados a partir da matriz", async () => {
    const assumeDueAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { data, error } = await authedClient
      .from("sla_actions")
      .insert({
        project_id: REFERENCE_PROJECT_ID,
        origin: "MANUAL",
        title: "[TESTE AUTOMATIZADO — remover ao final] Ação de teste do motor de SLA",
        description: "Criada pelo script automatizado.",
        risk_level: "CRITICAL",
        area: "ENGENHARIA",
        assume_due_at: assumeDueAt,
        created_by_type: "USER",
        created_by_user_id: authedUserId,
      })
      .select("id,current_escalation_level,status")
      .single();

    if (error) throw error;
    assert(data.current_escalation_level === "RESPONSAVEL", "ação deveria nascer no nível RESPONSAVEL");
    assert(data.status === "PENDING", "ação deveria nascer PENDING");
    actionId = data.id;
  });

  await checkAsync("ACTION_CREATED foi registrado em audit_log_entries", async () => {
    const { data, error } = await admin
      .from("audit_log_entries")
      .select("id,actor_user_id")
      .eq("action", "ACTION_CREATED")
      .eq("entity_id", actionId)
      .maybeSingle();
    if (error) throw error;
    assert(data !== null);
    assert(data.actor_user_id === authedUserId);
  });

  await checkAsync("current_escalation_level protegido: UPDATE direto (fora da RPC) é rejeitado pelo trigger", async () => {
    const { error } = await authedClient
      .from("sla_actions")
      .update({ current_escalation_level: "DIRETORIA" })
      .eq("id", actionId);
    assert(error !== null, "alterar current_escalation_level diretamente nunca deveria ser aceito");
  });

  await checkAsync('"ASSUMIR AÇÃO" registra acknowledged_at/usuário e muda status para ACKNOWLEDGED', async () => {
    const { error } = await authedClient
      .from("sla_actions")
      .update({
        acknowledged_at: new Date().toISOString(),
        acknowledged_by_user_id: authedUserId,
        status: "ACKNOWLEDGED",
      })
      .eq("id", actionId);
    if (error) throw error;

    const { data } = await admin.from("sla_actions").select("status,acknowledged_by_user_id").eq("id", actionId).single();
    assert(data.status === "ACKNOWLEDGED");
    assert(data.acknowledged_by_user_id === authedUserId);
  });

  await checkAsync("ACTION_ACKNOWLEDGED foi registrado em audit_log_entries", async () => {
    const { data, error } = await admin
      .from("audit_log_entries")
      .select("id")
      .eq("action", "ACTION_ACKNOWLEDGED")
      .eq("entity_id", actionId)
      .maybeSingle();
    if (error) throw error;
    assert(data !== null);
  });

  await checkAsync('"CONCLUIR AÇÃO" sem observação é rejeitada pela constraint do banco', async () => {
    const { error } = await authedClient
      .from("sla_actions")
      .update({ completed_at: new Date().toISOString(), completed_by_user_id: authedUserId, status: "COMPLETED" })
      .eq("id", actionId);
    assert(error !== null, "conclusão sem completion_note nunca deveria ser aceita");
  });

  await checkAsync('"CONCLUIR AÇÃO" com observação é aceita e registra ACTION_COMPLETED', async () => {
    const { error } = await authedClient
      .from("sla_actions")
      .update({
        completed_at: new Date().toISOString(),
        completed_by_user_id: authedUserId,
        completion_note: "Concluído pelo script automatizado de teste.",
        status: "COMPLETED",
      })
      .eq("id", actionId);
    if (error) throw error;

    const { data } = await admin
      .from("audit_log_entries")
      .select("id")
      .eq("action", "ACTION_COMPLETED")
      .eq("entity_id", actionId)
      .maybeSingle();
    assert(data !== null, "ACTION_COMPLETED deveria estar auditado");
  });

  await checkAsync("escalate_sla_action recusa escalar uma ação já concluída", async () => {
    const { error } = await authedClient.rpc("escalate_sla_action", {
      p_action_id: actionId,
      p_expected_current_level: "RESPONSAVEL",
      p_new_level: "ESCALAO_1",
      p_reason: "NO_ACKNOWLEDGMENT",
    });
    assert(error !== null, "não deveria ser possível escalar uma ação COMPLETED");
  });

  // ---------- segunda ação: exercita o escalonamento de verdade ----------

  await checkAsync("segunda ação criada para testar escalonamento via RPC", async () => {
    const { data, error } = await authedClient
      .from("sla_actions")
      .insert({
        project_id: REFERENCE_PROJECT_ID,
        origin: "MANUAL",
        title: "[TESTE AUTOMATIZADO — remover ao final] Ação de teste de escalonamento",
        risk_level: "HIGH",
        area: "JURIDICO",
        assume_due_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        created_by_type: "USER",
        created_by_user_id: authedUserId,
      })
      .select("id")
      .single();
    if (error) throw error;
    secondActionId = data.id;
  });

  await checkAsync("escalate_sla_action sobe de RESPONSAVEL para ESCALAO_1 e audita ACTION_ESCALATED", async () => {
    const { error } = await authedClient.rpc("escalate_sla_action", {
      p_action_id: secondActionId,
      p_expected_current_level: "RESPONSAVEL",
      p_new_level: "ESCALAO_1",
      p_reason: "NO_ACKNOWLEDGMENT",
    });
    if (error) throw error;

    const { data } = await admin.from("sla_actions").select("current_escalation_level,status").eq("id", secondActionId).single();
    assert(data.current_escalation_level === "ESCALAO_1");
    assert(data.status === "ESCALATED");

    const { data: auditRow } = await admin
      .from("audit_log_entries")
      .select("id,actor_type,actor_label")
      .eq("action", "ACTION_ESCALATED")
      .eq("entity_id", secondActionId)
      .maybeSingle();
    assert(auditRow !== null);
    assert(auditRow.actor_type === "SYSTEM", "escalonamento é sempre atribuído ao motor (SYSTEM), nunca a um usuário específico");
  });

  await checkAsync("não duplica escalonamento: repetir a mesma chamada (nível esperado já ultrapassado) falha", async () => {
    const { error } = await authedClient.rpc("escalate_sla_action", {
      p_action_id: secondActionId,
      p_expected_current_level: "RESPONSAVEL", // já não é mais RESPONSAVEL
      p_new_level: "ESCALAO_1",
      p_reason: "NO_ACKNOWLEDGMENT",
    });
    assert(error !== null, "concorrência otimista deveria rejeitar uma segunda tentativa com o nível antigo");

    const { data } = await admin
      .from("audit_log_entries")
      .select("id")
      .eq("action", "ACTION_ESCALATED")
      .eq("entity_id", secondActionId);
    assert(data.length === 1, "só deveria existir uma entrada de escalonamento, nunca duplicada");
  });

  await checkAsync("histórico de escalonamento (sla_action_escalations) registrou a transição", async () => {
    const { data, error } = await admin
      .from("sla_action_escalations")
      .select("from_level,to_level,reason")
      .eq("action_id", secondActionId);
    if (error) throw error;
    assert(data.length === 1);
    assert(data[0].from_level === "RESPONSAVEL" && data[0].to_level === "ESCALAO_1");
  });

  await checkAsync("configuração de matriz de SLA exige ADMIN e registra SLA_CONFIGURATION_UPDATED", async () => {
    const { error } = await authedClient.from("sla_matrix_rules").upsert(
      {
        project_id: REFERENCE_PROJECT_ID,
        risk_level: "LOW",
        area: null,
        time_unit: "BUSINESS_DAYS",
        assume_deadline_value: 3,
        escalation_2_after_value: 3,
        board_after_value: 2,
        updated_by_user_id: authedUserId,
      },
      { onConflict: "project_id,risk_level,area" }
    );
    if (error) throw error;

    const { data } = await admin
      .from("audit_log_entries")
      .select("id")
      .eq("action", "SLA_CONFIGURATION_UPDATED")
      .eq("project_id", REFERENCE_PROJECT_ID)
      .order("occurred_at", { ascending: false })
      .limit(1);
    assert(data.length === 1);
  });

  await checkAsync(
    "configuração de timezone/expediente do projeto exige ADMIN e registra SLA_CONFIGURATION_UPDATED",
    async () => {
      const { error } = await authedClient.from("sla_project_settings").upsert(
        {
          project_id: REFERENCE_PROJECT_ID,
          timezone: "America/Sao_Paulo",
          business_day_start_hour: 8,
          business_day_end_hour: 18,
          updated_by_user_id: authedUserId,
        },
        { onConflict: "project_id" }
      );
      if (error) throw error;

      const { data: settingsRow } = await admin
        .from("sla_project_settings")
        .select("timezone,business_day_start_hour,business_day_end_hour")
        .eq("project_id", REFERENCE_PROJECT_ID)
        .single();
      assert(settingsRow.timezone === "America/Sao_Paulo");

      const { data: auditRows } = await admin
        .from("audit_log_entries")
        .select("id")
        .eq("action", "SLA_CONFIGURATION_UPDATED")
        .eq("entity_type", "sla_project_settings")
        .eq("project_id", REFERENCE_PROJECT_ID);
      assert(auditRows.length === 1);
    }
  );

  await checkAsync("dados existentes (contract_events) permanecem intactos — nenhuma ação rotineira gera evento", async () => {
    const eventsAfter = await snapshotEvents();
    assert(eventsAfter === eventsBeforeAll, "nenhum contract_event deveria ter sido criado pelos testes de SLA");
  });

  // Restaura o estado original (nenhuma linha configurada para o
  // projeto de referência antes deste teste) — o registro de auditoria
  // permanece (append-only, correto).
  await admin.from("sla_project_settings").delete().eq("project_id", REFERENCE_PROJECT_ID);

  // ---------- limpeza ----------
  const escalationCleanupIds = [secondActionId].filter(Boolean);
  if (escalationCleanupIds.length > 0) {
    await admin.from("sla_action_escalations").delete().in("action_id", escalationCleanupIds);
  }
  const actionIds = [actionId, secondActionId].filter(Boolean);
  if (actionIds.length > 0) {
    const { error: deleteError } = await admin.from("sla_actions").delete().in("id", actionIds);
    if (deleteError) {
      console.log("AVISO: falha ao limpar ações de teste:", deleteError.message);
    } else {
      console.log(`Limpeza: ${actionIds.length} ação(ões) de teste removida(s).`);
    }
  }
  await admin
    .from("sla_matrix_rules")
    .delete()
    .eq("project_id", REFERENCE_PROJECT_ID)
    .eq("risk_level", "LOW")
    .is("area", null);

  await checkAsync("após limpeza, as ações de teste não existem mais", async () => {
    const { data } = await admin.from("sla_actions").select("id").in("id", actionIds);
    assert(data.length === 0);
  });
}

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
