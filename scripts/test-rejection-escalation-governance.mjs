// Testes da governança de rejeição de recomendações/findings relevantes
// (apps/web/lib/governance/reject-relevant-recommendation.ts) — a IA
// recomenda, o humano decide, mas rejeitar ALTO/CRÍTICO nunca pode ser
// silencioso.
//
// Duas partes, deliberadamente separadas:
//
// PARTE A — lógica pura executada de verdade (validação de
// justificativa, compatibilidade de severidade inferior, e verificação
// de que os arquivos TS não duplicam a regra em mais de um lugar).
// Nenhuma chamada a Supabase — mesmo princípio de todo o resto da
// suíte quando a lógica é pura.
//
// PARTE B — checagem ESTRUTURAL da migration
// (20260904120000_rejection_escalation_governance.sql) contra o texto
// SQL real: existência e forma exatas da constraint, do índice único,
// do motivo de escalonamento novo e da função reject_relevant_finding —
// mesmo padrão já usado por outras suítes deste projeto para validar
// schema/migração antes de aplicação real (ex.:
// test-construmanager-content-targeting.mjs para o Pacote C).
//
// IMPORTANTE — o que este arquivo NÃO faz: esta migration não foi
// aplicada em nenhum Supabase remoto nesta etapa (restrição explícita
// do pedido). Portanto nenhum teste aqui exercita reject_relevant_finding
// contra um banco real — isso exigiria aplicar a migration a um projeto
// remoto, o que está fora do escopo autorizado desta implementação. A
// prova de comportamento contra banco real (idempotência sob concorrência
// de verdade, trigger de auditoria disparando, atomicidade da transação)
// fica pendente do próximo passo manual: aplicar esta migration ao
// Supabase de referência e então rodar a Parte C (não incluída aqui).
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/test-rejection-escalation-governance.mjs

import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const { isRelevantRecommendationSeverity, validateRejectionJustification, RELEVANT_RECOMMENDATION_SEVERITIES } = await import(
  "../apps/web/lib/governance/reject-relevant-recommendation"
);

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
console.log("GOVERNANÇA DE REJEIÇÃO DE RECOMENDAÇÕES RELEVANTES — TESTES");
console.log("======================================");
console.log("");

// ============================================================
// PARTE A — lógica pura (executada de verdade, sem Supabase)
// ============================================================

check("RELEVANT_RECOMMENDATION_SEVERITIES usa exatamente o enum já existente (HIGH/CRITICAL) — nenhum enum novo", () => {
  assert(RELEVANT_RECOMMENDATION_SEVERITIES.length === 2);
  assert(RELEVANT_RECOMMENDATION_SEVERITIES.includes("HIGH"));
  assert(RELEVANT_RECOMMENDATION_SEVERITIES.includes("CRITICAL"));
});

check("isRelevantRecommendationSeverity: LOW/MEDIUM nunca são relevantes", () => {
  assert(isRelevantRecommendationSeverity("LOW") === false);
  assert(isRelevantRecommendationSeverity("MEDIUM") === false);
});

check("isRelevantRecommendationSeverity: HIGH/CRITICAL são relevantes", () => {
  assert(isRelevantRecommendationSeverity("HIGH") === true);
  assert(isRelevantRecommendationSeverity("CRITICAL") === true);
});

// ---- cenário 1/2/3: ALTO + REJECTED + NULL/""/"   " -> falha ----

check("ALTO + reviewer_note NULL -> inválido", () => {
  const result = validateRejectionJustification("HIGH", null);
  assert(result.valid === false);
  assert(typeof result.error === "string" && result.error.length > 0);
});

check('ALTO + reviewer_note "" -> inválido', () => {
  const result = validateRejectionJustification("HIGH", "");
  assert(result.valid === false);
});

check('ALTO + reviewer_note "   " (só espaços/tabs) -> inválido', () => {
  const result = validateRejectionJustification("HIGH", "   \t  \n ");
  assert(result.valid === false);
});

// ---- cenário 4: CRÍTICO nos mesmos três cenários -> falha ----

check("CRÍTICO + reviewer_note NULL -> inválido", () => {
  assert(validateRejectionJustification("CRITICAL", null).valid === false);
});

check('CRÍTICO + reviewer_note "" -> inválido', () => {
  assert(validateRejectionJustification("CRITICAL", "").valid === false);
});

check('CRÍTICO + reviewer_note "   " -> inválido', () => {
  assert(validateRejectionJustification("CRITICAL", "    ").valid === false);
});

// ---- cenário 5: ALTO/CRÍTICO + justificativa válida -> sucesso ----

check("ALTO + justificativa real -> válido", () => {
  const result = validateRejectionJustification("HIGH", "Risco já mitigado por aditivo assinado em 2026-08-10, cláusula 4.2.");
  assert(result.valid === true);
  assert(result.error === null);
});

check("CRÍTICO + justificativa real -> válido", () => {
  const result = validateRejectionJustification("CRITICAL", "Divergência confirmada como erro de digitação do Expert, corrigido no e-mail anexo.");
  assert(result.valid === true);
});

// ---- cenário 9: severidade inferior mantém comportamento anterior ----

check("LOW + reviewer_note NULL -> válido (nunca exige justificativa)", () => {
  assert(validateRejectionJustification("LOW", null).valid === true);
});

check("MEDIUM + reviewer_note vazio -> válido (nunca exige justificativa)", () => {
  assert(validateRejectionJustification("MEDIUM", "").valid === true);
});

// ---- unificação: updateFindingLifecycle delega REJECTED, não duplica a regra ----

check("updateFindingLifecycle delega REJECTED a rejectAiFinding (não duplica a regra de justificativa)", () => {
  const source = readSource("apps/web/lib/additionals/findings/update-finding-lifecycle.ts");
  assert(source.includes('rejectAiFinding'), "deveria importar/chamar rejectAiFinding");
  assert(source.includes('input.lifecycleStatus === "REJECTED"'), "deveria ramificar explicitamente para REJECTED");
  // Garantia negativa: a checagem de justificativa NÃO é reimplementada
  // neste arquivo (não existe outra ocorrência de validação de espaço em
  // branco fora do módulo central).
  assert(!/\\S/.test(source.replace(/\/\/.*$/gm, "")), "não deveria reimplementar a regex de justificativa aqui");
});

check("dismissHistoricalFinding permanece inalterado (comportamento de justificativa obrigatória preservado)", () => {
  const source = readSource("apps/web/lib/startup/dismiss-historical-finding.ts");
  assert(source.includes('lifecycle_status: "DISMISSED_AT_STARTUP"'));
  assert(source.includes("Justificativa é obrigatória para desconsiderar um finding histórico."));
  assert(!source.includes("rejectAiFinding"), "dismissHistoricalFinding nunca deveria chamar o módulo de rejeição — são fluxos distintos");
});

check("AdditionalProposalApprovalsForm: gap de severidade documentado, nenhuma regra inventada no componente React", () => {
  const actionSource = readSource("apps/web/lib/additionals/update-additional-proposal-approvals.ts");
  assert(actionSource.includes("GAP CONHECIDO"), "a lacuna de dado (sem severidade) precisa estar documentada explicitamente");

  // Só a função em si (depois do bloco de comentário do topo) não pode
  // ter ganhado uma checagem de severidade nova — a menção a
  // HIGH/CRITICAL no comentário explicativo do gap é esperada e não
  // conta como "regra inventada".
  const functionBody = actionSource.slice(actionSource.indexOf("export async function"));
  assert(!functionBody.includes("HIGH") && !functionBody.includes("CRITICAL"), "a função não deveria ganhar uma checagem de severidade sem coluna real no schema");
  assert(!functionBody.includes("rejectAiFinding"), "propostas não devem ser roteadas para o módulo de ai_findings — são entidades distintas");

  const formSource = readSource("apps/web/components/additionals/additional-proposal-approvals-form.tsx");
  assert(!formSource.includes("reviewerNote") && !formSource.includes("justificativa"), "a regra de justificativa nunca deveria ser implementada só no componente React");
});

console.log("");

// ============================================================
// PARTE B — checagem estrutural da migration (SQL real, não aplicada)
// ============================================================

const migrationPath = "supabase/migrations/20260904120000_rejection_escalation_governance.sql";
const migration = readSource(migrationPath);

check("migration é aditiva: nenhum DROP TABLE/COLUMN, nenhum TRUNCATE/DELETE de dado existente", () => {
  assert(!/drop\s+table/i.test(migration));
  assert(!/drop\s+column/i.test(migration));
  assert(!/truncate/i.test(migration));
  assert(!/delete\s+from/i.test(migration));
});

check("ai_findings.severity e sla_actions.risk_level continuam o mesmo enum reaproveitado (nenhum enum novo de risco)", () => {
  assert(!/create\s+type/i.test(migration), "nenhum novo enum de banco deveria ser criado");
  assert(migration.includes("'HIGH', 'CRITICAL'"), "a constraint deveria referenciar exatamente os valores já existentes");
});

check("constraint de justificativa obrigatória existe em ai_findings e cobre NULL/vazio/só-espaços via regex \\S", () => {
  assert(migration.includes("ai_findings_high_risk_rejection_requires_justification"));
  assert(migration.includes("lifecycle_status = 'REJECTED' and severity in ('HIGH', 'CRITICAL')"));
  assert(migration.includes("reviewer_note ~ '\\S'"), "deveria usar a mesma regex \\S da validação em TS");
});

check("severidades LOW/MEDIUM e outros lifecycle_status não são restringidos pela nova constraint (compatibilidade preservada)", () => {
  // A constraint só se aplica dentro do "not (...)" — nenhuma outra
  // cláusula da migration deveria mencionar LOW/MEDIUM como bloqueados.
  assert(!/severity\s+in\s*\('LOW'/i.test(migration));
});

check("novo motivo de escalonamento é aditivo ao enum fechado existente (RELEVANT_RECOMMENDATION_REJECTED)", () => {
  assert(migration.includes("RELEVANT_RECOMMENDATION_REJECTED"));
  // Os seis motivos originais continuam presentes — nenhum foi removido.
  for (const original of [
    "NO_ACKNOWLEDGMENT",
    "NOT_RESPONDED",
    "NOT_COMPLETED",
    "CONTRACTUAL_DEADLINE_NEAR",
    "CONTRACTUAL_DEADLINE_MISSED",
    "NEW_EVIDENCE_INCREASED_RISK",
  ]) {
    assert(migration.includes(original), `motivo original ${original} não deveria ser removido`);
  }
});

check("nenhum motor paralelo de escalonamento: reject_relevant_finding reutiliza escalate_sla_action já existente", () => {
  const fnMatch = migration.match(/create or replace function public\.reject_relevant_finding[\s\S]*?\$\$;/);
  assert(fnMatch, "função reject_relevant_finding deveria existir");
  const fnBody = fnMatch[0];
  assert(fnBody.includes("public.escalate_sla_action("), "deveria chamar a RPC de escalonamento já existente");
  assert(!fnBody.includes("current_escalation_level ="), "não deveria mudar o nível de escalonamento diretamente — só via escalate_sla_action()");
});

check("reject_relevant_finding cria exatamente uma sla_action por chamada (nunca em loop, nunca duas)", () => {
  const fnMatch = migration.match(/create or replace function public\.reject_relevant_finding[\s\S]*?\$\$;/);
  const fnBody = fnMatch[0];
  const insertCount = (fnBody.match(/insert into public\.sla_actions/g) ?? []).length;
  assert(insertCount === 1, `esperado exatamente 1 INSERT em sla_actions, encontrado ${insertCount}`);
});

check("idempotência: reject_relevant_finding trava a linha do finding (FOR UPDATE) e trata REJECTED repetido sem duplicar", () => {
  const fnMatch = migration.match(/create or replace function public\.reject_relevant_finding[\s\S]*?\$\$;/);
  const fnBody = fnMatch[0];
  assert(fnBody.includes("for update"), "deveria travar a linha do finding para serializar chamadas concorrentes");
  assert(fnBody.includes("v_finding.lifecycle_status = 'REJECTED'"), "deveria checar se já está rejeitado antes de criar nova ação");
  assert(fnBody.includes("already_existed"), "deveria sinalizar explicitamente ao chamador que nada novo foi criado");
});

check("idempotência (defesa em profundidade): índice único parcial em sla_actions.related_ai_finding_id", () => {
  assert(migration.includes("create unique index sla_actions_related_ai_finding_id_key"));
  assert(migration.includes("where related_ai_finding_id is not null"));
});

check("vínculo identifica a recomendação de origem: related_ai_finding_id + origin = 'AI_FINDING' na mesma linha inserida", () => {
  const fnMatch = migration.match(/create or replace function public\.reject_relevant_finding[\s\S]*?\$\$;/);
  const fnBody = fnMatch[0];
  assert(fnBody.includes("'AI_FINDING'"));
  assert(fnBody.includes("related_ai_finding_id"));
});

check("nenhuma auditoria paralela criada — a migration não cria nenhum novo trigger/tabela de auditoria", () => {
  assert(!/create\s+table\s+public\.audit/i.test(migration));
  assert(!/create trigger/i.test(migration), "nenhum trigger novo deveria ser necessário — a rejeição só aciona os triggers já existentes (ai_findings/sla_actions)");
});

check("permissão exigida: EDITOR (mesmo nível já usado por ai_findings UPDATE e sla_actions INSERT)", () => {
  const fnMatch = migration.match(/create or replace function public\.reject_relevant_finding[\s\S]*?\$\$;/);
  const fnBody = fnMatch[0];
  assert(fnBody.includes("has_project_permission(v_finding.project_id, 'EDITOR')"));
});

check("execução restrita a authenticated (revoke de public/anon), mesmo padrão de escalate_sla_action", () => {
  assert(migration.includes("revoke all on function public.reject_relevant_finding") && migration.includes("from public"));
  assert(migration.includes("grant execute on function public.reject_relevant_finding") && migration.includes("to authenticated"));
});

console.log("");
console.log("--- honestidade sobre o que NÃO foi verificado nesta sessão ---");
console.log("NOTA (não é falha): idempotência sob concorrência real, disparo efetivo dos");
console.log("triggers de auditoria e atomicidade da transação em Postgres real dependem");
console.log("de aplicar esta migration a um Supabase — fora do escopo autorizado agora.");
console.log("");

console.log("======================================");
console.log(`Resultado: ${passed} passaram, ${failed} falharam.`);
console.log("======================================");

if (failed > 0) process.exit(1);
