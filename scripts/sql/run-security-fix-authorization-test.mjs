// Prova REAL (via SET ROLE + auth.uid() simulado, não reimplementação em
// JS) das duas correções autorizadas em 2026-08-30:
//
//   1. escalate_sla_action(): antes só exigia is_project_member (QUALQUER
//      papel ativo, inclusive LEITURA); agora exige
//      has_project_permission(project_id, 'ADMINISTRADOR') — decisão
//      final revisada em 2026-08-30 (uma decisão intermediária anterior
//      permitia GESTOR/GERENTE; a decisão final restringe a
//      ADMINISTRADOR apenas, reaproveitando o helper central em vez de
//      uma checagem inline, já que has_project_permission continua com
//      sua hierarquia de 2 níveis — só ADMINISTRADOR escreve — deliberada
//      e intocada). Testa os 13 cenários definidos na investigação: anon,
//      sem membership, LEITURA mesmo projeto, LEITURA outro projeto,
//      COLABORADOR, GESTOR, GERENTE, ADMINISTRADOR, ADMINISTRADOR só de
//      outro projeto, UUID inexistente, escalada repetida (concorrência
//      otimista), ação já encerrada, e confirmação estrutural de que
//      project_id só pode vir da própria linha (a function não recebe
//      p_project_id como parâmetro).
//
//   2. register_document_version_file(): ACL mínima (zero chamador
//      legítimo encontrado em código/histórico) — anon e authenticated
//      não têm mais EXECUTE de forma alguma (REVOKE, não só checagem de
//      auth.uid() dentro do corpo). Testa que a chamada falha no nível
//      do Postgres (42501 insufficient_privilege) ANTES mesmo de entrar
//      na function, para os dois roles, e que service_role continua com
//      EXECUTE (chega até a checagem interna de auth.uid()).
//
// Diferente de run-gerente-compat-authorization-test.mjs (que só simula
// auth.uid() via request.jwt.claim.sub rodando como postgres): aqui o
// teste da ACL exige SET ROLE de verdade, porque REVOKE só é aplicado
// contra o role real da sessão (SECURITY DEFINER não dispensa o
// chamador de ter EXECUTE para sequer invocar a function) — postgres é
// superusuário e ignoraria qualquer REVOKE. Os testes de papel de
// projeto (LEITURA/COLABORADOR/GESTOR/GERENTE/ADMINISTRADOR) rodam como
// SET ROLE authenticated (o role real usado em produção por qualquer
// usuário logado via PostgREST), com request.jwt.claim.sub simulando o
// auth.uid() de cada usuário de teste — reproduz exatamente a mesma
// combinação (role Postgres + claim) que acontece em produção.
//
// SEGURANÇA DE AMBIENTE — mesmo padrão dos demais runners: container
// EXATO desta execução e confirmação explícita, nunca a stack local
// real do projeto nem o remoto.
//
// Uso (só depois de ter a stack descartável rodando, com as 13
// migrations pendentes já aplicadas):
//   ACC_SECFIX_TEST_DB_CONTAINER="<nome exato do container>" \
//   ACC_SECFIX_TEST_I_UNDERSTAND_THIS_IS_DISPOSABLE=true \
//     node scripts/sql/run-security-fix-authorization-test.mjs

import { spawnSync } from "node:child_process";

const container = process.env.ACC_SECFIX_TEST_DB_CONTAINER;
if (!container) {
  console.error('Defina ACC_SECFIX_TEST_DB_CONTAINER="<nome exato do container>".');
  process.exit(1);
}
if (process.env.ACC_SECFIX_TEST_I_UNDERSTAND_THIS_IS_DISPOSABLE !== "true") {
  console.error('ACC_SECFIX_TEST_I_UNDERSTAND_THIS_IS_DISPOSABLE precisa ser exatamente "true".');
  process.exit(1);
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

function psql(sql) {
  const result = spawnSync(
    "docker",
    ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "--no-psqlrc", "--quiet", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8" }
  );
  return result;
}

function psqlOk(sql) {
  const result = psql(sql);
  if (result.status !== 0) {
    throw new Error(`psql falhou (exit ${result.status}): ${result.stderr}`);
  }
  return result.stdout;
}

// Roda como postgres (superusuário) — usado só para fixtures/reset, nunca
// para os testes de autorização em si.
function asSuperuser(sql) {
  return psqlOk(sql);
}

// Simula exatamente a combinação role-Postgres + claim que PostgREST monta
// em produção: SET ROLE <pgRole> (authenticated/anon/service_role) dentro
// da MESMA sessão/transação em que o claim é setado — cada chamada é um
// processo psql novo (isolamento total entre "usuários").
function callAsPgRole(pgRole, userIdOrNull, sql) {
  const claimSql = userIdOrNull
    ? `perform set_config('request.jwt.claim.sub', '${userIdOrNull}', false);`
    : `perform set_config('request.jwt.claim.sub', '', false);`;
  return psql(`
    set role ${pgRole};
    do $$ begin ${claimSql} end $$;
    ${sql}
    reset role;
  `);
}

const PROJECT_A = "77777777-7777-4777-8777-777777777a01";
const PROJECT_B = "77777777-7777-4777-8777-777777777b01";
const USERS = {
  ADMINISTRADOR: "77777777-7777-4777-8777-777777777001",
  GESTOR: "77777777-7777-4777-8777-777777777002",
  GERENTE: "77777777-7777-4777-8777-777777777003",
  COLABORADOR: "77777777-7777-4777-8777-777777777004",
  LEITURA: "77777777-7777-4777-8777-777777777005",
  LEITURA_B: "77777777-7777-4777-8777-777777777006",
  NO_MEMBERSHIP: "77777777-7777-4777-8777-777777777007",
  ADMINISTRADOR_B: "77777777-7777-4777-8777-777777777008",
};
const ACTION_ID = "77777777-7777-4777-8777-777777777a11";
const ACTION_ID_COMPLETED = "77777777-7777-4777-8777-777777777a12";
const NONEXISTENT_ACTION_ID = "77777777-7777-4777-8777-777777777aff";
const DOCUMENT_ID = "77777777-7777-4777-8777-777777777d01";
const DOCUMENT_VERSION_ID = "77777777-7777-4777-8777-777777777d02";

function resetActionLevel() {
  asSuperuser(`
    set session_replication_role = replica;
    update public.sla_actions set status = 'PENDING', current_escalation_level = 'RESPONSAVEL' where id = '${ACTION_ID}';
    reset session_replication_role;
  `);
}

function main() {
  console.log("");
  console.log("======================================");
  console.log("CORREÇÕES DE AUTORIZAÇÃO 2026-08-30 — escalate_sla_action / register_document_version_file");
  console.log("======================================");
  console.log("");

  // ---------- Fixtures (idempotente) ----------
  asSuperuser(`
    set session_replication_role = replica;
    delete from public.sla_action_escalations where action_id in ('${ACTION_ID}', '${ACTION_ID_COMPLETED}');
    delete from public.sla_actions where id in ('${ACTION_ID}', '${ACTION_ID_COMPLETED}');
    delete from public.document_version_files where document_version_id = '${DOCUMENT_VERSION_ID}';
    delete from public.document_versions where id = '${DOCUMENT_VERSION_ID}';
    delete from public.documents where id = '${DOCUMENT_ID}';
    delete from public.project_memberships where project_id in ('${PROJECT_A}', '${PROJECT_B}');
    delete from public.projects where id in ('${PROJECT_A}', '${PROJECT_B}');
    delete from public.profiles where id in (${Object.values(USERS).map((u) => `'${u}'`).join(", ")});
    delete from auth.users where id in (${Object.values(USERS).map((u) => `'${u}'`).join(", ")});
    reset session_replication_role;
  `);

  asSuperuser(`
    insert into auth.users (id, email) values
      ('${USERS.ADMINISTRADOR}', 'secfix-admin@axion-test.local'),
      ('${USERS.GESTOR}', 'secfix-gestor@axion-test.local'),
      ('${USERS.GERENTE}', 'secfix-gerente@axion-test.local'),
      ('${USERS.COLABORADOR}', 'secfix-colab@axion-test.local'),
      ('${USERS.LEITURA}', 'secfix-leitura@axion-test.local'),
      ('${USERS.LEITURA_B}', 'secfix-leitura-b@axion-test.local'),
      ('${USERS.NO_MEMBERSHIP}', 'secfix-nomember@axion-test.local'),
      ('${USERS.ADMINISTRADOR_B}', 'secfix-admin-b@axion-test.local')
    on conflict (id) do nothing;

    -- handle_new_user trigger não está presente nesta stack descartável
    -- (mesma lacuna de fixture já documentada em runs anteriores desta
    -- sessão) — insere profiles diretamente, só para o teste.
    insert into public.profiles (id, name, email) values
      ('${USERS.ADMINISTRADOR}', 'SECFIX Administrador', 'secfix-admin@axion-test.local'),
      ('${USERS.GESTOR}', 'SECFIX Gestor', 'secfix-gestor@axion-test.local'),
      ('${USERS.GERENTE}', 'SECFIX Gerente', 'secfix-gerente@axion-test.local'),
      ('${USERS.COLABORADOR}', 'SECFIX Colaborador', 'secfix-colab@axion-test.local'),
      ('${USERS.LEITURA}', 'SECFIX Leitura', 'secfix-leitura@axion-test.local'),
      ('${USERS.LEITURA_B}', 'SECFIX Leitura B', 'secfix-leitura-b@axion-test.local'),
      ('${USERS.NO_MEMBERSHIP}', 'SECFIX Sem Membership', 'secfix-nomember@axion-test.local'),
      ('${USERS.ADMINISTRADOR_B}', 'SECFIX Administrador B', 'secfix-admin-b@axion-test.local')
    on conflict (id) do nothing;

    insert into public.projects (id, code, name, client, status, location, start_date, baseline_end_date) values
      ('${PROJECT_A}', 'SECFIX-A', 'Projeto Teste SECFIX A', 'Cliente Teste', 'ATIVO', 'Teste', '2026-01-01', '2026-12-31'),
      ('${PROJECT_B}', 'SECFIX-B', 'Projeto Teste SECFIX B', 'Cliente Teste', 'ATIVO', 'Teste', '2026-01-01', '2026-12-31')
    on conflict (id) do nothing;

    insert into public.project_memberships (project_id, user_id, permission, status) values
      ('${PROJECT_A}', '${USERS.ADMINISTRADOR}', 'ADMINISTRADOR', 'ACTIVE'),
      ('${PROJECT_A}', '${USERS.GESTOR}', 'GESTOR', 'ACTIVE'),
      ('${PROJECT_A}', '${USERS.GERENTE}', 'GERENTE', 'ACTIVE'),
      ('${PROJECT_A}', '${USERS.COLABORADOR}', 'COLABORADOR', 'ACTIVE'),
      ('${PROJECT_A}', '${USERS.LEITURA}', 'LEITURA', 'ACTIVE'),
      ('${PROJECT_B}', '${USERS.LEITURA_B}', 'LEITURA', 'ACTIVE'),
      ('${PROJECT_B}', '${USERS.ADMINISTRADOR_B}', 'ADMINISTRADOR', 'ACTIVE')
    on conflict (project_id, user_id) do nothing;

    insert into public.sla_actions (
      id, project_id, origin, title, description, risk_level, area,
      status, current_escalation_level, assume_due_at,
      created_by_type, created_by_user_id
    ) values (
      '${ACTION_ID}', '${PROJECT_A}', 'MANUAL', 'Ação teste SECFIX', '', 'HIGH', 'ENGENHARIA',
      'PENDING', 'RESPONSAVEL', now() + interval '2 days',
      'USER', '${USERS.ADMINISTRADOR}'
    ),
    (
      '${ACTION_ID_COMPLETED}', '${PROJECT_A}', 'MANUAL', 'Ação teste SECFIX (já encerrada)', '', 'LOW', 'ENGENHARIA',
      'CANCELLED', 'RESPONSAVEL', now() + interval '2 days',
      'USER', '${USERS.ADMINISTRADOR}'
    )
    on conflict (id) do nothing;

    insert into public.documents (id, project_id, kind, title) values
      ('${DOCUMENT_ID}', '${PROJECT_A}', 'RELATORIO_SEMANAL', 'Documento teste SECFIX')
    on conflict (id) do nothing;

    insert into public.document_versions (
      id, document_id, project_id, version_label, version_index, document_date,
      source_type, author, summary, storage_bucket, file_path, original_file_name,
      mime_type, file_size_bytes, sha256_hash, uploaded_by
    ) values (
      '${DOCUMENT_VERSION_ID}', '${DOCUMENT_ID}', '${PROJECT_A}', 'v1', 1, '2026-01-01',
      'RELATORIO_SEMANAL', 'SECFIX Administrador', 'Versao teste SECFIX', 'project-documents',
      '${PROJECT_A}/${DOCUMENT_ID}/${DOCUMENT_VERSION_ID}/v1.pdf', 'v1.pdf',
      'application/pdf', 1000, repeat('a', 64), '${USERS.ADMINISTRADOR}'
    )
    on conflict (id) do nothing;
  `);

  // ============================================================
  // 1. escalate_sla_action — 13 cenários
  // ============================================================

  console.log("");
  console.log("---- escalate_sla_action ----");
  console.log("");

  const escalateSql = `select public.escalate_sla_action('${ACTION_ID}', 'RESPONSAVEL', 'ESCALAO_1', 'NOT_RESPONDED');`;

  check("escalate_sla_action: anon (SET ROLE anon, sem claim) — bloqueado", () => {
    const r = callAsPgRole("anon", null, escalateSql);
    if (r.status === 0) throw new Error(`esperava falha, obteve sucesso: ${r.stdout}`);
  });

  check("escalate_sla_action: authenticated sem nenhuma membership — bloqueado", () => {
    const r = callAsPgRole("authenticated", USERS.NO_MEMBERSHIP, escalateSql);
    if (r.status === 0) throw new Error(`esperava falha, obteve sucesso: ${r.stdout}`);
    if (!r.stderr.includes("permission required")) throw new Error(`esperava "permission required", obtido: ${r.stderr}`);
  });

  check("escalate_sla_action: LEITURA do mesmo projeto (A) — bloqueado", () => {
    const r = callAsPgRole("authenticated", USERS.LEITURA, escalateSql);
    if (r.status === 0) throw new Error(`!!! CONSEGUIU ESCALAR — correção não aplicada !!! stdout: ${r.stdout}`);
    if (!r.stderr.includes("permission required")) throw new Error(`esperava "permission required", obtido: ${r.stderr}`);
  });
  resetActionLevel();

  check("escalate_sla_action: LEITURA de outro projeto (B) tentando UUID do projeto A — bloqueado (sem cross-tenant)", () => {
    const r = callAsPgRole("authenticated", USERS.LEITURA_B, escalateSql);
    if (r.status === 0) throw new Error(`!!! CONSEGUIU (cross-tenant) !!! stdout: ${r.stdout}`);
  });
  resetActionLevel();

  check("escalate_sla_action: COLABORADOR do projeto A — bloqueado", () => {
    const r = callAsPgRole("authenticated", USERS.COLABORADOR, escalateSql);
    if (r.status === 0) throw new Error(`!!! CONSEGUIU ESCALAR — correção não aplicada !!! stdout: ${r.stdout}`);
    if (!r.stderr.includes("permission required")) throw new Error(`esperava "permission required", obtido: ${r.stderr}`);
  });
  resetActionLevel();

  check("escalate_sla_action: GESTOR do projeto A — bloqueado (decisão final: só ADMINISTRADOR)", () => {
    const r = callAsPgRole("authenticated", USERS.GESTOR, escalateSql);
    if (r.status === 0) throw new Error(`!!! CONSEGUIU ESCALAR — deveria estar bloqueado !!! stdout: ${r.stdout}`);
    if (!r.stderr.includes("permission required")) throw new Error(`esperava "permission required", obtido: ${r.stderr}`);
  });
  resetActionLevel();

  check("escalate_sla_action: GERENTE do projeto A — bloqueado (decisão final: só ADMINISTRADOR)", () => {
    const r = callAsPgRole("authenticated", USERS.GERENTE, escalateSql);
    if (r.status === 0) throw new Error(`!!! CONSEGUIU ESCALAR — deveria estar bloqueado !!! stdout: ${r.stdout}`);
    if (!r.stderr.includes("permission required")) throw new Error(`esperava "permission required", obtido: ${r.stderr}`);
  });
  resetActionLevel();

  check("escalate_sla_action: ADMINISTRADOR_B (administrador só de outro projeto) tentando UUID do projeto A — bloqueado (cross-tenant, mesmo sendo administrador em algum projeto)", () => {
    const r = callAsPgRole("authenticated", USERS.ADMINISTRADOR_B, escalateSql);
    if (r.status === 0) throw new Error(`!!! CONSEGUIU (cross-tenant) !!! stdout: ${r.stdout}`);
    if (!r.stderr.includes("permission required")) throw new Error(`esperava "permission required", obtido: ${r.stderr}`);
  });
  resetActionLevel();

  check("escalate_sla_action: UUID inexistente — bloqueado (\"SLA action not found\")", () => {
    const r = callAsPgRole(
      "authenticated",
      USERS.ADMINISTRADOR,
      `select public.escalate_sla_action('${NONEXISTENT_ACTION_ID}', 'RESPONSAVEL', 'ESCALAO_1', 'NOT_RESPONDED');`
    );
    if (r.status === 0) throw new Error(`esperava falha, obteve sucesso: ${r.stdout}`);
    if (!r.stderr.includes("SLA action not found")) throw new Error(`esperava "SLA action not found", obtido: ${r.stderr}`);
  });

  check("escalate_sla_action: ação já CANCELLED (estado que não admite nova escalada) — bloqueado", () => {
    const r = callAsPgRole(
      "authenticated",
      USERS.ADMINISTRADOR,
      `select public.escalate_sla_action('${ACTION_ID_COMPLETED}', 'RESPONSAVEL', 'ESCALAO_1', 'NOT_RESPONDED');`
    );
    if (r.status === 0) throw new Error(`esperava falha, obteve sucesso: ${r.stdout}`);
    if (!r.stderr.includes("Cannot escalate a completed/cancelled action")) {
      throw new Error(`esperava "Cannot escalate a completed/cancelled action", obtido: ${r.stderr}`);
    }
  });

  check("escalate_sla_action: ADMINISTRADOR do projeto A — permitido", () => {
    const r = callAsPgRole("authenticated", USERS.ADMINISTRADOR, escalateSql);
    if (r.status !== 0) throw new Error(`esperava sucesso, obteve falha: ${r.stderr}`);
  });

  check("escalate_sla_action: escalada repetida com o mesmo p_expected_current_level (concorrência otimista) — bloqueada", () => {
    // A ação já foi escalada de RESPONSAVEL para ESCALAO_1 no check anterior
    // (sem reset) — repetir a mesma chamada com p_expected_current_level=
    // 'RESPONSAVEL' precisa falhar, porque o nível atual real já é
    // ESCALAO_1 (prova a checagem otimista contra escalonamento duplicado).
    const r = callAsPgRole("authenticated", USERS.ADMINISTRADOR, escalateSql);
    if (r.status === 0) throw new Error(`!!! ESCALOU DUAS VEZES A PARTIR DO MESMO NÍVEL !!! stdout: ${r.stdout}`);
    if (!r.stderr.includes("changed concurrently")) {
      throw new Error(`esperava "changed concurrently", obtido: ${r.stderr}`);
    }
  });
  resetActionLevel();

  check("escalate_sla_action: project_id só pode vir da própria sla_action (a function não recebe p_project_id como parâmetro)", () => {
    const args = asSuperuser(
      "select pg_get_function_identity_arguments('public.escalate_sla_action'::regproc);"
    ).trim();
    if (args.includes("project_id")) {
      throw new Error(`a assinatura não deveria expor project_id como parâmetro: ${args}`);
    }
    const def = asSuperuser("select pg_get_functiondef('public.escalate_sla_action'::regproc);");
    if (!def.includes("from public.sla_actions") || !def.includes("v_action.project_id")) {
      throw new Error("o corpo deveria resolver project_id a partir da linha lida de sla_actions (v_action.project_id), não de um parâmetro");
    }
  });

  // ============================================================
  // 2. register_document_version_file — ACL mínima (REVOKE real, via SET ROLE)
  // ============================================================

  console.log("");
  console.log("---- register_document_version_file (ACL) ----");
  console.log("");

  const registerFileSql = `select public.register_document_version_file('${DOCUMENT_VERSION_ID}', 'DOCUMENTO_APOIO', 'x/y.pdf', 'y.pdf', 'application/pdf', 100, repeat('a',64), 'UPLOAD', null, null);`;

  check("register_document_version_file: anon — permission denied no nível do Postgres (42501), nunca entra na function", () => {
    const r = callAsPgRole("anon", null, registerFileSql);
    if (r.status === 0) throw new Error(`esperava falha, obteve sucesso: ${r.stdout}`);
    if (!r.stderr.includes("permission denied for function")) {
      throw new Error(`esperava "permission denied for function" (ACL), obtido: ${r.stderr}`);
    }
  });

  check("register_document_version_file: authenticated (mesmo como ADMINISTRADOR real do projeto) — permission denied no nível do Postgres, ACL revogada por completo", () => {
    const r = callAsPgRole("authenticated", USERS.ADMINISTRADOR, registerFileSql);
    if (r.status === 0) throw new Error(`esperava falha, obteve sucesso: ${r.stdout}`);
    if (!r.stderr.includes("permission denied for function")) {
      throw new Error(`esperava "permission denied for function" (ACL), obtido: ${r.stderr}`);
    }
  });

  check("register_document_version_file: service_role mantém EXECUTE (chega à checagem interna, não é bloqueado pela ACL)", () => {
    const r = callAsPgRole("service_role", null, registerFileSql);
    if (r.stderr.includes("permission denied for function")) {
      throw new Error(`service_role deveria manter EXECUTE — bloqueado indevidamente pela ACL: ${r.stderr}`);
    }
    // Sem claim (auth.uid() null), a própria function deve rejeitar com
    // "Authentication required" — confirma que passou da ACL e chegou ao
    // corpo, sem exercer nenhum caminho de escrita de verdade.
    if (!r.stderr.includes("Authentication required")) {
      throw new Error(`esperava "Authentication required" vindo de dentro da function, obtido: status=${r.status} stderr=${r.stderr}`);
    }
  });

  console.log("");
  console.log("======================================");
  console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
  console.log("======================================");

  if (failed > 0) {
    process.exit(1);
  }
}

main();
