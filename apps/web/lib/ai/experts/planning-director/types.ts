// Schema específico do Diretor de Planejamento IA (planning-director) —
// estende os campos genéricos de ExpertAssessment (ver ../../types.ts)
// com o resultado ESTRUTURADO de recuperabilidade de atraso de
// cronograma. Nenhum campo aqui duplica um campo genérico já existente
// (severity/confidence/evidenceRefs/executiveSummary/requiresHumanReview
// continuam vindo de ExpertAssessment — "responsável pela avaliação" já
// é expertId ali, "justificativa" já é executiveSummary, "evidências"
// já é evidenceRefs). O ÚNICO campo genuinamente novo é
// ScheduleRecoverabilityAssessment: a classificação de recuperabilidade
// em si (RECUPERAVEL/IMPROVAVEL/INCERTA) e o detalhamento das
// evidências técnicas de cronograma que a sustentam — nada disso existe
// em nenhum tipo já existente no repositório (verificado antes de
// escrever este arquivo).

import type { ExpertAssessment } from "../../types";

// RECUPERAVEL: atraso (contratual ou não) com caminho técnico real de
// volta ao prazo — ALTO, nunca CRÍTICO por si só.
// IMPROVAVEL: o Diretor de Planejamento concluiu, com evidências, que a
// recuperação não é tecnicamente viável — só ISSO, combinado com prazo
// contratual já ultrapassado, eleva a CRÍTICO (ver
// derive-schedule-delay-severity.ts).
// INCERTA: evidências insuficientes ou conclusão não determinada — NUNCA
// vira CRÍTICO; mantém ALTO e sinaliza decisão humana necessária.
export type ScheduleRecoverabilityClassification = "RECUPERAVEL" | "IMPROVAVEL" | "INCERTA";

// Cada campo é a evidência TÉCNICA de cronograma (Parte 3 do requisito
// desta rodada) que sustenta a classificação acima — string livre
// (texto do próprio Diretor de Planejamento, nunca um número
// fabricado), null quando essa evidência específica não está
// disponível no contexto (nunca inventada).
export interface ScheduleRecoverabilityEvidence {
  criticalPath: string | null;
  floatDays: string | null;
  plannedVsActualProgress: string | null;
  productivity: string | null;
  mobilizedResources: string | null;
  remainingDuration: string | null;
  recoveryPlan: string | null;
  reinforcementReprogrammingOrExtensionNeeded: string | null;
}

// "contractualDeadlineOrLimitExceeded" é um FATO distinto da
// classificação de recuperabilidade — nunca deduzido da classificação
// nem vice-versa: um atraso pode já ter ultrapassado o prazo contratual
// e AINDA ser recuperável (ex.: aceleração formalmente aprovada), e um
// atraso ainda dentro do prazo pode já ser avaliado como
// tecnicamente improvável de se recuperar até o próprio prazo.
export interface ScheduleRecoverabilityAssessment {
  classification: ScheduleRecoverabilityClassification;
  contractualDeadlineOrLimitExceeded: boolean;
  evidence: ScheduleRecoverabilityEvidence;
  // "justificativa" do requisito — texto corrido explicando a
  // classificação a partir das evidências acima. Distinto de
  // ExpertAssessment.executiveSummary (resumo executivo do parecer
  // inteiro, não desta classificação específica).
  justification: string;
  // "data da avaliação" — o ÚNICO campo genuinamente cronológico novo
  // (ExpertAssessment não tem timestamp próprio, a data real fica na
  // linha do banco que armazena o parecer).
  assessedAt: string;
}

export interface PlanningDirectorAssessment extends ExpertAssessment {
  // null = o Diretor de Planejamento ainda não produziu uma
  // classificação estruturada de recuperabilidade para este evento
  // (ex.: evento sem relação com atraso de cronograma) — nunca
  // fabricado/presumido pelo caller.
  scheduleRecoverability: ScheduleRecoverabilityAssessment | null;
}
