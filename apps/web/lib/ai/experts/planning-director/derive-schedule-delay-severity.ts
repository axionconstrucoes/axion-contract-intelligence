// Regra de elevação de risco de ATRASO DE CRONOGRAMA para o e-mail de
// alerta contratual (AlertSeverity, packages/types) — pura, sem I/O,
// testável isoladamente. Implementa exatamente a regra desta rodada:
//
//   - atraso contratual com recuperação tecnicamente viável: ALTA;
//   - prazo contratual ultrapassado + recuperabilidade explicitamente
//     IMPROVAVEL: CRITICA;
//   - evidências insuficientes ou recuperabilidade INCERTA (ou nenhuma
//     avaliação estruturada disponível): mantém ALTA e sinaliza decisão
//     humana necessária.
//
// NUNCA deduz CRÍTICO de texto livre nem só da quantidade de dias de
// atraso — o ÚNICO insumo aceito é o resultado ESTRUTURADO
// ScheduleRecoverabilityAssessment (classification + o fato separado
// contractualDeadlineOrLimitExceeded), nunca um scan de string nem um
// limiar numérico de dias.
//
// Se outra fonte já produziu uma severidade maior (ex.: outro Expert,
// outra regra), a severidade final é sempre a MAIOR das duas — esta
// função nunca rebaixa uma severidade já elevada por outro caminho.

import type { AlertSeverity } from "@axion/types";
import type { ScheduleRecoverabilityAssessment } from "./types";

export interface ScheduleDelaySeverityResult {
  severity: AlertSeverity;
  // "DECISÃO HUMANA NECESSÁRIA" do requisito — sinalização explícita e
  // vulnerável (nunca confundida com o requiresHumanReview genérico de
  // ExpertAssessment, que é sempre `true` em toda avaliação de IA deste
  // sistema, independentemente de haver ambiguidade real ou não).
  requiresHumanDecision: boolean;
  reason: string;
}

const ALERT_SEVERITY_RANK: Record<AlertSeverity, number> = {
  BAIXA: 0,
  MEDIA: 1,
  ALTA: 2,
  CRITICA: 3,
};

function higherSeverity(a: AlertSeverity, b: AlertSeverity): AlertSeverity {
  return ALERT_SEVERITY_RANK[a] >= ALERT_SEVERITY_RANK[b] ? a : b;
}

export function deriveScheduleDelaySeverity(
  recoverability: ScheduleRecoverabilityAssessment | null,
  currentHighestSeverity: AlertSeverity = "BAIXA"
): ScheduleDelaySeverityResult {
  if (!recoverability) {
    return withFloor(
      {
        severity: "ALTA",
        requiresHumanDecision: true,
        reason:
          "Nenhuma avaliação estruturada de recuperabilidade do Diretor de Planejamento IA disponível — mantido ALTO, decisão humana necessária.",
      },
      currentHighestSeverity
    );
  }

  if (recoverability.classification === "INCERTA") {
    return withFloor(
      {
        severity: "ALTA",
        requiresHumanDecision: true,
        reason:
          "Recuperabilidade classificada como INCERTA (evidências insuficientes) — mantido ALTO, decisão humana necessária.",
      },
      currentHighestSeverity
    );
  }

  if (recoverability.contractualDeadlineOrLimitExceeded && recoverability.classification === "IMPROVAVEL") {
    return withFloor(
      {
        severity: "CRITICA",
        requiresHumanDecision: false,
        reason:
          "Prazo/limite contratual ultrapassado e o Diretor de Planejamento IA concluiu, com evidências, que a recuperação é improvável.",
      },
      currentHighestSeverity
    );
  }

  return withFloor(
    {
      severity: "ALTA",
      requiresHumanDecision: false,
      reason: recoverability.contractualDeadlineOrLimitExceeded
        ? "Prazo contratual ultrapassado, mas a recuperação foi classificada como tecnicamente viável."
        : "Atraso identificado, ainda dentro do prazo/limite contratual, com recuperação tecnicamente viável.",
    },
    currentHighestSeverity
  );
}

function withFloor(result: ScheduleDelaySeverityResult, currentHighestSeverity: AlertSeverity): ScheduleDelaySeverityResult {
  const severity = higherSeverity(result.severity, currentHighestSeverity);
  return severity === result.severity ? result : { ...result, severity };
}
