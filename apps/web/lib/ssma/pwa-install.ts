// Endereço de instalação do PWA SSMA (link e QR Code). O endereço DEFINITIVO não é inventado:
// vem de configuração (ACC_SSMA_PWA_URL ou, na falta, AXION_APP_BASE_URL + /ssma). Sem
// configuração, a tela avisa em vez de mostrar um endereço falso.
//
// O QR Code contém SOMENTE esta URL — nunca credencial, token, sessão ou identificador de usuário.
// Por isso a URL é validada: http(s), sem usuário/senha, sem query e sem fragmento.

export type SsmaInstallUrl =
  | { ok: true; url: string; source: "ACC_SSMA_PWA_URL" | "AXION_APP_BASE_URL" }
  | { ok: false; reason: "NOT_CONFIGURED" | "INVALID"; message: string };

const NOT_CONFIGURED = "O endereço de instalação do app de campo ainda não foi configurado (ACC_SSMA_PWA_URL).";

function normalize(raw: string, appendPath: string | null): { url: string } | { error: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { error: "O endereço configurado não é uma URL válida." };
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))) {
    return { error: "O endereço de instalação deve usar https (http só em localhost)." };
  }
  if (parsed.username || parsed.password) return { error: "O endereço de instalação não pode conter usuário ou senha." };
  if (parsed.search || parsed.hash) return { error: "O endereço de instalação não pode conter parâmetros nem fragmento (o QR Code leva só a URL)." };
  const path = appendPath ? `${parsed.pathname.replace(/\/+$/, "")}${appendPath}` : parsed.pathname.replace(/\/+$/, "") || "/";
  return { url: `${parsed.origin}${path}` };
}

export function resolveSsmaInstallUrl(env: Record<string, string | undefined> = process.env): SsmaInstallUrl {
  const explicit = env.ACC_SSMA_PWA_URL?.trim();
  const base = env.AXION_APP_BASE_URL?.trim();
  const source = explicit ? "ACC_SSMA_PWA_URL" : base ? "AXION_APP_BASE_URL" : null;
  if (!source) return { ok: false, reason: "NOT_CONFIGURED", message: NOT_CONFIGURED };
  const result = normalize(explicit || (base as string), explicit ? null : "/ssma");
  if ("error" in result) return { ok: false, reason: "INVALID", message: result.error };
  return { ok: true, url: result.url, source };
}

export const INSTALL_INSTRUCTIONS = {
  ios: [
    "Abra o endereço no Safari (no iPhone, a instalação é feita pelo Safari).",
    "Toque em Compartilhar (quadrado com seta).",
    "Escolha “Adicionar à Tela de Início” e confirme.",
    "Abra o ACC SSMA pelo ícone e entre com a sua conta.",
  ],
  android: [
    "Abra o endereço no Chrome.",
    "Toque no menu ⋮ e escolha “Instalar app” (ou “Adicionar à tela inicial”).",
    "Confirme. O ícone ACC SSMA aparece na tela inicial.",
    "Abra o app e entre com a sua conta.",
  ],
} as const;
