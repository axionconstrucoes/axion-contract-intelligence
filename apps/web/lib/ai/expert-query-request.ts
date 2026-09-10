// Parsing e validação, no SERVIDOR, do contexto de uma consulta
// conversacional a um Expert (ver query/types.ts). Compartilhado por
// todos os Server Actions de consulta (expert-query-action.ts,
// esg-query-action.ts) — nunca duplicado por Expert.
//
// Este módulo NÃO tem "use server": ele exporta constantes e funções
// síncronas, e um módulo "use server" só pode exportar funções async
// (ver scripts/test-use-server-exports.mjs). Os Server Actions o
// importam.
//
// Princípio: o navegador nunca é a fonte final do contexto. O formulário
// declara `projectId`/`scope`/`eventId`, mas cada valor é validado aqui
// contra o domínio real (ExpertQueryScope) e, no caso do escopo EVENT, o
// vínculo evento→projeto é reconfirmado no banco por
// buildEventAnalysisContext (que falha explicitamente se o evento não
// pertencer ao projeto). Nenhum fallback silencioso: contexto ausente ou
// incoerente nunca vira uma consulta "no projeto errado".

import type { ExpertQueryRequest, ExpertQueryScope } from "./query/types";

/**
 * Escopos que os Server Actions aceitam vindos de um formulário. Os
 * demais escopos do tipo (DOCUMENT/EMAIL/MULTI_EXPERT) existem como
 * contrato futuro e não são acionáveis pela UI nesta fase.
 */
const FORM_SCOPES: ExpertQueryScope[] = ["PROJECT", "EVENT"];

/**
 * Mensagem única de contexto ausente/incoerente. Nunca exibe
 * "undefined" nem qualquer valor cru do formulário ao usuário.
 */
export const MISSING_QUERY_CONTEXT_MESSAGE =
  "Não foi possível identificar o contexto desta análise. Recarregue a página e tente novamente.";

export const MISSING_QUESTION_MESSAGE = "Digite uma pergunta.";

export type ParsedExpertQueryForm =
  | { ok: true; request: ExpertQueryRequest }
  | { ok: false; error: string };

function optionalField(formData: FormData, name: string): string | null {
  const value = String(formData.get(name) ?? "").trim();
  return value || null;
}

/**
 * Monta o ExpertQueryRequest a partir do FormData. Falha fechado: sem
 * projeto, sem escopo reconhecido, ou escopo EVENT sem evento, nenhuma
 * consulta é feita.
 */
export function parseExpertQueryForm(formData: FormData): ParsedExpertQueryForm {
  const projectId = optionalField(formData, "projectId");
  const scopeRaw = optionalField(formData, "scope");
  const eventId = optionalField(formData, "eventId");
  const question = optionalField(formData, "question");

  if (!projectId) {
    return { ok: false, error: MISSING_QUERY_CONTEXT_MESSAGE };
  }

  const scope = FORM_SCOPES.find((candidate) => candidate === scopeRaw);
  if (!scope) {
    return { ok: false, error: MISSING_QUERY_CONTEXT_MESSAGE };
  }

  if (scope === "EVENT" && !eventId) {
    return { ok: false, error: MISSING_QUERY_CONTEXT_MESSAGE };
  }

  if (!question) {
    return { ok: false, error: MISSING_QUESTION_MESSAGE };
  }

  return {
    ok: true,
    request: {
      scope,
      projectId,
      // Fora do escopo EVENT o identificador de evento é descartado de
      // propósito: um eventId residual do navegador nunca pode influenciar
      // uma consulta de projeto.
      eventId: scope === "EVENT" ? (eventId ?? undefined) : undefined,
      question,
    },
  };
}

/**
 * Mensagem de erro exibível na UI. Nunca deixa vazar "undefined"/"null"
 * de uma mensagem técnica para a tela — nesse caso usa o fallback do
 * Expert chamador.
 */
export function resolveExpertQueryErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message) return fallback;
  if (/\b(undefined|null|NaN|\[object Object\])\b/.test(message)) return fallback;
  return message;
}
