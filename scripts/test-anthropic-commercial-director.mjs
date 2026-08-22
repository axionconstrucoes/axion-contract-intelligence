// Harness do primeiro provider real (Anthropic) conectado ao Diretor
// Comercial IA. Dois modos:
//
//   A. CONFIG CHECK (default) — nunca chama rede. Verifica se
//      AXION_AI_PROVIDER/ANTHROPIC_API_KEY/ANTHROPIC_MODEL estão
//      configurados e se o SDK carrega. Nunca imprime a chave.
//
//   B. LIVE TEST (--live) — só chama a API Anthropic quando a flag é
//      passada explicitamente. Usa o evento de referência, somente
//      leitura (nunca grava nada — nenhum e-mail, nenhuma action,
//      nenhuma alteração no Event Ledger).
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/test-anthropic-commercial-director.mjs
//   node --env-file=apps/web/.env.local scripts/test-anthropic-commercial-director.mjs --live

import { createClient } from "@supabase/supabase-js";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const REFERENCE_EVENT_ID = "58988a54-092c-442f-a79a-638b53bc088e";
const REFERENCE_PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const LIVE_QUESTION =
  "Analise comercialmente este evento. Identifique os principais riscos, pontos de negociação, informações " +
  "faltantes e ações recomendadas. Não invente valores ou condições não presentes nas fontes.";

const isLive = process.argv.includes("--live");

console.log("");
console.log("======================================");
console.log("ANTHROPIC + DIRETOR COMERCIAL IA — HARNESS");
console.log("======================================");
console.log("Modo:", isLive ? "LIVE TEST (chama a API real)" : "CONFIG CHECK (sem rede)");
console.log("");

// --- Modo A: CONFIG CHECK — sempre executa, nunca chama rede, nunca imprime a chave. ---

const { resolveAiProviderNameForExpert } = await import("../apps/web/lib/ai/providers/resolve-provider-for-expert");

const axionAiProviderSpecific = process.env.AXION_AI_PROVIDER_COMMERCIAL_DIRECTOR ?? "(ausente)";
const axionAiProvider = process.env.AXION_AI_PROVIDER ?? "(ausente — default é fake)";
const resolvedProviderName = resolveAiProviderNameForExpert("commercial-director");
const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
const model = process.env.ANTHROPIC_MODEL ?? null;
const hasSupabase = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) && Boolean(process.env.SUPABASE_SECRET_KEY);

console.log("--- Config check ---");
console.log("AXION_AI_PROVIDER_COMMERCIAL_DIRECTOR:", axionAiProviderSpecific);
console.log("AXION_AI_PROVIDER (fallback de compatibilidade):", axionAiProvider);
console.log("Provider resolvido para commercial-director:", resolvedProviderName);
console.log("ANTHROPIC_API_KEY presente:", hasApiKey);
console.log("ANTHROPIC_MODEL:", model ?? "(ausente)");
console.log("ANTHROPIC_MAX_TOKENS:", process.env.ANTHROPIC_MAX_TOKENS ?? "(ausente — default 4096)");
console.log("ANTHROPIC_TIMEOUT_MS:", process.env.ANTHROPIC_TIMEOUT_MS ?? "(ausente — default 60000)");
console.log("Supabase configurado:", hasSupabase);

let sdkLoaded = false;
try {
  await import("@anthropic-ai/sdk");
  sdkLoaded = true;
  console.log("SDK @anthropic-ai/sdk carrega corretamente: sim");
} catch (error) {
  console.log("SDK @anthropic-ai/sdk carrega corretamente: NÃO —", error.message);
}

let configOk = false;
if (hasApiKey && model) {
  try {
    const { loadAnthropicConfig } = await import("../apps/web/lib/ai/providers/anthropic-config");
    const config = loadAnthropicConfig();
    configOk = true;
    console.log(`loadAnthropicConfig(): OK (model="${config.model}", maxTokens=${config.maxTokens}, timeoutMs=${config.timeoutMs})`);
  } catch (error) {
    console.log("loadAnthropicConfig(): FALHOU —", error.message);
  }
} else {
  console.log("loadAnthropicConfig(): não testado — ANTHROPIC_API_KEY e/ou ANTHROPIC_MODEL ausentes.");
}

console.log("");

if (!isLive) {
  console.log("======================================");
  console.log(
    configOk && sdkLoaded
      ? "CONFIG CHECK OK — configuração completa. Rode novamente com --live para uma chamada real (somente leitura)."
      : "CONFIG CHECK: configuração incompleta nesta máquina — nenhuma chamada de rede foi feita. Nada foi solicitado ao usuário no chat."
  );
  console.log("======================================");
  process.exit(0);
}

// --- Modo B: LIVE TEST — só chega aqui com --live. ---

if (!hasApiKey || !model) {
  console.log("======================================");
  console.log("LIVE TEST PENDENTE — ANTHROPIC_API_KEY e/ou ANTHROPIC_MODEL não configurados nesta máquina.");
  console.log("Nenhuma chamada foi feita. A chave nunca é solicitada por este script.");
  console.log("======================================");
  process.exit(0);
}

if (!hasSupabase) {
  console.log("======================================");
  console.log("LIVE TEST PENDENTE — NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SECRET_KEY não configurados nesta máquina.");
  console.log("======================================");
  process.exit(0);
}

if (resolvedProviderName !== "anthropic") {
  console.log("======================================");
  console.log(
    `LIVE TEST PENDENTE — o provider resolvido para commercial-director é "${resolvedProviderName}", não "anthropic". ` +
      "Configure AXION_AI_PROVIDER_COMMERCIAL_DIRECTOR=anthropic (ou AXION_AI_PROVIDER=anthropic) para rodar o live test."
  );
  console.log("======================================");
  process.exit(0);
}

const { resolveAiProviderForExpert } = await import("../apps/web/lib/ai/providers/resolve-provider-for-expert");
const { buildEventAnalysisContext } = await import("../apps/web/lib/ai/context/build-event-context");
const { validateExpertQueryResponse } = await import("../apps/web/lib/ai/query/validate-expert-query-response");
const { EXPERT_QUERY_RESPONSE_JSON_SCHEMA } = await import("../apps/web/lib/ai/query/json-schema");
const {
  COMMERCIAL_DIRECTOR_EXPERT_ID,
  COMMERCIAL_DIRECTOR_INSTRUCTIONS,
  COMMERCIAL_DIRECTOR_NAME,
  COMMERCIAL_DIRECTOR_VERSION,
} = await import("../apps/web/lib/ai/experts/commercial-director/identity");
const { runAnthropicCommercialDirectorLiveTest, describeErrorSafely } = await import("./lib/run-anthropic-live-test.mjs");

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log("--- Live test (somente leitura — nenhum dado será criado/alterado/apagado/enviado) ---");
console.log("Evento de referência:", REFERENCE_EVENT_ID);
console.log("Projeto de referência:", REFERENCE_PROJECT_ID);
console.log("Pergunta:", LIVE_QUESTION);
console.log("");

try {
  const result = await runAnthropicCommercialDirectorLiveTest({
    buildEventContext: () =>
      buildEventAnalysisContext(supabase, { projectId: REFERENCE_PROJECT_ID, eventId: REFERENCE_EVENT_ID }),
    resolveProvider: () => resolveAiProviderForExpert("commercial-director"),
    validateResponse: validateExpertQueryResponse,
    identity: {
      expertId: COMMERCIAL_DIRECTOR_EXPERT_ID,
      expertName: COMMERCIAL_DIRECTOR_NAME,
      expertVersion: COMMERCIAL_DIRECTOR_VERSION,
      instructions: COMMERCIAL_DIRECTOR_INSTRUCTIONS,
      outputSchema: EXPERT_QUERY_RESPONSE_JSON_SCHEMA,
    },
    question: LIVE_QUESTION,
  });

  console.log("");
  console.log("--- ExpertQueryResponse (validado) ---");
  console.log(JSON.stringify(result.response, null, 2));

  console.log("");
  console.log("--- Metadata de auditoria (provider real) ---");
  console.log(JSON.stringify(result.audit, null, 2));

  console.log("");
  console.log("======================================");
  console.log("LIVE TEST OK — nenhum dado foi criado, alterado, apagado ou enviado.");
  console.log("======================================");
} catch (error) {
  const safe = describeErrorSafely(error);
  console.log("");
  console.log("======================================");
  console.log("LIVE TEST FALHOU — erro controlado (nunca a chave, nunca o prompt/contexto integral):");
  console.log("  name:", safe.name);
  console.log("  status:", safe.status ?? "(n/a)");
  console.log("  code:", safe.code ?? "(n/a)");
  console.log("  message:", safe.message);
  console.log("Nenhum dado foi criado, alterado, apagado ou enviado.");
  console.log("======================================");
  process.exit(1);
}
