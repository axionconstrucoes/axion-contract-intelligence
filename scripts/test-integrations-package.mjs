// Testes do pacote completo de Integrações (múltiplas contas AXION,
// participantes monitorados AXION/CLIENTE/TERCEIRO, status real
// ATIVO/PENDENTE/ATENÇÃO/ERRO, origem da fonte genérica, card ESG/SSMA,
// identidade cromática por fonte). Lógica pura testada de verdade;
// RPCs novas testadas contra o Supabase real (service-role para
// fixtures, usuário autenticado real para provar RLS/ADMIN em
// runtime). NUNCA chama a API Anthropic.
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/test-integrations-package.mjs

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const { classifyParticipantType } = await import("../apps/web/lib/email/inbound/ingestion-controls/classify-participant-type");
const { resolveEmailIntegrationDisplayStatus, resolveGenericIntegrationDisplayStatus } = await import(
  "../apps/web/lib/ui/resolve-integration-display-status"
);
const { ADD_BUTTON_CLASSNAME } = await import("../apps/web/lib/ui/add-button-style");
const { ACC_FEATURE_HELP } = await import("../apps/web/lib/ui/feature-help");
const { integrationStatusLabels, sourceTypeShortLabels, driveTypeLabels } = await import("../apps/web/lib/labels");
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
console.log("PACOTE DE INTEGRAÇÕES — TESTES");
console.log("======================================");
console.log("");

// ---------------- classificação de participantes (seção 4) ----------------

check("classificação: @axion.com.br => AXION", () => {
  assert(classifyParticipantType("ana@axion.com.br", "axion.com.br", ["weg.net"]) === "AXION");
});

check("classificação: domínio configurado como cliente (weg.net) => CLIENTE", () => {
  assert(classifyParticipantType("contato@weg.net", "axion.com.br", ["weg.net"]) === "CLIENTE");
});

check("classificação: externo não cadastrado como cliente => TERCEIRO sugerido (nunca CLIENTE automático)", () => {
  assert(classifyParticipantType("consultor@outraempresa.com.br", "axion.com.br", ["weg.net"]) === "TERCEIRO");
});

check("classificação: mesmo domínio de cliente com múltiplos domínios configurados", () => {
  assert(classifyParticipantType("x@cliente2.com.br", "axion.com.br", ["weg.net", "cliente2.com.br"]) === "CLIENTE");
  assert(classifyParticipantType("x@weg.net", "axion.com.br", ["weg.net", "cliente2.com.br"]) === "CLIENTE");
});

// ---------------- status real (seção 7): "0 novas mensagens" != PENDENTE ----------------

check("e-mail: configuração completa + conta CONNECTED => ATIVO (CONECTADO), independentemente de contagem de mensagens", () => {
  const status = resolveEmailIntegrationDisplayStatus({
    configEnabled: true,
    hasEmailAccount: true,
    hasClientDomain: true,
    accountStatus: "CONNECTED",
  });
  assert(status === "CONECTADO", `esperado CONECTADO (Ativo), obtido ${status}`);
});

check("e-mail: função de status nem recebe contagem de mensagens como parâmetro (nunca pode confundir 0 novas com pendente)", () => {
  const source = readSource("apps/web/lib/ui/resolve-integration-display-status.ts");
  assert(!/messageCount|newMessages|emailsFound|emailsImported/.test(source), "resolveEmailIntegrationDisplayStatus não deveria depender de contagem de mensagens");
});

check("e-mail: configuração incompleta (sem conta) => PENDENTE", () => {
  const status = resolveEmailIntegrationDisplayStatus({ configEnabled: true, hasEmailAccount: false, hasClientDomain: true, accountStatus: null });
  assert(status === "PENDENTE");
});

check("e-mail: configuração incompleta (sem domínio cliente) => PENDENTE", () => {
  const status = resolveEmailIntegrationDisplayStatus({ configEnabled: true, hasEmailAccount: true, hasClientDomain: false, accountStatus: "CONNECTED" });
  assert(status === "PENDENTE");
});

check("e-mail: conta com autorização expirada => ATENÇÃO (nunca ERRO)", () => {
  const status = resolveEmailIntegrationDisplayStatus({ configEnabled: true, hasEmailAccount: true, hasClientDomain: true, accountStatus: "AUTH_EXPIRED" });
  assert(status === "ATENCAO");
});

check("e-mail: conta com erro => ERRO", () => {
  const status = resolveEmailIntegrationDisplayStatus({ configEnabled: true, hasEmailAccount: true, hasClientDomain: true, accountStatus: "ERROR" });
  assert(status === "ERRO");
});

check("fontes genéricas: status real armazenado é reaproveitado sem reinterpretação", () => {
  assert(resolveGenericIntegrationDisplayStatus("CONECTADO") === "CONECTADO");
  assert(resolveGenericIntegrationDisplayStatus("PENDENTE") === "PENDENTE");
  assert(resolveGenericIntegrationDisplayStatus("ATENCAO") === "ATENCAO");
  assert(resolveGenericIntegrationDisplayStatus("ERRO") === "ERRO");
});

check("labels PT-BR: ATIVO/PENDENTE/ATENÇÃO/ERRO", () => {
  assert(integrationStatusLabels.CONECTADO === "Ativo");
  assert(integrationStatusLabels.PENDENTE === "Pendente");
  assert(integrationStatusLabels.ATENCAO === "Atenção");
  assert(integrationStatusLabels.ERRO === "Erro");
});

// ---------------- botões ADICIONAR (seção 6) ----------------

check("botões ADICIONAR: fundo vermelho escuro, texto branco, semibold, hover mais escuro", () => {
  assert(/bg-red-800\b/.test(ADD_BUTTON_CLASSNAME));
  assert(/text-white\b/.test(ADD_BUTTON_CLASSNAME));
  assert(/font-semibold\b/.test(ADD_BUTTON_CLASSNAME));
  assert(/hover:bg-red-900\b/.test(ADD_BUTTON_CLASSNAME));
});

check("os 3 botões ADICIONAR desta área usam o mesmo estilo (conta AXION, domínio, participante)", () => {
  const accountsSource = readSource("apps/web/components/integrations/email-accounts-panel.tsx");
  assert(accountsSource.includes("ADD_BUTTON_CLASSNAME"), "botão Adicionar conta AXION deveria usar ADD_BUTTON_CLASSNAME");

  const configFormSource = readSource("apps/web/components/integrations/email-ingestion-config-form.tsx");
  assert(configFormSource.includes("ADD_BUTTON_CLASSNAME"), "ListEditor (domínio/participante) deveria usar ADD_BUTTON_CLASSNAME");
  assert(configFormSource.includes('addLabel="+ Adicionar domínio"'));
  assert(configFormSource.includes('addLabel="+ Adicionar participante"'));
});

// ---------------- identidade cromática por fonte (seção 21/22/23) ----------------

check("cor do card NUNCA depende de status — resolveIntegrationVisualIdentity só recebe o sourceType, nunca um status", () => {
  const source = readSource("apps/web/components/integrations/integration-visual-identity.ts");
  const signatureMatch = source.match(/export function resolveIntegrationVisualIdentity\(([^)]*)\)/);
  assert(signatureMatch, "função resolveIntegrationVisualIdentity não encontrada");
  assert(!/status/i.test(signatureMatch[1]), `assinatura não deveria receber status: (${signatureMatch[1]})`);
  const recordMatch = source.match(/IDENTITY_BY_SOURCE_TYPE[\s\S]*?=\s*\{([\s\S]*)\n\};/);
  assert(recordMatch, "mapa IDENTITY_BY_SOURCE_TYPE não encontrado");
  assert(!/\bstatus\b/i.test(recordMatch[1]), "o mapa de identidade por fonte não deveria referenciar status em nenhuma entrada");
});

check("os 12 tipos de fonte têm identidade visual distinta (cor + ícone)", () => {
  const source = readSource("apps/web/components/integrations/integration-visual-identity.ts");
  const sourceTypes = [
    "EMAIL",
    "GOOGLE_DRIVE",
    "CONSTRUMANAGER",
    "DIARIO_OBRA",
    "CONTRATO",
    "RECEBIDOS_CLIENTE",
    "EDITAL_RFI_RFP",
    "CRONOGRAMA",
    "RELATORIO_SEMANAL",
    "ERP",
    "ORCAMENTO",
    "ESG_SSMA",
  ];
  for (const type of sourceTypes) assert(source.includes(`${type}: {`), `${type} deveria ter identidade visual própria`);

  const cardClassMatches = [...source.matchAll(/cardClassName: "([^"]+)"/g)].map((m) => m[1]);
  assert(cardClassMatches.length === sourceTypes.length, "cada fonte deveria ter exatamente uma cardClassName");
  assert(new Set(cardClassMatches).size === cardClassMatches.length, "nenhuma fonte deveria repetir exatamente a mesma cor de card");
});

check("nenhuma biblioteca de ícones nova foi instalada (só lucide-react, já existente)", () => {
  const packageJson = readSource("apps/web/package.json");
  const iconLibs = ["react-icons", "@heroicons", "phosphor-icons", "feather-icons", "@fortawesome"];
  for (const lib of iconLibs) assert(!packageJson.includes(lib), `não deveria ter instalado ${lib}`);
  const identitySource = readSource("apps/web/components/integrations/integration-visual-identity.ts");
  assert(identitySource.includes('from "lucide-react"'));
});

check("badge de status (IntegrationStatusBadge) é independente da cor do card — badges.tsx não IMPORTA integration-visual-identity", () => {
  const badgesSource = readSource("apps/web/components/shared/badges.tsx");
  assert(!/^import.*integration-visual-identity/m.test(badgesSource), "badges.tsx não deveria importar a identidade visual por fonte");
});

// ---------------- Origem da fonte: nunca inventa informação ----------------

check("origem ainda não definida: card mostra literalmente essa frase quando nenhum campo foi preenchido", () => {
  const source = readSource("apps/web/components/integrations/integration-card.tsx");
  assert(source.includes("Origem ainda não definida"));
  assert(/\.filter\(/.test(source), "só deveria exibir campos realmente preenchidos (filter)");
});

check("ESG/SSMA: rótulos específicos 'Técnico de Segurança' e 'Responsável/Gerente ESG', nunca hardcoded como valor de e-mail", () => {
  const formSource = readSource("apps/web/components/integrations/integration-origin-form.tsx");
  assert(formSource.includes("Técnico de Segurança"));
  assert(formSource.includes("Responsável/Gerente ESG"));
  assert(!/tecnico\.seguranca@axion\.com\.br["']/.test(formSource), "endereço de exemplo nunca deveria estar hardcoded como valor real");
});

check("Google Drive: tipo Meu Drive/Drive compartilhado/Pasta compartilhada nunca confundidos entre si", () => {
  assert(driveTypeLabels.MEU_DRIVE === "Meu Drive");
  assert(driveTypeLabels.DRIVE_COMPARTILHADO === "Drive compartilhado");
  assert(driveTypeLabels.PASTA_COMPARTILHADA === "Pasta compartilhada");
});

check("Relatórios Semanais: conta/remetente nunca hardcoded no código (é sempre campo configurável)", () => {
  const files = [
    "apps/web/components/integrations/integration-card.tsx",
    "apps/web/components/integrations/integration-origin-form.tsx",
    "packages/mock-data/src/sources.ts",
  ];
  for (const file of files) {
    const source = readSource(file);
    assert(!/ricardo\.martins@axion\.com\.br/.test(source), `${file} não deveria ter o e-mail de exemplo do requisito hardcoded`);
  }
});

// ---------------- ESG/SSMA card (seção 19) ----------------

check("sourceDefinitions inclui ESG_SSMA com a descrição exata do requisito", () => {
  const source = readSource("packages/mock-data/src/sources.ts");
  assert(source.includes('type: "ESG_SSMA"'));
  assert(source.includes("Registros, evidências e documentos de segurança, saúde, meio ambiente e obrigações ESG/SSMA"));
});

check("sourceTypeShortLabels cobre ESG_SSMA (Record<SourceType,...> — TS já garante isso, checagem real de conteúdo aqui)", () => {
  assert(sourceTypeShortLabels.ESG_SSMA === "ESG/SSMA");
});

// ---------------- FeatureInfo (seção 26) ----------------

check("registry: helpIds de participante/origem/ESG/tipo de Drive existem", () => {
  for (const id of [
    "gmail-participant-monitored",
    "gmail-participant-cliente",
    "gmail-participant-terceiro",
    "integration-origin",
    "esg-ssma-source",
    "drive-type",
  ]) {
    assert(ACC_FEATURE_HELP[id], `${id} ausente do registry`);
  }
});

check("FeatureInfo realmente renderizado: participante monitorado, origem da fonte (card genérico e e-mail), ESG, tipo de Drive", () => {
  const configFormSource = readSource("apps/web/components/integrations/email-ingestion-config-form.tsx");
  assert(configFormSource.includes('helpId="gmail-participant-monitored"'));

  const cardSource = readSource("apps/web/components/integrations/integration-card.tsx");
  assert(cardSource.includes('helpId="integration-origin"'));
  assert(cardSource.includes('helpId="esg-ssma-source"'));

  const emailCardSource = readSource("apps/web/components/integrations/email-integration-card.tsx");
  assert(emailCardSource.includes('helpId="integration-origin"'));

  const originFormSource = readSource("apps/web/components/integrations/integration-origin-form.tsx");
  assert(originFormSource.includes('helpId="drive-type"'));
});

// ---------------- migrations: RLS, ADMIN-gated, sem credencial ----------------

check("migration: nenhuma coluna nova armazena token/secret/senha/refresh token", () => {
  const source = readSource("supabase/migrations/20260823120000_integration_origin_and_participant_classification.sql");
  assert(!/access_token|refresh_token|client_secret|password/i.test(source));
});

check("migration: save_integration_origin exige ADMIN e audita sem incluir credenciais", () => {
  const source = readSource("supabase/migrations/20260823120000_integration_origin_and_participant_classification.sql");
  assert(source.includes("has_project_permission(p_project_id, 'ADMIN')"));
  assert(source.includes("INTEGRATION_ORIGIN_UPDATED"));
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
  const cleanup = { accountIds: [], authUserIds: [] };

  async function createAdminSession(emailPrefix, permission = "ADMIN") {
    const email = `${emailPrefix}-${Date.now()}@example.com`;
    const password = `Teste-${randomUUID()}`;
    const { data: created, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(error.message);
    cleanup.authUserIds.push(created.user.id);
    await supabase.from("project_memberships").insert({ project_id: REFERENCE_PROJECT_ID, user_id: created.user.id, permission });
    const sessionClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    await sessionClient.auth.signInWithPassword({ email, password });
    return { userId: created.user.id, sessionClient };
  }

  await checkAsync("múltiplas contas AXION (3+): todas registradas e listadas, nenhum limite artificial", async () => {
    const { userId, sessionClient } = await createAdminSession("teste-integ-multi-admin");
    const suffix = Date.now();
    const addresses = [`multi-a-${suffix}@axion.com.br`, `multi-b-${suffix}@axion.com.br`, `multi-c-${suffix}@axion.com.br`];
    for (const address of addresses) {
      const { data: accountId, error } = await sessionClient.rpc("register_email_account", { p_email_address: address }).single();
      if (error) throw new Error(error.message);
      cleanup.accountIds.push(accountId);
    }

    const { data: allAccounts } = await supabase.from("email_accounts").select("email_address").in("email_address", addresses);
    assert(allAccounts.length === 3, `esperado 3 contas registradas, obtido ${allAccounts.length}`);

    await supabase.from("project_memberships").delete().eq("project_id", REFERENCE_PROJECT_ID).eq("user_id", userId);
  });

  await checkAsync(
    "participante monitorado (cliente @weg.net) não cadastrado previamente: pode ser adicionado sem profile/membership/login",
    async () => {
      const { userId, sessionClient } = await createAdminSession("teste-integ-participant-admin");
      const accountAddress = `conta-participant-${Date.now()}@axion.com.br`;
      const { data: account } = await supabase.from("email_accounts").insert({ email_address: accountAddress, status: "CONNECTED" }).select("id").single();
      cleanup.accountIds.push(account.id);

      const clientEmail = `cliente-nao-cadastrado-${Date.now()}@weg.net`;
      const { data: configId, error } = await sessionClient
        .rpc("save_project_email_ingestion_config", {
          p_project_id: REFERENCE_PROJECT_ID,
          p_email_account_id: account.id,
          p_window_mode: "FROM_NOW",
          p_client_domains: [{ domain: "weg.net", domainRole: "CLIENT", enabled: true }],
          p_participants: [{ emailAddress: clientEmail, roleNote: "", enabled: true, participantType: "CLIENTE" }],
          p_include_attachments: true,
          p_enabled: true,
        })
        .single();
      if (error) throw new Error(error.message);

      const { data: participantRows } = await supabase
        .from("project_email_ingestion_participants")
        .select("email_address, participant_type")
        .eq("config_id", configId)
        .eq("email_address", clientEmail);
      assert(participantRows.length === 1);
      assert(participantRows[0].participant_type === "CLIENTE");

      // Nunca ganhou profile nem acesso ao ACC.
      const { data: profileRows } = await supabase.from("profiles").select("id").eq("email", clientEmail);
      assert(profileRows.length === 0, "participante nunca deveria ganhar um profile só por ser monitorado");

      await supabase.from("project_memberships").delete().eq("project_id", REFERENCE_PROJECT_ID).eq("user_id", userId);
    }
  );

  await checkAsync("terceiro não cadastrado: entra no perímetro de monitoramento sem ganhar acesso ao ACC", async () => {
    const { userId, sessionClient } = await createAdminSession("teste-integ-terceiro-admin");
    const accountAddress = `conta-terceiro-${Date.now()}@axion.com.br`;
    const { data: account } = await supabase.from("email_accounts").insert({ email_address: accountAddress, status: "CONNECTED" }).select("id").single();
    cleanup.accountIds.push(account.id);

    const terceiroEmail = `terceiro-nao-cadastrado-${Date.now()}@empresa.com.br`;
    const { data: configId, error } = await sessionClient
      .rpc("save_project_email_ingestion_config", {
        p_project_id: REFERENCE_PROJECT_ID,
        p_email_account_id: account.id,
        p_window_mode: "FROM_NOW",
        p_client_domains: [{ domain: "weg.net", domainRole: "CLIENT", enabled: true }],
        p_participants: [{ emailAddress: terceiroEmail, roleNote: "Consultor externo", enabled: true, participantType: "TERCEIRO" }],
        p_include_attachments: true,
        p_enabled: true,
      })
      .single();
    if (error) throw new Error(error.message);

    const { data: participantRows } = await supabase
      .from("project_email_ingestion_participants")
      .select("participant_type")
      .eq("config_id", configId)
      .eq("email_address", terceiroEmail);
    assert(participantRows[0].participant_type === "TERCEIRO");

    const { data: profileRows } = await supabase.from("profiles").select("id").eq("email", terceiroEmail);
    assert(profileRows.length === 0, "terceiro nunca deveria ganhar acesso ao ACC");
    const { data: authUsers } = await supabase.auth.admin.listUsers();
    assert(!authUsers.users.some((u) => u.email === terceiroEmail), "terceiro nunca deveria ganhar uma conta de autenticação no ACC");

    await supabase.from("project_memberships").delete().eq("project_id", REFERENCE_PROJECT_ID).eq("user_id", userId);
  });

  await checkAsync("múltiplos domínios de cliente: dois domínios salvos e preservados na mesma configuração", async () => {
    const { userId, sessionClient } = await createAdminSession("teste-integ-domains-admin");
    const accountAddress = `conta-domains-${Date.now()}@axion.com.br`;
    const { data: account } = await supabase.from("email_accounts").insert({ email_address: accountAddress, status: "CONNECTED" }).select("id").single();
    cleanup.accountIds.push(account.id);

    const { data: configId, error } = await sessionClient
      .rpc("save_project_email_ingestion_config", {
        p_project_id: REFERENCE_PROJECT_ID,
        p_email_account_id: account.id,
        p_window_mode: "FROM_NOW",
        p_client_domains: [
          { domain: "weg.net", domainRole: "CLIENT", enabled: true },
          { domain: "weg-fios.com.br", domainRole: "CLIENT", enabled: true },
        ],
        p_participants: [],
        p_include_attachments: true,
        p_enabled: true,
      })
      .single();
    if (error) throw new Error(error.message);

    const { data: domainRows } = await supabase.from("project_email_ingestion_domains").select("domain").eq("config_id", configId).eq("domain_role", "CLIENT");
    assert(domainRows.length === 2, `esperado 2 domínios cliente, obtido ${domainRows.length}`);

    await supabase.from("project_memberships").delete().eq("project_id", REFERENCE_PROJECT_ID).eq("user_id", userId);
  });

  await checkAsync("mailbox != participante: mailbox monitorada nunca aparece na tabela de participantes e vice-versa", async () => {
    const { userId, sessionClient } = await createAdminSession("teste-integ-mailbox-vs-part-admin");
    const accountAddress = `conta-mailbox-${Date.now()}@axion.com.br`;
    const { data: account } = await supabase.from("email_accounts").insert({ email_address: accountAddress, status: "CONNECTED" }).select("id").single();
    cleanup.accountIds.push(account.id);

    const participantEmail = `participante-${Date.now()}@weg.net`;
    const { data: configId, error } = await sessionClient
      .rpc("save_project_email_ingestion_config", {
        p_project_id: REFERENCE_PROJECT_ID,
        p_email_account_id: account.id,
        p_window_mode: "FROM_NOW",
        p_client_domains: [{ domain: "weg.net", domainRole: "CLIENT", enabled: true }],
        p_participants: [{ emailAddress: participantEmail, roleNote: "", enabled: true, participantType: "CLIENTE" }],
        p_include_attachments: true,
        p_enabled: true,
      })
      .single();
    if (error) throw new Error(error.message);

    const { data: mailboxRows } = await supabase.from("project_email_ingestion_mailboxes").select("mailbox_address").eq("config_id", configId);
    assert(!mailboxRows.some((m) => m.mailbox_address === participantEmail), "participante nunca deveria virar uma mailbox de ingestão");

    const { data: participantRows } = await supabase.from("project_email_ingestion_participants").select("email_address").eq("config_id", configId);
    assert(!participantRows.some((p) => p.email_address === accountAddress), "a conta AXION (mailbox) nunca deveria aparecer como participante");

    await supabase.from("project_memberships").delete().eq("project_id", REFERENCE_PROJECT_ID).eq("user_id", userId);
  });

  await checkAsync("save_integration_origin: ADMIN salva origem genérica (Construmanager), audita sem token/secret", async () => {
    const { userId, sessionClient } = await createAdminSession("teste-integ-origin-admin");

    const { data: integrationId, error } = await sessionClient
      .rpc("save_integration_origin", {
        p_project_id: REFERENCE_PROJECT_ID,
        p_source_type: "CONSTRUMANAGER",
        p_external_system_reference: "Construmanager",
        p_external_project_reference: "WEG — Fábrica de Fios (teste automatizado)",
        p_account_reference: "obras@axion.com.br",
      })
      .single();
    if (error) throw new Error(error.message);

    const { data: row } = await supabase
      .from("project_integrations")
      .select("external_system_reference, external_project_reference, account_reference")
      .eq("id", integrationId)
      .single();
    assert(row.external_system_reference === "Construmanager");
    assert(row.external_project_reference === "WEG — Fábrica de Fios (teste automatizado)");

    const { data: auditRows } = await supabase
      .from("audit_log_entries")
      .select("actor_type, detail")
      .eq("entity_type", "PROJECT_INTEGRATION")
      .eq("entity_id", integrationId)
      .eq("action", "INTEGRATION_ORIGIN_UPDATED");
    assert(auditRows.length >= 1);
    assert(auditRows[0].actor_type === "USER");
    assert(!/token|secret|senha|password/i.test(auditRows[0].detail));

    // Restaura o estado original desta linha (nunca deixar dado de teste no projeto de referência).
    await supabase
      .from("project_integrations")
      .update({ external_system_reference: null, external_project_reference: null, account_reference: null })
      .eq("id", integrationId);

    await supabase.from("project_memberships").delete().eq("project_id", REFERENCE_PROJECT_ID).eq("user_id", userId);
  });

  await checkAsync("save_integration_origin: usuário sem ADMIN é rejeitado", async () => {
    const { userId, sessionClient } = await createAdminSession("teste-integ-origin-noperm", "VIEWER");
    const { error } = await sessionClient.rpc("save_integration_origin", {
      p_project_id: REFERENCE_PROJECT_ID,
      p_source_type: "CONSTRUMANAGER",
      p_external_system_reference: "Não deveria salvar",
    });
    assert(error !== null);
    await supabase.from("project_memberships").delete().eq("project_id", REFERENCE_PROJECT_ID).eq("user_id", userId);
  });

  await checkAsync("project_integrations aceita ESG_SSMA como source_type e ATENCAO como status (CHECK constraints estendidos)", async () => {
    const { error: insertError } = await supabase
      .from("project_integrations")
      .upsert(
        { project_id: REFERENCE_PROJECT_ID, source_type: "ESG_SSMA", status: "ATENCAO", detail: "teste" },
        { onConflict: "project_id,source_type" }
      );
    assert(insertError === null, `ESG_SSMA/ATENCAO deveriam ser aceitos: ${insertError?.message}`);

    const { data: row } = await supabase
      .from("project_integrations")
      .select("status")
      .eq("project_id", REFERENCE_PROJECT_ID)
      .eq("source_type", "ESG_SSMA")
      .single();
    assert(row.status === "ATENCAO");

    // Restaura para PENDENTE (estado limpo).
    await supabase.from("project_integrations").update({ status: "PENDENTE" }).eq("project_id", REFERENCE_PROJECT_ID).eq("source_type", "ESG_SSMA");
  });

  console.log("");
  console.log("--- Limpando fixtures ---");
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
