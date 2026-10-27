// Estado da caixa CONSULTAR IA — fora de qualquer módulo "use server" (ver expert-query-state.ts).

import type { AlertConsultSuccess } from "./run-alert-consult";
import type { AlertConsultSpecialtyId } from "./specialties";

export interface AlertConsultState {
  result: AlertConsultSuccess | null;
  error: string | null;
  /** Ecoa a escolha para a tela não perder pergunta/especialidade após a consulta. */
  question: string | null;
  specialtyId: AlertConsultSpecialtyId | null;
}

export const initialAlertConsultState: AlertConsultState = { result: null, error: null, question: null, specialtyId: null };
