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
import { MISSING_QUERY_SCOPE_MESSAGE } from "./query/validate-expert-query-response";

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
 * Erro cuja mensagem foi ESCRITA PARA O USUÁRIO e por isso pode ser
 * exibida como está. É o único mecanismo pelo qual um texto produzido
 * dentro do `try` de um Server Action chega à tela — nunca a mensagem
 * de um erro qualquer.
 *
 * Use somente para texto redigido pensando em quem lê a tela: sem
 * identificador técnico, sem nome de tabela/coluna/variável de
 * ambiente, sem status HTTP, sem stack. Qualquer outra falha deve
 * continuar sendo um `Error` comum — ela vira o fallback do Expert
 * chamador.
 */
export class ExpertQuerySafeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpertQuerySafeError";
  }
}

/**
 * Mensagens que este próprio código produz e que já são seguras por
 * construção. Comparadas por IGUALDADE EXATA — não é um filtro por
 * palavra proibida, é o reconhecimento das constantes que nós mesmos
 * redigimos para a tela.
 */
const SAFE_MESSAGES: readonly string[] = [
  MISSING_QUERY_CONTEXT_MESSAGE,
  MISSING_QUESTION_MESSAGE,
  MISSING_QUERY_SCOPE_MESSAGE,
];

/**
 * Mensagem de erro exibível na UI — FAIL-CLOSED.
 *
 * A primeira versão era fail-open: devolvia qualquer `error.message`
 * que não casasse com uma lista de palavras proibidas
 * (`undefined|null|NaN|[object Object]`). Isso ainda deixava passar
 * mensagem de Postgres/Supabase, erro HTTP do Anthropic, falha de rede,
 * stack trace e nome de variável interna. Pior: a própria regex era
 * frustrada pelos `\b` ao redor de `[object Object]`, que começa e
 * termina em caractere não alfanumérico — o limite de palavra não casa
 * ali, então nem o caso que ela pretendia cobrir era confiável.
 *
 * Agora só chega à tela o que foi deliberadamente redigido para ela:
 *   1. um `ExpertQuerySafeError` (mecanismo explícito e tipado); ou
 *   2. uma das constantes de mensagem deste módulo (igualdade exata).
 *
 * Todo o resto vira o `fallback` do Expert chamador. O erro real é
 * registrado no log do servidor (nome + mensagem) para diagnóstico —
 * nunca no retorno para o navegador. Nenhum valor de configuração é
 * logado aqui, e os erros do provider real já nascem sem a API key (ver
 * providers/anthropic-provider.ts, wrapAnthropicError).
 */
export function resolveExpertQueryErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ExpertQuerySafeError) {
    const safeMessage = error.message.trim();
    return safeMessage || fallback;
  }

  const message = error instanceof Error ? error.message.trim() : "";
  if (message && SAFE_MESSAGES.includes(message)) {
    return message;
  }

  console.error("[expert-query] erro não exibível ao usuário:", {
    name: error instanceof Error ? error.name : typeof error,
    message: message || "(sem mensagem)",
  });

  return fallback;
}
