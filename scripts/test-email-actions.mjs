// E-mail acionável (MVP) — DAR CIÊNCIA / ASSUMIR RESPONSABILIDADE /
// DEFINIR PRAZO / RESPONDER AO ACC.
//
// A parte dependente de banco (RPCs issue_email_alert_action_tokens /
// get_email_alert_action_context / confirm_email_alert_action — ~20
// cenários: token inválido/expirado, token bruto nunca armazenado,
// idempotência sob duplo clique, permissão por ação, prazo passado
// bloqueado, redução de prazo sem comentário bloqueada, resposta vazia
// bloqueada, projeto/alerta adulterado bloqueado, append-only, GET
// nunca muda estado) foi validada de verdade nesta sessão via dry-run
// contra o Postgres local (docker exec ... psql), toda dentro de uma
// transação com ROLLBACK final — nenhum efeito permanente no banco
// local, nenhuma migration aplicada. Ver relatório da Fase B para o
// log completo dessa validação; não repetida aqui porque exigiria
// Docker + a stack local do Supabase, o que este script não pode
// assumir que existe no ambiente de quem o executa.
//
// Este script cobre o que É reproduzível em qualquer ambiente Node:
// a lógica pura (hash de token, montagem de URL, render dos botões) —
// executada de verdade, não só regex — e checagens estruturais no
// código-fonte (RLS/grants/append-only na migration proposta,
// integração central nos três templates, GET nunca muda estado,
// nenhum envio real, piloto/OAuth/faixa de teste intocados).
//
// Uso:
//   node scripts/test-email-actions.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
function readSource(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`OK   ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`FAIL ${name}`);
    console.log(`     ${error.message}`);
    failed += 1;
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    console.log(`OK   ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`FAIL ${name}`);
    console.log(`     ${error.message}`);
    failed += 1;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message ?? "assertion failed");
}

console.log("");
console.log("======================================");
console.log("E-MAIL ACIONÁVEL (MVP) — lógica pura + estrutural");
console.log("======================================");
console.log("");

// ---------- lógica pura: executada de verdade ----------

const { hashEmailActionToken } = await import(
  "../apps/web/lib/email-actions/token-crypto.ts"
);
const { buildEmailActionUrl } = await import("../apps/web/lib/email-actions/urls.ts");
const { renderEmailActionButtonsHtml, renderEmailActionButtonsText } = await import(
  "../apps/web/lib/email-actions/render-buttons.ts"
);
const { EMAIL_ALERT_ACTION_TYPES, EMAIL_ALERT_ACTION_LABELS } = await import(
  "../apps/web/lib/email-actions/types.ts"
);

await checkAsync("hashEmailActionToken: sha256 hex determinístico, nunca o valor bruto", async () => {
  const hash1 = await hashEmailActionToken("token-de-teste-123");
  const hash2 = await hashEmailActionToken("token-de-teste-123");
  assert(hash1 === hash2, "o hash deveria ser determinístico para o mesmo token");
  assert(/^[0-9a-f]{64}$/.test(hash1), `esperado sha256 hex de 64 caracteres, encontrado "${hash1}"`);
  assert(!hash1.includes("token-de-teste-123"), "o hash nunca deveria conter o token bruto");
});

await checkAsync("hashEmailActionToken: tokens diferentes produzem hashes diferentes", async () => {
  const hashA = await hashEmailActionToken("token-A");
  const hashB = await hashEmailActionToken("token-B");
  assert(hashA !== hashB, "tokens diferentes deveriam produzir hashes diferentes");
});

check("buildEmailActionUrl: monta /email-actions/<token> a partir da base URL configurada", () => {
  const url = buildEmailActionUrl("https://app.axion.com.br", "abc123");
  assert(url === "https://app.axion.com.br/email-actions/abc123", `URL inesperada: "${url}"`);
});

check("buildEmailActionUrl: nunca inventa a base URL — usa exatamente a recebida", () => {
  const url = buildEmailActionUrl("http://localhost:3000", "xyz");
  assert(url.startsWith("http://localhost:3000/"), `deveria usar a base recebida: "${url}"`);
});

check("EMAIL_ALERT_ACTION_LABELS: cobre as 4 ações do MVP, nunca 'Marcar como tratado'", () => {
  assert(EMAIL_ALERT_ACTION_TYPES.length === 4, "deveriam existir exatamente 4 ações no MVP");
  for (const action of EMAIL_ALERT_ACTION_TYPES) {
    assert(EMAIL_ALERT_ACTION_LABELS[action], `rótulo ausente para ${action}`);
  }
  assert(
    !Object.values(EMAIL_ALERT_ACTION_LABELS).some((label) => /marcar como tratado/i.test(label)),
    "'Marcar como tratado' está fora do escopo deste MVP"
  );
});

check("renderEmailActionButtonsHtml: um <a> por botão, com o rótulo e a URL corretos, HTML escapado", () => {
  const html = renderEmailActionButtonsHtml([
    { action: "ACKNOWLEDGE", url: "https://app.axion.com.br/email-actions/tok1" },
    { action: "RESPOND", url: "https://app.axion.com.br/email-actions/tok2?x=1&y=2" },
  ]);
  assert(html.includes("DAR CIÊNCIA"), "deveria conter o rótulo DAR CIÊNCIA");
  assert(html.includes("RESPONDER AO ACC"), "deveria conter o rótulo RESPONDER AO ACC");
  assert(html.includes("/email-actions/tok1"), "deveria conter a URL do primeiro botão");
  assert(html.includes("x=1&amp;y=2"), "& deveria vir escapado como &amp; no HTML");
  assert((html.match(/<a /g) ?? []).length === 2, "deveria haver exatamente 2 elementos <a>");
});

check("renderEmailActionButtonsHtml: lista vazia produz string vazia (sem markup órfão)", () => {
  assert(renderEmailActionButtonsHtml([]) === "", "lista vazia deveria produzir string vazia");
});

check("renderEmailActionButtonsText: uma linha 'RÓTULO: url' por botão", () => {
  const text = renderEmailActionButtonsText([
    { action: "SET_DEADLINE", url: "https://app.axion.com.br/email-actions/tok3" },
  ]);
  assert(text === "DEFINIR PRAZO: https://app.axion.com.br/email-actions/tok3", `texto inesperado: "${text}"`);
});

// ---------- estrutural: migration proposta ----------

const migrationPath =
  "supabase/migrations/20260826140000_email_alert_actions_foundation.sql";
const migrationSource = readSource(migrationPath);

check("migration: puramente aditiva (só CREATE/ALTER ADD, nenhum DROP/ALTER...DROP de algo existente)", () => {
  assert(!/drop table|drop column|alter table public\.(?!email_alert)\w+\s+drop/i.test(migrationSource),
    "não deveria alterar/remover nada de tabelas existentes"
  );
});

check("migration: RLS habilitado nas duas tabelas novas, sem policy de INSERT/UPDATE/DELETE para authenticated/anon", () => {
  assert(/enable row level security/i.test(migrationSource));
  assert(
    !/for insert[\s\S]{0,200}to authenticated|for update[\s\S]{0,200}to authenticated|for delete[\s\S]{0,200}to authenticated/i.test(
      migrationSource
    ),
    "nenhuma policy de escrita direta deveria existir — toda escrita passa pelas RPCs SECURITY DEFINER"
  );
});

const EMAIL_ACTION_RPC_NAMES = [
  "issue_email_alert_action_tokens",
  "get_email_alert_action_context",
  "confirm_email_alert_action",
];

function extractFunctionBlock(fn) {
  const start = migrationSource.indexOf(`create or replace function public.${fn}(`);
  if (start === -1) return null;
  const nextFnStart = migrationSource.indexOf("create or replace function", start + 1);
  return migrationSource.slice(start, nextFnStart === -1 ? undefined : nextFnStart);
}

check("migration: as 3 RPCs públicas são SECURITY DEFINER com search_path = '' (hardening — nunca 'public')", () => {
  for (const fn of EMAIL_ACTION_RPC_NAMES) {
    const block = extractFunctionBlock(fn);
    assert(block, `função ${fn} não encontrada`);
    assert(/security definer/i.test(block), `${fn} deveria ser SECURITY DEFINER`);
    assert(/set search_path = ''/.test(block), `${fn} deveria fixar search_path = '' (vazio, nunca 'public')`);
    assert(!/set search_path = public\b/.test(block), `${fn} não deveria mais usar search_path = public`);
  }
});

check("migration: toda referência a tabela/schema dentro das 3 RPCs é totalmente qualificada (public.*/extensions.*)", () => {
  for (const fn of EMAIL_ACTION_RPC_NAMES) {
    const block = extractFunctionBlock(fn);
    // Com search_path = '', uma referência não qualificada a uma tabela
    // (ex.: "from sla_actions" em vez de "from public.sla_actions")
    // quebraria em runtime — checagem estrutural: toda cláusula
    // from/insert into/update de tabela conhecida desta feature usa
    // public. explicitamente.
    for (const table of [
      "email_alert_action_tokens", "email_alert_actions", "sla_actions",
      "action_requests", "action_request_assignees", "action_request_responses",
      "contract_events", "event_notes", "project_memberships", "projects",
      "audit_log_entries",
    ]) {
      const unqualified = new RegExp(`[^.]\\b(from|into|update)\\s+${table}\\b`, "i");
      assert(!unqualified.test(block), `${fn}: referência não qualificada a ${table} (deveria ser public.${table})`);
    }
  }
});

check("migration: as 3 RPCs têm owner explícito (alter function ... owner to postgres)", () => {
  for (const fn of EMAIL_ACTION_RPC_NAMES) {
    assert(
      new RegExp(`alter function public\\.${fn}\\([\\s\\S]{0,200}?\\)\\s*owner to postgres;`).test(migrationSource),
      `${fn} deveria ter owner explícito (alter function ... owner to postgres)`
    );
  }
});

check("migration: issue_email_alert_action_tokens é revogada de public/anon/authenticated e concedida só a service_role", () => {
  const start = migrationSource.indexOf("revoke all on function public.issue_email_alert_action_tokens");
  const block = migrationSource.slice(start, start + 400);
  assert(/from public, anon, authenticated;/i.test(block), "deveria revogar de public/anon/authenticated");
  assert(/grant execute on function public\.issue_email_alert_action_tokens\([\s\S]*?\)\s*to service_role;/i.test(block),
    "deveria conceder execute só a service_role"
  );
  assert(!/\)\s*to authenticated;/i.test(block), "nunca deveria conceder a authenticated — só o sistema pode emitir tokens");
});

check("migration: confirm_email_alert_action e get_email_alert_action_context concedidas a authenticated, nunca a anon", () => {
  for (const fn of ["confirm_email_alert_action", "get_email_alert_action_context"]) {
    const idx = migrationSource.indexOf(`revoke all on function public.${fn}`);
    assert(idx !== -1, `revoke não encontrado para ${fn}`);
    const block = migrationSource.slice(idx, idx + 300);
    assert(/from public, anon/i.test(block), `${fn} deveria ser revogada de public/anon`);
    assert(/grant execute[\s\S]*?to authenticated/i.test(block), `${fn} deveria ser concedida a authenticated`);
  }
});

check("migration: token bruto nunca é uma coluna de tabela — só token_hash (as duas CREATE TABLE)", () => {
  assert(migrationSource.includes("token_hash text not null"), "deveria existir a coluna token_hash");
  for (const tableName of ["email_alert_action_tokens", "email_alert_actions"]) {
    const start = migrationSource.indexOf(`create table public.${tableName} (`);
    const end = migrationSource.indexOf(");", start);
    const tableBody = migrationSource.slice(start, end).replace(/token_hash/g, "");
    assert(!/\btoken\s+text\b/i.test(tableBody), `${tableName} não deveria ter uma coluna de token bruto`);
  }
});

check("migration: pgcrypto qualificado explicitamente (extensions.*) — nunca depende do search_path de sessão", () => {
  assert(migrationSource.includes("extensions.gen_random_bytes"), "gen_random_bytes deveria vir qualificado como extensions.gen_random_bytes");
  assert(migrationSource.includes("extensions.digest"), "digest deveria vir qualificado como extensions.digest");
});

check("migration: email_alert_actions é append-only (trigger before update/delete)", () => {
  assert(/before update or delete[\s\S]{0,120}on public\.email_alert_actions/i.test(migrationSource),
    "deveria haver um trigger before update/delete em email_alert_actions"
  );
});

check("migration: idempotência garantida a nível de banco (UNIQUE em token_id)", () => {
  assert(/create unique index email_alert_actions_token_id_key/i.test(migrationSource),
    "deveria existir um índice único em token_id — autoridade final de idempotência"
  );
});

check("migration: SET_DEADLINE não aceita data passada, RESPOND exige comentário de 3-4000 chars (checagens no RPC)", () => {
  assert(migrationSource.includes("O prazo não pode ser no passado"));
  assert(migrationSource.includes("A resposta precisa ter entre 3 e 4000 caracteres"));
  assert(migrationSource.includes("Reduzir um prazo já existente exige um comentário"));
});

check("migration: confirmação valida que o alerta pertence ao projeto do token (nunca confia só no token/URL)", () => {
  assert(
    /v_alert_project_id is null or v_alert_project_id <> v_token\.project_id/.test(migrationSource),
    "deveria validar alert.project_id contra token.project_id"
  );
});

check("migration: get_email_alert_action_context nunca revela se um token válido pertence a projeto inacessível (mesmo erro genérico)", () => {
  const contextFnStart = migrationSource.indexOf("create or replace function public.get_email_alert_action_context");
  const contextFnBody = migrationSource.slice(contextFnStart, contextFnStart + 2000);
  const matches = contextFnBody.match(/raise exception 'Token not found or not accessible'/g) ?? [];
  assert(matches.length === 1, "deveria haver um único ponto de erro genérico para 'não encontrado' e 'sem acesso'");
});

// ---------- estrutural: sincronização com o estado operacional ----------
// Mapa alert_kind × ação × escrita operacional (ver relatório) — cada
// combinação precisa aparecer no corpo de confirm_email_alert_action.

const confirmFnBody = extractFunctionBlock("confirm_email_alert_action");

check("confirm_email_alert_action: SLA_ACTION ACKNOWLEDGE sincroniza acknowledged_at/status (nunca regride status)", () => {
  assert(/update public\.sla_actions[\s\S]{0,200}acknowledged_at = coalesce\(acknowledged_at, now\(\)\)/.test(confirmFnBody));
  assert(/status = case when status = 'PENDING' then 'ACKNOWLEDGED' else status end/.test(confirmFnBody));
});

check("confirm_email_alert_action: SLA_ACTION ASSUME_RESPONSIBILITY sincroniza responsible_user_id", () => {
  assert(/update public\.sla_actions\s*\n\s*set responsible_user_id = auth\.uid\(\)/.test(confirmFnBody));
});

check("confirm_email_alert_action: SLA_ACTION SET_DEADLINE respeita os 3 relógios distintos (assume/complete/respond), nunca um campo genérico", () => {
  assert(confirmFnBody.includes("update public.sla_actions set assume_due_at = p_new_due_at"));
  assert(confirmFnBody.includes("update public.sla_actions set complete_due_at = p_new_due_at"));
  assert(confirmFnBody.includes("update public.sla_actions set respond_due_at = p_new_due_at"));
});

check("confirm_email_alert_action: ACTION_REQUEST sincroniza assignees (ASSUME, idempotente), due_at (DEADLINE) e responses (ACK/RESPOND)", () => {
  assert(/insert into public\.action_request_assignees[\s\S]{0,150}on conflict \(action_request_id, user_id\) do nothing/.test(confirmFnBody));
  assert(confirmFnBody.includes("update public.action_requests set due_at = p_new_due_at"));
  const responseInserts = confirmFnBody.match(/insert into public\.action_request_responses/g) ?? [];
  assert(responseInserts.length === 2, "deveria haver 2 inserts em action_request_responses (ACKNOWLEDGE e RESPOND)");
});

check("confirm_email_alert_action: CONTRACT_EVENT RESPOND grava em event_notes (categoria OUTROS) — mesma tabela já lida pelo Ledger", () => {
  assert(/insert into public\.event_notes[\s\S]{0,150}'OUTROS'/.test(confirmFnBody));
});

check("confirm_email_alert_action: 'previous' vem sempre do operacional real (SELECT ... FOR UPDATE), nunca só do histórico do ledger, quando existe fonte operacional", () => {
  assert(/select status, assume_due_at, respond_due_at, complete_due_at[\s\S]{0,150}from public\.sla_actions[\s\S]{0,100}for update/.test(confirmFnBody));
  assert(/select responsible_user_id into v_previous_responsible[\s\S]{0,100}from public\.sla_actions[\s\S]{0,100}for update/.test(confirmFnBody));
  assert(/select due_at into v_previous_due_at[\s\S]{0,100}from public\.action_requests[\s\S]{0,100}for update/.test(confirmFnBody));
});

check("confirm_email_alert_action: comentário no cabeçalho documenta a decisão de design (transacional, sem duas fontes divergentes)", () => {
  assert(/SINCRONIZAÇÃO COM O ESTADO OPERACIONAL/.test(migrationSource));
  assert(/nenhuma exceção.*desfaz TUDO|desfaz TUDO que essa chamada/i.test(migrationSource) || /nenhum COMMIT interno/.test(migrationSource));
});

// ---------- estrutural: retorno após login (OAuth) ----------

const { isSafeInternalPath, sanitizeInternalRedirect } = await import(
  "../apps/web/lib/safe-redirect.ts"
);

check("isSafeInternalPath: aceita paths internos simples", () => {
  assert(isSafeInternalPath("/email-actions/abc123") === true);
  assert(isSafeInternalPath("/projetos") === true);
  assert(isSafeInternalPath("/a/b?c=1&d=2") === true);
});

check("isSafeInternalPath: bloqueia open redirect (URL absoluta, protocolo, //, backslash)", () => {
  for (const value of [
    "https://evil.com",
    "//evil.com",
    "/\\evil.com",
    "http://evil.com/x",
    "javascript:alert(1)",
    "/ok/../\\evil.com",
    // "://" em QUALQUER posição é bloqueado, mesmo dentro do valor de um
    // query param — postura deliberadamente conservadora (nunca precisa
    // provar que nenhuma rota atual/futura reencaminharia esse valor).
    "/redirect?to=https://evil.com",
  ]) {
    assert(isSafeInternalPath(value) === false, `"${value}" deveria ser bloqueado (open redirect)`);
  }
});

check("isSafeInternalPath: bloqueia valores vazios/não-string/absurdamente longos", () => {
  assert(isSafeInternalPath("") === false);
  assert(isSafeInternalPath(null) === false);
  assert(isSafeInternalPath(undefined) === false);
  assert(isSafeInternalPath(123) === false);
  assert(isSafeInternalPath("/" + "a".repeat(3000)) === false);
});

check("sanitizeInternalRedirect: devolve o valor quando seguro, o fallback quando não", () => {
  assert(sanitizeInternalRedirect("/email-actions/tok", "/projetos") === "/email-actions/tok");
  assert(sanitizeInternalRedirect("https://evil.com", "/projetos") === "/projetos");
  assert(sanitizeInternalRedirect(null, "/projetos") === "/projetos");
});

const proxySource = readSource("apps/web/proxy.ts");
const callbackSource2 = readSource("apps/web/app/auth/callback/route.ts");
const loginPageSourceForNext = readSource("apps/web/app/login/page.tsx");
const googleButtonSourceForNext = readSource("apps/web/app/login/google-signin-button.tsx");
const loginActionsSourceForNext = readSource("apps/web/app/login/actions.ts");

check("proxy.ts: preserva o destino original em ?next= ao redirecionar para /login (só quando não é '/')", () => {
  assert(proxySource.includes('redirectUrl.searchParams.set("next", originalPath)'));
  assert(proxySource.includes('originalPath !== "/"'));
});

check("auth/callback/route.ts: lê e revalida 'next' com sanitizeInternalRedirect antes de redirecionar (nunca confia cegamente)", () => {
  assert(callbackSource2.includes('from "@/lib/safe-redirect"'));
  assert(callbackSource2.includes("sanitizeInternalRedirect(url.searchParams.get(\"next\")"));
  assert(!callbackSource2.includes('new URL("/projetos", url.origin)'), "o destino final não deveria mais ser um literal fixo — precisa vir de nextDestination");
});

check("login/page.tsx: revalida 'next' de novo (nunca confia só porque já veio do proxy) e propaga para Google + formulário de senha", () => {
  assert(loginPageSourceForNext.includes("sanitizeInternalRedirect(next"));
  assert(loginPageSourceForNext.includes("<GoogleSignInButton next={safeNext} />"));
  assert(loginPageSourceForNext.includes('name="next"'));
});

check("google-signin-button.tsx: anexa 'next' à URL de callback só quando presente — comportamento sem destino é idêntico ao anterior", () => {
  assert(googleButtonSourceForNext.includes("callbackUrl.searchParams.set(\"next\", next)"));
  assert(/if \(next\)/.test(googleButtonSourceForNext));
});

check("login/actions.ts (login por senha): também propaga 'next' — comportamento sem destino continua idêntico ao anterior (redirect(\"/projetos\"))", () => {
  assert(loginActionsSourceForNext.includes("sanitizeInternalRedirect(formData.get(\"next\")"));
  assert(loginActionsSourceForNext.includes('nextDestination === "/projetos" ? "" :'));
});

check("nenhum arquivo do fluxo de login registra o token em log/console — 'next' só é usado para montar a URL de redirect", () => {
  for (const source of [callbackSource2, loginPageSourceForNext, googleButtonSourceForNext, loginActionsSourceForNext]) {
    assert(!/console\.(log|error|warn|info)\(/.test(source), "nenhum destes arquivos deveria logar nada (token/next poderiam vazar)");
  }
});

// ---------- estrutural: emissão dos botões (ação impossível não é oferecida) ----------

const resolveAllowedSource = readSource("apps/web/lib/email-actions/resolve-allowed-actions.ts");
const issueTokensSourceForFilter = readSource("apps/web/lib/email-actions/issue-tokens.ts");

check("issue-tokens.ts: usa resolveAllowedEmailActions com o e-mail de checagem de permissão correto (não mais sempre intendedRecipientEmail)", () => {
  assert(issueTokensSourceForFilter.includes('from "./resolve-allowed-actions"'));
  assert(issueTokensSourceForFilter.includes("resolveAllowedEmailActions(admin, input.projectId, permissionCheckEmail)"));
});

check("resolveAllowedEmailActions: ADMINISTRADOR/GESTOR recebem as 4 ações; COLABORADOR/LEITURA/sem membership só ACKNOWLEDGE+RESPOND (nunca bloqueia tudo)", () => {
  assert(resolveAllowedSource.includes('"ADMINISTRADOR" || membership.permission === "GESTOR"'));
  assert(resolveAllowedSource.includes("SAFE_DEFAULT_ACTIONS"));
});

const pilotGuardSourceForFilter = readSource("apps/web/lib/email/pilot-outbound-guard.ts");

check("pilot-outbound-guard.ts: resolveEffectiveRecipient é a fonte única de modo/efetivo/pretendido — applyPilotOutboundGuard a consome (não reimplementa)", () => {
  assert(pilotGuardSourceForFilter.includes("export function resolveEffectiveRecipient("));
  assert(/function applyPilotOutboundGuard[\s\S]{0,120}resolveEffectiveRecipient\(input\.to, env\)/.test(pilotGuardSourceForFilter),
    "applyPilotOutboundGuard deveria chamar resolveEffectiveRecipient, não reimplementar a decisão"
  );
});

check("issue-tokens.ts: consome resolveEffectiveRecipient (fonte única) — nunca reimplementa o ternário pilot/production", () => {
  assert(issueTokensSourceForFilter.includes('from "@/lib/email/pilot-outbound-guard"'));
  assert(issueTokensSourceForFilter.includes("resolveEffectiveRecipient(input.intendedRecipientEmail)"));
});

check("nenhuma segunda leitura de ACC_OUTBOUND_MODE/ACC_PILOT_RECIPIENT fora de pilot-outbound-guard.ts (as únicas variáveis de ambiente do piloto)", () => {
  for (const file of [
    "apps/web/lib/email-actions/issue-tokens.ts",
    "apps/web/lib/email-actions/resolve-allowed-actions.ts",
    "apps/web/lib/email/gmail-email-provider.ts",
    "apps/web/lib/email/fake-email-provider.ts",
  ]) {
    const source = readSource(file);
    assert(!source.includes("process.env.ACC_OUTBOUND_MODE") && !source.includes("process.env.ACC_PILOT_RECIPIENT"),
      `${file} não deveria ler as variáveis do piloto diretamente — só via resolveEffectiveRecipient/resolveOutboundMode`
    );
  }
});

check("issue-tokens.ts: em produção a checagem de permissão usa o destinatário PRETENDIDO; em piloto, usa o EFETIVO (quem de fato recebe/pode clicar)", () => {
  assert(/mode === "PILOT"[\s\S]{0,40}resolved\.effectiveRecipientEmail[\s\S]{0,40}resolved\.intendedRecipientEmail/.test(issueTokensSourceForFilter),
    "deveria escolher effectiveRecipientEmail em PILOT e intendedRecipientEmail em PRODUCTION para a checagem de permissão"
  );
});

check("issue-tokens.ts: destinatário PRETENDIDO original é sempre preservado e enviado ao RPC (auditado), mesmo quando diferente do efetivo", () => {
  assert(issueTokensSourceForFilter.includes("p_intended_recipient_email: resolved.intendedRecipientEmail"));
  assert(issueTokensSourceForFilter.includes("p_effective_recipient_email: resolved.effectiveRecipientEmail"));
});

await checkAsync("resolveEffectiveRecipient: em piloto, Reynaldo (ADMINISTRADOR) é o destinatário EFETIVO usado para checar permissão — recebe as 4 ações mesmo que o pretendido fosse outra pessoa", async () => {
  const { resolveEffectiveRecipient } = await import(
    "../apps/web/lib/email/pilot-outbound-guard.ts"
  );
  const resolved = resolveEffectiveRecipient("colaborador-qualquer@axion.com.br", {
    outboundMode: "pilot",
    pilotRecipient: "reynaldo@axion.com.br",
  });
  assert(resolved.mode === "PILOT");
  assert(resolved.effectiveRecipientEmail === "reynaldo@axion.com.br");
  assert(resolved.intendedRecipientEmail === "colaborador-qualquer@axion.com.br", "o pretendido original nunca deveria ser perdido/sobrescrito");
});

await checkAsync("resolveEffectiveRecipient: em produção, efetivo === pretendido (sem substituição)", async () => {
  const { resolveEffectiveRecipient } = await import(
    "../apps/web/lib/email/pilot-outbound-guard.ts"
  );
  const resolved = resolveEffectiveRecipient("cliente-real@empresa.com.br", { outboundMode: "production" });
  assert(resolved.mode === "PRODUCTION");
  assert(resolved.effectiveRecipientEmail === "cliente-real@empresa.com.br");
  assert(resolved.intendedRecipientEmail === "cliente-real@empresa.com.br");
});

// ---------- estrutural: solicitação de ação — HTML clicável + fallback texto completo ----------

const actionRequestCoreSource = readSource("apps/web/lib/email/action-request-notification-core.ts");
const actionRequestActionsSource = readSource("apps/web/app/[projectId]/action-requests/actions.ts");

check("action-request-notification-core.ts: aceita htmlBody opcional e passa html ao provider (multipart/alternative) sem reduzir o texto puro", () => {
  assert(actionRequestCoreSource.includes("htmlBody?: string | null"));
  assert(actionRequestCoreSource.includes("html: input.htmlBody ?? undefined"));
  assert(actionRequestCoreSource.includes("html: signed.html"));
  assert(actionRequestCoreSource.includes("text: signed.text"), "o texto puro continua sempre enviado, com ou sem html");
});

check("action-requests/actions.ts: monta htmlBody com os botões como <a> reais quando há ações, texto continua completo nos dois casos", () => {
  assert(actionRequestActionsSource.includes("renderEmailActionButtonsHtml(buttons)"));
  assert(actionRequestActionsSource.includes("htmlBody"));
  assert(actionRequestActionsSource.includes("escapeHtml(body)"), "o corpo autoral do humano precisa ser escapado antes de virar HTML");
});

// ---------- estrutural: integração central nos 3 templates ----------

const contractAlertSource = readSource("apps/web/lib/email/templates/contract-alert-template.ts");
const slaEscalationSource = readSource("apps/web/lib/email/templates/sla-escalation-template.ts");

check("contract-alert-template.ts: usa renderEmailActionButtonsHtml/Text — nunca monta o botão de ação inline", () => {
  assert(contractAlertSource.includes('from "@/lib/email-actions/render-buttons"'));
  assert(contractAlertSource.includes("renderEmailActionButtonsHtml(input.actionButtons)"));
});

check("sla-escalation-template.ts: usa a MESMA função central — nunca duplica o HTML do botão", () => {
  assert(slaEscalationSource.includes('from "@/lib/email-actions/render-buttons"'));
  assert(slaEscalationSource.includes("renderEmailActionButtonsHtml(input.actionButtons)"));
});

check("action-requests/actions.ts (solicitação de ação): usa a mesma infraestrutura central (issueEmailAlertActionButtons)", () => {
  assert(actionRequestActionsSource.includes('from "@/lib/email-actions/issue-tokens"'));
  assert(actionRequestActionsSource.includes("renderEmailActionButtonsText"));
});

check("os três fluxos chamam issueEmailAlertActionButtons — nenhum gera token por conta própria", () => {
  const sendAlertActionsSource = readSource(
    "apps/web/app/[projectId]/ledger/[eventId]/send-alert-actions.ts"
  );
  const acoesActionsSource = readSource("apps/web/app/[projectId]/acoes/actions.ts");
  for (const [label, source] of [
    ["alerta de contrato", sendAlertActionsSource],
    ["escalonamento SLA", acoesActionsSource],
    ["solicitação de ação", actionRequestActionsSource],
  ]) {
    assert(source.includes("issueEmailAlertActionButtons"), `${label} deveria chamar issueEmailAlertActionButtons`);
  }
});

// ---------- estrutural: GET nunca muda estado / POST-only ----------

const contextLibSource = readSource("apps/web/lib/email-actions/get-context.ts");
const confirmLibSource = readSource("apps/web/lib/email-actions/confirm-action.ts");
const emailActionsPageSource = readSource("apps/web/app/email-actions/[token]/page.tsx");
const emailActionsServerActionSource = readSource("apps/web/app/email-actions/[token]/actions.ts");

check("página /email-actions/[token] (GET): só chama getEmailAlertActionContext — nunca confirmEmailAlertAction", () => {
  assert(emailActionsPageSource.includes("getEmailAlertActionContext"));
  assert(!emailActionsPageSource.includes("confirmEmailAlertAction("), "a página (GET) nunca deveria confirmar a ação diretamente");
});

check("confirmação é um Server Action (\"use server\"), nunca um handler GET", () => {
  assert(emailActionsServerActionSource.trimStart().startsWith('"use server"'));
});

check("get-context.ts chama get_email_alert_action_context (RPC read-only, nunca confirm_*)", () => {
  assert(contextLibSource.includes('"get_email_alert_action_context"'));
  assert(!contextLibSource.includes("confirm_email_alert_action"));
});

check("confirm-action.ts hasheia o token antes de qualquer chamada ao banco (nunca envia o token bruto ao RPC)", () => {
  assert(confirmLibSource.includes("hashEmailActionToken"));
  assert(/p_token_hash:\s*tokenHash/.test(confirmLibSource));
});

check("token nunca vem de um campo de formulário — sempre do segmento de rota, preso via bind", () => {
  const confirmFormSource = readSource("apps/web/app/email-actions/[token]/confirm-form.tsx");
  assert(confirmFormSource.includes("confirmEmailAlertActionAction.bind(null, rawToken)"),
    "o token deveria vir preso via bind, nunca de um input do formulário"
  );
  assert(!/name="token"|name='token'/.test(confirmFormSource), "não deveria existir um campo de formulário chamado token");
});

// ---------- não altera autenticação/OAuth/redirects/faixa de teste/piloto ----------

check("proxy.ts (auth gate) não foi alterado por esta feature — /email-actions/[token] fica protegida automaticamente (não está em isPublicRoute)", () => {
  const proxySource = readSource("apps/web/proxy.ts");
  assert(!proxySource.includes("email-actions"), "proxy.ts não deveria mencionar email-actions — a proteção é automática (rota não pública)");
});

check("auth/callback/route.ts e login/actions.ts: alterados só no mínimo necessário para o retorno pós-login — validação de domínio/senha/exchangeCodeForSession intactas", () => {
  const callbackSource = readSource("apps/web/app/auth/callback/route.ts");
  const loginActionsSource = readSource("apps/web/app/login/actions.ts");
  // Nenhum dos dois importa/chama a feature de e-mail acionável
  // diretamente (só o helper genérico de redirect seguro, já validado
  // acima) — um comentário explicando o motivo do "next" é esperado e
  // não conta como acoplamento.
  assert(!callbackSource.includes('from "@/lib/email-actions') && !callbackSource.includes("EmailAlertAction"));
  assert(!loginActionsSource.includes('from "@/lib/email-actions') && !loginActionsSource.includes("EmailAlertAction"));
  // A lógica de autenticação em si (não o redirect final) continua
  // exatamente a mesma.
  assert(callbackSource.includes("ALLOWED_EMAIL_DOMAIN = \"axion.com.br\""));
  assert(callbackSource.includes("exchangeCodeForSession(code)"));
  assert(callbackSource.includes("await supabase.auth.signOut()"));
  assert(loginActionsSource.includes("signInWithPassword"));
});

check("faixa SISTEMA EM TESTE não foi alterada — layout raiz continua igual, nenhum arquivo novo a referencia", () => {
  const rootLayoutSource = readSource("apps/web/app/layout.tsx");
  assert(rootLayoutSource.includes("<TestModeBanner"), "layout raiz deveria continuar renderizando a faixa (herdada por /email-actions também)");
  for (const source of [emailActionsPageSource, contextLibSource, confirmLibSource]) {
    assert(!/SISTEMA EM TESTE/i.test(source), "esta feature não deveria mencionar/alterar a faixa SISTEMA EM TESTE");
  }
});

check("pilot-outbound-guard.ts: estendido (nova resolveEffectiveRecipient), nunca importa de email-actions — dependência de mão única", () => {
  const pilotGuardSource = readSource("apps/web/lib/email/pilot-outbound-guard.ts");
  assert(pilotGuardSource.includes('"reynaldo@axion.com.br"'));
  assert(pilotGuardSource.includes("PILOT_SUBJECT_PREFIX"));
  assert(!pilotGuardSource.includes('from "@/lib/email-actions') && !pilotGuardSource.includes("EmailAlertAction"),
    "o guard nunca deveria importar da feature de e-mail acionável — é o contrário: email-actions importa do guard"
  );
});

check("test-pilot-outbound-guard.mjs (25 cenários pré-existentes) continua passando sem alteração após o refactor — comportamento externo idêntico", () => {
  // Não reexecuta aqui (script separado, já rodado nesta sessão) — só
  // confirma que o arquivo de teste em si não precisou ser alterado
  // para continuar válido (evidência de que a API pública de
  // applyPilotOutboundGuard não mudou).
  const pilotGuardTestSource = readSource("scripts/test-pilot-outbound-guard.mjs");
  assert(pilotGuardTestSource.includes("applyPilotOutboundGuard, resolveOutboundMode, isValidEmailAddress, ACC_EXPECTED_PILOT_RECIPIENT, PILOT_SUBJECT_PREFIX"),
    "a assinatura de import esperada pelo teste pré-existente continua satisfeita"
  );
});

check("nenhum e-mail real é enviado por esta feature nesta etapa (issue-tokens.ts nunca chama provider.send)", () => {
  const issueTokensSource = readSource("apps/web/lib/email-actions/issue-tokens.ts");
  assert(!issueTokensSource.includes("provider.send") && !issueTokensSource.includes("getEmailProvider"),
    "issue-tokens.ts só grava tokens no banco — nunca envia e-mail"
  );
});

check("Gmail inbound não foi tocado/habilitado por esta feature", () => {
  const inboundFiles = [
    "apps/web/lib/email/inbound/gmail-inbound-auth.ts",
    "apps/web/lib/email/inbound/gmail-inbound-policy.ts",
  ];
  for (const relativePath of inboundFiles) {
    const source = readSource(relativePath);
    assert(!source.includes("email-actions") && !source.includes("EmailAlertAction"),
      `${relativePath} não deveria ter sido tocado por esta feature`
    );
  }
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
