// Puro — especialidades da caixa "CONSULTAR IA" dos alertas.
//
// NÃO cria Experts novos: cada especialidade é mapeada para um Expert JÁ existente (provider,
// permissões, grounding e validação continuam os dele) + um foco de especialidade que entra no
// texto da pergunta. O mapeamento é explícito e auditável:
//   Contratual/Jurídico      → legal-consultant
//   Engenharia               → planning-director (mesmo mapeamento de askEngineeringDirectorAction)
//   Planejamento e Prazo     → planning-director
//   SSMA                     → esg-director
//   Documentação e Entrega   → legal-consultant (documentos contratuais/evidências) com foco próprio
//   Geral                    → legal-consultant (base contratual do alerta) com foco multidisciplinar

import type { MembershipArea } from "@axion/types";

import type { ExpertId } from "../types";

export type AlertConsultSpecialtyId = "juridico" | "engenharia" | "planejamento" | "ssma" | "documentacao" | "geral";

export interface AlertConsultSpecialty {
  id: AlertConsultSpecialtyId;
  label: string;
  expertId: ExpertId;
  /** Foco anexado à pergunta — instrui o Expert existente sob a ótica da especialidade. */
  focus: string;
}

export const ALERT_CONSULT_SPECIALTIES: readonly AlertConsultSpecialty[] = [
  {
    id: "juridico",
    label: "Contratual/Jurídico",
    expertId: "legal-consultant",
    focus:
      "Responda sob a ótica contratual/jurídica: obrigações e cláusulas aplicáveis, consequências contratuais PREVISTAS, notificações e prazos contratuais. Não afirme penalidade sem cláusula que a sustente.",
  },
  {
    id: "engenharia",
    label: "Engenharia",
    expertId: "planning-director",
    focus:
      "Responda sob a ótica de engenharia: soluções técnicas, método executivo, recursos, qualidade e recuperação física da situação, indicando o que depende de projeto, medição ou inspeção em campo.",
  },
  {
    id: "planejamento",
    label: "Planejamento e Prazo",
    expertId: "planning-director",
    focus:
      "Responda sob a ótica de planejamento e prazo: impacto em marcos e caminho crítico, opções de recuperação de prazo, sequenciamento e janelas de mitigação, usando só as datas e atividades presentes no contexto.",
  },
  {
    id: "ssma",
    label: "SSMA",
    expertId: "esg-director",
    focus:
      "Responda sob a ótica de segurança, saúde e meio ambiente: riscos às pessoas e ao ambiente, controles e medidas corretivas, licenças e registros exigidos, indicando evidências necessárias.",
  },
  {
    id: "documentacao",
    label: "Documentação e Entrega",
    expertId: "legal-consultant",
    focus:
      "Responda sob a ótica de documentação e entrega: documentos, evidências e registros exigidos (as-built, databook, garantias, notas fiscais, licenças), rastreabilidade até a fonte e o que falta para comprovar a entrega.",
  },
  {
    id: "geral",
    label: "Geral",
    expertId: "legal-consultant",
    focus:
      "Responda de forma geral e multidisciplinar a partir do contexto do alerta e indique quando outra especialidade deve ser consultada.",
  },
];

export const DEFAULT_ALERT_CONSULT_QUESTION =
  "Como tratar ou mitigar esta situação de risco? Apresente opções práticas de acordo com sua especialidade.";

export const MAX_ALERT_CONSULT_QUESTION_LENGTH = 2000;

export function getAlertConsultSpecialty(id: string | null | undefined): AlertConsultSpecialty | null {
  return ALERT_CONSULT_SPECIALTIES.find((specialty) => specialty.id === id) ?? null;
}

/**
 * Especialidade inicial pela ÁREA cadastrada do colaborador na obra. Sem área, ou sem
 * correspondência direta, volta "geral" — nunca uma suposição. O usuário pode trocar.
 */
export function preselectSpecialtyForArea(area: MembershipArea | string | null | undefined): AlertConsultSpecialtyId {
  switch (area) {
    case "ENGENHARIA":
      return "engenharia";
    case "PLANEJAMENTO":
      return "planejamento";
    case "SSMA/ESG":
      return "ssma";
    case "JURÍDICO":
      return "juridico";
    default:
      return "geral";
  }
}

/** Critérios de risco (texto exato da definição AXION) — mesmo texto dos prompts dos Experts. */
export const CONSULT_RISK_CRITERIA_TEXT =
  "Critérios de risco AXION: CRÍTICO = risco iminente de descumprimento e penalização contratual, exigindo ação imediata; " +
  "ALTO = risco iminente de descumprimento e penalização, com tempo para mitigação; " +
  "MÉDIO = risco com possível consequência a médio prazo; BAIXO = risco processual de acompanhamento ou organização. " +
  "Não existe número fixo de dias separando os níveis: não invente limites nem prazos. Penalização só pode ser afirmada com a cláusula que a prevê; " +
  "sem vínculo contratual ou prazo no contexto, diga que a informação está ausente e peça a confirmação em vez de afirmar certeza.";

const GUARDRAILS =
  "Regras desta consulta: apresente opções PRÁTICAS conforme a sua especialidade (o que fazer, quem envolve, que evidência registrar) e os critérios para escolher entre elas; use SOMENTE o contexto desta obra e cite as fontes consultáveis; explique informações ausentes e incertezas; " +
  "separe fato, inferência e recomendação; esta consulta NÃO executa ações nem altera o alerta; não afirme que uma providência foi concluída sem registro correspondente. " +
  CONSULT_RISK_CRITERIA_TEXT;

/** Pergunta enviada ao Expert: foco da especialidade + pergunta do usuário + regras da consulta. */
export function composeSpecialtyQuestion(
  specialty: AlertConsultSpecialty,
  userQuestion: string,
  subjectContext: string | null
): string {
  const parts = [`[Especialidade: ${specialty.label}] ${specialty.focus}`];
  if (subjectContext) parts.push(`Contexto do alerta (registro do ACC):\n${subjectContext}`);
  parts.push(`Pergunta do usuário: ${userQuestion.trim()}`);
  parts.push(GUARDRAILS);
  return parts.join("\n\n");
}

export type AlertConsultSubjectKind = "evento" | "providencia";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ParsedAlertConsultForm =
  | {
      ok: true;
      input: { projectId: string; subject: AlertConsultSubjectKind; id: string; specialtyId: AlertConsultSpecialtyId; question: string };
    }
  | { ok: false; error: string };

export const CONSULT_INVALID_CONTEXT_MESSAGE = "Não foi possível identificar o alerta desta consulta. Reabra o link do e-mail e tente novamente.";

/** Valida o formulário no SERVIDOR — o navegador nunca é a fonte final do contexto. */
export function parseAlertConsultForm(formData: FormData): ParsedAlertConsultForm {
  const get = (name: string) => String(formData.get(name) ?? "").trim();
  const projectId = get("projectId");
  const subject = get("subject");
  const id = get("id");
  const specialty = getAlertConsultSpecialty(get("specialty"));
  const question = get("question");

  if (!UUID_RE.test(projectId) || !UUID_RE.test(id) || (subject !== "evento" && subject !== "providencia")) {
    return { ok: false, error: CONSULT_INVALID_CONTEXT_MESSAGE };
  }
  if (!specialty) return { ok: false, error: "Selecione uma especialidade." };
  if (!question) return { ok: false, error: "Digite uma pergunta." };
  if (question.length > MAX_ALERT_CONSULT_QUESTION_LENGTH) {
    return { ok: false, error: `A pergunta deve ter no máximo ${MAX_ALERT_CONSULT_QUESTION_LENGTH} caracteres.` };
  }

  return { ok: true, input: { projectId, subject, id, specialtyId: specialty.id, question } };
}
