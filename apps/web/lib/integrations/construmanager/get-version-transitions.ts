// Leitura das transições de versão vigente para o painel do ACC.
//
// Só SELECT, sempre pelo client de sessão: a view roda com
// `security_invoker = true`, então a RLS de
// construmanager_version_transitions (membros do projeto) continua
// valendo. Nenhuma credencial e nenhuma chamada à API acontecem aqui.
//
// Por que existe: gravar apenas em audit_log_entries não atende ao
// requisito de *sabermos* que uma nova versão está vigente — ninguém
// abre o log de auditoria todo dia. A transição precisa aparecer onde a
// pessoa já olha.

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Onde está o conteúdo desta versão, no momento da leitura.
 *
 * Derivado do vínculo de conteúdo, nunca de um download: um item de
 * referência externa é reportado como tal sem que nada seja baixado.
 */
export type TransitionContentStatus =
  | "ARMAZENADO_NO_ACC"
  | "PENDENTE"
  | "SOMENTE_NO_CONSTRUMANAGER";

export interface ConstrumanagerVersionTransition {
  id: string;
  objectId: number;
  documentName: string | null;
  previousRevision: string | null;
  newRevision: string;
  detectedAt: string;
  sourceCreatedAt: string | null;
  authorName: string | null;
  sizeBytes: number | null;
  folderPath: string | null;
  contentStatus: TransitionContentStatus;
  impactReview: {
    id: string;
    scheduleImpact: "SIM" | "NAO" | "INCONCLUSIVO";
    priceImpact: "SIM" | "NAO" | "INCONCLUSIVO";
    planningResponse: string;
    status: "PENDENTE_ORCAMENTO" | "CONCLUIDA";
    budgetResponse: string | null;
  } | null;
}

/**
 * Por que a consulta falhou, em vocabulário do domínio.
 *
 * `VIEW_AUSENTE` é separado e **temporário** de propósito: cobre apenas
 * a janela entre o deploy do código e a aplicação da migration. Como a
 * ordem prevista é migration ANTES do merge, depois do deploy essa
 * condição vira erro operacional como qualquer outra — e por isso ela é
 * *identificada*, não escondida junto com o resto.
 */
export type TransitionQueryFailure = "VIEW_AUSENTE" | "ERRO_DE_CONSULTA";

/**
 * Resultado da consulta, em TRÊS estados explícitos.
 *
 * A versão anterior devolvia `null` para tudo, o que tornava
 * indistinguíveis "não há novidade" e "a consulta falhou". Na prática
 * isso significava que uma falha de permissão, uma view ausente ou uma
 * queda de conexão apareciam na tela exatamente como calmaria — a pior
 * forma de falhar num monitoramento, porque o silêncio é justamente o
 * sinal de que está tudo bem.
 */
export type ConstrumanagerVersionTransitionsResult =
  | { status: "OK"; total: number; items: ConstrumanagerVersionTransition[] }
  | { status: "INDISPONIVEL"; reason: TransitionQueryFailure };

/**
 * Teto de linhas exibidas.
 *
 * O painel mostra as transições RECENTES, não o histórico completo — o
 * ledger imutável guarda tudo e continua auditável por consulta. Uma
 * lista longa aqui esconderia justamente a novidade.
 */
const RECENT_LIMIT = 10;

/**
 * Códigos que significam "o objeto não existe no schema".
 *
 * `42P01` é o SQLSTATE do Postgres para relação inexistente; `PGRST205`
 * é o equivalente do PostgREST quando a tabela/view não está no cache
 * de schema.
 */
const MISSING_RELATION_CODES = new Set(["42P01", "PGRST205"]);

type TransitionRow = {
  id: string;
  construmanager_object_id: number;
  document_name: string | null;
  previous_revision: string | null;
  new_revision: string;
  detected_at: string;
  source_created_at: string | null;
  author_name: string | null;
  size_bytes: number | null;
  folder_path: string | null;
  content_status: string;
};

function normalizeContentStatus(raw: string): TransitionContentStatus {
  if (raw === "ARMAZENADO_NO_ACC" || raw === "SOMENTE_NO_CONSTRUMANAGER") {
    return raw;
  }
  return "PENDENTE";
}

/**
 * Registra a falha no servidor, sem vazar nada para o navegador.
 *
 * Só código e mensagem do PostgREST — nunca SQL, header, token ou
 * credencial. O usuário vê apenas "monitoramento indisponível"; quem
 * precisa do detalhe técnico é quem lê o log do servidor.
 */
function logTransitionFailure(
  projectId: string,
  code: string | undefined,
  message: string | undefined
): void {
  console.error(
    "[construmanager] Consulta de transicoes de versao falhou.",
    JSON.stringify({
      projectId,
      code: code ?? "(sem codigo)",
      // Truncado: mensagens de driver podem ser longas e verbosas.
      message: (message ?? "(sem mensagem)").slice(0, 300),
    })
  );
}

export async function getConstrumanagerVersionTransitions(
  supabase: SupabaseClient,
  projectId: string
): Promise<ConstrumanagerVersionTransitionsResult> {
  const [{ data, error }, reviewsResult] = await Promise.all([
    supabase
    .from("construmanager_recent_version_transitions")
    .select(
      "id, construmanager_object_id, document_name, previous_revision, new_revision, detected_at, source_created_at, author_name, size_bytes, folder_path, content_status"
    )
    .eq("project_id", projectId)
    .order("detected_at", { ascending: false })
    .limit(RECENT_LIMIT),
    supabase
      .from("construmanager_version_impact_reviews")
      .select("id,transition_id,schedule_impact,price_impact,planning_response,status,budget_response")
      .eq("project_id", projectId),
  ]);

  if (error) {
    const code = (error as { code?: string }).code;

    logTransitionFailure(projectId, code, error.message);

    return {
      status: "INDISPONIVEL",
      reason:
        code !== undefined && MISSING_RELATION_CODES.has(code)
          ? "VIEW_AUSENTE"
          : "ERRO_DE_CONSULTA",
    };
  }

  if (reviewsResult.error && !MISSING_RELATION_CODES.has(reviewsResult.error.code)) {
    logTransitionFailure(projectId, reviewsResult.error.code, reviewsResult.error.message);
    return { status: "INDISPONIVEL", reason: "ERRO_DE_CONSULTA" };
  }

  // `data` nulo sem `error` não é um caso previsto pelo driver; tratá-lo
  // como lista vazia mascararia um estado que não sabemos interpretar.
  if (!data) {
    logTransitionFailure(projectId, "SEM_DADOS", "Consulta retornou data nulo sem erro.");
    return { status: "INDISPONIVEL", reason: "ERRO_DE_CONSULTA" };
  }

  const rows = data as unknown as TransitionRow[];
  const reviews = new Map(
    ((reviewsResult.error && MISSING_RELATION_CODES.has(reviewsResult.error.code)
      ? []
      : reviewsResult.data ?? []) as Array<{
      id: string;
      transition_id: string;
      schedule_impact: "SIM" | "NAO" | "INCONCLUSIVO";
      price_impact: "SIM" | "NAO" | "INCONCLUSIVO";
      planning_response: string;
      status: "PENDENTE_ORCAMENTO" | "CONCLUIDA";
      budget_response: string | null;
    }>).map((review) => [review.transition_id, review])
  );

  return {
    status: "OK",
    total: rows.length,
    items: rows.map((row) => {
      const review = reviews.get(row.id);
      return {
        id: row.id,
        objectId: row.construmanager_object_id,
        documentName: row.document_name,
        previousRevision: row.previous_revision,
        newRevision: row.new_revision,
        detectedAt: row.detected_at,
        sourceCreatedAt: row.source_created_at,
        authorName: row.author_name,
        sizeBytes: row.size_bytes === null || row.size_bytes === undefined
          ? null
          : Number(row.size_bytes),
        folderPath: row.folder_path,
        contentStatus: normalizeContentStatus(row.content_status),
        impactReview: review ? {
          id: review.id,
          scheduleImpact: review.schedule_impact,
          priceImpact: review.price_impact,
          planningResponse: review.planning_response,
          status: review.status,
          budgetResponse: review.budget_response,
        } : null,
      };
    }),
  };
}
