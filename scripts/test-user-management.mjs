// Testes de "Usuários & Permissões" — Cargo x Área, pré-cadastro,
// ativação no primeiro login, busca segura, edição de permissão,
// proteção do último administrador, caso Victor Cerri. As migrations
// novas (20260825120000/120500/121000) AINDA NÃO FORAM APLICADAS em
// nenhum ambiente — por isso a cobertura aqui é ESTRUTURAL (leitura de
// código-fonte/SQL), mesmo padrão já usado em
// scripts/test-feature-info.mjs e scripts/test-global-test-mode-banner.mjs.
// Nenhuma chamada de rede, nenhum e-mail, nenhuma ingestão.
//
// Uso:
//   node scripts/test-user-management.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function assert(condition, message) {
  if (!condition) throw new Error(message ?? "assertion failed");
}

console.log("");
console.log("======================================");
console.log("USUÁRIOS & PERMISSÕES — TESTES");
console.log("======================================");
console.log("");

// GERENTE (20260829200000_project_permission_gerente_compat) é
// sinônimo de GESTOR — mesma autorização, nome atual para inclusões
// novas. Nenhum membro real foi convertido de GESTOR para GERENTE.
const VALID_PERMISSIONS = ["ADMINISTRADOR", "GESTOR", "GERENTE", "COLABORADOR", "LEITURA"];
const VALID_AREAS = [
  "DIRETORIA", "ADMINISTRATIVO", "COMERCIAL", "FINANCEIRO",
  "ENGENHARIA", "ORÇAMENTO", "JURÍDICO", "PLANEJAMENTO",
];

// --- 1. Cargo separado de Área ---

const pageSource = readSource("apps/web/app/[projectId]/usuarios/page.tsx");

check("tabela: colunas Usuário/Origem/Cargo/Área/Permissão/Status/Ações, nesta ordem, Cargo e Área distintos", () => {
  const headers = [...pageSource.matchAll(/<TableHead>([^<]+)<\/TableHead>/g)].map((m) => m[1]);
  assert(headers.join("|") === "Usuário|Origem|Cargo|Área|Permissão|Status|Ações", `cabeçalhos obtidos: ${headers.join(", ")}`);
});

check("tabela: Cargo vem de profiles.title (m.user.title), Área vem de project_memberships.area (m.area) — nunca a mesma fonte", () => {
  assert(pageSource.includes("m.user.title"), "Cargo deveria usar m.user.title");
  assert(pageSource.includes("membershipAreaLabels[m.area]"), "Área deveria usar m.area via membershipAreaLabels");
});

// --- 2. Os quatro cargos definidos (Reynaldo, Ricardo, Márcio, Victor) ---
// Especificação viva — nunca gravada no banco real nesta etapa (task
// explícita: "não gravar esses cargos no banco real"). Valida que os 4
// registros batem com os enums reais de permission/area do banco.

const DEFINED_JOB_TITLES = [
  { name: "Reynaldo Duarte", email: "reynaldo@axion.com.br", jobTitle: "SUPERINTENDENTE COMERCIAL", area: "COMERCIAL", permission: "PRESERVAR_VALOR_REAL" },
  { name: "Ricardo Martins", email: "ricardo.martins@axion.com.br", jobTitle: "GERENTE DE ORÇAMENTO", area: "PLANEJAMENTO", permission: "GESTOR" },
  { name: "Márcio Galvão", email: "marcio.galvao@axion.com.br", jobTitle: "GERENTE DE ENGENHARIA", area: "ENGENHARIA", permission: "GESTOR" },
  { name: "Victor Cerri", email: "victor.cerri@axion.com.br", jobTitle: "DIRETOR COMERCIAL", area: "COMERCIAL", permission: "GESTOR" },
];

check("os 4 cargos definidos têm área/permissão válidas contra os enums reais do banco (nunca gravados nesta etapa)", () => {
  for (const entry of DEFINED_JOB_TITLES) {
    assert(entry.jobTitle.trim().length > 0, `${entry.name}: cargo vazio`);
    assert(VALID_AREAS.includes(entry.area), `${entry.name}: área "${entry.area}" inválida`);
    assert(
      entry.permission === "PRESERVAR_VALOR_REAL" || VALID_PERMISSIONS.includes(entry.permission),
      `${entry.name}: permissão "${entry.permission}" inválida`
    );
    assert(entry.email.endsWith("@axion.com.br"), `${entry.name}: e-mail fora do domínio corporativo`);
  }
});

check("nenhum cargo foi gravado no banco real nesta etapa: apps/web não chama set_profile_job_title com valor fixo/hardcoded para estes e-mails", () => {
  for (const file of ["apps/web/app/[projectId]/usuarios/actions.ts", "apps/web/app/[projectId]/usuarios/page.tsx"]) {
    const source = readSource(file);
    for (const entry of DEFINED_JOB_TITLES) {
      assert(!source.includes(entry.jobTitle), `${file} não deveria conter o cargo "${entry.jobTitle}" hardcoded`);
    }
  }
});

// --- 3. Coluna adequada para cargo já existe (não precisa nova migration para a COLUNA) ---

check("profiles.title já existe (identity_foundation) — nenhuma migration nova cria coluna de cargo, só a RPC de edição por admin", () => {
  const identityFoundation = readSource("supabase/migrations/20260817191336_identity_foundation.sql");
  assert(/create table public\.profiles[\s\S]*?title text/.test(identityFoundation), "profiles.title deveria já existir desde identity_foundation");
});

const jobTitleMigration = readSource("supabase/migrations/20260825120000_admin_set_profile_job_title.sql");

check("migration nova (não aplicada): set_profile_job_title é SECURITY DEFINER, exige ADMINISTRADOR do projeto, audita", () => {
  assert(/create or replace function public\.set_profile_job_title/.test(jobTitleMigration));
  assert(/security definer/.test(jobTitleMigration));
  assert(/has_project_permission\(p_project_id, 'ADMINISTRADOR'\)/.test(jobTitleMigration));
  assert(/insert into public\.audit_log_entries/.test(jobTitleMigration));
});

// --- Pré-cadastro de usuários (migrations novas, não aplicadas) ---

const invitationsMigration = readSource("supabase/migrations/20260825120500_project_member_invitations_foundation.sql");
const activationMigration = readSource("supabase/migrations/20260825121000_activate_project_member_invitation_on_login.sql");

check("pré-cadastro: tabela project_member_invitations tem todas as colunas pedidas", () => {
  const requiredColumns = [
    "project_id", "email", "name", "job_title", "area", "permission",
    "status", "created_by", "created_at", "activated_at", "cancelled_at", "profile_id",
  ];
  for (const col of requiredColumns) {
    assert(new RegExp(`\\b${col}\\b`).test(invitationsMigration), `coluna ausente: ${col}`);
  }
  assert(/status .*in \('PENDING', 'ACTIVATED', 'CANCELLED'\)/.test(invitationsMigration), "status deveria aceitar PENDING/ACTIVATED/CANCELLED");
  assert(/unique \(project_id, email\)/.test(invitationsMigration), "deveria haver unicidade por (project_id, email)");
});

check("pré-cadastro: RLS habilitada, sem nenhuma policy de INSERT/UPDATE/DELETE (escrita só via RPC)", () => {
  assert(/alter table public\.project_member_invitations enable row level security/.test(invitationsMigration));
  assert(!/for insert/.test(invitationsMigration), "não deveria haver policy de INSERT");
  assert(!/for update/.test(invitationsMigration), "não deveria haver policy de UPDATE");
  assert(!/for delete/.test(invitationsMigration), "não deveria haver policy de DELETE");
});

check("pré-cadastro: RPC exige ADMINISTRADOR do projeto e audita a criação", () => {
  assert(/create function public\.pre_register_project_member/.test(invitationsMigration));
  assert(/has_project_permission\(p_project_id, 'ADMINISTRADOR'\)/.test(invitationsMigration));
  assert(/MEMBER_PRE_REGISTERED/.test(invitationsMigration));
});

check("pré-cadastro: bloqueio de domínio externo — só @axion.com.br é aceito, com CHECK na tabela E validação na RPC", () => {
  assert(/check \(email like '%@axion\.com\.br'\)/.test(invitationsMigration), "CHECK constraint da tabela ausente");
  assert(/split_part\(v_email, '@', 2\) <> 'axion\.com\.br'/.test(invitationsMigration), "validação de domínio na RPC ausente");
});

check("pré-cadastro: duplicidade é bloqueada (pré-cadastro pendente/ativado já existente, ou profile já existente)", () => {
  assert(/Este e-mail já tem um profile/.test(invitationsMigration));
  assert(/Já existe um pré-cadastro pendente ou ativado/.test(invitationsMigration));
});

check("pré-cadastro: nenhum acesso é concedido antes da ativação — RPC de pré-cadastro nunca insere em project_memberships", () => {
  const rpcBody = invitationsMigration.slice(invitationsMigration.indexOf("create function public.pre_register_project_member"));
  assert(!/insert into public\.project_memberships/.test(rpcBody), "pre_register_project_member nunca deveria criar membership diretamente");
});

// --- Ativação no primeiro login ---

check("ativação: handle_new_user é CREATE OR REPLACE (nunca edita a migration histórica de identity_foundation)", () => {
  assert(/create or replace function public\.handle_new_user/.test(activationMigration));
  const identityFoundation = readSource("supabase/migrations/20260817191336_identity_foundation.sql");
  assert(identityFoundation.includes("create function public.handle_new_user"), "migration histórica original deveria continuar intacta (create function, não replace)");
});

check("ativação: compara e-mail EXATO (case-insensitive), nunca aproximado", () => {
  assert(/lower\(email\) = lower\(new\.email\)/.test(activationMigration));
  assert(!/ilike|similar to|%/.test(activationMigration.match(/where status = 'PENDING'[\s\S]{0,200}/)?.[0] ?? ""), "não deveria haver comparação aproximada de e-mail");
});

check("ativação: cria membership com os dados do convite, marca ACTIVATED e audita", () => {
  assert(/insert into public\.project_memberships \(project_id, user_id, permission, area, status\)/.test(activationMigration));
  assert(/values \(v_invitation\.project_id, new\.id, v_invitation\.permission, v_invitation\.area, 'ACTIVE'\)/.test(activationMigration));
  assert(/status = 'ACTIVATED', activated_at = now\(\), profile_id = new\.id/.test(activationMigration));
  assert(/MEMBER_INVITATION_ACTIVATED/.test(activationMigration));
});

check("ativação: qualquer divergência (membership já existente) bloqueia SÓ aquele pré-cadastro (cancela), nunca o login inteiro, e NUNCA insere membership nesse caminho", () => {
  const loopSource = activationMigration.slice(activationMigration.indexOf("for v_invitation in"));
  const elseBranch = loopSource.slice(loopSource.indexOf("else"), loopSource.indexOf("exception"));
  assert(/status = 'CANCELLED', cancelled_at = now\(\)/.test(elseBranch), "convite divergente deveria ser marcado CANCELLED");
  assert(!/insert into public\.project_memberships/.test(elseBranch), "convite divergente NUNCA deveria inserir membership");
});

check("ativação: cancelamento por divergência é auditado com invitation_id, project_id e motivo (e-mail já é dado de identificação usado em toda a trilha, não segredo/token/senha)", () => {
  const loopSource = activationMigration.slice(activationMigration.indexOf("for v_invitation in"));
  const elseBranch = loopSource.slice(loopSource.indexOf("else"), loopSource.indexOf("exception"));
  assert(/insert into public\.audit_log_entries/.test(elseBranch), "cancelamento por divergência deveria auditar");
  assert(/MEMBER_INVITATION_CANCELLED/.test(elseBranch), "action MEMBER_INVITATION_CANCELLED ausente");
  assert(/'project_member_invitations', v_invitation\.id::text/.test(elseBranch), "entity_id deveria identificar o invitation_id");
  assert(/já existe vínculo ativo/.test(elseBranch), "motivo do cancelamento deveria estar registrado no detail");
});

check("ativação: erro inesperado processando um convite é isolado num bloco próprio (savepoint), cancela SÓ aquele convite (fail-closed), audita o motivo, e nunca propaga para os demais convites nem para o login", () => {
  const loopBody = activationMigration.slice(activationMigration.indexOf("loop"), activationMigration.lastIndexOf("end loop"));
  assert(/\bbegin\b[\s\S]*\bexception\b[\s\S]*\bwhen others\b/.test(loopBody), "cada iteração deveria ter seu próprio bloco begin/exception");
  const exceptionBlock = activationMigration.slice(activationMigration.indexOf("when others"), activationMigration.lastIndexOf("end;"));
  assert(/get stacked diagnostics/.test(exceptionBlock), "deveria capturar a mensagem real do erro");
  assert(/status = 'CANCELLED', cancelled_at = now\(\)/.test(exceptionBlock), "erro inesperado deveria cancelar (fail-closed), nunca deixar PENDING ambíguo ou ACTIVATED");
  assert(/insert into public\.audit_log_entries/.test(exceptionBlock), "erro inesperado deveria ser auditado");
  assert(/MEMBER_INVITATION_CANCELLED/.test(exceptionBlock), "action MEMBER_INVITATION_CANCELLED ausente no tratamento de erro");
  assert(/por erro no processamento/.test(exceptionBlock), "motivo do erro deveria estar registrado no detail");
});

check("ativação: nenhum acesso concedido antes do login — a única inserção em project_memberships desta migration está dentro do laço de ativação (pós-login)", () => {
  const beforeLoop = activationMigration.slice(0, activationMigration.indexOf("for v_invitation in"));
  assert(!/insert into public\.project_memberships/.test(beforeLoop), "não deveria haver insert em project_memberships antes do laço de ativação");
});

check("ativação: continua idempotente após a correção — filtro status='PENDING' garante que um convite já ACTIVATED/CANCELLED nunca é reprocessado, mesmo se o trigger disparasse de novo", () => {
  assert(/where status = 'PENDING'/.test(activationMigration), "o laço deveria continuar filtrando só convites PENDING");
});

check("ativação: nada foi relaxado na correção — auth.uid() continua ausente do trigger (por design, é auth.users que dispara), domínio/unicidade/RLS continuam definidos só na migration de pré-cadastro, intocada", () => {
  const untouchedInvitationsMigration = readSource("supabase/migrations/20260825120500_project_member_invitations_foundation.sql");
  assert(/check \(email like '%@axion\.com\.br'\)/.test(untouchedInvitationsMigration), "CHECK de domínio não deveria ter sido tocado");
  assert(/unique \(project_id, email\)/.test(untouchedInvitationsMigration), "unicidade não deveria ter sido tocada");
  assert(/enable row level security/.test(untouchedInvitationsMigration), "RLS não deveria ter sido tocada");
  assert(!/for insert|for update|for delete/.test(untouchedInvitationsMigration), "nenhuma policy de escrita deveria ter sido adicionada");
});

// --- 4. Busca segura ---

const usersActionsSource = readSource("apps/web/app/[projectId]/usuarios/actions.ts");

check("busca: usa a RPC oficial find_profile_by_email (já existente) — nenhuma RPC nova de busca criada", () => {
  assert(usersActionsSource.includes('supabase.rpc("find_profile_by_email"'), "deveria reaproveitar find_profile_by_email");
  const identityFoundation = readSource("supabase/migrations/20260824090000_project_membership_roles_status_area.sql");
  assert(/has_project_permission\(p_project_id, 'ADMINISTRADOR'\)/.test(identityFoundation.slice(identityFoundation.indexOf("find_profile_by_email"))), "find_profile_by_email deveria exigir ADMINISTRADOR");
});

check("busca: só aceita e-mail completo @axion.com.br — busca parcial é rejeitada antes de chamar a RPC", () => {
  assert(/!query\.includes\("@"\) \|\| !query\.endsWith\(AXION_EMAIL_DOMAIN\)/.test(usersActionsSource));
});

check("busca: quando não encontra, sinaliza notFound (para oferecer pré-cadastro), nunca inventa um resultado", () => {
  assert(/notFound: true/.test(usersActionsSource));
});

// --- 5. Ações de usuário ---

check("edição de permissão: usa a RPC real update_project_member_role (não 'update_project_member_permission', que não existe)", () => {
  assert(usersActionsSource.includes('supabase.rpc("update_project_member_role"'), "deveria chamar update_project_member_role (nome real confirmado no banco)");
  assert(!usersActionsSource.includes('supabase.rpc("update_project_member_permission"'), "update_project_member_permission não existe — nenhuma chamada de RPC real deveria usar esse nome");
});

check("status: usa set_project_member_status; remoção (remove_project_member) não tem controle de UI nesta etapa, deliberadamente", () => {
  assert(usersActionsSource.includes('supabase.rpc("set_project_member_status"'));
  assert(!usersActionsSource.includes('supabase.rpc("remove_project_member"'), "remove_project_member não deveria ter UI nesta etapa (evitar exclusão acidental)");
});

check("proteção do último administrador: já garantida pelo trigger prevent_last_administrator_removal (20260824090000), nenhuma RPC nova tenta contornar", () => {
  const rolesMigration = readSource("supabase/migrations/20260824090000_project_membership_roles_status_area.sql");
  assert(/prevent_last_administrator_removal/.test(rolesMigration));
  assert(/before update or delete on public\.project_memberships/.test(rolesMigration));
  // Nenhuma das migrations novas desta etapa faz UPDATE/DELETE direto em
  // project_memberships fora das RPCs já protegidas pelo trigger acima.
  for (const migrationSource of [jobTitleMigration, invitationsMigration, activationMigration]) {
    assert(!/delete from public\.project_memberships/.test(migrationSource), "nenhuma migration nova deveria fazer DELETE em project_memberships");
  }
});

// --- 6. Permissões reais (nunca ADMIN/EDITOR/VIEWER) ---

check("tipos: ProjectPermission tem exatamente os 5 papéis reais (GESTOR e GERENTE convivendo — transição compatível), nunca ADMIN/EDITOR/VIEWER", () => {
  const typesSource = readSource("packages/types/src/index.ts");
  const match = typesSource.match(/export type ProjectPermission = ([^;]+);/);
  assert(match, "ProjectPermission não encontrado");
  assert(
    match[1].includes("ADMINISTRADOR") &&
    match[1].includes("GESTOR") &&
    match[1].includes("GERENTE") &&
    match[1].includes("COLABORADOR") &&
    match[1].includes("LEITURA")
  );
  assert(!/"ADMIN"|"EDITOR"|"VIEWER"/.test(match[1]), "ProjectPermission não deveria reintroduzir os papéis antigos");
});

check("nenhum arquivo de produção em apps/web usa mais os literais ADMIN/EDITOR/VIEWER para permissão", () => {
  assert(!/"ADMIN"|"EDITOR"|"VIEWER"/.test(usersActionsSource));
  assert(!/"ADMIN"|"EDITOR"|"VIEWER"/.test(pageSource));
});

// --- Victor Cerri como caso pendente ---

check("Victor Cerri: especificação corresponde exatamente a um caso de pré-cadastro pendente (nunca auth.users artificial, nunca service role, nunca convite/e-mail)", () => {
  const victor = DEFINED_JOB_TITLES.find((e) => e.name === "Victor Cerri");
  assert(victor, "Victor Cerri ausente da especificação");
  assert(victor.email === "victor.cerri@axion.com.br");
  assert(victor.jobTitle === "DIRETOR COMERCIAL");
  assert(victor.area === "COMERCIAL");
  assert(victor.permission === "GESTOR");
  // Nenhum arquivo desta etapa cria um auth.users artificial nem usa service role para Victor.
  for (const file of ["apps/web/app/[projectId]/usuarios/actions.ts", "supabase/migrations/20260825120500_project_member_invitations_foundation.sql"]) {
    const source = readSource(file);
    assert(!/auth\.users/i.test(source) || file.includes("actions.ts") === false, `${file} não deveria manipular auth.users diretamente`);
    assert(!/service_role|SUPABASE_SECRET_KEY/i.test(source), `${file} não deveria usar service role`);
  }
});

// --- Nenhuma mensagem enviada ---

check("nenhum arquivo novo desta etapa chama getEmailProvider/envia e-mail (nem para Victor, nem para ativação)", () => {
  for (const file of [
    "apps/web/app/[projectId]/usuarios/actions.ts",
    "supabase/migrations/20260825120000_admin_set_profile_job_title.sql",
    "supabase/migrations/20260825120500_project_member_invitations_foundation.sql",
    "supabase/migrations/20260825121000_activate_project_member_invitation_on_login.sql",
  ]) {
    const source = readSource(file);
    assert(!/getEmailProvider|EmailProvider|sendEmail|gmail\.users\.messages\.send/i.test(source), `${file} não deveria referenciar envio de e-mail`);
  }
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
