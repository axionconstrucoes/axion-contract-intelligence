// Puro, sem I/O — deliberadamente sem "server-only" (mesmo padrão do
// resto do pacote de e-mail): testável por script Node standalone.

import type { ScheduleActivity } from "@axion/types";
import type { ScheduleRecoverabilityAssessment } from "./types";

// Gera o resultado ESTRUTURADO de recuperabilidade a partir de dados
// REAIS de cronograma (schedule_activities) — nunca de texto livre nem
// de um provider de IA simulado com respostas fabricadas. Determinístico
// e sem rede, por construção (só leitura de dados já carregados +
// aritmética de datas), o que já satisfaz "provider falso/sem rede"
// exigido pelo teste ponta a ponta deste bloco.
//
// LIMITAÇÃO REAL, DELIBERADA E DOCUMENTADA: o schema atual de
// schedule_activities (baseline_start/end, planned_start/end, status)
// NÃO captura caminho crítico, folgas, produtividade nem plano de
// recuperação — só datas e um status de 3 valores (NO_PRAZO/ATRASADA/
// CONCLUIDA). Por isso esta função NUNCA classifica como RECUPERAVEL
// nem IMPROVAVEL a partir só de datas/status: isso seria exatamente o
// "deduzir de texto livre/contagem de dias" que a regra do Bloco 3
// proíbe explicitamente. O único fato que ela afirma com segurança é
// `contractualDeadlineOrLimitExceeded` (uma data real já passada é um
// FATO, não uma inferência) — a classificação em si fica sempre
// INCERTA quando não há evidência qualitativa real disponível (o que é
// sempre o caso neste schema hoje), disparando corretamente "ALTA +
// DECISÃO HUMANA NECESSÁRIA" em vez de um CRÍTICO nunca fundamentado.
// Um humano (ou uma futura extração real de caminho crítico/plano de
// recuperação) preenche essas evidências quando disponíveis — nunca
// esta função.

/**
 * Retorna `null` quando NENHUMA atividade ainda ativa está atrasada
 * além do previsto (nada a avaliar) — o caller nunca deve gravar uma
 * avaliação de "atraso" quando não há atraso real nenhum.
 */
export function generateScheduleRecoverabilityAssessment(
  activities: ScheduleActivity[],
  now: Date = new Date()
): ScheduleRecoverabilityAssessment | null {
  const overdue = activities.filter(
    (activity) => activity.status !== "CONCLUIDA" && new Date(activity.currentEnd).getTime() < now.getTime()
  );

  if (overdue.length === 0) {
    return null;
  }

  const overdueNames = overdue.map((a) => a.name).join(", ");
  const worstOverdue = overdue.reduce((worst, activity) =>
    new Date(activity.currentEnd).getTime() < new Date(worst.currentEnd).getTime() ? activity : worst
  );

  return {
    classification: "INCERTA",
    contractualDeadlineOrLimitExceeded: true,
    evidence: {
      criticalPath: null,
      floatDays: null,
      plannedVsActualProgress: null,
      productivity: null,
      mobilizedResources: null,
      remainingDuration: `${overdue.length} atividade(s) de cronograma além do prazo previsto na data desta avaliação: ${overdueNames}.`,
      recoveryPlan: null,
      reinforcementReprogrammingOrExtensionNeeded: null,
    },
    justification:
      `Fato verificado nos dados reais de cronograma: ${overdue.length} atividade(s) ultrapassaram a data prevista de término (a mais antiga, "${worstOverdue.name}", venceu em ${worstOverdue.currentEnd}). ` +
      "Nenhuma evidência qualitativa de recuperabilidade (caminho crítico, folgas, produtividade, plano de recuperação) está disponível nos dados estruturados de cronograma desta fase — a classificação fica INCERTA por honestidade (nunca deduzida só da contagem de dias), exigindo avaliação humana ou extração futura dessas evidências antes de qualquer elevação a CRÍTICO.",
    assessedAt: now.toISOString(),
  };
}
