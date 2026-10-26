// Adapter para o módulo SSMA: consulta o especialista de SSMA (esg-director, mesmo Expert da
// caixa CONSULTAR IA) no contexto de UM registro. Só contrato — não depende de tabelas do SSMA:
// quem chama monta `recordContext` (texto do registro, já autorizado para o usuário) e informa a
// obra. Somente leitura; a consulta nunca altera o registro nem declara ação concluída.

import type { SupabaseClient } from "@supabase/supabase-js";

import { runAlertConsultExpert } from "./alert-consult-experts";
import { buildAiProviderUiMetadata, type AiProviderUiMetadata } from "../provider-ui-metadata";
import { resolveExpertQueryErrorMessage } from "../expert-query-request";
import type { AiProvider } from "../providers/types";
import type { ExpertQueryResponse } from "../query/types";
import { composeSpecialtyQuestion, DEFAULT_ALERT_CONSULT_QUESTION, getAlertConsultSpecialty, MAX_ALERT_CONSULT_QUESTION_LENGTH } from "./specialties";

export interface SsmaRecordConsultInput {
  projectId: string;
  /** Texto autorizado do registro (categoria, descrição, local, data, risco, ação corretiva...). */
  recordContext: string;
  /** Pergunta editável; vazia = pergunta padrão. */
  question?: string;
  /** Somente testes (provedor simulado). */
  provider?: AiProvider;
}

export type SsmaRecordConsultOutcome =
  | { ok: true; response: ExpertQueryResponse; meta: AiProviderUiMetadata; question: string }
  | { ok: false; error: string };

export async function consultSsmaSpecialistForRecord(
  supabase: SupabaseClient,
  input: SsmaRecordConsultInput
): Promise<SsmaRecordConsultOutcome> {
  const specialty = getAlertConsultSpecialty("ssma");
  if (!specialty) return { ok: false, error: "Especialista de SSMA indisponível." };

  const question = (input.question ?? "").trim() || DEFAULT_ALERT_CONSULT_QUESTION;
  if (question.length > MAX_ALERT_CONSULT_QUESTION_LENGTH) {
    return { ok: false, error: `A pergunta deve ter no máximo ${MAX_ALERT_CONSULT_QUESTION_LENGTH} caracteres.` };
  }

  try {
    const result = await runAlertConsultExpert(
      supabase,
      specialty.expertId,
      {
        scope: "PROJECT",
        projectId: input.projectId,
        question: composeSpecialtyQuestion(specialty, question, input.recordContext),
      },
      question,
      input.provider
    );
    return {
      ok: true,
      response: { ...result.response, question },
      meta: buildAiProviderUiMetadata(result.audit.providerId, result.audit.model),
      question,
    };
  } catch (error) {
    return { ok: false, error: resolveExpertQueryErrorMessage(error, "Falha ao consultar o especialista de SSMA.") };
  }
}
