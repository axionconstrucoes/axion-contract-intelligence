// Testes da governança de rejeição de recomendações/findings relevantes
// (apps/web/lib/governance/reject-relevant-recommendation.ts) — a IA
// recomenda, o humano decide, mas rejeitar ALTO/CRÍTICO nunca pode ser
// silencioso.
//
// Três partes, deliberadamente separadas:
//
// PARTE A — lógica pura executada de verdade (validação de
// justificativa, compatibilidade de severidade inferior, e verificação
// de que os arquivos TS não duplicam a regra em mais de um lugar).
// Nenhuma chamada a Supabase — mesmo princípio de todo o resto da
// suíte quando a lógica é pura.
//
// PARTE B — checagem ESTRUTURAL da migration original (checkpoint 1,
// 20260904120000_rejection_escalation_governance.sql) contra o texto
// SQL real: existência e forma exatas da constraint, do índice único,
// do motivo de escalonamento novo e da função reject_relevant_finding —
// mesmo padrão já usado por outras suítes deste projeto para validar
// schema/migração antes de aplicação real (ex.:
// test-construmanager-content-targeting.mjs para o Pacote C).
//
// PARTE C — checkpoint 2 (fechamento de lacunas):
// 20260904130000_rejection_escalation_governance_hardening.sql —
// invariante de banco (constraint triggers DEFERRABLE) e transparência
// do superior hierárquico (escalation_target_user_id/_resolved). Mesma
// checagem estrutural; ver a nota de honestidade ao final do arquivo
// para o que NÃO pôde ser exercitado contra Postgres real nesta sessão.
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

// ============================================================
// PARTE C — checkpoint 2: hardening (invariante de banco + transparência
// do superior hierárquico), migration
// 20260904130000_rejection_escalation_governance_hardening.sql
// ============================================================

const hardeningPath = "supabase/migrations/20260904130000_rejection_escalation_governance_hardening.sql";
const hardening = readSource(hardeningPath);

check("hardening é aditiva: nenhum DROP TABLE/COLUMN, nenhum TRUNCATE/DELETE de dado existente", () => {
  assert(!/drop\s+table/i.test(hardening));
  assert(!/drop\s+column/i.test(hardening));
  assert(!/truncate/i.test(hardening));
  assert(!/delete\s+from/i.test(hardening));
  assert(!/create\s+type/i.test(hardening), "nenhum novo enum de banco deveria ser criado");
});

check("pré-voo: migration falha alto e cedo se dado pré-existente já violar o invariante, antes de criar os triggers", () => {
  const preflightIndex = hardening.indexOf("do $$");
  const triggerIndex = hardening.indexOf("create constraint trigger");
  assert(preflightIndex >= 0, "bloco DO de pré-voo não encontrado");
  assert(triggerIndex >= 0, "nenhum constraint trigger encontrado");
  assert(preflightIndex < triggerIndex, "o pré-voo precisa rodar ANTES de instalar os triggers");
  assert(hardening.includes("ai_findings f") && hardening.includes("not exists (select 1 from public.sla_actions sa where sa.related_ai_finding_id = f.id)"));
});

check("invariante é DEFERRABLE INITIALLY DEFERRED nos dois lados — nunca um AFTER trigger imediato", () => {
  const triggerBlocks = hardening.match(/create constraint trigger[\s\S]*?execute function[^;]*;/g) ?? [];
  assert(triggerBlocks.length === 2, `esperados 2 constraint triggers, encontrados ${triggerBlocks.length}`);
  for (const block of triggerBlocks) {
    assert(block.includes("deferrable initially deferred"), `constraint trigger sem DEFERRABLE INITIALLY DEFERRED: ${block.slice(0, 80)}...`);
  }
});

check("trigger de ai_findings dispara em INSERT OR UPDATE (cobre também um INSERT direto já REJECTED)", () => {
  assert(/create constraint trigger ai_findings_enforce_rejection_escalation\s*\nafter insert or update on public\.ai_findings/.test(hardening));
});

check("trigger de sla_actions só dispara em DELETE ou UPDATE OF related_ai_finding_id — nunca em todo UPDATE (não penaliza assumir/concluir/escalonar)", () => {
  assert(/create constraint trigger sla_actions_enforce_rejection_escalation_link\s*\nafter delete or update of related_ai_finding_id on public\.sla_actions/.test(hardening));
});

check("os dois triggers chamam o MESMO helper único — nenhuma regra duplicada entre ai_findings e sla_actions", () => {
  const helperCalls = (hardening.match(/perform public\.assert_high_risk_rejection_has_escalation\(/g) ?? []).length;
  assert(helperCalls === 2, `esperadas exatamente 2 chamadas ao helper (uma por trigger function), encontradas ${helperCalls}`);
});

check("helper função nunca inventa/cria dado — só SELECT/EXISTS, nunca INSERT/UPDATE/DELETE", () => {
  const fnMatch = hardening.match(/create or replace function public\.assert_high_risk_rejection_has_escalation[\s\S]*?\$\$;/);
  assert(fnMatch, "função helper não encontrada");
  const body = fnMatch[0];
  assert(!/insert into|update public\.|delete from/i.test(body));
});

check("reject_relevant_finding (v2): DROP + CREATE (mudança de retorno), reutiliza escalate_sla_action sem tocar current_escalation_level diretamente", () => {
  assert(hardening.includes("drop function if exists public.reject_relevant_finding(uuid, text, text, timestamptz, timestamptz, timestamptz);"));
  const fnMatch = hardening.match(/create or replace function public\.reject_relevant_finding[\s\S]*?\n\$\$;/);
  assert(fnMatch, "reject_relevant_finding (v2) não encontrada");
  const fnBody = fnMatch[0];
  assert(fnBody.includes("public.escalate_sla_action("));
  assert(!fnBody.includes("current_escalation_level ="), "não deveria mudar o nível de escalonamento diretamente — só via escalate_sla_action()");
  const insertCount = (fnBody.match(/insert into public\.sla_actions/g) ?? []).length;
  assert(insertCount === 1, `esperado exatamente 1 INSERT em sla_actions, encontrado ${insertCount}`);
});

check("retorno da RPC agora distingue explicitamente superior encontrado x não configurado (escalation_target_user_id/escalation_target_resolved)", () => {
  assert(hardening.includes("escalation_target_user_id uuid"));
  assert(hardening.includes("escalation_target_resolved boolean"));
  const fnMatch = hardening.match(/create or replace function public\.reject_relevant_finding[\s\S]*?\n\$\$;/);
  const fnBody = fnMatch[0];
  // Resolvido lendo de volta sla_action_escalations.notified_user_id —
  // nunca uma segunda lógica de resolução de responsável.
  assert(fnBody.includes("sae.notified_user_id"));
  assert(fnBody.includes("v_target_user_id is not null"), "escalation_target_resolved precisa ser derivado do valor real resolvido, nunca hardcoded true/false");
});

check("caminho idempotente (finding já REJECTED) TAMBÉM devolve o superior já resolvido, não só sla_action_id", () => {
  const fnMatch = hardening.match(/create or replace function public\.reject_relevant_finding[\s\S]*?\n\$\$;/);
  const fnBody = fnMatch[0];
  assert(fnBody.includes("v_existing_target_user_id"));
});

check("caminho LOW/MEDIUM (sem escalonamento) devolve escalation_target_resolved=false explicitamente, nunca omitido", () => {
  const fnMatch = hardening.match(/create or replace function public\.reject_relevant_finding[\s\S]*?\n\$\$;/);
  const fnBody = fnMatch[0];
  assert(fnBody.includes("return query select null::uuid, null::uuid, false, null::uuid, false;"));
});

check("nenhuma pessoa é inventada: target vem sempre de sla_area_responsibles via escalate_sla_action, nunca um literal de e-mail/endereço", () => {
  const fnMatch = hardening.match(/create or replace function public\.reject_relevant_finding[\s\S]*?\n\$\$;/);
  const fnBody = fnMatch[0];
  // Procura só por um e-mail literal de verdade (usuario@dominio) fora de
  // comentário — nunca a palavra "hardcoded" em si, que aparece
  // legitimamente em comentários explicando que o valor NUNCA é fixo.
  const withoutComments = fnBody.replace(/--.*$/gm, "");
  assert(!/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(withoutComments), "não deveria haver nenhum e-mail literal no código executável");
});

check("funções novas (helper + triggers) revogadas de public/anon/authenticated — mesmo padrão de outras trigger functions do projeto", () => {
  assert(hardening.includes("revoke all on function public.assert_high_risk_rejection_has_escalation(uuid) from authenticated;"));
  assert(hardening.includes("revoke all on function public.enforce_high_risk_rejection_escalation() from authenticated;"));
  assert(hardening.includes("revoke all on function public.enforce_sla_action_escalation_link() from authenticated;"));
});

check("TS: RejectAiFindingResult expõe escalationTargetUserId/escalationTargetResolved, consumidos do retorno da RPC (não recalculados em TS)", () => {
  const tsSource = readSource("apps/web/lib/governance/reject-relevant-recommendation.ts");
  assert(tsSource.includes("escalationTargetUserId: string | null"));
  assert(tsSource.includes("escalationTargetResolved: boolean"));
  assert(tsSource.includes("row?.escalation_target_user_id"));
  assert(tsSource.includes("row?.escalation_target_resolved"));
});

// ---- Priority 3 (reconfirmação com evidência) ----

check("Additional Proposals: investigação de fonte canônica de severidade documentada com evidência concreta (não presumida)", () => {
  const source = readSource("apps/web/lib/additionals/update-additional-proposal-approvals.ts");
  assert(source.includes("project_additional_proposal_links"), "deveria registrar a relação com contract_events investigada e descartada");
  assert(source.includes("schedule-formalization-alert.ts") || source.includes("computeScheduleFormalizationAlert"));
  assert(source.includes("closing-gate.ts") || source.includes("computeClosingGateAssessment"));
  assert(source.includes("Evolução mínima de schema"), "deveria propor a evolução mínima sem implementá-la");
  // Garantia negativa: a evolução proposta não foi implementada nesta etapa.
  const functionBody = source.slice(source.indexOf("export async function"));
  assert(!functionBody.includes("risk_severity"), "a coluna proposta não deveria ter sido criada/usada nesta etapa");
});

check("EXPERT_RECOMMENDATION: reconfirmado N/A — formulário manual de criação de sla_actions continua sem lifecycle de rejeição próprio", () => {
  const actionsSource = readSource("apps/web/app/[projectId]/acoes/actions.ts");
  assert(actionsSource.includes('"EXPERT_RECOMMENDATION"'), "origin EXPERT_RECOMMENDATION deveria continuar existindo como etiqueta manual");
  assert(!actionsSource.includes("rejectAiFinding") && !actionsSource.includes("reject_relevant_finding"), "criação manual de sla_actions nunca deveria ganhar um lifecycle de rejeição — não é o mesmo conceito de ai_findings");
});

console.log("");
console.log("--- honestidade: itens que dependem de Postgres real e NÃO foram exercitados ---");
console.log("Docker Desktop não está com o daemon ativo nesta máquina (`docker ps` falha) —");
console.log("`supabase start` (banco local efêmero) não está disponível nesta sessão. Aplicar");
console.log("a migration num Supabase remoto está fora do escopo autorizado. Os itens abaixo");
console.log("foram verificados apenas ESTRUTURALMENTE (leitura do SQL/lógica), NUNCA exercitados");
console.log("contra um Postgres de verdade — não fabricar evidência de execução real:");
console.log("  1/2. UPDATE direto HIGH/CRITICAL->REJECTED sem sla_action falhar no COMMIT");
console.log("  3.   transação legítima da RPC (v2) ser aceita de fato");
console.log("  4.   retry sob concorrência real continuar com exatamente 1 sla_action");
console.log("  5.   DELETE/desvincular sla_action de um finding ainda REJECTED ser bloqueado");
console.log("  6/7. retorno real da RPC com/sem superior configurado (só a FORMA foi provada)");
console.log("Próximo passo manual: `supabase start` (requer Docker rodando) + aplicar as duas");
console.log("migrations num banco local efêmero + rodar as consultas SQL diretas acima.");
console.log("");

console.log("======================================");
console.log(`Resultado: ${passed} passaram, ${failed} falharam.`);
console.log("======================================");

if (failed > 0) process.exit(1);
