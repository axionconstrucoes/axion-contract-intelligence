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
}

export function createConstrumanagerClient(): ConstrumanagerClient {
  return new ConstrumanagerClient(
    getConstrumanagerConfig()
  );
}
