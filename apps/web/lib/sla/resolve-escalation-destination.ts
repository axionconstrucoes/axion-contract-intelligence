import type { SlaAreaResponsibles, SlaEscalationLevel } from "./types";

export interface ResolvedEscalationDestination {
  level: SlaEscalationLevel;
  userId: string | null;
}

/**
 * Resolve o nível efetivo antes de gravar/enviar um escalonamento.
 * Cadeia única de três níveis: RESPONSAVEL -> ESCALAO_1 -> DIRETORIA.
 * ESCALAO_2 permanece aceito apenas em registros antigos (leitura):
 * nunca é destino de um novo escalonamento — quando ainda aparece como
 * nível recomendado/atual, o destino é a DIRETORIA (Nível 3), com o
 * mesmo resultado no caminho automático e no manual.
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

  if (recommendedLevel === "ESCALAO_2" || recommendedLevel === "DIRETORIA") {
    // escalation_2_user_id (legado) é ignorado: novos fluxos nunca criam ESCALAO_2.
    return { level: "DIRETORIA", userId: responsibles?.boardUserId ?? null };
  }

  return { level: recommendedLevel, userId: responsibles?.responsibleDirectUserId ?? null };
}
