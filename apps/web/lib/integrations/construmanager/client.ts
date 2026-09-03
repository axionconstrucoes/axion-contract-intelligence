import { getConstrumanagerConfig } from "./config";
import type {
  ConstrumanagerAuthResponse,
  ConstrumanagerConfig,
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
}

export function createConstrumanagerClient(): ConstrumanagerClient {
  return new ConstrumanagerClient(
    getConstrumanagerConfig()
  );
}
