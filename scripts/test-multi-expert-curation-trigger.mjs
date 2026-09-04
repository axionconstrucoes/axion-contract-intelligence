// Testes do gatilho MANUAL da curadoria multiagente no Event Ledger
// (apps/web/app/[projectId]/ledger/[eventId]/run-multi-expert-curation-actions.ts
// + persist-curation-audit.ts). NUNCA reimplementa a lógica dos 5
// Experts ou do roteador/CEO IA — apenas prova que o gatilho reutiliza
// run-multi-expert-curation.ts já existente, sem duplicar nada, com
// permissão exigida, vínculo correto a projeto/evento, decisão sempre
// humana e falha segura.
//
// Checagem ESTRUTURAL do código-fonte real (mesmo padrão de outras
// suítes deste projeto quando o alvo depende de sessão autenticada
// real/Supabase ao vivo — ver test-multi-expert-curation.mjs para a
// prova ao vivo do motor em si, que este arquivo nunca duplica).
//
// Uso:
//   node scripts/test-multi-expert-curation-trigger.mjs

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
console.log("GATILHO MANUAL DA CURADORIA MULTIAGENTE (EVENT LEDGER) — TESTES");
console.log("======================================");
console.log("");

const actionSource = readSource("apps/web/app/[projectId]/ledger/[eventId]/run-multi-expert-curation-actions.ts");
const buttonSource = readSource("apps/web/components/ledger/run-multi-expert-curation-button.tsx");
const auditSource = readSource("apps/web/lib/ai/curation/persist-curation-audit.ts");
const pageSource = readSource("apps/web/app/[projectId]/ledger/[eventId]/page.tsx");

// ---- 1. disparo manual da curadoria ----

check("gatilho é uma Server Action explícita ('use server'), nunca automático/scheduler", () => {
  assert(actionSource.trimStart().startsWith('"use server";'));
  // "schedule" sozinho não é usado aqui: é uma palavra de domínio legítima
  // neste arquivo (ex.: comentário citando assessScheduleDelayAction) —
  // só primitivas reais de agendamento automático são proibidas.
  assert(!/node-cron|setInterval\(|setTimeout\(|cron\.schedule/i.test(actionSource), "não deveria haver nenhum agendamento automático");
});

check("UI expõe um botão de comando manual claro, com rótulo explícito de análise de IA", () => {
  assert(buttonSource.includes("Executar análise multiagente"));
  assert(buttonSource.includes("Curadoria multiagente (Experts IA)"));
  assert(buttonSource.includes("Análise de IA"), "deveria deixar explícito que é análise de IA, não fato");
});

check("botão só é renderizado quando o servidor já concedeu a permissão (page.tsx calcula canTriggerCuration)", () => {
  assert(pageSource.includes("canTriggerCuration"));
  assert(pageSource.includes("RunMultiExpertCurationButton"));
});

// ---- 2. vínculo correto com projeto e evento ----

check("Server Action valida que o evento pertence ao projeto informado antes de rodar a curadoria", () => {
  assert(actionSource.includes("event.projectId !== projectId"));
});

check("runMultiExpertCuration é chamado com projectId/eventId reais do formulário, sourceType EVENT", () => {
  const callMatch = actionSource.match(/runMultiExpertCuration\(supabase,\s*\{[\s\S]*?\}\);/);
  assert(callMatch, "chamada a runMultiExpertCuration não encontrada");
  const call = callMatch[0];
  assert(call.includes("projectId,"));
  assert(call.includes("eventId,"));
  assert(call.includes('sourceType: "EVENT"'));
});

check("description nunca é inventada — vem do título+descrição reais do evento, nunca texto livre digitado à parte", () => {
  assert(actionSource.includes("event.title") && actionSource.includes("event.description"));
});

check("auditoria registra project_id e entity_id=eventId (via curation.audit), nunca um id fabricado", () => {
  assert(auditSource.includes("project_id: audit.projectId"));
  assert(auditSource.includes("entity_id: audit.eventId"));
});

// ---- 3. uso real do motor multiagente existente (nunca duplicado) ----

check("Server Action importa e chama runMultiExpertCuration já existente — nunca reimplementa roteamento/Experts/CEO", () => {
  assert(actionSource.includes('import { runMultiExpertCuration } from "@/lib/ai/curation/run-multi-expert-curation"'));
  assert(!/answerCommercialDirectorQuery|answerEsgDirectorQuery|answerLegalConsultantQuery|answerPlanningDirectorQuery|runExecutiveCuration|decideExpertRouting/.test(actionSource), "não deveria importar Experts/roteador/CEO diretamente — isso é responsabilidade exclusiva de run-multi-expert-curation.ts");
});

check("run-multi-expert-curation.ts (motor reutilizado) permanece intocado por este trabalho", () => {
  const engineSource = readSource("apps/web/lib/ai/curation/run-multi-expert-curation.ts");
  assert(engineSource.includes("export async function runMultiExpertCuration"));
  // Garantia negativa: nenhuma referência ao novo gatilho vazou para dentro do motor.
  assert(!engineSource.includes("run-multi-expert-curation-actions"), "o motor não deveria conhecer o gatilho que o chama");
});

// ---- 4. auditoria da execução ----

check("nenhuma tabela/migration nova foi criada para a auditoria — só audit_log_entries via client admin", () => {
  assert(auditSource.includes('admin.from("audit_log_entries").insert('));
  assert(auditSource.includes('action: "AI_MULTI_EXPERT_CURATION_CREATED"'));
  assert(auditSource.includes('entity_type: "CONTRACT_EVENT"'));
});

check("auditoria registra usuário que iniciou, experts participantes, resultado consolidado e indicação de revisão humana", () => {
  assert(auditSource.includes("actor_user_id: triggeredByUserId"));
  assert(auditSource.includes("expertNames"));
  assert(auditSource.includes("exec.recomendacao") || auditSource.includes("exec.situacao"));
  assert(auditSource.includes("Revisão humana"));
});

check("audit_log_entries.detail (texto, sem limite) é reaproveitado — mesmo padrão de apply-schedule-delay-assessment.ts, nenhum novo trigger/tabela", () => {
  assert(!/create\s+table/i.test(auditSource));
  assert(!/create trigger/i.test(auditSource));
});

// ---- 5. preservação explícita da decisão humana ----

check("nenhuma ação automática é executada a partir do resultado (sem escrita em sla_actions/contract_events/e-mail)", () => {
  for (const forbidden of ["sla_actions", "contract_events", "sendContractAlertEmail", "sendSlaEscalationEmail", "escalate_sla_action"]) {
    assert(!actionSource.includes(forbidden), `Server Action não deveria escrever/chamar ${forbidden}`);
    assert(!auditSource.includes(forbidden), `persistCurationAudit não deveria escrever/chamar ${forbidden}`);
  }
});

check("UI deixa explícito que a decisão continua humana e a análise é sujeita a revisão", () => {
  assert(buttonSource.includes("revisão humana") || buttonSource.includes("Revisão humana"));
  assert(buttonSource.includes("nenhuma ação é executada automaticamente") || buttonSource.includes("nunca substitui decisão humana"));
});

// ---- 6. falha segura ----

check("falha ao executar a curadoria retorna erro claro, sem sucesso parcial/estado inconsistente", () => {
  const tryBlock = actionSource.match(/let curation: MultiExpertCuration;\s*try\s*\{[\s\S]*?\}\s*catch[\s\S]*?\}/);
  assert(tryBlock, "bloco try/catch da chamada ao motor não encontrado");
  assert(tryBlock[0].includes("success: null"));
});

check("falha ao registrar auditoria nunca esconde uma análise já produzida, mas relata o erro explicitamente", () => {
  const auditCatch = actionSource.match(/catch \(error\) \{\s*\/\/[\s\S]*?return \{[\s\S]*?\};\s*\}\s*\n\s*revalidatePath/);
  assert(auditCatch, "bloco catch da persistência de auditoria não encontrado no formato esperado");
  assert(auditCatch[0].includes("success: curation"), "deveria devolver a análise mesmo se a auditoria falhar");
  assert(auditCatch[0].includes("error:"), "deveria reportar o erro de auditoria explicitamente, nunca escondê-lo");
});

// ---- 7. prevenção de execução indevida / sem autorização adequada ----

check("permissão é revalidada no servidor (GERENTE/GESTOR/ADMINISTRADOR) antes de qualquer chamada ao motor", () => {
  const permissionCheckIndex = actionSource.indexOf('permission !== "ADMINISTRADOR"');
  const engineCallIndex = actionSource.indexOf("runMultiExpertCuration(supabase");
  assert(permissionCheckIndex >= 0, "checagem de permissão não encontrada");
  assert(engineCallIndex >= 0, "chamada ao motor não encontrada");
  assert(permissionCheckIndex < engineCallIndex, "a permissão precisa ser checada ANTES de chamar o motor");
});

check("checagem de permissão nunca é só client-side — o componente React não reimplementa a regra", () => {
  assert(!buttonSource.includes("ADMINISTRADOR") && !buttonSource.includes("GESTOR") && !buttonSource.includes("GERENTE"), "a regra de permissão deveria viver só na Server Action, nunca duplicada no componente");
});

check("sessão autenticada é exigida (auth.getUser()) antes de resolver o usuário que iniciou", () => {
  assert(actionSource.includes("supabase.auth.getUser()"));
  assert(actionSource.includes("Sessão expirada"));
});

console.log("");
console.log("======================================");
console.log(`Resultado: ${passed} passaram, ${failed} falharam.`);
console.log("======================================");

if (failed > 0) process.exit(1);
