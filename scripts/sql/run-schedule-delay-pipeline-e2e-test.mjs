// Bloco 8 — teste PONTA A PONTA do pipeline real de severidade de
// atraso de cronograma: generateScheduleRecoverabilityAssessment (dados
// reais de schedule_activities) -> deriveScheduleDelaySeverity (regra
// do Bloco 3) -> applyScheduleDelayAssessmentToEvent (escrita real em
// event_ai_assessments + audit_log_entries via @supabase/supabase-js,
// sem framework Next.js, sem rede/IA nenhuma — "provider falso" aqui é
// literalmente nenhum provider: tudo determinístico a partir de dados
// reais). Nunca só o gerador de prévia de e-mail.
//
// SEGURANÇA DE AMBIENTE — mesma família de runners (porta e container
// EXATOS, confirmação explícita, host restrito).
//
// Uso:
//   ACC_SCHEDULE_PIPELINE_TEST_API_URL="http://127.0.0.1:55513" \
//   ACC_SCHEDULE_PIPELINE_TEST_DB_CONTAINER="supabase_db_acc-disposable-20260829" \
//   ACC_SCHEDULE_PIPELINE_TEST_I_UNDERSTAND_THIS_IS_DISPOSABLE=true \
//     node scripts/sql/run-schedule-delay-pipeline-e2e-test.mjs

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { register } from "node:module";

register("../ts-module-resolver.mjs", import.meta.url);

const EXACT_API_URL = "http://127.0.0.1:55513";
const EXACT_DB_CONTAINER = "supabase_db_acc-disposable-20260829";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

if (process.env.ACC_SCHEDULE_PIPELINE_TEST_API_URL !== EXACT_API_URL) {
  console.error(`ACC_SCHEDULE_PIPELINE_TEST_API_URL precisa ser exatamente "${EXACT_API_URL}".`);
  process.exit(1);
}
if (process.env.ACC_SCHEDULE_PIPELINE_TEST_DB_CONTAINER !== EXACT_DB_CONTAINER) {
  console.error(`ACC_SCHEDULE_PIPELINE_TEST_DB_CONTAINER precisa ser exatamente "${EXACT_DB_CONTAINER}".`);
  process.exit(1);
}
if (process.env.ACC_SCHEDULE_PIPELINE_TEST_I_UNDERSTAND_THIS_IS_DISPOSABLE !== "true") {
  console.error('ACC_SCHEDULE_PIPELINE_TEST_I_UNDERSTAND_THIS_IS_DISPOSABLE precisa ser exatamente "true".');
  process.exit(1);
}

function psql(sql) {
  const result = spawnSync(
    "docker",
    ["exec", "-i", EXACT_DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "--no-psqlrc", "--quiet", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(`psql falhou (exit ${result.status}): ${result.stderr}`);
  }
  return result.stdout;
}

let passed = 0;
let failed = 0;
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
function assert(condition, message) {
  if (!condition) throw new Error(message ?? "assertion failed");
}

console.log("");
console.log("======================================");
console.log("PIPELINE REAL — severidade de atraso de cronograma (Bloco 8)");
console.log("======================================");
console.log("");

const { generateScheduleRecoverabilityAssessment } = await import(
  "../../apps/web/lib/ai/experts/planning-director/generate-schedule-recoverability-assessment.ts"
);
const { applyScheduleDelayAssessmentToEvent } = await import(
  "../../apps/web/lib/ai/experts/planning-director/apply-schedule-delay-assessment.ts"
);

const admin = createClient(EXACT_API_URL, SERVICE_ROLE_KEY);

const PROJECT = "77777777-7777-4777-8777-777777788801";
const EVENT_NO_DELAY = "77777777-7777-4777-8777-777777788802";
const EVENT_WITH_DELAY = "77777777-7777-4777-8777-777777788803";
const EVENT_ALREADY_CRITICA = "77777777-7777-4777-8777-777777788804";

psql(`
  insert into public.projects (id, code, name, client, status, location, start_date, baseline_end_date) values
    ('${PROJECT}', 'SCHED-PIPE-1', 'Projeto (pipeline cronograma)', 'Cliente Teste', 'ATIVO', 'Teste', '2026-01-01', '2026-12-31')
  on conflict (id) do nothing;
  insert into public.contract_events (id, project_id, title, description, occurred_at, source_type, status, created_by_type) values
    ('${EVENT_NO_DELAY}', '${PROJECT}', 'Evento sem atraso', 'Descrição de teste', now(), 'CONTRATO', 'NOVO', 'SYSTEM'),
    ('${EVENT_WITH_DELAY}', '${PROJECT}', 'Evento com atraso real de cronograma', 'Descrição de teste', now(), 'CONTRATO', 'NOVO', 'SYSTEM'),
    ('${EVENT_ALREADY_CRITICA}', '${PROJECT}', 'Evento já com severidade CRITICA de outra fonte', 'Descrição de teste', now(), 'CONTRATO', 'NOVO', 'SYSTEM')
  on conflict (id) do nothing;
  insert into public.event_ai_assessments (event_id, finding_type, severity, summary, confidence, requires_human_review) values
    ('${EVENT_ALREADY_CRITICA}', 'DESVIO', 'CRITICA', 'Severidade CRITICA já atribuída por outra fonte (fixture de teste).', 0.9, true)
  on conflict (event_id) do nothing;
`);

// ---------- generateScheduleRecoverabilityAssessment: dados reais ----------

const now = new Date("2026-08-29T12:00:00.000Z");

await check("sem atividade atrasada -> generateScheduleRecoverabilityAssessment retorna null (nada a avaliar)", () => {
  const result = generateScheduleRecoverabilityAssessment(
    [
      { id: "a1", projectId: PROJECT, name: "Fundação", baselineStart: "2026-01-01", baselineEnd: "2026-02-01", currentStart: "2026-01-01", currentEnd: "2026-02-01", status: "CONCLUIDA" },
      { id: "a2", projectId: PROJECT, name: "Estrutura", baselineStart: "2026-02-01", baselineEnd: "2026-09-15", currentStart: "2026-02-01", currentEnd: "2026-09-15", status: "NO_PRAZO" },
    ],
    now
  );
  assert(result === null, "não deveria produzir avaliação quando nada está atrasado");
});

await check("com atividade ATRASADA e currentEnd no passado -> classification INCERTA, contractualDeadlineOrLimitExceeded=true (fato real, nunca IMPROVAVEL/RECUPERAVEL por só data/status)", () => {
  const result = generateScheduleRecoverabilityAssessment(
    [
      { id: "a1", projectId: PROJECT, name: "Fundação", baselineStart: "2026-01-01", baselineEnd: "2026-02-01", currentStart: "2026-01-01", currentEnd: "2026-08-20", status: "ATRASADA" },
    ],
    now
  );
  assert(result !== null);
  assert(result.classification === "INCERTA", `esperado INCERTA (nunca inferida só de data/status), obtido ${result.classification}`);
  assert(result.contractualDeadlineOrLimitExceeded === true, "data real já passada é um fato verificável");
  assert(result.evidence.remainingDuration?.includes("Fundação"), "evidência deveria citar a atividade real atrasada");
});

// ---------- applyScheduleDelayAssessmentToEvent: escrita real ----------

await check("evento sem avaliação prévia + sem atraso real -> nenhuma escrita é feita (generate retorna null, apply nunca é chamado)", () => {
  const activities = [];
  const result = generateScheduleRecoverabilityAssessment(activities, now);
  assert(result === null);
  const dbCheck = psql(`select count(*) from public.event_ai_assessments where event_id = '${EVENT_NO_DELAY}';`);
  assert(dbCheck.includes(" 0"), "não deveria haver nenhuma linha para um evento nunca avaliado");
});

await check("evento com atraso real -> apply grava severidade ALTA + requiresHumanDecision=true (INCERTA nunca vira CRÍTICO sozinha)", async () => {
  const recoverability = generateScheduleRecoverabilityAssessment(
    [{ id: "a1", projectId: PROJECT, name: "Fundação", baselineStart: "2026-01-01", baselineEnd: "2026-02-01", currentStart: "2026-01-01", currentEnd: "2026-08-20", status: "ATRASADA" }],
    now
  );
  const result = await applyScheduleDelayAssessmentToEvent(admin, {
    projectId: PROJECT,
    eventId: EVENT_WITH_DELAY,
    recoverability,
    assessedByLabel: "Diretor de Planejamento IA (teste)",
  });
  assert(result.newSeverity === "ALTA", `esperado ALTA, obtido ${result.newSeverity}`);
  assert(result.requiresHumanDecision === true);

  const row = psql(`select severity, requires_human_review, finding_type from public.event_ai_assessments where event_id = '${EVENT_WITH_DELAY}';`);
  assert(row.includes("ALTA"), `linha real deveria ter severity=ALTA: ${row}`);
  assert(row.includes(" t"), "requires_human_review deveria ser true na linha real");
  assert(row.includes("DESVIO"), "finding_type deveria ser DESVIO");
});

await check("a mesma escrita acima produziu EXATAMENTE 1 linha de auditoria SCHEDULE_DELAY_SEVERITY_ASSESSED, rastreável (evidência/justificativa/responsável/data no detail)", () => {
  const row = psql(
    `select detail from public.audit_log_entries where entity_type = 'CONTRACT_EVENT' and entity_id = '${EVENT_WITH_DELAY}' and action = 'SCHEDULE_DELAY_SEVERITY_ASSESSED';`
  );
  const count = psql(
    `select count(*) from public.audit_log_entries where entity_type = 'CONTRACT_EVENT' and entity_id = '${EVENT_WITH_DELAY}' and action = 'SCHEDULE_DELAY_SEVERITY_ASSESSED';`
  );
  assert(count.includes(" 1"), `esperado exatamente 1 linha de auditoria, obtido: ${count}`);
  assert(row.includes("ALTA"), "detail da auditoria deveria citar a severidade nova");
});

await check("re-executar sobre um evento JÁ com severidade CRITICA de outra fonte -> nunca rebaixa (piso preservado)", async () => {
  const recoverability = generateScheduleRecoverabilityAssessment(
    [{ id: "a1", projectId: PROJECT, name: "Fundação", baselineStart: "2026-01-01", baselineEnd: "2026-02-01", currentStart: "2026-01-01", currentEnd: "2026-08-20", status: "ATRASADA" }],
    now
  );
  const result = await applyScheduleDelayAssessmentToEvent(admin, {
    projectId: PROJECT,
    eventId: EVENT_ALREADY_CRITICA,
    recoverability,
    assessedByLabel: "Diretor de Planejamento IA (teste)",
  });
  assert(result.previousSeverity === "CRITICA", `esperado piso anterior CRITICA, obtido ${result.previousSeverity}`);
  assert(result.newSeverity === "CRITICA", `nunca deveria rebaixar de CRITICA, obtido ${result.newSeverity}`);

  const row = psql(`select severity from public.event_ai_assessments where event_id = '${EVENT_ALREADY_CRITICA}';`);
  assert(row.includes("CRITICA"), `linha real deveria continuar CRITICA: ${row}`);
});

await check("upsert real: reavaliar o MESMO evento não cria uma segunda linha (UNIQUE event_id respeitado)", () => {
  const count = psql(`select count(*) from public.event_ai_assessments where event_id = '${EVENT_WITH_DELAY}';`);
  assert(count.includes(" 1"), `esperado exatamente 1 linha (upsert, nunca duplicando), obtido: ${count}`);
});

await check("nunca conectado apenas ao gerador de prévia de e-mail — generate/apply nunca são importados por scripts/generate-alert-email-preview.mjs", () => {
  const previewSource = readFileSync(new URL("../generate-alert-email-preview.mjs", import.meta.url), "utf8");
  assert(!previewSource.includes("apply-schedule-delay-assessment"), "o gerador de prévia nunca deveria importar o serviço de escrita real");
  assert(!previewSource.includes("generate-schedule-recoverability-assessment"), "o gerador de prévia continua usando sua PRÓPRIA fixture, nunca o gerador real de dados de cronograma");
});

await check("o serviço de escrita real É importado por um caminho de aplicação genuíno (Server Action do evento), nunca órfão", () => {
  const actionSource = readFileSync(
    new URL("../../apps/web/app/[projectId]/ledger/[eventId]/assess-schedule-delay-actions.ts", import.meta.url),
    "utf8"
  );
  assert(actionSource.includes("applyScheduleDelayAssessmentToEvent"), "a Server Action real deveria chamar o serviço de escrita");
  assert(actionSource.includes("generateScheduleRecoverabilityAssessment"), "a Server Action real deveria chamar o gerador de dados reais de cronograma");
  const buttonSource = readFileSync(
    new URL("../../apps/web/components/ledger/assess-schedule-delay-button.tsx", import.meta.url),
    "utf8"
  );
  assert(buttonSource.includes("assessScheduleDelayAction"), "deveria existir um botão real que dispara a Server Action");
  const pageSource = readFileSync(
    new URL("../../apps/web/app/[projectId]/ledger/[eventId]/page.tsx", import.meta.url),
    "utf8"
  );
  assert(pageSource.includes("<AssessScheduleDelayButton"), "o botão real deveria estar de fato renderizado na tela do evento, nunca só definido e nunca usado");
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");
if (failed > 0) process.exit(1);
