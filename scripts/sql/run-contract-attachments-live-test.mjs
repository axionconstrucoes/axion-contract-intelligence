// Prova REAL (via SET ROLE + auth.uid() simulado, mesmo padrão de
// run-security-fix-authorization-test.mjs) da migration
// 20260831210000_contract_attachments_authorization_and_delete.sql —
// "ANEXOS DO CONTRATO" — item 2 da correção solicitada em 2026-08-31:
//
//   - Matriz de papéis para can_add_contract_attachment/
//     register_document_version_file(ANEXO_CONTRATUAL):
//     ADMINISTRADOR, GERENTE, GESTOR (só compatibilidade transitória de
//     dados antigos), COLABORADOR, LEITURA, usuário fora do projeto,
//     anon, service_role.
//   - delete_contract_attachment: matriz de papéis (ADMINISTRADOR/
//     GERENTE permitido; GESTOR permitido só como o mesmo papel legado;
//     COLABORADOR/LEITURA/fora-do-projeto bloqueados).
//   - Deduplicação por hash (document_version_files_contract_attachment_
//     hash_idx): reenvio do mesmo sha256 na MESMA versão é rejeitado com
//     DUPLICATE_ATTACHMENT_HASH; o mesmo hash em OUTRA versão é aceito
//     (índice é por document_version_id, não global).
//   - RLS de document_version_files (SELECT): membro de outro projeto
//     não enxerga os anexos do projeto A.
//   - search_path e EXECUTE para authenticated: já cobertos por
//     run-security-definer-search-path-audit.mjs (roda antes deste,
//     mesmo container) — não duplicado aqui.
//   - Tentativa direta de "adulterar" project_id/document_version_id:
//     nenhuma das duas functions aceita esses valores como parâmetro
//     (register_document_version_file só recebe p_document_version_id,
//     que é resolvido para project_id via JOIN; delete_contract_attachment
//     só recebe p_file_id) — provado estruturalmente E também tentando
//     um document_version_id de OUTRO projeto (cross-tenant real).
//   - Rollback em caso de falha: violação de hash não deixa linha
//     parcial nem o audit_log_entries correspondente; exclusão bloqueada
//     por evidência não apaga a linha nem o Storage.
//
// Item 5 (ciclo funcional completo) roda no MESMO container, ver
// run-contract-attachments-functional-cycle.mjs.
//
// SEGURANÇA DE AMBIENTE — mesmo padrão dos demais runners: container
// EXATO desta execução e confirmação explícita, nunca a stack local
// real do projeto nem o remoto.
//
// Uso (só depois de ter a stack descartável rodando, com o histórico
// completo de migrations já aplicado, incluindo
// 20260831210000_contract_attachments_authorization_and_delete.sql):
//   ACC_ATTACH_TEST_DB_CONTAINER="<nome exato do container>" \
//   ACC_ATTACH_TEST_I_UNDERSTAND_THIS_IS_DISPOSABLE=true \
//     node scripts/sql/run-contract-attachments-live-test.mjs

import { spawnSync } from "node:child_process";

const container = process.env.ACC_ATTACH_TEST_DB_CONTAINER;
if (!container) {
  console.error('Defina ACC_ATTACH_TEST_DB_CONTAINER="<nome exato do container>".');
  process.exit(1);
}
if (process.env.ACC_ATTACH_TEST_I_UNDERSTAND_THIS_IS_DISPOSABLE !== "true") {
  console.error('ACC_ATTACH_TEST_I_UNDERSTAND_THIS_IS_DISPOSABLE precisa ser exatamente "true".');
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

function asSuperuser(sql) {
  return psqlOk(sql);
}

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

const PROJECT_A = "88888888-8888-4888-8888-888888888a01";
const PROJECT_B = "88888888-8888-4888-8888-888888888b01";
const USERS = {
  ADMINISTRADOR: "88888888-8888-4888-8888-888888888001",
  GERENTE: "88888888-8888-4888-8888-888888888002",
  GESTOR: "88888888-8888-4888-8888-888888888003",
  COLABORADOR: "88888888-8888-4888-8888-888888888004",
  LEITURA: "88888888-8888-4888-8888-888888888005",
  NO_MEMBERSHIP: "88888888-8888-4888-8888-888888888006",
  OUTSIDE_MEMBER_B: "88888888-8888-4888-8888-888888888007",
};
const DOCUMENT_ID = "88888888-8888-4888-8888-888888888d01";
const DOCUMENT_VERSION_ID = "88888888-8888-4888-8888-888888888d02";
const DOCUMENT_VERSION_ID_2 = "88888888-8888-4888-8888-888888888d03";
const DOCUMENT_ID_B = "88888888-8888-4888-8888-888888888d11";
const DOCUMENT_VERSION_ID_B = "88888888-8888-4888-8888-888888888d12";

console.log("======================================");
console.log("ANEXOS DO CONTRATO — item 2: teste real em stack descartável");
console.log("======================================");

asSuperuser(`
  set session_replication_role = replica;
  delete from public.document_version_files where document_version_id in ('${DOCUMENT_VERSION_ID}','${DOCUMENT_VERSION_ID_2}','${DOCUMENT_VERSION_ID_B}');
  delete from public.audit_log_entries where entity_type = 'DOCUMENT_VERSION_FILE';
  delete from public.document_versions where id in ('${DOCUMENT_VERSION_ID}','${DOCUMENT_VERSION_ID_2}','${DOCUMENT_VERSION_ID_B}');
  delete from public.documents where id in ('${DOCUMENT_ID}','${DOCUMENT_ID_B}');
  delete from public.project_memberships where project_id in ('${PROJECT_A}','${PROJECT_B}');
  delete from public.projects where id in ('${PROJECT_A}','${PROJECT_B}');
  delete from public.profiles where id in (${Object.values(USERS).map((u) => `'${u}'`).join(", ")});
  delete from auth.users where id in (${Object.values(USERS).map((u) => `'${u}'`).join(", ")});
  reset session_replication_role;
`);

asSuperuser(`
  insert into auth.users (id, email) values
    ('${USERS.ADMINISTRADOR}', 'attach-admin@axion-test.local'),
    ('${USERS.GERENTE}', 'attach-gerente@axion-test.local'),
    ('${USERS.GESTOR}', 'attach-gestor@axion-test.local'),
    ('${USERS.COLABORADOR}', 'attach-colab@axion-test.local'),
    ('${USERS.LEITURA}', 'attach-leitura@axion-test.local'),
    ('${USERS.NO_MEMBERSHIP}', 'attach-nomember@axion-test.local'),
    ('${USERS.OUTSIDE_MEMBER_B}', 'attach-outside-b@axion-test.local')
  on conflict (id) do nothing;

  insert into public.profiles (id, name, email) values
    ('${USERS.ADMINISTRADOR}', 'ATTACH Administrador', 'attach-admin@axion-test.local'),
    ('${USERS.GERENTE}', 'ATTACH Gerente', 'attach-gerente@axion-test.local'),
    ('${USERS.GESTOR}', 'ATTACH Gestor (legado)', 'attach-gestor@axion-test.local'),
    ('${USERS.COLABORADOR}', 'ATTACH Colaborador', 'attach-colab@axion-test.local'),
    ('${USERS.LEITURA}', 'ATTACH Leitura', 'attach-leitura@axion-test.local'),
    ('${USERS.NO_MEMBERSHIP}', 'ATTACH Sem Membership', 'attach-nomember@axion-test.local'),
    ('${USERS.OUTSIDE_MEMBER_B}', 'ATTACH Outside B', 'attach-outside-b@axion-test.local')
  on conflict (id) do nothing;

  insert into public.projects (id, code, name, client, status, location, start_date, baseline_end_date) values
    ('${PROJECT_A}', 'ATTACH-A', 'Projeto Teste ATTACH A', 'Cliente Teste', 'ATIVO', 'Teste', '2026-01-01', '2026-12-31'),
    ('${PROJECT_B}', 'ATTACH-B', 'Projeto Teste ATTACH B', 'Cliente Teste', 'ATIVO', 'Teste', '2026-01-01', '2026-12-31')
  on conflict (id) do nothing;

  -- GESTOR aqui é deliberadamente o mesmo papel legado de GERENTE (nunca
  -- convertido automaticamente) — ver migration
  -- 20260829200000_project_permission_gerente_compat.sql.
  insert into public.project_memberships (project_id, user_id, permission, status) values
    ('${PROJECT_A}', '${USERS.ADMINISTRADOR}', 'ADMINISTRADOR', 'ACTIVE'),
    ('${PROJECT_A}', '${USERS.GERENTE}', 'GERENTE', 'ACTIVE'),
    ('${PROJECT_A}', '${USERS.GESTOR}', 'GESTOR', 'ACTIVE'),
    ('${PROJECT_A}', '${USERS.COLABORADOR}', 'COLABORADOR', 'ACTIVE'),
    ('${PROJECT_A}', '${USERS.LEITURA}', 'LEITURA', 'ACTIVE'),
    ('${PROJECT_B}', '${USERS.OUTSIDE_MEMBER_B}', 'ADMINISTRADOR', 'ACTIVE')
  on conflict (project_id, user_id) do nothing;

  insert into public.documents (id, project_id, kind, title) values
    ('${DOCUMENT_ID}', '${PROJECT_A}', 'CONTRATO_BASE', 'Contrato Base Teste ATTACH'),
    ('${DOCUMENT_ID_B}', '${PROJECT_B}', 'CONTRATO_BASE', 'Contrato Base Teste ATTACH B')
  on conflict (id) do nothing;

  insert into public.document_versions (
    id, document_id, project_id, version_label, version_index, document_date,
    source_type, author, summary, storage_bucket, file_path, original_file_name,
    mime_type, file_size_bytes, sha256_hash, uploaded_by
  ) values (
    '${DOCUMENT_VERSION_ID}', '${DOCUMENT_ID}', '${PROJECT_A}', 'v1', 1, '2026-01-01',
    'CONTRATO', 'ATTACH Administrador', 'Versao teste ATTACH', 'project-documents',
    '${PROJECT_A}/${DOCUMENT_ID}/${DOCUMENT_VERSION_ID}/contrato.pdf', 'contrato.pdf',
    'application/pdf', 1000, repeat('a', 64), '${USERS.ADMINISTRADOR}'
  ),
  (
    '${DOCUMENT_VERSION_ID_2}', '${DOCUMENT_ID}', '${PROJECT_A}', 'v2', 2, '2026-01-02',
    'CONTRATO', 'ATTACH Administrador', 'Versao 2 teste ATTACH', 'project-documents',
    '${PROJECT_A}/${DOCUMENT_ID}/${DOCUMENT_VERSION_ID_2}/contrato-v2.pdf', 'contrato-v2.pdf',
    'application/pdf', 1000, repeat('b', 64), '${USERS.ADMINISTRADOR}'
  ),
  (
    '${DOCUMENT_VERSION_ID_B}', '${DOCUMENT_ID_B}', '${PROJECT_B}', 'v1', 1, '2026-01-01',
    'CONTRATO', 'ATTACH Outside B', 'Versao teste ATTACH B', 'project-documents',
    '${PROJECT_B}/${DOCUMENT_ID_B}/${DOCUMENT_VERSION_ID_B}/contrato.pdf', 'contrato.pdf',
    'application/pdf', 1000, repeat('c', 64), '${USERS.OUTSIDE_MEMBER_B}'
  )
  on conflict (id) do nothing;
`);

// ============================================================
// 1. can_add_contract_attachment / register_document_version_file — matriz de papéis
// ============================================================

console.log("");
console.log("---- register_document_version_file(ANEXO_CONTRATUAL) — matriz de papéis ----");
console.log("");

// storage_path inclui um sufixo distinto por chamada (uuid gerado client-
// side na aplicação real, ver use-contract-attachments.ts) para isolar o
// teste de deduplicação por HASH da restrição, separada, de unicidade de
// (storage_bucket, storage_path) — sem isso, duas tentativas com o mesmo
// nome de arquivo colidiriam ali primeiro, mascarando o índice de dedup.
let pathSuffixCounter = 0;
const registerAttachmentSql = (versionId, hashChar, pathSuffix = String(pathSuffixCounter++)) =>
  `select public.register_document_version_file('${versionId}', 'ANEXO_CONTRATUAL', '${PROJECT_A}/${DOCUMENT_ID}/${versionId}/anexo-${pathSuffix}.pdf', 'anexo.pdf', 'application/pdf', 100, repeat('${hashChar}',64), 'UPLOAD', null, null);`;

check("anon — permission denied no nível do Postgres (42501)", () => {
  const r = callAsPgRole("anon", null, registerAttachmentSql(DOCUMENT_VERSION_ID, "1"));
  if (r.status === 0) throw new Error(`esperava falha, obteve sucesso: ${r.stdout}`);
  if (!r.stderr.includes("permission denied for function")) {
    throw new Error(`esperava permission denied, obtido: ${r.stderr}`);
  }
});

check("authenticated sem nenhuma membership — bloqueado (Insufficient permission)", () => {
  const r = callAsPgRole("authenticated", USERS.NO_MEMBERSHIP, registerAttachmentSql(DOCUMENT_VERSION_ID, "1"));
  if (r.status === 0) throw new Error(`esperava falha, obteve sucesso: ${r.stdout}`);
  if (!r.stderr.includes("Insufficient permission for this file role")) {
    throw new Error(`esperado "Insufficient permission for this file role", obtido: ${r.stderr}`);
  }
});

check("usuário de OUTRO projeto (B) tentando document_version_id do projeto A — bloqueado (sem cross-tenant)", () => {
  const r = callAsPgRole("authenticated", USERS.OUTSIDE_MEMBER_B, registerAttachmentSql(DOCUMENT_VERSION_ID, "1"));
  if (r.status === 0) throw new Error(`!!! CONSEGUIU (cross-tenant) !!! stdout: ${r.stdout}`);
  if (!r.stderr.includes("Insufficient permission for this file role")) {
    throw new Error(`esperado "Insufficient permission for this file role", obtido: ${r.stderr}`);
  }
});

check("ADMINISTRADOR — permitido (chega até o INSERT real)", () => {
  const r = callAsPgRole("authenticated", USERS.ADMINISTRADOR, registerAttachmentSql(DOCUMENT_VERSION_ID, "1"));
  if (r.status !== 0) throw new Error(`esperava sucesso, obteve falha: ${r.stderr}`);
});

check("GERENTE — permitido", () => {
  const r = callAsPgRole("authenticated", USERS.GERENTE, registerAttachmentSql(DOCUMENT_VERSION_ID, "2"));
  if (r.status !== 0) throw new Error(`esperava sucesso, obteve falha: ${r.stderr}`);
});

check("GESTOR (compatibilidade transitória do mesmo papel legado) — permitido", () => {
  const r = callAsPgRole("authenticated", USERS.GESTOR, registerAttachmentSql(DOCUMENT_VERSION_ID, "3"));
  if (r.status !== 0) throw new Error(`esperava sucesso, obteve falha: ${r.stderr}`);
});

check("COLABORADOR — permitido (decisão de negócio: pode ADICIONAR)", () => {
  const r = callAsPgRole("authenticated", USERS.COLABORADOR, registerAttachmentSql(DOCUMENT_VERSION_ID, "4"));
  if (r.status !== 0) throw new Error(`esperava sucesso, obteve falha: ${r.stderr}`);
});

check("LEITURA — bloqueado (só visualiza/baixa, nunca adiciona)", () => {
  const r = callAsPgRole("authenticated", USERS.LEITURA, registerAttachmentSql(DOCUMENT_VERSION_ID, "5"));
  if (r.status === 0) throw new Error(`!!! LEITURA CONSEGUIU ADICIONAR ANEXO !!! stdout: ${r.stdout}`);
  if (!r.stderr.includes("Insufficient permission for this file role")) {
    throw new Error(`esperado "Insufficient permission for this file role", obtido: ${r.stderr}`);
  }
});

check("service_role mantém EXECUTE (chega ao corpo, rejeitado por falta de auth.uid())", () => {
  const r = callAsPgRole("service_role", null, registerAttachmentSql(DOCUMENT_VERSION_ID, "6"));
  if (r.stderr.includes("permission denied for function")) {
    throw new Error(`service_role deveria manter EXECUTE: ${r.stderr}`);
  }
  if (!r.stderr.includes("Authentication required")) {
    throw new Error(`esperado "Authentication required", obtido: ${r.stderr}`);
  }
});

// ============================================================
// 2. Deduplicação por hash
// ============================================================

console.log("");
console.log("---- Deduplicação por hash (índice único parcial) ----");
console.log("");

check("reenvio do MESMO sha256 na MESMA versão — rejeitado com DUPLICATE_ATTACHMENT_HASH", () => {
  const r = callAsPgRole("authenticated", USERS.ADMINISTRADOR, registerAttachmentSql(DOCUMENT_VERSION_ID, "1"));
  if (r.status === 0) throw new Error(`!!! DUPLICOU O MESMO CONTEÚDO !!! stdout: ${r.stdout}`);
  if (!r.stderr.includes("DUPLICATE_ATTACHMENT_HASH")) {
    throw new Error(`esperado "DUPLICATE_ATTACHMENT_HASH", obtido: ${r.stderr}`);
  }
});

check("rollback: a tentativa duplicada não deixou audit_log_entries órfão", () => {
  const count = asSuperuser(
    `select count(*) from public.audit_log_entries where entity_type='DOCUMENT_VERSION_FILE' and detail like '%SHA-256: ${"1".repeat(64)}%';`
  ).trim();
  if (count !== "1") {
    throw new Error(`esperava exatamente 1 entrada de audit (só o INSERT bem-sucedido original), encontrado: ${count}`);
  }
});

check("o MESMO sha256 em OUTRA versão do MESMO documento — aceito (índice é por document_version_id)", () => {
  const r = callAsPgRole("authenticated", USERS.ADMINISTRADOR, registerAttachmentSql(DOCUMENT_VERSION_ID_2, "1"));
  if (r.status !== 0) throw new Error(`esperava sucesso (dedup é por versão, não global), obteve falha: ${r.stderr}`);
});

// ============================================================
// 3. RLS de document_version_files (SELECT)
// ============================================================

console.log("");
console.log("---- RLS (SELECT em document_version_files) ----");
console.log("");

check("usuário de OUTRO projeto (B) não enxerga anexos do projeto A via RLS", () => {
  const r = callAsPgRole(
    "authenticated",
    USERS.OUTSIDE_MEMBER_B,
    `select count(*) from public.document_version_files where document_version_id = '${DOCUMENT_VERSION_ID}';`
  );
  if (r.status !== 0) throw new Error(`query deveria retornar 0 linhas, não falhar: ${r.stderr}`);
  if (r.stdout.trim() !== "0") {
    throw new Error(`esperava 0 linhas visíveis via RLS para membro de outro projeto, obtido: ${r.stdout.trim()}`);
  }
});

check("ADMINISTRADOR do projeto A enxerga os anexos via RLS", () => {
  const r = callAsPgRole(
    "authenticated",
    USERS.ADMINISTRADOR,
    `select count(*) from public.document_version_files where document_version_id = '${DOCUMENT_VERSION_ID}' and file_role = 'ANEXO_CONTRATUAL';`
  );
  if (r.status !== 0) throw new Error(`query falhou: ${r.stderr}`);
  const n = Number(r.stdout.trim());
  if (!(n >= 4)) {
    throw new Error(`esperava ao menos os 4 anexos criados por ADMINISTRADOR/GERENTE/GESTOR/COLABORADOR, obtido: ${n}`);
  }
});

// ============================================================
// 4. delete_contract_attachment — matriz de papéis
// ============================================================

console.log("");
console.log("---- delete_contract_attachment — matriz de papéis ----");
console.log("");

function getFileId(sha256Char) {
  return asSuperuser(
    `select id from public.document_version_files where document_version_id = '${DOCUMENT_VERSION_ID}' and sha256_hash = repeat('${sha256Char}',64);`
  ).trim();
}

const fileIdColaborador = getFileId("4");
const fileIdGerente = getFileId("2");
const fileIdGestor = getFileId("3");
const fileIdAdmin = getFileId("1");

check("COLABORADOR não pode excluir (pode adicionar, não excluir)", () => {
  const r = callAsPgRole("authenticated", USERS.COLABORADOR, `select public.delete_contract_attachment('${fileIdColaborador}');`);
  if (r.status === 0) throw new Error(`!!! COLABORADOR CONSEGUIU EXCLUIR !!! stdout: ${r.stdout}`);
  if (!r.stderr.includes("ADMINISTRADOR or GERENTE permission required")) {
    throw new Error(`esperado "ADMINISTRADOR or GERENTE permission required", obtido: ${r.stderr}`);
  }
});

check("LEITURA não pode excluir", () => {
  const r = callAsPgRole("authenticated", USERS.LEITURA, `select public.delete_contract_attachment('${fileIdColaborador}');`);
  if (r.status === 0) throw new Error(`!!! LEITURA CONSEGUIU EXCLUIR !!! stdout: ${r.stdout}`);
  if (!r.stderr.includes("ADMINISTRADOR or GERENTE permission required")) {
    throw new Error(`esperado "ADMINISTRADOR or GERENTE permission required", obtido: ${r.stderr}`);
  }
});

check("usuário de OUTRO projeto (B) não pode excluir anexo do projeto A", () => {
  const r = callAsPgRole("authenticated", USERS.OUTSIDE_MEMBER_B, `select public.delete_contract_attachment('${fileIdColaborador}');`);
  if (r.status === 0) throw new Error(`!!! CROSS-TENANT DELETE CONSEGUIU !!! stdout: ${r.stdout}`);
  if (!r.stderr.includes("ADMINISTRADOR or GERENTE permission required")) {
    throw new Error(`esperado "ADMINISTRADOR or GERENTE permission required", obtido: ${r.stderr}`);
  }
});

check("GERENTE pode excluir um anexo (o dele próprio)", () => {
  const r = callAsPgRole("authenticated", USERS.GERENTE, `select public.delete_contract_attachment('${fileIdGerente}');`);
  if (r.status !== 0) throw new Error(`esperava sucesso, obteve falha: ${r.stderr}`);
});

check("GESTOR (mesmo papel legado) pode excluir um anexo", () => {
  const r = callAsPgRole("authenticated", USERS.GESTOR, `select public.delete_contract_attachment('${fileIdGestor}');`);
  if (r.status !== 0) throw new Error(`esperava sucesso, obteve falha: ${r.stderr}`);
});

check("ADMINISTRADOR pode excluir um anexo de COLABORADOR (excluir não depende de quem adicionou)", () => {
  const r = callAsPgRole("authenticated", USERS.ADMINISTRADOR, `select public.delete_contract_attachment('${fileIdColaborador}');`);
  if (r.status !== 0) throw new Error(`esperava sucesso, obteve falha: ${r.stderr}`);
});

check("excluir um file_id inexistente — bloqueado (Anexo não encontrado)", () => {
  const r = callAsPgRole("authenticated", USERS.ADMINISTRADOR, `select public.delete_contract_attachment('00000000-0000-4000-8000-000000000000');`);
  if (r.status === 0) throw new Error(`esperava falha, obteve sucesso: ${r.stdout}`);
  if (!r.stderr.includes("Anexo não encontrado")) throw new Error(`esperado "Anexo não encontrado", obtido: ${r.stderr}`);
});

check("delete_contract_attachment recusa um file_role diferente de ANEXO_CONTRATUAL (PRINCIPAL nunca é removido por esta RPC)", () => {
  const principalId = asSuperuser(`select id from public.document_version_files where document_version_id = '${DOCUMENT_VERSION_ID}' and file_role = 'PRINCIPAL';`).trim();
  if (!principalId) throw new Error("fixture: nenhuma linha PRINCIPAL encontrada para testar (verifique sync_document_version_principal_file)");
  const r = callAsPgRole("authenticated", USERS.ADMINISTRADOR, `select public.delete_contract_attachment('${principalId}');`);
  if (r.status === 0) throw new Error(`!!! CONSEGUIU EXCLUIR O ARQUIVO PRINCIPAL !!! stdout: ${r.stdout}`);
  if (!r.stderr.includes("This RPC only removes ANEXO_CONTRATUAL files")) {
    throw new Error(`esperado "This RPC only removes ANEXO_CONTRATUAL files", obtido: ${r.stderr}`);
  }
});

// ============================================================
// 5. Adulteração direta de project_id / document_version_id
// ============================================================

console.log("");
console.log("---- Tentativa direta de adulterar project_id/document_version_id ----");
console.log("");

check("register_document_version_file não recebe project_id como parâmetro (só document_version_id, resolvido via JOIN)", () => {
  const args = asSuperuser(
    "select pg_get_function_identity_arguments('public.register_document_version_file'::regproc);"
  ).trim();
  if (args.includes("p_project_id") || args.includes("project_id uuid")) {
    throw new Error(`a assinatura não deveria expor project_id como parâmetro: ${args}`);
  }
});

check("delete_contract_attachment não recebe project_id nem document_version_id como parâmetro (só p_file_id)", () => {
  const args = asSuperuser(
    "select pg_get_function_identity_arguments('public.delete_contract_attachment'::regproc);"
  ).trim();
  if (args !== "p_file_id uuid") {
    throw new Error(`esperava assinatura só com p_file_id uuid, obtido: ${args}`);
  }
});

check("passar um document_version_id de OUTRO projeto (B) como se fosse do projeto A — resolve para o projeto B de verdade (sem cross-tenant), e o autor (do projeto A) é barrado", () => {
  const r = callAsPgRole(
    "authenticated",
    USERS.ADMINISTRADOR,
    registerAttachmentSql(DOCUMENT_VERSION_ID_B, "9")
  );
  if (r.status === 0) throw new Error(`!!! ADMINISTRADOR DO PROJETO A CONSEGUIU ESCREVER NO PROJETO B !!! stdout: ${r.stdout}`);
  if (!r.stderr.includes("Insufficient permission for this file role")) {
    throw new Error(`esperado "Insufficient permission for this file role" (project_id resolvido corretamente para B, onde ADMINISTRADOR de A não tem membership), obtido: ${r.stderr}`);
  }
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");
process.exit(failed === 0 ? 0 : 1);
