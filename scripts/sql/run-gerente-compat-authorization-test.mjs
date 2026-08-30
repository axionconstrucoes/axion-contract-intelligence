// Prova REAL de que GERENTE tem exatamente a mesma autorização que
// GESTOR hoje tem — nem mais, nem menos — nas 3 checagens que
// distinguem GESTOR de COLABORADOR/LEITURA no banco real:
//   has_project_permission (hierarquia global — ambos ficam abaixo do
//     limiar de escrita, igual hoje);
//   can_manage_project_documents (Documentos: upload/promoção de
//     anexo — ambos autorizados, igual hoje);
//   get_email_alert_action_context (ações de alerta por e-mail:
//     ASSUME_RESPONSIBILITY/SET_DEADLINE — ambos autorizados, igual
//     hoje).
// Testa os 5 papéis reais (ADMINISTRADOR/GESTOR/GERENTE/COLABORADOR/
// LEITURA) chamando as functions SECURITY DEFINER de verdade, via
// psql, simulando cada usuário através de request.jwt.claim.sub (o
// mesmo dado que auth.uid() lê em produção) — não uma reimplementação
// da checagem em JS.
//
// Diferente dos runners REST em scripts/sql/run-trash-*-test.mjs
// (que passam por GoTrue+PostgREST): aqui a simulação é direta via
// SQL, porque o serviço de auth está desligado na stack descartável
// usada para validar esta migration (config.toml com [auth]
// enabled = false, para manter "integrações desligadas" como exigido
// na autorização desta tarefa). A camada de autorização real está
// inteiramente nas functions abaixo — REST só repassa o mesmo
// auth.uid() a partir de um JWT verificado; testar diretamente via SQL
// exercita exatamente a mesma lógica, sem a dependência extra.
//
// SEGURANÇA DE AMBIENTE — mesmo padrão dos demais runners: container
// EXATO desta execução e confirmação explícita, nunca a stack local
// real do projeto nem o remoto.
//
// Uso (só depois de ter a stack descartável rodando):
//   ACC_GERENTE_TEST_DB_CONTAINER="supabase_db_acc-gerente-compat-test" \
//   ACC_GERENTE_TEST_I_UNDERSTAND_THIS_IS_DISPOSABLE=true \
//     node scripts/sql/run-gerente-compat-authorization-test.mjs

import { spawnSync } from "node:child_process";

const EXACT_DB_CONTAINER = "supabase_db_acc-gerente-compat-test";

if (process.env.ACC_GERENTE_TEST_DB_CONTAINER !== EXACT_DB_CONTAINER) {
  console.error(`ACC_GERENTE_TEST_DB_CONTAINER precisa ser exatamente "${EXACT_DB_CONTAINER}".`);
  process.exit(1);
}
if (process.env.ACC_GERENTE_TEST_I_UNDERSTAND_THIS_IS_DISPOSABLE !== "true") {
  console.error('ACC_GERENTE_TEST_I_UNDERSTAND_THIS_IS_DISPOSABLE precisa ser exatamente "true".');
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
    ["exec", "-i", EXACT_DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "--no-psqlrc", "--quiet", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(`psql falhou (exit ${result.status}): ${result.stderr}`);
  }
  return result.stdout;
}

// Cada consulta roda em sua PRÓPRIA sessão psql (novo processo) — usa
// set_config(..., false) para setar a claim no nível de SESSÃO (não de
// transação), garantindo isolamento total entre usuários simulados.
// perform (não select) para o set_config: evita que seu valor de
// retorno vire uma linha extra na saída -t -A, que só deve conter o
// resultado da consulta real feita em seguida.
function asUser(userId, sql) {
  return psql(`do $$ begin perform set_config('request.jwt.claim.sub', '${userId}', false); end $$;\n${sql}`);
}

const PROJECT_ID = "99999999-9999-4999-8999-999999999901";
const USERS = {
  ADMINISTRADOR: "99999999-9999-4999-8999-999999999911",
  GESTOR: "99999999-9999-4999-8999-999999999912",
  GERENTE: "99999999-9999-4999-8999-999999999913",
  COLABORADOR: "99999999-9999-4999-8999-999999999914",
  LEITURA: "99999999-9999-4999-8999-999999999915",
  // Usuário dedicado só para o teste de promoção (update_project_member_role)
  // — nunca o mesmo usuário fixo usado nos checks de leitura acima, para
  // que reexecuções do script continuem encontrando COLABORADOR/LEITURA
  // intocados (mesma idempotência dos runners REST em scripts/sql/).
  PARA_PROMOVER: "99999999-9999-4999-8999-999999999916",
};
const NEW_MEMBER_GERENTE_USER = "99999999-9999-4999-8999-999999999941";
const NEW_MEMBER_GESTOR_USER = "99999999-9999-4999-8999-999999999942";
const TOKEN_HASH = "gerente-compat-test-token-hash";
const EVENT_ID = "99999999-9999-4999-8999-999999999921";

function main() {
  console.log("");
  console.log("======================================");
  console.log("GERENTE ↔ GESTOR — equivalência real de autorização (5 papéis)");
  console.log("======================================");
  console.log("");

  // Idempotência: reexecuções desta stack descartável devem sempre partir
  // do mesmo estado inicial — remove qualquer resíduo de execuções
  // anteriores antes de recriar os fixtures. session_replication_role =
  // replica desarma o trigger prevent_last_administrator_removal só para
  // esta limpeza (que apaga TODAS as memberships do projeto de teste, o
  // que o trigger legitimamente bloquearia em uso normal) — a proteção
  // real continua ativa para todo o resto do arquivo (checks abaixo nunca
  // tocam essa GUC).
  psql(`
    set session_replication_role = replica;
    delete from public.project_memberships where project_id = '${PROJECT_ID}';
    delete from public.email_alert_action_tokens where project_id = '${PROJECT_ID}';
    delete from public.contract_events where project_id = '${PROJECT_ID}';
    delete from public.projects where id = '${PROJECT_ID}';
    delete from public.profiles where id in (
      '${USERS.ADMINISTRADOR}', '${USERS.GESTOR}', '${USERS.GERENTE}',
      '${USERS.COLABORADOR}', '${USERS.LEITURA}', '${USERS.PARA_PROMOVER}',
      '${NEW_MEMBER_GERENTE_USER}', '${NEW_MEMBER_GESTOR_USER}'
    );
    delete from auth.users where id in (
      '${USERS.ADMINISTRADOR}', '${USERS.GESTOR}', '${USERS.GERENTE}',
      '${USERS.COLABORADOR}', '${USERS.LEITURA}', '${USERS.PARA_PROMOVER}',
      '${NEW_MEMBER_GERENTE_USER}', '${NEW_MEMBER_GESTOR_USER}'
    );
    reset session_replication_role;
  `);

  psql(`
    insert into auth.users (id, email) values
      ('${USERS.ADMINISTRADOR}', 'gerente-compat-admin@axion-test.local'),
      ('${USERS.GESTOR}', 'gerente-compat-gestor@axion-test.local'),
      ('${USERS.GERENTE}', 'gerente-compat-gerente@axion-test.local'),
      ('${USERS.COLABORADOR}', 'gerente-compat-colab@axion-test.local'),
      ('${USERS.LEITURA}', 'gerente-compat-leitura@axion-test.local'),
      ('${USERS.PARA_PROMOVER}', 'gerente-compat-promover@axion-test.local')
    on conflict (id) do nothing;

    insert into public.projects (id, code, name, client, status, location, start_date, baseline_end_date) values
      ('${PROJECT_ID}', 'GERENTE-COMPAT', 'Projeto Teste GERENTE-compat', 'Cliente Teste', 'ATIVO', 'Teste', '2026-01-01', '2026-12-31')
    on conflict (id) do nothing;

    insert into public.project_memberships (project_id, user_id, permission, status) values
      ('${PROJECT_ID}', '${USERS.ADMINISTRADOR}', 'ADMINISTRADOR', 'ACTIVE'),
      ('${PROJECT_ID}', '${USERS.PARA_PROMOVER}', 'COLABORADOR', 'ACTIVE'),
      ('${PROJECT_ID}', '${USERS.GESTOR}', 'GESTOR', 'ACTIVE'),
      ('${PROJECT_ID}', '${USERS.GERENTE}', 'GERENTE', 'ACTIVE'),
      ('${PROJECT_ID}', '${USERS.COLABORADOR}', 'COLABORADOR', 'ACTIVE'),
      ('${PROJECT_ID}', '${USERS.LEITURA}', 'LEITURA', 'ACTIVE')
    on conflict (project_id, user_id) do nothing;

    insert into public.contract_events (id, project_id, occurred_at, title, description, source_type, status, created_by_type, created_by_user_id)
    values ('${EVENT_ID}', '${PROJECT_ID}', now(), 'Evento teste GERENTE-compat', 'Descricao', 'EMAIL', 'NOVO', 'USER', '${USERS.ADMINISTRADOR}')
    on conflict (id) do nothing;

    insert into public.email_alert_action_tokens (id, project_id, alert_kind, alert_id, action, token_hash, intended_recipient_email, effective_recipient_email, expires_at)
    values ('99999999-9999-4999-8999-999999999931', '${PROJECT_ID}', 'CONTRACT_EVENT', '${EVENT_ID}', 'ASSUME_RESPONSIBILITY', '${TOKEN_HASH}', 'x@axion.com.br', 'x@axion.com.br', now() + interval '7 days')
    on conflict (id) do nothing;
  `);

  // ---------- 1. has_project_permission — GESTOR e GERENTE idênticos ----------

  for (const role of ["GESTOR", "GERENTE"]) {
    check(`has_project_permission: ${role} NÃO satisfaz nenhum limiar acima de LEITURA (só ADMINISTRADOR escreve)`, () => {
      const admin = asUser(USERS[role], `select public.has_project_permission('${PROJECT_ID}', 'ADMINISTRADOR');`).trim();
      const gestorMin = asUser(USERS[role], `select public.has_project_permission('${PROJECT_ID}', 'GESTOR');`).trim();
      const gerenteMin = asUser(USERS[role], `select public.has_project_permission('${PROJECT_ID}', 'GERENTE');`).trim();
      const leitura = asUser(USERS[role], `select public.has_project_permission('${PROJECT_ID}', 'LEITURA');`).trim();
      if (admin !== "f") throw new Error(`esperado f para ADMINISTRADOR, obtido ${admin}`);
      if (gestorMin !== "f") throw new Error(`esperado f para limiar GESTOR, obtido ${gestorMin}`);
      if (gerenteMin !== "f") throw new Error(`esperado f para limiar GERENTE, obtido ${gerenteMin}`);
      if (leitura !== "t") throw new Error(`esperado t para LEITURA, obtido ${leitura}`);
    });
  }

  check("has_project_permission: ADMINISTRADOR satisfaz todos os limiares (inclusive GERENTE)", () => {
    const result = asUser(USERS.ADMINISTRADOR, `select public.has_project_permission('${PROJECT_ID}', 'GERENTE');`).trim();
    if (result !== "t") throw new Error(`esperado t, obtido ${result}`);
  });

  // ---------- 2. can_manage_project_documents — GESTOR e GERENTE idênticos ----------

  for (const role of ["ADMINISTRADOR", "GESTOR", "GERENTE"]) {
    check(`can_manage_project_documents: ${role} PODE (upload/promoção de documentos)`, () => {
      const result = asUser(USERS[role], `select public.can_manage_project_documents('${PROJECT_ID}');`).trim();
      if (result !== "t") throw new Error(`esperado t, obtido ${result}`);
    });
  }
  for (const role of ["COLABORADOR", "LEITURA"]) {
    check(`can_manage_project_documents: ${role} NÃO pode`, () => {
      const result = asUser(USERS[role], `select public.can_manage_project_documents('${PROJECT_ID}');`).trim();
      if (result !== "f") throw new Error(`esperado f, obtido ${result}`);
    });
  }

  // ---------- 3. get_email_alert_action_context — GESTOR e GERENTE idênticos ----------

  for (const role of ["ADMINISTRADOR", "GESTOR", "GERENTE"]) {
    check(`get_email_alert_action_context: ${role} PODE executar ASSUME_RESPONSIBILITY`, () => {
      const result = asUser(USERS[role], `select can_execute from public.get_email_alert_action_context('${TOKEN_HASH}');`).trim();
      if (result !== "t") throw new Error(`esperado t, obtido ${result}`);
    });
  }
  for (const role of ["COLABORADOR", "LEITURA"]) {
    check(`get_email_alert_action_context: ${role} NÃO pode executar ASSUME_RESPONSIBILITY`, () => {
      const result = asUser(USERS[role], `select can_execute from public.get_email_alert_action_context('${TOKEN_HASH}');`).trim();
      if (result !== "f") throw new Error(`esperado f, obtido ${result}`);
    });
  }

  // ---------- 4. add_project_member / update_project_member_role — aceitam GESTOR e GERENTE ----------

  check("add_project_member: ADMINISTRADOR consegue incluir um novo membro com permission=GERENTE", () => {
    psql(`insert into auth.users (id, email) values ('${NEW_MEMBER_GERENTE_USER}', 'gerente-compat-novo@axion-test.local') on conflict (id) do nothing;`);
    const result = asUser(
      USERS.ADMINISTRADOR,
      `select permission from public.add_project_member('${PROJECT_ID}', '${NEW_MEMBER_GERENTE_USER}', 'GERENTE', null);`
    ).trim();
    if (result !== "GERENTE") throw new Error(`esperado GERENTE, obtido ${result}`);
  });

  check("add_project_member: ADMINISTRADOR ainda consegue incluir um novo membro com permission=GESTOR (compatibilidade)", () => {
    psql(`insert into auth.users (id, email) values ('${NEW_MEMBER_GESTOR_USER}', 'gerente-compat-novo2@axion-test.local') on conflict (id) do nothing;`);
    const result = asUser(
      USERS.ADMINISTRADOR,
      `select permission from public.add_project_member('${PROJECT_ID}', '${NEW_MEMBER_GESTOR_USER}', 'GESTOR', null);`
    ).trim();
    if (result !== "GESTOR") throw new Error(`esperado GESTOR, obtido ${result}`);
  });

  check("update_project_member_role: ADMINISTRADOR consegue promover COLABORADOR para GERENTE", () => {
    const result = asUser(
      USERS.ADMINISTRADOR,
      `select permission from public.update_project_member_role('${PROJECT_ID}', '${USERS.PARA_PROMOVER}', 'GERENTE');`
    ).trim();
    if (result !== "GERENTE") throw new Error(`esperado GERENTE, obtido ${result}`);
  });

  check("CHECK constraint: project_memberships.permission continua rejeitando um papel inventado (não vira aceita-tudo ao ganhar GERENTE)", () => {
    let threw = false;
    try {
      psql(`
        insert into public.project_memberships (project_id, user_id, permission, status)
        values ('${PROJECT_ID}', '${USERS.PARA_PROMOVER}', 'PAPEL_INVENTADO', 'ACTIVE')
        on conflict (project_id, user_id) do update set permission = excluded.permission;
      `);
    } catch (error) {
      threw = true;
      if (!error.message.includes("project_memberships_permission_check")) {
        throw new Error(`esperava falha do CHECK constraint de permission, obtido outro erro: ${error.message}`);
      }
    }
    if (!threw) throw new Error("INSERT com papel inventado deveria ter sido rejeitado pelo CHECK constraint, mas não foi");
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
