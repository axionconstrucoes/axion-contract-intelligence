// Orquestração PURA (dependências injetadas) da consulta "CONSULTAR IA" de um alerta.
//
// Garantias, nesta ordem (falha fechada):
//   1. permissão ativa na obra (getPermission) — sem ela nada é carregado;
//   2. o alerta (evento/providência) é carregado POR OBRA: id de outra obra = inexistente;
//   3. o Expert existente roda com o contexto SOMENTE dessa obra;
//   4. nada é gravado: a consulta não altera o alerta nem registra providência.

import { resolveExpertQueryErrorMessage } from "../expert-query-request";
import { buildAiProviderUiMetadata, type AiProviderUiMetadata } from "../provider-ui-metadata";
import type { ExpertQueryRequest, ExpertQueryResponse } from "../query/types";
import type { ExpertId } from "../types";

import {
  composeSpecialtyQuestion,
  getAlertConsultSpecialty,
  type AlertConsultSpecialtyId,
  type AlertConsultSubjectKind,
} from "./specialties";

export interface AlertConsultSource {
  kind: "EVENTO" | "CLAUSULA" | "EVIDENCIA" | "PROVIDENCIA";
  label: string;
  /** Caminho relativo no ACC (exige login e participação na obra); null = pendente de confirmação. */
  href: string | null;
  note?: string;
}

export interface AlertConsultSubject {
  projectId: string;
  subject: AlertConsultSubjectKind;
  id: string;
  title: string;
  projectName: string;
  /** EVENT: o context builder do Expert monta o contexto; PROJECT: o resumo abaixo vai na pergunta. */
  scope: "EVENT" | "PROJECT";
  /** Texto do registro da providência (null para evento — o contexto vem do builder). */
  contextText: string | null;
  sources: AlertConsultSource[];
}

export type ProjectPermission = "ADMINISTRADOR" | "GESTOR" | "GERENTE" | "COLABORADOR" | "LEITURA";

export interface AlertConsultDeps {
  getPermission(projectId: string): Promise<ProjectPermission | null>;
  /** Carrega o alerta SOMENTE se pertencer à obra informada (e visível ao usuário); senão null. */
  loadSubject(projectId: string, subject: AlertConsultSubjectKind, id: string): Promise<AlertConsultSubject | null>;
  runExpert(
    expertId: ExpertId,
    request: ExpertQueryRequest,
    /** Pergunta ORIGINAL do usuário (guards que inspecionam a pergunta não devem ver o texto de apoio). */
    userQuestion: string
  ): Promise<{ response: ExpertQueryResponse; audit: { providerId: string; model: string | null } }>;
}

export interface AlertConsultInput {
  projectId: string;
  subject: AlertConsultSubjectKind;
  id: string;
  specialtyId: AlertConsultSpecialtyId;
  question: string;
}

export interface AlertConsultSuccess {
  response: ExpertQueryResponse;
  specialtyLabel: string;
  expertId: ExpertId;
  /** Provider/modelo efetivo — nunca confundir fake com IA real. */
  meta: AiProviderUiMetadata;
  sources: AlertConsultSource[];
  /** Pergunta como o usuário a escreveu (a pergunta composta enviada ao Expert não é exibida como dele). */
  question: string;
  generatedAt: string;
}

export type AlertConsultOutcome = ({ ok: true } & AlertConsultSuccess) | { ok: false; error: string };

export const CONSULT_NO_ACCESS_MESSAGE = "Você não possui acesso ativo a esta obra.";
export const CONSULT_NOT_FOUND_MESSAGE = "Este alerta não existe ou seu usuário não tem acesso a ele.";
const FALLBACK_ERROR = "Falha ao consultar o especialista de IA.";

export async function runAlertConsult(deps: AlertConsultDeps, input: AlertConsultInput): Promise<AlertConsultOutcome> {
  const specialty = getAlertConsultSpecialty(input.specialtyId);
  if (!specialty) return { ok: false, error: "Selecione uma especialidade." };

  try {
    const permission = await deps.getPermission(input.projectId);
    if (permission === null) return { ok: false, error: CONSULT_NO_ACCESS_MESSAGE };

    const subject = await deps.loadSubject(input.projectId, input.subject, input.id);
    // Defesa em profundidade: mesmo um loader indevido nunca devolve alerta de outra obra.
    if (!subject || subject.projectId !== input.projectId || subject.id !== input.id) {
      return { ok: false, error: CONSULT_NOT_FOUND_MESSAGE };
    }

    const request: ExpertQueryRequest = {
      scope: subject.scope,
      projectId: input.projectId,
      eventId: subject.scope === "EVENT" ? subject.id : undefined,
      question: composeSpecialtyQuestion(specialty, input.question, subject.contextText),
    };

    const result = await deps.runExpert(specialty.expertId, request, input.question.trim());

    return {
      ok: true,
      // A pergunta exibida é a do usuário; o restante da resposta é o validado pelo Expert.
      response: { ...result.response, question: input.question.trim() },
      specialtyLabel: specialty.label,
      expertId: specialty.expertId,
      meta: buildAiProviderUiMetadata(result.audit.providerId, result.audit.model),
      sources: subject.sources,
      question: input.question.trim(),
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    return { ok: false, error: resolveExpertQueryErrorMessage(error, FALLBACK_ERROR) };
  }
}
