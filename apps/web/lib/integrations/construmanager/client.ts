import { getConstrumanagerConfig } from "./config";
import type {
  ConstrumanagerAuthResponse,
  ConstrumanagerConfig,
  ConstrumanagerFileListResponse,
  ConstrumanagerFolderListResponse,
  ConstrumanagerMasterListResponse,
  ConstrumanagerTokenResponse,
  ConstrumanagerWorkListResponse,
} from "./types";

export class ConstrumanagerClient {
  private readonly config: ConstrumanagerConfig;

  constructor(config: ConstrumanagerConfig) {
    this.config = config;
  }

  private async requestJson<T>(
    path: string,
    init: RequestInit
  ): Promise<T> {
    const controller = new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs
    );

    try {
      const response = await fetch(`${this.config.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(
          `Construmanager request ${path} failed with HTTP ${response.status}.`
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "AbortError"
      ) {
        throw new Error(
          `Construmanager request ${path} timed out after ${this.config.timeoutMs} ms.`
        );
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async authenticate(): Promise<ConstrumanagerAuthResponse> {
    const response =
      await this.requestJson<ConstrumanagerAuthResponse>(
        "/Login/Auth",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            login: this.config.login,
            senha: this.config.password,
          }),
        }
      );

    if (response.status?.id !== 1) {
      throw new Error(
        `Construmanager authentication failed: ${
          response.status?.description || "unknown API status"
        }`
      );
    }

    if (
      !response.user ||
      response.user.id <= 0 ||
      response.user.companyId <= 0 ||
      !response.user.token ||
      response.user.token.length < 10
    ) {
      throw new Error(
        "Construmanager authentication returned an invalid user session."
      );
    }

    return response;
  }

  async getAccessToken(
    intermediateToken: string
  ): Promise<ConstrumanagerTokenResponse> {
    if (!intermediateToken || intermediateToken.length < 10) {
      throw new Error(
        "Construmanager intermediate token is invalid."
      );
    }

    const body = new URLSearchParams({
      grant_type: "password",
      token: intermediateToken,
    });

    const response =
      await this.requestJson<ConstrumanagerTokenResponse>(
        "/Login/Token/Get",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded",
          },
          body,
        }
      );

    if (
      !response.access_token ||
      response.access_token.length < 10
    ) {
      throw new Error(
        "Construmanager Token/Get did not return a valid access token."
      );
    }

    return response;
  }

  async listWorks(
    accessToken: string,
    companyId: number
  ): Promise<ConstrumanagerWorkListResponse> {
    if (!accessToken || accessToken.length < 10) {
      throw new Error(
        "Construmanager Bearer token is invalid."
      );
    }

    if (!Number.isInteger(companyId) || companyId <= 0) {
      throw new Error(
        "Construmanager companyId is invalid."
      );
    }

    const response =
      await this.requestJson<ConstrumanagerWorkListResponse>(
        "/Obra/List",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            empresaId: companyId,
          }),
        }
      );

    if (response.status?.id !== 0) {
      throw new Error(
        `Construmanager Obra/List failed: ${
          response.status?.description || "unknown API status"
        }`
      );
    }

    if (!Array.isArray(response.listWork)) {
      throw new Error(
        "Construmanager Obra/List returned an invalid work list."
      );
    }

    return response;
  }

  // ============================================================
  // Rotas de METADADOS (Pacote B) — estritamente somente leitura.
  //
  // Nenhuma delas baixa arquivo: não existe Objeto/Download aqui e
  // nenhum corpo de resposta vira Storage. Os contratos abaixo NÃO são
  // suposição: foram validados contra a obra piloto 34164 e conferidos
  // com a documentação oficial em /Help.
  //
  // Atenção às três armadilhas reais desta API:
  //   1. Pasta/List e Arquivo/List usam { empresaId, obraId }, mas
  //      ListaMestra/List usa { idEmpresa, idObra } — grafias
  //      diferentes na MESMA API. Trocar uma pela outra devolve HTTP
  //      500.
  //   2. ListaMestra/List exige idUsuario, idTipoUsuario e idObjeto.
  //      Sem eles a resposta é 200 com "Registro não encontrado" — um
  //      falso negativo que parece "sem dados".
  //   3. idObjeto tem que ser separado por VÍRGULA. Com ";" a API
  //      devolve stack trace de SQL Server.
  // ============================================================

  private assertWorkScopeArguments(
    accessToken: string,
    companyId: number,
    workId: number
  ): void {
    if (!accessToken || accessToken.length < 10) {
      throw new Error("Construmanager Bearer token is invalid.");
    }

    if (!Number.isInteger(companyId) || companyId <= 0) {
      throw new Error("Construmanager companyId is invalid.");
    }

    if (!Number.isInteger(workId) || workId <= 0) {
      throw new Error("Construmanager workId is invalid.");
    }
  }

  private authorizedJson<T>(
    path: string,
    accessToken: string,
    body: unknown
  ): Promise<T> {
    return this.requestJson<T>(path, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  // Pasta/List — árvore de pastas da obra. Precisa vir ANTES da lista
  // mestra: os ids retornados aqui são a entrada obrigatória de
  // idObjeto.
  async listFolders(
    accessToken: string,
    companyId: number,
    workId: number
  ): Promise<ConstrumanagerFolderListResponse> {
    this.assertWorkScopeArguments(accessToken, companyId, workId);

    const response =
      await this.authorizedJson<ConstrumanagerFolderListResponse>(
        "/Pasta/List",
        accessToken,
        { empresaId: companyId, obraId: workId }
      );

    if (response.status?.id !== 0) {
      throw new Error(
        `Construmanager Pasta/List failed: ${
          response.status?.description || "unknown API status"
        }`
      );
    }

    if (!Array.isArray(response.listFolder)) {
      throw new Error(
        "Construmanager Pasta/List returned an invalid folder list."
      );
    }

    return response;
  }

  // Arquivo/List — FONTE SECUNDÁRIA (extensão e conferência cruzada).
  // Não usar para versionamento: hasVersion é booleano cego, o
  // histórico só existe na lista mestra.
  async listFiles(
    accessToken: string,
    companyId: number,
    workId: number
  ): Promise<ConstrumanagerFileListResponse> {
    this.assertWorkScopeArguments(accessToken, companyId, workId);

    const response =
      await this.authorizedJson<ConstrumanagerFileListResponse>(
        "/Arquivo/List",
        accessToken,
        { empresaId: companyId, obraId: workId }
      );

    if (response.status?.id !== 0) {
      throw new Error(
        `Construmanager Arquivo/List failed: ${
          response.status?.description || "unknown API status"
        }`
      );
    }

    if (!Array.isArray(response.listFile)) {
      throw new Error(
        "Construmanager Arquivo/List returned an invalid file list."
      );
    }

    return response;
  }

  // ListaMestra/List — FONTE PRIMÁRIA dos documentos e a única rota que
  // expõe versões históricas (isMostrarVersao = true).
  //
  // `top` NUNCA é enviado: quando ele vai no corpo, a API devolve as
  // linhas no campo `top` e deixa `listaMestra` vazio.
  async listMasterList(
    accessToken: string,
    companyId: number,
    workId: number,
    userId: number,
    userTypeId: number,
    folderIds: number[]
  ): Promise<ConstrumanagerMasterListResponse> {
    this.assertWorkScopeArguments(accessToken, companyId, workId);

    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error("Construmanager userId is invalid.");
    }

    if (!Number.isInteger(userTypeId) || userTypeId <= 0) {
      throw new Error("Construmanager userTypeId is invalid.");
    }

    if (!Array.isArray(folderIds) || folderIds.length === 0) {
      throw new Error(
        "Construmanager ListaMestra/List requires at least one folder id."
      );
    }

    if (!folderIds.every((id) => Number.isInteger(id) && id > 0)) {
      throw new Error(
        "Construmanager ListaMestra/List received an invalid folder id."
      );
    }

    const response =
      await this.authorizedJson<ConstrumanagerMasterListResponse>(
        "/ListaMestra/List",
        accessToken,
        {
          id: "",
          isMostrarVersao: true,
          idEmpresa: companyId,
          idObra: workId,
          idUsuario: userId,
          idTipoUsuario: userTypeId,
          isMasterLider: false,
          // Separador obrigatoriamente vírgula.
          idObjeto: folderIds.join(","),
          isJSON: true,
        }
      );

    if (response.status?.id !== 0) {
      throw new Error(
        `Construmanager ListaMestra/List failed: ${
          response.status?.description || "unknown API status"
        }`
      );
    }

    if (
      !Array.isArray(response.listaMestra) &&
      !Array.isArray(response.top)
    ) {
      throw new Error(
        "Construmanager ListaMestra/List returned an invalid master list."
      );
    }

    return response;
  }

  // ============================================================
  // Objeto/Download — ÚNICA rota do Pacote C que traz bytes.
  //
  // Fatos já validados do contrato (não reinventar):
  //   - a resposta é application/octet-stream;
  //   - o corpo é um ZIP, mesmo para um único arquivo;
  //   - a hierarquia de pastas do Construmanager é preservada dentro
  //     do ZIP;
  //   - arquivos reais chegam a centenas de MB. NÃO existe limite de
  //     50 MB aqui.
  //
  // O corpo segue o CONTRATO OFICIAL confirmado na documentação do
  // fornecedor e é montado por buildObjectDownloadBody() — ver ali a
  // forma exata e por que idEmpresa NÃO entra nesta rota. Quem chama
  // informa `requestBody` para manter a montagem num ponto só,
  // testável isoladamente.
  //
  // Nada nesta função escreve em disco, e o token nunca é logado nem
  // devolvido: ele só existe no header desta requisição.
  async downloadObject(
    accessToken: string,
    companyId: number,
    workId: number,
    objectId: number,
    requestBody: Record<string, unknown>,
    onChunk: (chunk: Uint8Array) => void | Promise<void>,
    options: {
      maxBytes: number;
      timeoutMs?: number;
    }
  ): Promise<ConstrumanagerDownloadOutcome> {
    this.assertWorkScopeArguments(accessToken, companyId, workId);

    if (!Number.isInteger(objectId) || objectId <= 0) {
      throw new Error("Construmanager objectId is invalid.");
    }

    if (!Number.isInteger(options.maxBytes) || options.maxBytes <= 0) {
      throw new Error("Construmanager download maxBytes is invalid.");
    }

    const controller = new AbortController();

    // Download é longo por natureza: o timeout de 15 s das rotas de
    // metadados abortaria um arquivo grande legítimo. O AbortController
    // continua sendo o único mecanismo de parada — nada roda solto.
    const timeoutMs = options.timeoutMs ?? 15 * 60 * 1000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.config.baseUrl}/Objeto/Download`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/octet-stream",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(
          `Construmanager request /Objeto/Download failed with HTTP ${response.status}.`
        );
      }

      const contentType = (
        response.headers.get("content-type") ?? ""
      ).toLowerCase();

      // A API devolve 200 com JSON de erro em requisição malformada —
      // o mesmo padrão que já mordeu em ListaMestra/List. Um JSON aqui
      // NUNCA é conteúdo: é falha disfarçada de sucesso.
      if (contentType.includes("application/json") || contentType.includes("text/")) {
        throw new Error(
          "Construmanager /Objeto/Download returned a textual payload instead of binary content."
        );
      }

      if (!response.body) {
        throw new Error(
          "Construmanager /Objeto/Download returned an empty response body."
        );
      }

      let bytesReceived = 0;

      const declaredLength = Number(
        response.headers.get("content-length") ?? ""
      );

      if (
        Number.isFinite(declaredLength) &&
        declaredLength > options.maxBytes
      ) {
        throw new Error(
          `Construmanager /Objeto/Download declared ${declaredLength} bytes, above the ${options.maxBytes} byte limit.`
        );
      }

      const reader = response.body.getReader();

      // Streaming puro: o corpo nunca é materializado inteiro em
      // memória, e o teto é aplicado ENQUANTO chega — o content-length
      // declarado pela origem não é garantia.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;

        bytesReceived += value.length;

        if (bytesReceived > options.maxBytes) {
          await reader.cancel().catch(() => undefined);
          controller.abort();
          throw new Error(
            `Construmanager /Objeto/Download exceeded the ${options.maxBytes} byte limit.`
          );
        }

        await onChunk(value);
      }

      if (bytesReceived === 0) {
        throw new Error(
          "Construmanager /Objeto/Download returned zero bytes."
        );
      }

      return { bytesReceived, contentType: contentType || null };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `Construmanager request /Objeto/Download timed out after ${timeoutMs} ms.`
        );
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export interface ConstrumanagerDownloadOutcome {
  bytesReceived: number;
  contentType: string | null;
}

// Montagem do corpo de Objeto/Download — CONTRATO OFICIAL confirmado
// na documentação do Construmanager:
//
//   {
//     "idObjetos": [ <int>, ... ],   obrigatório, 1..100 itens
//     "idObra": <int>,               obrigatório
//     "markup": <bool>,
//     "markupOculto": <bool>
//   }
//
// Três armadilhas que esta rota NÃO compartilha com as de metadados:
//   1. NÃO existe idEmpresa/empresaId aqui. A obra já identifica o
//      escopo; mandar empresa é campo estranho ao contrato.
//   2. É idObjetos (PLURAL, array de INTEGER) — não idObjeto string,
//      e não a lista separada por vírgula que ListaMestra/List exige.
//   3. markup/markupOculto são do contrato e vão explicitamente em
//      false: o ACC preserva o documento como está, sem anotação
//      sobreposta. Omiti-los deixaria o comportamento a critério do
//      fornecedor.
export const OBJECT_DOWNLOAD_MAX_IDS = 100;

export function buildObjectDownloadBody(
  workId: number,
  objectIds: number | number[]
): Record<string, unknown> {
  const ids = Array.isArray(objectIds) ? objectIds : [objectIds];

  if (ids.length === 0) {
    throw new Error(
      "Construmanager /Objeto/Download requires at least one object id."
    );
  }

  // Teto oficial de 100. Aplicado aqui, e não só na camada de lote,
  // para que nenhum caminho futuro consiga montar uma requisição
  // fora do contrato.
  if (ids.length > OBJECT_DOWNLOAD_MAX_IDS) {
    throw new Error(
      `Construmanager /Objeto/Download accepts at most ${OBJECT_DOWNLOAD_MAX_IDS} object ids per request.`
    );
  }

  if (!ids.every((id) => Number.isInteger(id) && id > 0)) {
    throw new Error(
      "Construmanager /Objeto/Download received an invalid object id."
    );
  }

  if (!Number.isInteger(workId) || workId <= 0) {
    throw new Error("Construmanager workId is invalid.");
  }

  return {
    idObjetos: ids,
    idObra: workId,
    markup: false,
    markupOculto: false,
  };
}

export function createConstrumanagerClient(): ConstrumanagerClient {
  return new ConstrumanagerClient(
    getConstrumanagerConfig()
  );
}
