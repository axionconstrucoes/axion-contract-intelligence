// Preparação da lista de conteúdo — deliberadamente separada do download.
//
// Por que este módulo existe: o painel do Pacote C só renderiza os botões
// por item quando já existem linhas em construmanager_content_links, e
// essas linhas só nascem de ensure_construmanager_content_links. Enquanto
// esse RPC era chamado apenas de dentro da ação de download — e o botão de
// lote ficou oculto para proteger o piloto — não sobrou nenhum caminho
// para criar os vínculos, e o painel travou em zero.
//
// A correção não é reexibir o lote (qualquer acionamento daquela ação
// baixa pelo menos um alvo, e no piloto seria um alvo arbitrário): é
// reconhecer que "preparar" e "baixar" sempre foram duas operações
// distintas e dar a cada uma o seu gatilho.
//
// Este módulo é puro de propósito. Um módulo "use server" só pode exportar
// funções async, então validação e normalização moram aqui, onde são
// testáveis sem sessão, sem rede e sem banco.

/**
 * Única RPC que a preparação tem permissão de chamar.
 *
 * Exportada como constante para que o teste possa afirmar, sobre o código
 * real da action, que nenhuma outra RPC é acionada no caminho de preparo.
 */
export const PREPARE_CONTENT_RPC = "ensure_construmanager_content_links";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O projectId chega de um campo de formulário e vai direto para um
 * parâmetro de RPC. Validar o formato aqui rejeita entrada malformada
 * antes de qualquer ida ao banco — a autorização de verdade continua
 * sendo do RPC (auth.uid() + ADMINISTRADOR), que esta checagem não
 * substitui nem enfraquece.
 */
export function isValidProjectId(value: string): boolean {
  return UUID_PATTERN.test(value.trim());
}

export interface ContentPreparationSummary {
  /** Vínculos criados NESTA execução. Segunda execução: 0. */
  linksCreated: number;
  /** Total acumulado de vínculos de documento-cabeça do projeto. */
  documentsTotal: number;
  /** Total acumulado de vínculos de versão histórica do projeto. */
  versionsTotal: number;
  /** Vínculos ainda passíveis de download (PENDENTE ou ERRO). */
  pendingTotal: number;
}

/**
 * Converte um contador vindo do banco. Postgres devolve bigint como
 * string em algumas rotas do PostgREST, e um valor ausente não pode
 * virar NaN na tela.
 */
function toCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed | 0;
}

/**
 * Normaliza o retorno do RPC. `ensure_construmanager_content_links`
 * declara RETURNS TABLE, então o PostgREST entrega um array de uma
 * linha; aceitar também o objeto solto evita que uma mudança de forma
 * do driver quebre a leitura silenciosamente.
 */
export function summarizeContentPreparation(
  data: unknown
): ContentPreparationSummary {
  const row = Array.isArray(data) ? data[0] : data;

  if (!row || typeof row !== "object") {
    return {
      linksCreated: 0,
      documentsTotal: 0,
      versionsTotal: 0,
      pendingTotal: 0,
    };
  }

  const record = row as Record<string, unknown>;

  return {
    linksCreated: toCount(record.links_created),
    documentsTotal: toCount(record.documents_total),
    versionsTotal: toCount(record.versions_total),
    pendingTotal: toCount(record.pending_total),
  };
}
