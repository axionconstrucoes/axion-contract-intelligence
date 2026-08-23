// Testes de "Ingestão Controlada de E-mails @axion.com.br" (Integrações
// → Gmail/E-mails) — preparação do ACC para conectar contas Google
// Workspace e confirmar a primeira sincronização real, seção por seção
// do requisito. Lógica pura (classificação, progresso, eligibilidade)
// testada com fixtures em memória — nenhuma chamada real ao Gmail em
// lugar nenhum deste arquivo. RPCs novas testadas contra o Supabase
// real (service-role para fixtures, client anônimo + usuário real para
// provar RLS/permissão em runtime). NUNCA chama a API Anthropic — este
// pacote não envolve IA generativa.
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/test-gmail-ingestion-controls.mjs

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const { evaluateGmailMessagePolicy } = await import("../apps/web/lib/email/inbound/gmail-inbound-policy");
const { classifyCommunicationScope } = await import("../apps/web/lib/email/inbound/ingestion-controls/classify-communication-scope");
const { computeSyncProgress } = await import("../apps/web/lib/email/inbound/ingestion-controls/compute-sync-progress");
const { classifyInitialLifecycleStatus } = await import("../apps/web/lib/additionals/findings/classify-finding-lifecycle");
const { ACC_FEATURE_HELP } = await import("../apps/web/lib/ui/feature-help");
const { EXPERT_PROVIDER_ENV_VAR } = await import("../apps/web/lib/ai/providers/resolve-provider-for-expert");

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

// Nunca chama IA real.
const ALL_PROVIDER_ENV_VARS = [...Object.values(EXPERT_PROVIDER_ENV_VAR), "AXION_AI_PROVIDER"];
const originalProviderEnv = Object.fromEntries(ALL_PROVIDER_ENV_VARS.map((name) => [name, process.env[name]]));
for (const name of ALL_PROVIDER_ENV_VARS) process.env[name] = "fake";
function restoreProviderEnv() {
  for (const name of ALL_PROVIDER_ENV_VARS) {
    if (originalProviderEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalProviderEnv[name];
  }
}

console.log("");
console.log("======================================");
console.log("INGESTÃO CONTROLADA DE E-MAILS — TESTES");
console.log("======================================");
console.log("");

// ---------------- classificação AXION↔AXION x AXION↔CLIENTE (seção 10) ----------------

check("comunicação interna: todos os participantes @axion.com.br => INTERNAL_AXION_COMMUNICATION", () => {
  const scope = classifyCommunicationScope(["ana@axion.com.br", "bruno@axion.com.br"], "axion.com.br");
  assert(scope === "INTERNAL_AXION_COMMUNICATION");
});

check("comunicação com cliente: qualquer participante fora do domínio AXION => CLIENT_COMMUNICATION", () => {
  const scope = classifyCommunicationScope(["ana@axion.com.br", "contato@weg.net"], "axion.com.br");
  assert(scope === "CLIENT_COMMUNICATION");
});

check("e-mail interno relevante NUNCA é excluído por ser interno: evaluateGmailMessagePolicy aceita AXION↔AXION quando axion.com.br está nos domínios permitidos", () => {
  const headers = [
    { name: "From", value: "ana@axion.com.br" },
    { name: "To", value: "bruno@axion.com.br" },
  ];
  const policy = evaluateGmailMessagePolicy(headers, "ana@axion.com.br", ["axion.com.br"]);
  assert(policy.eligible === true, "e-mail interno AXION↔AXION deveria ser elegível quando axion.com.br está autorizado");
  const scope = classifyCommunicationScope(policy.addresses, "axion.com.br");
  assert(scope === "INTERNAL_AXION_COMMUNICATION");
});

check("não confunde mensagem interna com manifestação do cliente: mesma mensagem nunca é CLIENT_COMMUNICATION se não há participante do domínio do cliente", () => {
  const headers = [
    { name: "From", value: "ana@axion.com.br" },
    { name: "To", value: "bruno@axion.com.br" },
    { name: "Cc", value: "carla@axion.com.br" },
  ];
  const policy = evaluateGmailMessagePolicy(headers, "ana@axion.com.br", ["axion.com.br"]);
  const scope = classifyCommunicationScope(policy.addresses, "axion.com.br");
  assert(scope !== "CLIENT_COMMUNICATION", "sem nenhum participante do cliente, nunca deveria ser rotulada como comunicação do cliente");
});

check("mensagem AXION↔CLIENTE continua sendo reconhecida corretamente", () => {
  const headers = [
    { name: "From", value: "ana@axion.com.br" },
    { name: "To", value: "contato@weg.net" },
  ];
  const policy = evaluateGmailMessagePolicy(headers, "ana@axion.com.br", ["axion.com.br", "weg.net"]);
  assert(policy.eligible === true);
  const scope = classifyCommunicationScope(policy.addresses, "axion.com.br");
  assert(scope === "CLIENT_COMMUNICATION");
});

// ---------------- progresso real (seção 13/14) ----------------

function makeRun(overrides) {
  return {
    id: "run-1",
    configId: "cfg-1",
    projectId: "proj-1",
    status: "RUNNING",
    emailsFound: null,
    emailsImported: 0,
    attachmentsFound: 0,
    attachmentsProcessed: 0,
    findingsGenerated: 0,
    failuresCount: 0,
    errorMessage: null,
    startedByUserId: "user-1",
    startedAt: "2026-08-23T10:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

check("progresso: denominador desconhecido => fase 'Preparando...', percent null (nunca 0% fake)", () => {
  const progress = computeSyncProgress(makeRun({ emailsFound: null }));
  assert(progress.phase === "PREPARING");
  assert(progress.percent === null, "sem denominador conhecido, percent nunca deveria ser um número (nem 0)");
});

check("progresso: determinístico a partir de contadores reais (nunca timer)", () => {
  const progress = computeSyncProgress(makeRun({ emailsFound: 200, emailsImported: 68 }));
  assert(progress.phase === "RUNNING");
  assert(progress.percent === 34, `esperado 34%, obtido ${progress.percent}`);
});

check("progresso: COMPLETED sempre 100%", () => {
  const progress = computeSyncProgress(makeRun({ status: "COMPLETED", emailsFound: 50, emailsImported: 50, completedAt: "2026-08-23T11:00:00.000Z" }));
  assert(progress.percent === 100);
});

check("progresso: FAILED nunca mostra percentual de sucesso", () => {
  const progress = computeSyncProgress(makeRun({ status: "FAILED", errorMessage: "Cota do Gmail excedida", emailsFound: 100, emailsImported: 40 }));
  assert(progress.phase === "FAILED");
  assert(progress.percent === null);
});

check("progresso: 0 mensagens elegíveis não trava em 'Preparando...' indefinidamente", () => {
  const progress = computeSyncProgress(makeRun({ emailsFound: 0 }));
  assert(progress.phase === "RUNNING");
  assert(progress.percent === 100);
});

// ---------------- FeatureInfo (seção 22) ----------------

check("registry: os 8 helpIds da ingestão de e-mails existem", () => {
  const ids = [
    "gmail-add-account",
    "gmail-account-connected",
    "gmail-client-domain",
    "gmail-participants",
    "gmail-ingestion-period",
    "gmail-include-attachments",
    "gmail-incremental-sync",
    "gmail-sync-progress",
  ];
  for (const id of ids) assert(ACC_FEATURE_HELP[id], `${id} ausente do registry`);
});

check("FeatureInfo realmente renderizado nos componentes certos", () => {
  const accountsSource = readSource("apps/web/components/integrations/email-accounts-panel.tsx");
  assert(accountsSource.includes('helpId="gmail-add-account"'));
  assert(accountsSource.includes('helpId="gmail-account-connected"'));

  const configSource = readSource("apps/web/components/integrations/email-ingestion-config-form.tsx");
  assert(configSource.includes('helpId="gmail-client-domain"'));
  assert(configSource.includes('helpId="gmail-participants"'));
  assert(configSource.includes('helpId="gmail-ingestion-period"'));
  assert(configSource.includes('helpId="gmail-include-attachments"'));

  const confirmationSource = readSource("apps/web/components/integrations/email-sync-confirmation-panel.tsx");
  assert(confirmationSource.includes('helpId="gmail-incremental-sync"'));

  const panelSource = readSource("apps/web/components/integrations/email-sync-panel.tsx");
  assert(panelSource.includes('helpId="gmail-sync-progress"'));
});

// ---------------- Zero Gmail/Anthropic live nesta feature ----------------

check("nenhuma chamada real ao Gmail: nenhum arquivo novo da feature importa googleapis", () => {
  const files = [
    "apps/web/lib/email/inbound/ingestion-controls/classify-communication-scope.ts",
    "apps/web/lib/email/inbound/ingestion-controls/compute-sync-progress.ts",
    "apps/web/lib/email/inbound/ingestion-controls/get-email-accounts.ts",
    "apps/web/lib/email/inbound/ingestion-controls/get-project-email-ingestion-config.ts",
    "apps/web/lib/email/inbound/ingestion-controls/get-sync-runs.ts",
    "apps/web/lib/email/inbound/ingestion-controls/estimate-eligible-email-count.ts",
    "apps/web/app/[projectId]/integracoes/actions.ts",
    "apps/web/app/[projectId]/integracoes/page.tsx",
  ];
  for (const file of files) {
    const source = readSource(file);
    assert(!/googleapis/.test(source), `${file} não deveria importar googleapis — nenhuma chamada real ao Gmail nesta tarefa`);
  }
});

check("confirmação de sincronização é sempre humana: start_email_sync_run e o Server Action nunca são chamados automaticamente (sem cron/setInterval na feature)", () => {
  const actionSource = readSource("apps/web/app/[projectId]/integracoes/actions.ts");
  assert(!/setInterval|setTimeout|node-cron|CronJob/.test(actionSource), "Server Action nunca deveria se auto-agendar");
  const migrationSource = readSource("supabase/migrations/20260823110500_controlled_gmail_ingestion_config_rpc.sql");
  assert(migrationSource.includes("auth.uid()"), "start_email_sync_run deve exigir sessão autenticada real");
});

// ---------------- FROM_PROJECT_START agora usa projects.project_start_date (seção 6) ----------------

check("gmail-inbound-ingest.mjs e gmail-inbound-dry-run.mjs resolvem FROM_PROJECT_START via projects.project_start_date", () => {
  for (const file of ["scripts/gmail-inbound-ingest.mjs", "scripts/gmail-inbound-dry-run.mjs"]) {
    const source = readSource(file);
    assert(source.includes('window_mode === "FROM_PROJECT_START"'), `${file} deveria tratar FROM_PROJECT_START explicitamente`);
    assert(source.includes("project_start_date"), `${file} deveria usar projects.project_start_date`);
    assert(!/requires project start date implementation|ainda depende da data inicial/.test(source), `${file} não deveria mais ter o TODO antigo`);
  }
});

// ---------------- Migrations: RLS, RPCs ADMIN-gated, sem policy ampla nova ----------------

check("migration de contas/sync_runs: email_accounts nunca guarda token/secret; nenhuma policy de INSERT ampla nova", () => {
  const source = readSource("supabase/migrations/20260823110000_controlled_gmail_ingestion_preparation.sql");
  assert(!/access_token|refresh_token|client_secret/i.test(source), "nenhuma coluna de credencial deveria existir");
  assert(source.includes("is_any_project_admin"));
  assert((source.match(/create policy/g) ?? []).length <= 3, "só as 3 policies de SELECT esperadas (email_accounts, participants, sync_runs)");
  assert(!/for insert|for update|for delete/i.test(source), "escrita deve passar sempre pelas RPCs, nunca por policy direta");
});

check("migration da RPC de config: exige ADMIN do projeto, nunca service-role", () => {
  const source = readSource("supabase/migrations/20260823110500_controlled_gmail_ingestion_config_rpc.sql");
  assert(source.includes("has_project_permission(p_project_id, 'ADMIN')"));
  assert(source.includes("security definer"));
});

// ---------------- Testes reais contra o Supabase ----------------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const REFERENCE_PROJECT_ID = "00000000-0000-4000-8000-000000000001";

if (!supabaseUrl || !serviceKey) {
  console.log("SKIP testes com Supabase real — Supabase não configurado.");
} else {
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const cleanup = { accountIds: [], authUserIds: [], emailIds: [] };

  // ---------------- histórico → Start-up x pós-go-live → fluxo normal (seção 18) ----------------

  await checkAsync("carga histórica: effectiveDate anterior a acc_operational_start_date => HISTORICAL_PENDING_STARTUP_REVIEW", async () => {
    const { data: project } = await supabase.from("projects").select("acc_operational_start_date").eq("id", REFERENCE_PROJECT_ID).single();
    const before = new Date(project.acc_operational_start_date);
    before.setUTCDate(before.getUTCDate() - 30);
    const status = await classifyInitialLifecycleStatus(supabase, {
      projectId: REFERENCE_PROJECT_ID,
      effectiveDate: before.toISOString().slice(0, 10),
    });
    assert(status === "HISTORICAL_PENDING_STARTUP_REVIEW", `esperado HISTORICAL_PENDING_STARTUP_REVIEW, obtido ${status}`);
  });

  await checkAsync("pós-go-live: effectiveDate posterior a acc_operational_start_date => NEW (fluxo normal)", async () => {
    const { data: project } = await supabase.from("projects").select("acc_operational_start_date").eq("id", REFERENCE_PROJECT_ID).single();
    const after = new Date(project.acc_operational_start_date);
    after.setUTCDate(after.getUTCDate() + 1);
    const status = await classifyInitialLifecycleStatus(supabase, {
      projectId: REFERENCE_PROJECT_ID,
      effectiveDate: after.toISOString().slice(0, 10),
    });
    assert(status === "NEW", `esperado NEW, obtido ${status}`);
  });

  // ---------------- email_accounts: domínio, RLS, audit ----------------

  await checkAsync("register_email_account: rejeita domínio externo para conta AXION", async () => {
    const anonClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const email = `teste-gmail-${Date.now()}@example.com`;
    const password = `Teste-${randomUUID()}`;
    const { data: created, error: createError } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
    if (createError) throw new Error(createError.message);
    cleanup.authUserIds.push(created.user.id);
    await supabase.from("project_memberships").insert({ project_id: REFERENCE_PROJECT_ID, user_id: created.user.id, permission: "ADMIN" });

    const sessionClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    await sessionClient.auth.signInWithPassword({ email, password });

    const { error } = await sessionClient.rpc("register_email_account", { p_email_address: "alguem@gmail.com" });
    assert(error !== null, "domínio externo deveria ser rejeitado");
    assert(/axion\.com\.br/.test(error.message));

    await supabase.from("project_memberships").delete().eq("project_id", REFERENCE_PROJECT_ID).eq("user_id", created.user.id);
    void anonClient;
  });

  await checkAsync("register_email_account: sessão anônima é rejeitada", async () => {
    const anonClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await anonClient.rpc("register_email_account", { p_email_address: "teste@axion.com.br" });
    assert(error !== null);
  });

  await checkAsync("register_email_account: usuário autenticado sem ADMIN em nenhum projeto é rejeitado", async () => {
    const email = `teste-gmail-noperm-${Date.now()}@example.com`;
    const password = `Teste-${randomUUID()}`;
    const { data: created, error: createError } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
    if (createError) throw new Error(createError.message);
    cleanup.authUserIds.push(created.user.id);
    // Deliberadamente nenhum project_memberships ADMIN.

    const sessionClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    await sessionClient.auth.signInWithPassword({ email, password });

    const { error } = await sessionClient.rpc("register_email_account", { p_email_address: "outra@axion.com.br" });
    assert(error !== null);
    assert(/[Pp]ermiss/.test(error.message));
  });

  await checkAsync("register_email_account (ADMIN real): registra, audita EMAIL_ACCOUNT_CONNECTED como USER, e é idempotente", async () => {
    const email = `teste-gmail-admin-${Date.now()}@example.com`;
    const password = `Teste-${randomUUID()}`;
    const { data: created, error: createError } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
    if (createError) throw new Error(createError.message);
    cleanup.authUserIds.push(created.user.id);
    await supabase.from("project_memberships").insert({ project_id: REFERENCE_PROJECT_ID, user_id: created.user.id, permission: "ADMIN" });

    const sessionClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    await sessionClient.auth.signInWithPassword({ email, password });

    const accountAddress = `conta-teste-${Date.now()}@axion.com.br`;
    const { data: accountId, error } = await sessionClient
      .rpc("register_email_account", { p_email_address: accountAddress, p_display_name: "Conta de teste" })
      .single();
    if (error) throw new Error(error.message);
    cleanup.accountIds.push(accountId);

    const { data: accountRow } = await supabase.from("email_accounts").select("status, display_name").eq("id", accountId).single();
    assert(accountRow.status === "CONNECTED");
    assert(accountRow.display_name === "Conta de teste");

    const { data: auditRows } = await supabase
      .from("audit_log_entries")
      .select("actor_type, actor_user_id")
      .eq("entity_type", "EMAIL_ACCOUNT")
      .eq("entity_id", accountId)
      .eq("action", "EMAIL_ACCOUNT_CONNECTED");
    assert(auditRows.length >= 1);
    assert(auditRows[0].actor_type === "USER");

    // Idempotente: registrar de novo o mesmo endereço não cria uma segunda linha.
    const { data: secondCallId } = await sessionClient.rpc("register_email_account", { p_email_address: accountAddress }).single();
    assert(secondCallId === accountId, "registrar a mesma conta de novo deveria devolver o mesmo id, nunca duplicar");

    const { count } = await supabase.from("email_accounts").select("id", { count: "exact", head: true }).eq("email_address", accountAddress);
    assert(count === 1);

    await supabase.from("project_memberships").delete().eq("project_id", REFERENCE_PROJECT_ID).eq("user_id", created.user.id);
  });

  // ---------------- save_project_email_ingestion_config: axion.com.br sempre incluído, participantes, anexos ----------------

  await checkAsync(
    "save_project_email_ingestion_config: salva domínio/participantes/anexos; axion.com.br é sempre incluído automaticamente (nunca exclui e-mail interno)",
    async () => {
      // project_email_ingestion_configs é ÚNICO por projeto (unique(project_id))
      // — REFERENCE_PROJECT_ID pode já ter uma configuração REAL em uso (ex.:
      // uma conta AXION genuinamente registrada por um usuário real). Este
      // teste precisa restaurar tudo (config/domínios/participantes/mailboxes)
      // ao final, exatamente como scripts/test-startup.mjs já faz para
      // projects — nunca deixar dado de teste poluindo um projeto
      // compartilhado.
      const { data: beforeConfig } = await supabase
        .from("project_email_ingestion_configs")
        .select("*")
        .eq("project_id", REFERENCE_PROJECT_ID)
        .maybeSingle();
      const beforeDomains = beforeConfig
        ? (await supabase.from("project_email_ingestion_domains").select("*").eq("config_id", beforeConfig.id)).data
        : [];
      const beforeParticipants = beforeConfig
        ? (await supabase.from("project_email_ingestion_participants").select("*").eq("config_id", beforeConfig.id)).data
        : [];
      const beforeMailboxes = beforeConfig
        ? (await supabase.from("project_email_ingestion_mailboxes").select("*").eq("config_id", beforeConfig.id)).data
        : [];

      const email = `teste-gmail-config-${Date.now()}@example.com`;
      const password = `Teste-${randomUUID()}`;
      const { data: created } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
      cleanup.authUserIds.push(created.user.id);
      await supabase.from("project_memberships").insert({ project_id: REFERENCE_PROJECT_ID, user_id: created.user.id, permission: "ADMIN" });

      const accountAddress = `conta-config-${Date.now()}@axion.com.br`;
      const { data: accountId } = await supabase
        .from("email_accounts")
        .insert({ email_address: accountAddress, status: "CONNECTED" })
        .select("id")
        .single();
      cleanup.accountIds.push(accountId.id);

      const sessionClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      await sessionClient.auth.signInWithPassword({ email, password });

      try {
        const { data: configId, error } = await sessionClient
          .rpc("save_project_email_ingestion_config", {
            p_project_id: REFERENCE_PROJECT_ID,
            p_email_account_id: accountId.id,
            p_window_mode: "CUSTOM",
            p_custom_start_at: "2026-01-01T00:00:00Z",
            p_custom_end_at: null,
            p_client_domains: [{ domain: "cliente-teste.com.br", domainRole: "CLIENT", enabled: true }],
            p_participants: [{ emailAddress: "consultor@externo.com", roleNote: "Consultor jurídico do cliente", enabled: true }],
            p_include_attachments: true,
            p_enabled: true,
          })
          .single();
        if (error) throw new Error(error.message);

        const { data: domainRows } = await supabase.from("project_email_ingestion_domains").select("domain, domain_role").eq("config_id", configId);
        const axionDomain = domainRows.find((d) => d.domain === "axion.com.br");
        assert(axionDomain, "axion.com.br deveria ser incluído automaticamente — e-mail interno nunca excluído por engano");
        assert(axionDomain.domain_role === "AXION");
        assert(domainRows.some((d) => d.domain === "cliente-teste.com.br" && d.domain_role === "CLIENT"));

        const { data: participantRows } = await supabase
          .from("project_email_ingestion_participants")
          .select("email_address, role_note")
          .eq("config_id", configId);
        assert(participantRows.length === 1);
        assert(participantRows[0].email_address === "consultor@externo.com");

        const { data: mailboxRows } = await supabase.from("project_email_ingestion_mailboxes").select("mailbox_address").eq("config_id", configId);
        assert(mailboxRows.some((m) => m.mailbox_address === accountAddress), "a mailbox monitorada deveria ser a conta AXION escolhida");
      } finally {
        await supabase.from("project_memberships").delete().eq("project_id", REFERENCE_PROJECT_ID).eq("user_id", created.user.id);

        // Restaura o projeto de referência exatamente como estava antes deste teste.
        if (beforeConfig) {
          await supabase
            .from("project_email_ingestion_configs")
            .update({
              enabled: beforeConfig.enabled,
              window_mode: beforeConfig.window_mode,
              custom_start_at: beforeConfig.custom_start_at,
              custom_end_at: beforeConfig.custom_end_at,
              include_attachments: beforeConfig.include_attachments,
              email_account_id: beforeConfig.email_account_id,
            })
            .eq("id", beforeConfig.id);

          await supabase.from("project_email_ingestion_domains").delete().eq("config_id", beforeConfig.id);
          if (beforeDomains.length > 0) {
            await supabase
              .from("project_email_ingestion_domains")
              .insert(beforeDomains.map(({ id: _id, ...rest }) => rest));
          }

          await supabase.from("project_email_ingestion_participants").delete().eq("config_id", beforeConfig.id);
          if (beforeParticipants.length > 0) {
            await supabase
              .from("project_email_ingestion_participants")
              .insert(beforeParticipants.map(({ id: _id, ...rest }) => rest));
          }

          await supabase.from("project_email_ingestion_mailboxes").delete().eq("config_id", beforeConfig.id);
          if (beforeMailboxes.length > 0) {
            await supabase
              .from("project_email_ingestion_mailboxes")
              .insert(beforeMailboxes.map(({ id: _id, ...rest }) => rest));
          }
        } else {
          // Não havia configuração antes deste teste — remover tudo que o teste criou.
          await supabase.from("project_email_ingestion_configs").delete().eq("project_id", REFERENCE_PROJECT_ID);
        }
      }
    }
  );

  await checkAsync("save_project_email_ingestion_config: usuário sem ADMIN é rejeitado", async () => {
    const email = `teste-gmail-config-noperm-${Date.now()}@example.com`;
    const password = `Teste-${randomUUID()}`;
    const { data: created } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
    cleanup.authUserIds.push(created.user.id);
    await supabase.from("project_memberships").insert({ project_id: REFERENCE_PROJECT_ID, user_id: created.user.id, permission: "VIEWER" });

    const sessionClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    await sessionClient.auth.signInWithPassword({ email, password });

    const { error } = await sessionClient.rpc("save_project_email_ingestion_config", {
      p_project_id: REFERENCE_PROJECT_ID,
      p_email_account_id: "00000000-0000-4000-8000-000000000099",
      p_window_mode: "FROM_NOW",
    });
    assert(error !== null, "VIEWER não deveria conseguir salvar configuração de ingestão");

    await supabase.from("project_memberships").delete().eq("project_id", REFERENCE_PROJECT_ID).eq("user_id", created.user.id);
  });

  // ---------------- start_email_sync_run: confirmação humana obrigatória, audit enriquecido ----------------

  await checkAsync(
    "start_email_sync_run: exige ADMIN, cria execução PREPARING e audita EMAIL_SYNC_STARTED com parâmetros operacionais (project/account/period/attachments)",
    async () => {
      const { data: existingConfig } = await supabase
        .from("project_email_ingestion_configs")
        .select("id")
        .eq("project_id", REFERENCE_PROJECT_ID)
        .maybeSingle();
      if (!existingConfig) throw new Error("Projeto de referência precisa ter uma configuração de ingestão para este teste.");

      const email = `teste-gmail-sync-${Date.now()}@example.com`;
      const password = `Teste-${randomUUID()}`;
      const { data: created } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
      cleanup.authUserIds.push(created.user.id);
      await supabase.from("project_memberships").insert({ project_id: REFERENCE_PROJECT_ID, user_id: created.user.id, permission: "ADMIN" });

      const sessionClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      await sessionClient.auth.signInWithPassword({ email, password });

      const { data: runId, error } = await sessionClient.rpc("start_email_sync_run", { p_config_id: existingConfig.id }).single();
      if (error) throw new Error(error.message);

      const { data: runRow } = await supabase
        .from("project_email_ingestion_sync_runs")
        .select("status, started_by_user_id, project_id")
        .eq("id", runId)
        .single();
      assert(runRow.status === "PREPARING");
      assert(runRow.started_by_user_id === created.user.id, "confirmação de sincronização é sempre humana — started_by_user_id nunca nulo");

      const { data: auditRows } = await supabase
        .from("audit_log_entries")
        .select("detail, actor_type")
        .eq("entity_type", "PROJECT_EMAIL_INGESTION_SYNC_RUN")
        .eq("entity_id", runId)
        .eq("action", "EMAIL_SYNC_STARTED");
      assert(auditRows.length === 1);
      assert(auditRows[0].actor_type === "USER");
      assert(/project=/.test(auditRows[0].detail) && /account=/.test(auditRows[0].detail) && /period=/.test(auditRows[0].detail) && /attachments=/.test(auditRows[0].detail), "auditoria deveria registrar project/account/period/attachments");

      await supabase.from("project_email_ingestion_sync_runs").delete().eq("id", runId);
      await supabase.from("project_memberships").delete().eq("project_id", REFERENCE_PROJECT_ID).eq("user_id", created.user.id);
    }
  );

  await checkAsync("start_email_sync_run: erro parcial exige error_message (CHECK do banco)", async () => {
    const { data: existingConfig } = await supabase
      .from("project_email_ingestion_configs")
      .select("id")
      .eq("project_id", REFERENCE_PROJECT_ID)
      .maybeSingle();
    if (!existingConfig) throw new Error("Projeto de referência precisa ter uma configuração de ingestão para este teste.");

    const { data: runRow, error: insertError } = await supabase
      .from("project_email_ingestion_sync_runs")
      .insert({
        config_id: existingConfig.id,
        project_id: REFERENCE_PROJECT_ID,
        status: "PREPARING",
        started_by_user_id: (await supabase.from("project_memberships").select("user_id").eq("project_id", REFERENCE_PROJECT_ID).eq("permission", "ADMIN").limit(1).single()).data.user_id,
      })
      .select("id")
      .single();
    if (insertError) throw new Error(insertError.message);

    const { error: failWithoutMessageError } = await supabase
      .from("project_email_ingestion_sync_runs")
      .update({ status: "FAILED" })
      .eq("id", runRow.id);
    assert(failWithoutMessageError !== null, "status FAILED sem error_message deveria violar o CHECK do banco");

    const { error: failWithMessageError } = await supabase
      .from("project_email_ingestion_sync_runs")
      .update({ status: "FAILED", error_message: "Falha simulada de teste", completed_at: new Date().toISOString() })
      .eq("id", runRow.id);
    assert(failWithMessageError === null, `FAILED com error_message deveria ser aceito: ${failWithMessageError?.message}`);
    // Falha parcial nunca esconde o registro — a linha continua visível/consultável.
    const { data: stillVisible } = await supabase.from("project_email_ingestion_sync_runs").select("id").eq("id", runRow.id).maybeSingle();
    assert(stillVisible, "execução com falha nunca deveria ser removida/escondida");

    await supabase.from("project_email_ingestion_sync_runs").delete().eq("id", runRow.id);
  });

  // ---------------- dedup: mesmo e-mail em duas contas preserva as duas proveniências ----------------

  await checkAsync("mesmo e-mail em duas contas AXION: preserva as duas proveniências (2 linhas, uma por mailbox)", async () => {
    const providerMessageId = `dedup-test-${Date.now()}`;
    const base = {
      project_id: REFERENCE_PROJECT_ID,
      from_address: "cliente@weg.net",
      to_address: "acc@axion.com.br",
      subject: "Teste de dedup entre contas",
      sent_at: new Date().toISOString(),
      snippet: "teste",
      provider: "GMAIL",
      provider_message_id: providerMessageId,
      direction: "INBOUND",
    };

    const { data: first, error: firstError } = await supabase
      .from("emails")
      .insert({ ...base, mailbox_address: "conta-a@axion.com.br" })
      .select("id")
      .single();
    if (firstError) throw new Error(firstError.message);
    cleanup.emailIds.push(first.id);

    const { data: second, error: secondError } = await supabase
      .from("emails")
      .insert({ ...base, mailbox_address: "conta-b@axion.com.br" })
      .select("id")
      .single();
    if (secondError) throw new Error(`mesma mensagem em uma segunda caixa AXION deveria ser permitida: ${secondError.message}`);
    cleanup.emailIds.push(second.id);

    assert(first.id !== second.id, "as duas proveniências nunca deveriam colapsar na mesma linha");

    // Mesma mailbox + mesmo provider_message_id: dedup real (unique index).
    const { error: duplicateError } = await supabase.from("emails").insert({ ...base, mailbox_address: "conta-a@axion.com.br" });
    assert(duplicateError !== null, "reingerir a mesma mensagem na MESMA caixa deveria ser rejeitado pelo índice único (nunca duplicar)");
  });

  console.log("");
  console.log("--- Limpando fixtures ---");
  if (cleanup.emailIds.length > 0) {
    await supabase.from("emails").delete().in("id", cleanup.emailIds);
  }
  if (cleanup.accountIds.length > 0) {
    await supabase.from("email_accounts").delete().in("id", cleanup.accountIds);
  }
  for (const userId of cleanup.authUserIds) {
    await supabase.auth.admin.deleteUser(userId);
  }
  console.log("Fixtures removidas (exceto audit_log_entries, append-only por design).");
}

restoreProviderEnv();

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
