import type { ConstrumanagerConfig } from "./types";

const DEFAULT_BASE_URL = "https://api.construmanager.com.br";
// Ultimo recurso: rota desconhecida e sem override explicito.
export const DEFAULT_TIMEOUT_MS = 15000;

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];

  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getConstrumanagerConfig(): ConstrumanagerConfig {
  const login = requiredEnvironmentVariable("CONSTRUMANAGER_LOGIN").trim();
  const password = requiredEnvironmentVariable("CONSTRUMANAGER_PASSWORD");

  const baseUrl = (
    process.env.CONSTRUMANAGER_BASE_URL?.trim() || DEFAULT_BASE_URL
  ).replace(/\/+$/, "");

  const parsedUrl = new URL(baseUrl);

  if (parsedUrl.protocol !== "https:") {
    throw new Error("CONSTRUMANAGER_BASE_URL must use HTTPS.");
  }

  // `timeoutMs` fica AUSENTE de proposito. Preenche-lo aqui com 15000
  // seria indistinguivel de um override explicito de 15000, e o client
  // nunca chegaria aos padroes por rota — /Arquivo/List voltaria a
  // expirar em 15 s, que foi o que derrubou o run 34082823463.
  return {
    baseUrl,
    login,
    password,
  };
}
