// Guarda das suítes de ROTINA: nenhuma delas pode falar com um provedor de IA real.
//
// Carregado com `node --import ./scripts/lib/block-live-ai.mjs scripts/test-*.mjs` (ver package.json).
//   1. Remove do ambiente as chaves de provedores de IA — mesmo que o desenvolvedor as tenha no shell.
//   2. Faz fetch/http/https para hosts de provedores de IA FALHAREM alto (nunca "passar em silêncio").
//
// Só testes marcados como "live" (npm run test:live-ai) podem sair disto, e exigem habilitação
// explícita (ver scripts/test-live-ai.mjs). Não afeta Chrome/CDP, Supabase local, PGlite nem fetch local.

import http from "node:http";
import https from "node:https";

const AI_ENV_KEYS = [
  "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY",
  "AXION_AI_PROVIDER", "AXION_AI_PROVIDER_COMMERCIAL_DIRECTOR", "AXION_AI_PROVIDER_ESG_DIRECTOR",
  "AXION_AI_PROVIDER_CEO", "AXION_AI_PROVIDER_LEGAL_CONSULTANT", "AXION_AI_PROVIDER_PLANNING_DIRECTOR",
];
for (const key of AI_ENV_KEYS) delete process.env[key];

export const BLOCKED_AI_HOSTS = [
  /(^|\.)anthropic\.com$/i,
  /(^|\.)openai\.com$/i,
  /(^|\.)generativelanguage\.googleapis\.com$/i,
  /(^|\.)aiplatform\.googleapis\.com$/i,
  /(^|\.)mistral\.ai$/i,
  /(^|\.)cohere\.(ai|com)$/i,
];

export function isBlockedAiHost(hostname) {
  return BLOCKED_AI_HOSTS.some((pattern) => pattern.test(String(hostname ?? "")));
}

function fail(hostname) {
  const error = new Error(
    `[block-live-ai] chamada a provedor de IA real BLOQUEADA nas suítes de rotina (host: ${hostname}). ` +
      "Use um provedor simulado. Testes reais: npm run test:live-ai com ACC_ALLOW_LIVE_AI_TESTS=1."
  );
  error.code = "ACC_LIVE_AI_BLOCKED";
  return error;
}

const realFetch = globalThis.fetch;
if (typeof realFetch === "function") {
  globalThis.fetch = function guardedFetch(input, init) {
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
      const host = new URL(url).hostname;
      if (isBlockedAiHost(host)) return Promise.reject(fail(host));
    } catch (error) {
      if (error?.code === "ACC_LIVE_AI_BLOCKED") return Promise.reject(error);
    }
    return realFetch.call(this, input, init);
  };
}

for (const mod of [http, https]) {
  for (const method of ["request", "get"]) {
    const original = mod[method];
    mod[method] = function guarded(...args) {
      const first = args[0];
      const host = typeof first === "string" ? safeHost(first) : first instanceof URL ? first.hostname : (first?.hostname ?? first?.host);
      if (isBlockedAiHost(String(host ?? "").split(":")[0])) throw fail(host);
      return original.apply(this, args);
    };
  }
}

function safeHost(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}
