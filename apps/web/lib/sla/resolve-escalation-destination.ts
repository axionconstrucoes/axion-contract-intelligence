import type { SlaAreaResponsibles, SlaEscalationLevel } from "./types";

export interface ResolvedEscalationDestination {
  level: SlaEscalationLevel;
  userId: string | null;
}

/**
 * Resolve o nível efetivo antes de gravar/enviar um escalonamento.
 * A matriz atual possui três níveis. ESCALAO_2 permanece apenas para
 * compatibilidade com registros antigos.
 */
export function resolveEscalationDestination(
  recommendedLevel: SlaEscalationLevel,
  responsibles: SlaAreaResponsibles | undefined
): ResolvedEscalationDestination {
  if (recommendedLevel === "ESCALAO_1") {
    if (responsibles?.escalation1UserId) {
      return { level: "ESCALAO_1", userId: responsibles.escalation1UserId };
    }

    if (responsibles?.boardUserId) {
      return { level: "DIRETORIA", userId: responsibles.boardUserId };
    }
  }

  if (recommendedLevel === "ESCALAO_2") {
    if (responsibles?.escalation2UserId) {
      return { level: "ESCALAO_2", userId: responsibles.escalation2UserId };
    }

    if (responsibles?.boardUserId) {
      return { level: "DIRETORIA", userId: responsibles.boardUserId };
    }
  }

  if (recommendedLevel === "DIRETORIA") {
    return { level: "DIRETORIA", userId: responsibles?.boardUserId ?? null };
  }

  return { level: recommendedLevel, userId: responsibles?.responsibleDirectUserId ?? null };
}
