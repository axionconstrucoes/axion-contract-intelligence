// Client da API EXTERNA do Diario de Obra.
//
// Fonte independente do Construmanager: outra plataforma, outro host,
// outra credencial. Este arquivo nao importa nada do modulo
// Construmanager e nao le nenhum secret dele.
//
// API OFICIAL, NAO A DO PORTAL
//
// O portal web usa internamente api.diariodeobra.app/v2 com a sessao do
// navegador. Aqui usamos a API EXTERNA publicada pelo fornecedor, cuja
// documentacao existe para "exportar os dados inseridos no sistema (em
// formato JSON)". Imitar a sessao do navegador seria possivel e seria
// errado: quebraria no primeiro deploy do fornecedor e contrariaria o
// contrato de uso.
//
//   base ....... https://apiexterna.diariodeobra.app/v1
//   auth ....... cabecalho `token` (JWT)
//   limite ..... 150 requisicoes por minuto (HTTP 429 ao exceder)
//
// As regras de seguranca vivem TODAS aqui — allowlist, bloqueio de
// midia, teto e ausencia de retry. Nenhum chamador precisa lembrar
// delas, e nenhum consegue contorna-las.

export const DIARIO_BASE_URL = "https://apiexterna.diariodeobra.app/v1";

const ID = "[a-f0-9]{24}";

/** As TRES unicas rotas alcancaveis. Qualquer outra e' recusada. */
export const DIARIO_ROTAS_PERMITIDAS: readonly RegExp[] = Object.freeze([
  new RegExp(`^/obras/${ID}$`),
  new RegExp(`^/obras/${ID}/relatorios$`),
  new RegExp(`^/obras/${ID}/relatorios/${ID}$`),
]);

/**
 * Guarda redundante de midia.
 *
 * Nenhum destes termos existe como rota na allowlist acima — a guarda
 * e' deliberadamente redundante. Se um dia alguem ampliar a allowlist
 * sem pensar, isto continua barrando foto, video, anexo e PDF.
 */
export const DIARIO_TERMOS_DE_MIDIA: readonly string[] = Object.freeze([
  "foto",
  "fotos",
  "galeria",
  "video",
  "videos",
  "anexo",
  "anexos",
  "impressao",
  "imprimir",
  "exportar",
  "download",
  "pdf",
  "assinatura",
]);

/**
 * Teto local por execucao. O fornecedor permite 150 por minuto; ficar
 * muito abaixo protege a plataforma dele e nos de um laco acidental.
 */
export const DIARIO_MAX_CHAMADAS_POR_EXECUCAO = 60;

export const DIARIO_TIMEOUT_MS = 30_000;

/**
 * Tamanho de lote pedido em cada janela.
 *
 * 30 e' o valor COMPROVADO na validacao real (run 34136744223). Pedir
 * mais reduziria chamadas, mas nao ha evidencia de que a API aceite —
 * e um teto silenciosamente aplicado pelo servidor seria indistinguivel
 * de uma janela cheia, exatamente a confusao que a subdivisao existe
 * para evitar. Aumentar isto exige medir antes.
 */
export const DIARIO_LIMITE_LOTE = 30;

export interface DiarioClientConfig {
  token: string;
  fetchImpl?: typeof fetch;
}

export interface DiarioListQuery {
  dataInicio?: string;
  dataFim?: string;
  limite?: number;
  ordem?: "asc" | "desc";
}

export class DiarioDeObraApiError extends Error {}

/**
 * Sanitizacao. O token e' um JWT: vazado num log, e' acesso completo ate
 * expirar. Alem dos rotulos obvios, qualquer cadeia opaca longa cai —
 * foi uma cadeia sem rotulo que vazou no log de outro modulo deste
 * projeto, e a licao vale aqui.
 */
export function sanitizeDiarioError(erro: unknown): string {
  const bruto = erro instanceof Error ? erro.message : String(erro ?? "");

  return bruto
    .replace(/eyJ[A-Za-z0-9_.-]+/g, "[JWT REDIGIDO]")
    .replace(
      /(token|cookie|senha|password|login|authorization|apikey)\s*[:=]\s*\S+/gi,
      "$1=[REDIGIDO]"
    )
    .replace(/https?:\/\/\S+/g, "[URL REDIGIDA]")
    .replace(/[A-Za-z0-9_-]{40,}/g, "[REDIGIDO]")
    .replace(/\s+/g, " ")
    .slice(0, 300)
    .trim();
}

export class DiarioDeObraClient {
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private chamadas = 0;
  private readonly rotasUsadas: string[] = [];

  constructor(config: DiarioClientConfig) {
    this.token = config.token;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  get totalDeChamadas(): number {
    return this.chamadas;
  }

  get rotas(): string[] {
    return [...this.rotasUsadas];
  }

  private async get<T>(caminho: string, query: Record<string, string> = {}): Promise<T> {
    const minusculo = caminho.toLowerCase();

    for (const termo of DIARIO_TERMOS_DE_MIDIA) {
      if (minusculo.includes(termo)) {
        throw new DiarioDeObraApiError(
          `Caminho recusado por conter termo de midia (${termo}): esta integracao nao transfere byte de midia.`
        );
      }
    }

    if (!DIARIO_ROTAS_PERMITIDAS.some((padrao) => padrao.test(caminho))) {
      throw new DiarioDeObraApiError(`Rota fora da allowlist: ${caminho}`);
    }

    if (this.chamadas >= DIARIO_MAX_CHAMADAS_POR_EXECUCAO) {
      throw new DiarioDeObraApiError(
        `Teto de ${DIARIO_MAX_CHAMADAS_POR_EXECUCAO} chamadas por execucao atingido.`
      );
    }

    this.chamadas += 1;
    this.rotasUsadas.push(caminho);

    const parametros = new URLSearchParams(query);
    const sufixo = parametros.toString() ? `?${parametros}` : "";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DIARIO_TIMEOUT_MS);

    try {
      // Uma tentativa por chamada. Sem retry: repetir mascararia a
      // instabilidade que precisamos medir e consumiria o limite do
      // fornecedor justamente quando ele ja esta sob pressao.
      const resposta = await this.fetchImpl(`${DIARIO_BASE_URL}${caminho}${sufixo}`, {
        method: "GET",
        headers: { "Content-Type": "application/json", token: this.token },
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
      });

      if (resposta.status === 429) {
        throw new DiarioDeObraApiError(
          "HTTP 429: limite de 150 requisicoes por minuto atingido para esta empresa."
        );
      }

      if (!resposta.ok) {
        throw new DiarioDeObraApiError(`${caminho} respondeu HTTP ${resposta.status}.`);
      }

      return (await resposta.json()) as T;
    } catch (erro) {
      if (erro instanceof Error && erro.name === "AbortError") {
        throw new DiarioDeObraApiError(
          `${caminho} expirou apos ${DIARIO_TIMEOUT_MS} ms.`
        );
      }
      throw erro;
    } finally {
      // Sempre, inclusive no sucesso: um timer pendente manteria o
      // processo vivo depois de a resposta ter chegado.
      clearTimeout(timer);
    }
  }

  async getObra(obraId: string): Promise<Record<string, unknown>> {
    return this.get(`/obras/${obraId}`);
  }

  async listarRelatorios(
    obraId: string,
    query: DiarioListQuery = {}
  ): Promise<Array<Record<string, unknown>>> {
    const parametros: Record<string, string> = {
      limite: String(query.limite ?? DIARIO_LIMITE_LOTE),
      ordem: query.ordem ?? "desc",
    };

    // O filtro por periodo so vale com AS DUAS datas — e' o que a
    // documentacao oficial exige.
    if (query.dataInicio && query.dataFim) {
      parametros.dataInicio = query.dataInicio;
      parametros.dataFim = query.dataFim;
    }

    const resposta = await this.get<unknown>(`/obras/${obraId}/relatorios`, parametros);

    if (!Array.isArray(resposta)) {
      throw new DiarioDeObraApiError(
        "A listagem de relatorios nao devolveu um array."
      );
    }

    return resposta as Array<Record<string, unknown>>;
  }

  async getRelatorio(obraId: string, relatorioId: string): Promise<Record<string, unknown>> {
    return this.get(`/obras/${obraId}/relatorios/${relatorioId}`);
  }
}
