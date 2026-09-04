// Registra a execução da curadoria multiagente em audit_log_entries —
// infraestrutura já existente (mesmo padrão de
// apps/web/lib/ai/experts/planning-director/apply-schedule-delay-assessment.ts
// para "resultado de Expert sem coluna dedicada": codificado de forma
// compacta e legível dentro de `detail`, nunca perdido). NENHUMA tabela
// nova, NENHUM trigger novo — audit_log_entries.detail (text, sem
// limite) já suporta o que este requisito pede.
//
// audit_log_entries não tem policy de INSERT para o client autenticado
// normal (só SELECT + triggers SECURITY DEFINER) — por isso esta função
// recebe explicitamente um client admin (mesmo padrão de
// apply-schedule-delay-assessment.ts/send-contract-alert-email.ts),
// nunca cria o seu próprio.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MultiExpertCuration } from "./types";

export interface PersistCurationAuditInput {
  curation: MultiExpertCuration;
  triggeredByUserId: string;
  triggeredByLabel: string;
}

/**
 * Uma única linha de auditoria por execução (nunca uma por Expert
 * consultado — mesmo princípio de "1 escalonamento = 1 linha" já usado
 * por sla_action_escalations). Cobre, dentro do que audit_log_entries já
 * suporta: project_id/entity_id (colunas dedicadas), usuário que
 * iniciou (actor_user_id), data/hora (occurred_at), e — dentro de
 * `detail` — tema roteado, Experts participantes, severidade
 * consolidada, situação, recomendação, decisões humanas necessárias e a
 * confirmação explícita de que a decisão continua humana.
 */
export async function persistCurationAudit(admin: SupabaseClient, input: PersistCurationAuditInput): Promise<void> {
  const { curation, triggeredByUserId, triggeredByLabel } = input;
  const { executiveCuration: exec, routing, audit, expertResults } = curation;

  // Nome real de cada Expert vem da própria resposta (expertName já
  // resolvido por answerXQuery) — nunca uma segunda tabela de nomes
  // mantida à parte, que poderia divergir do Expert real consultado.
  const expertNames = expertResults.map((r) => r.response.expertName);

  const detailLines = [
    `Curadoria multiagente disparada manualmente por ${triggeredByLabel} sobre o evento ${audit.eventId ?? "(sem evento)"}.`,
    `Tema roteado: ${routing.topic} — ${routing.reason}`,
    `Experts consultados (${expertNames.length}): ${expertNames.length > 0 ? expertNames.join(", ") : "nenhum (roteamento não selecionou especialista)"}`,
    `Severidade consolidada: ${exec.overallSeverity}`,
    `Situação: ${exec.situacao}`,
    `Divergências entre Experts: ${exec.divergencias.length > 0 ? `${exec.divergencias.length} registrada(s)` : "nenhuma"}`,
    `Recomendação do CEO IA: ${exec.recomendacao}`,
    `Decisões humanas necessárias: ${exec.decisoesHumanasNecessarias.length > 0 ? exec.decisoesHumanasNecessarias.join(" | ") : "nenhuma indicada"}`,
    "Revisão humana: SEMPRE obrigatória (requiresHumanReview=true) — nenhuma ação foi executada automaticamente; este registro é só a análise, não uma decisão.",
  ];

  const { error } = await admin.from("audit_log_entries").insert({
    project_id: audit.projectId,
    actor_type: "USER",
    actor_user_id: triggeredByUserId,
    actor_label: null,
    action: "AI_MULTI_EXPERT_CURATION_CREATED",
    entity_type: "CONTRACT_EVENT",
    entity_id: audit.eventId ?? audit.projectId,
    detail: detailLines.join("\n"),
    occurred_at: audit.generatedAt,
  });

  if (error) {
    throw new Error(`Falha ao registrar auditoria da curadoria multiagente: ${error.message}`);
  }
}
