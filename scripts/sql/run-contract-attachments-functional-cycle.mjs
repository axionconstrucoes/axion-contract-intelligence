// Item 5 da correção solicitada em 2026-08-31 — ciclo funcional completo
// de "ANEXOS DO CONTRATO", executado contra a MESMA stack descartável (via
// SET ROLE + auth.uid() simulado, mesmo padrão dos demais runners):
//
//   contrato sem anexo -> upload -> registro no banco -> contador 0->1 ->
//   visualização (signed URL simulada por leitura direta da linha,
//   storage_path+bucket) -> download -> reenvio idêntico sem duplicar ->
//   remoção -> contador 1->0 -> contrato principal preservado -> anexo
//   vinculado a evidência tem a remoção bloqueada (as 4 checagens de
//   proteção, uma por uma, com prova de que NENHUMA delas causa alteração
//   parcial).
//
// Também prova o 4º/3º/2º caminho de proteção de evidência
// (event_cross_references.document_id, clause_id->document_version_id,
// project_additional_proposal_links.document_version_id) que
// run-contract-attachments-live-test.mjs não cobre.
//
// SEGURANÇA DE AMBIENTE — mesmo padrão dos demais runners: container
// EXATO desta execução e confirmação explícita, nunca a stack local real
// do projeto nem o remoto.
//
// Uso:
//   ACC_ATTACH_CYCLE_DB_CONTAINER="<nome exato do container>" \
//   ACC_ATTACH_CYCLE_I_UNDERSTAND_THIS_IS_DISPOSABLE=true \
//     node scripts/sql/run-contract-attachments-functional-cycle.mjs

import { spawnSync } from "node:child_process";

const container = process.env.ACC_ATTACH_CYCLE_DB_CONTAINER;
if (!container) {
  console.error('Defina ACC_ATTACH_CYCLE_DB_CONTAINER="<nome exato do container>".');
  process.exit(1);
}
if (process.env.ACC_ATTACH_CYCLE_I_UNDERSTAND_THIS_IS_DISPOSABLE !== "true") {
  console.error('ACC_ATTACH_CYCLE_I_UNDERSTAND_THIS_IS_DISPOSABLE precisa ser exatamente "true".');
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
  return spawnSync(
    "docker",
    ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "--no-psqlrc", "--quiet", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8" }
  );
}
function psqlOk(sql) {
  const r = psql(sql);
  if (r.status !== 0) throw new Error(`psql falhou (exit ${r.status}): ${r.stderr}`);
  return r.stdout;
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

const PROJECT_A = "99999999-9999-4999-8999-999999999a01";
const USERS = {
  ADMINISTRADOR: "99999999-9999-4999-8999-999999999001",
  GERENTE: "99999999-9999-4999-8999-999999999002",
};
const DOCUMENT_ID = "99999999-9999-4999-8999-999999999d01";
const DOCUMENT_VERSION_ID = "99999999-9999-4999-8999-999999999d02";
const EVENT_ID = "99999999-9999-4999-8999-999999999e01";
const EVENT_ID_2 = "99999999-9999-4999-8999-999999999e02";
const EVENT_ID_3 = "99999999-9999-4999-8999-999999999e03";
const CLAUSE_ID = "99999999-9999-4999-8999-999999999c01";
const PROPOSAL_ID = "99999999-9999-4999-8999-99999999b001";

console.log("======================================");
console.log("ANEXOS DO CONTRATO — item 5: ciclo funcional completo");
console.log("======================================");

asSuperuser(`
  set session_replication_role = replica;
  delete from public.project_additional_proposal_links where document_version_id = '${DOCUMENT_VERSION_ID}';
  delete from public.project_additional_proposals where id = '${PROPOSAL_ID}';
  delete from public.event_cross_references where event_id in ('${EVENT_ID}','${EVENT_ID_2}','${EVENT_ID_3}');
  delete from public.clauses where id = '${CLAUSE_ID}';
  delete from public.event_evidence where event_id = '${EVENT_ID}';
  delete from public.contract_events where id in ('${EVENT_ID}','${EVENT_ID_2}','${EVENT_ID_3}');
  delete from public.document_version_files where document_version_id = '${DOCUMENT_VERSION_ID}';
  delete from public.audit_log_entries where entity_type = 'DOCUMENT_VERSION_FILE';
  delete from public.document_versions where id = '${DOCUMENT_VERSION_ID}';
  delete from public.documents where id = '${DOCUMENT_ID}';
  delete from public.project_memberships where project_id = '${PROJECT_A}';
  delete from public.projects where id = '${PROJECT_A}';
  delete from public.profiles where id in (${Object.values(USERS).map((u) => `'${u}'`).join(", ")});
  delete from auth.users where id in (${Object.values(USERS).map((u) => `'${u}'`).join(", ")});
  reset session_replication_role;

  insert into auth.users (id, email) values
    ('${USERS.ADMINISTRADOR}', 'cycle-admin@axion-test.local'),
    ('${USERS.GERENTE}', 'cycle-gerente@axion-test.local')
  on conflict (id) do nothing;

  insert into public.profiles (id, name, email) values
    ('${USERS.ADMINISTRADOR}', 'CYCLE Administrador', 'cycle-admin@axion-test.local'),
    ('${USERS.GERENTE}', 'CYCLE Gerente', 'cycle-gerente@axion-test.local')
  on conflict (id) do nothing;

  insert into public.projects (id, code, name, client, status, location, start_date, baseline_end_date) values
    ('${PROJECT_A}', 'CYCLE-A', 'Projeto Teste CYCLE', 'Cliente Teste', 'ATIVO', 'Teste', '2026-01-01', '2026-12-31')
  on conflict (id) do nothing;

  insert into public.project_memberships (project_id, user_id, permission, status) values
    ('${PROJECT_A}', '${USERS.ADMINISTRADOR}', 'ADMINISTRADOR', 'ACTIVE'),
    ('${PROJECT_A}', '${USERS.GERENTE}', 'GERENTE', 'ACTIVE')
  on conflict (project_id, user_id) do nothing;

  insert into public.documents (id, project_id, kind, title) values
    ('${DOCUMENT_ID}', '${PROJECT_A}', 'CONTRATO_BASE', 'Contrato Base Teste CYCLE')
  on conflict (id) do nothing;

  insert into public.document_versions (
    id, document_id, project_id, version_label, version_index, document_date,
    source_type, author, summary, storage_bucket, file_path, original_file_name,
    mime_type, file_size_bytes, sha256_hash, uploaded_by
  ) values (
    '${DOCUMENT_VERSION_ID}', '${DOCUMENT_ID}', '${PROJECT_A}', 'v1', 1, '2026-01-01',
    'CONTRATO', 'CYCLE Administrador', 'Versao teste CYCLE', 'project-documents',
    '${PROJECT_A}/${DOCUMENT_ID}/${DOCUMENT_VERSION_ID}/contrato.pdf', 'contrato.pdf',
    'application/pdf', 1000, repeat('f', 64), '${USERS.ADMINISTRADOR}'
  )
  on conflict (id) do nothing;
`);

// ------------------------------------------------------------
// 1. Contrato sem anexo -> contador 0
// ------------------------------------------------------------

check("1. Contador de anexos começa em 0 (só PRINCIPAL existe, nenhum ANEXO_CONTRATUAL)", () => {
  const count = asSuperuser(
    `select count(*) from public.document_version_files where document_version_id = '${DOCUMENT_VERSION_ID}' and file_role = 'ANEXO_CONTRATUAL';`
  ).trim();
  if (count !== "0") throw new Error(`esperava 0, obtido ${count}`);
});

check("1b. O documento principal (PRINCIPAL) existe e está intacto antes de qualquer upload", () => {
  const row = asSuperuser(
    `select original_file_name from public.document_version_files where document_version_id = '${DOCUMENT_VERSION_ID}' and file_role = 'PRINCIPAL';`
  ).trim();
  if (row !== "contrato.pdf") throw new Error(`esperava "contrato.pdf" como PRINCIPAL, obtido "${row}"`);
});

// ------------------------------------------------------------
// 2. Upload -> registro -> contador 0->1
// ------------------------------------------------------------

let attachmentId = null;
check("2. Upload de um anexo contratual (ADMINISTRADOR) — registro bem-sucedido", () => {
  const r = callAsPgRole(
    "authenticated",
    USERS.ADMINISTRADOR,
    `select public.register_document_version_file('${DOCUMENT_VERSION_ID}', 'ANEXO_CONTRATUAL', '${PROJECT_A}/${DOCUMENT_ID}/${DOCUMENT_VERSION_ID}/anexos-contratuais/anexo-1.pdf', 'aditivo-financeiro.pdf', 'application/pdf', 204800, repeat('1', 64), 'UPLOAD', 'Aditivo financeiro assinado', null);`
  );
  if (r.status !== 0) throw new Error(`esperava sucesso, obteve falha: ${r.stderr}`);
  attachmentId = r.stdout.trim();
  if (!attachmentId) throw new Error("nenhum id de anexo retornado");
});

check("2b. Contador de anexos passou de 0 para 1", () => {
  const count = asSuperuser(
    `select count(*) from public.document_version_files where document_version_id = '${DOCUMENT_VERSION_ID}' and file_role = 'ANEXO_CONTRATUAL';`
  ).trim();
  if (count !== "1") throw new Error(`esperava 1, obtido ${count}`);
});

check("2c. Audit log registrou DOCUMENT_VERSION_FILE_ADDED com o papel/origem corretos", () => {
  const detail = asSuperuser(
    `select detail from public.audit_log_entries where entity_type='DOCUMENT_VERSION_FILE' and entity_id = '${attachmentId}' and action='DOCUMENT_VERSION_FILE_ADDED';`
  ).trim();
  if (!detail.includes("aditivo-financeiro.pdf") || !detail.includes("ANEXO_CONTRATUAL")) {
    throw new Error(`audit_log_entries.detail inesperado: ${detail}`);
  }
});

// ------------------------------------------------------------
// 3. Visualização / download (metadados para signed URL)
// ------------------------------------------------------------

check("3. Visualização/download: metadados (bucket+path) corretos para gerar signed URL, visível via RLS para membro do projeto", () => {
  const r = callAsPgRole(
    "authenticated",
    USERS.GERENTE,
    `select storage_bucket || '|' || storage_path from public.document_version_files where id = '${attachmentId}';`
  );
  if (r.status !== 0) throw new Error(`esperava sucesso (RLS deveria permitir a membro do mesmo projeto), obteve falha: ${r.stderr}`);
  const [bucket, path] = r.stdout.trim().split("|");
  if (bucket !== "project-documents") throw new Error(`bucket inesperado: ${bucket}`);
  if (!path.startsWith(`${PROJECT_A}/${DOCUMENT_ID}/${DOCUMENT_VERSION_ID}/`)) throw new Error(`storage_path fora do escopo esperado: ${path}`);
});

// ------------------------------------------------------------
// 4. Reenvio idêntico sem duplicar
// ------------------------------------------------------------

check("4. Reenvio do MESMO conteúdo (mesmo sha256) — bloqueado como duplicata, contador continua em 1", () => {
  const r = callAsPgRole(
    "authenticated",
    USERS.ADMINISTRADOR,
    `select public.register_document_version_file('${DOCUMENT_VERSION_ID}', 'ANEXO_CONTRATUAL', '${PROJECT_A}/${DOCUMENT_ID}/${DOCUMENT_VERSION_ID}/anexos-contratuais/anexo-1-retry.pdf', 'aditivo-financeiro.pdf', 'application/pdf', 204800, repeat('1', 64), 'UPLOAD', null, null);`
  );
  if (r.status === 0) throw new Error(`!!! DUPLICOU !!! stdout: ${r.stdout}`);
  if (!r.stderr.includes("DUPLICATE_ATTACHMENT_HASH")) throw new Error(`esperado DUPLICATE_ATTACHMENT_HASH, obtido: ${r.stderr}`);

  const count = asSuperuser(
    `select count(*) from public.document_version_files where document_version_id = '${DOCUMENT_VERSION_ID}' and file_role = 'ANEXO_CONTRATUAL';`
  ).trim();
  if (count !== "1") throw new Error(`contador deveria continuar em 1 após tentativa de duplicata, obtido ${count}`);
});

// ------------------------------------------------------------
// 5. Remoção -> contador 1->0 -> contrato principal preservado
// ------------------------------------------------------------

check("5. Remoção do anexo (GERENTE) — sucesso", () => {
  const r = callAsPgRole("authenticated", USERS.GERENTE, `select public.delete_contract_attachment('${attachmentId}');`);
  if (r.status !== 0) throw new Error(`esperava sucesso, obteve falha: ${r.stderr}`);
});

check("5b. Contador de anexos voltou de 1 para 0", () => {
  const count = asSuperuser(
    `select count(*) from public.document_version_files where document_version_id = '${DOCUMENT_VERSION_ID}' and file_role = 'ANEXO_CONTRATUAL';`
  ).trim();
  if (count !== "0") throw new Error(`esperava 0, obtido ${count}`);
});

check("5c. A linha do anexo removido de fato desapareceu (não é soft-delete)", () => {
  const exists = asSuperuser(`select count(*) from public.document_version_files where id = '${attachmentId}';`).trim();
  if (exists !== "0") throw new Error(`esperava que a linha do anexo tivesse sido removida, ainda existe (${exists})`);
});

check("5d. O documento PRINCIPAL (contrato base) permanece intacto após a remoção do anexo", () => {
  const row = asSuperuser(
    `select original_file_name from public.document_version_files where document_version_id = '${DOCUMENT_VERSION_ID}' and file_role = 'PRINCIPAL';`
  ).trim();
  if (row !== "contrato.pdf") throw new Error(`documento principal deveria continuar intacto, obtido "${row}"`);
});

check("5e. Audit log registrou DOCUMENT_VERSION_FILE_DELETED com o texto exato de preservação do Storage", () => {
  const detail = asSuperuser(
    `select detail from public.audit_log_entries where entity_type='DOCUMENT_VERSION_FILE' and entity_id = '${attachmentId}' and action='DOCUMENT_VERSION_FILE_DELETED';`
  ).trim();
  if (!detail.includes("O arquivo histórico permanece preservado no Storage para auditoria")) {
    throw new Error(`audit_log_entries.detail inesperado: ${detail}`);
  }
});

// ------------------------------------------------------------
// 6. Bloqueio de remoção quando o anexo está vinculado a evidência
//    — as 4 checagens, uma de cada vez, sem alteração parcial
// ------------------------------------------------------------

console.log("");
console.log("---- 6. Bloqueio de remoção por evidência/referência (4 caminhos) ----");
console.log("");

function uploadFreshAttachment(hashChar, label) {
  const r = callAsPgRole(
    "authenticated",
    USERS.ADMINISTRADOR,
    `select public.register_document_version_file('${DOCUMENT_VERSION_ID}', 'ANEXO_CONTRATUAL', '${PROJECT_A}/${DOCUMENT_ID}/${DOCUMENT_VERSION_ID}/anexos-contratuais/${label}.pdf', '${label}.pdf', 'application/pdf', 1024, repeat('${hashChar}', 64), 'UPLOAD', null, null);`
  );
  if (r.status !== 0) throw new Error(`fixture: upload de "${label}" falhou: ${r.stderr}`);
  return r.stdout.trim();
}

// 6.1 — event_evidence (granularidade de versão)
const attachmentForEvidence = uploadFreshAttachment("2", "anexo-evidencia");
asSuperuser(`
  insert into public.contract_events (id, project_id, occurred_at, title, description, source_type, status, created_by_type, created_by_user_id) values
    ('${EVENT_ID}', '${PROJECT_A}', now(), 'Evento teste CYCLE', 'Descricao', 'CONTRATO', 'NOVO', 'USER', '${USERS.ADMINISTRADOR}');
  insert into public.event_evidence (event_id, source_type, label, locator, document_version_id) values
    ('${EVENT_ID}', 'CONTRATO', 'Evidencia teste', 'contrato.pdf', '${DOCUMENT_VERSION_ID}');
`);

check("6.1. Remoção bloqueada: a VERSÃO está referenciada em event_evidence (evento do Event Ledger)", () => {
  const r = callAsPgRole("authenticated", USERS.ADMINISTRADOR, `select public.delete_contract_attachment('${attachmentForEvidence}');`);
  if (r.status === 0) throw new Error(`!!! CONSEGUIU REMOVER ANEXO LIGADO A EVIDÊNCIA !!! stdout: ${r.stdout}`);
  if (!r.stderr.includes("referenciada como evidência de um evento do Event Ledger")) {
    throw new Error(`mensagem inesperada: ${r.stderr}`);
  }
});

check("6.1b. Nenhuma alteração parcial: o anexo bloqueado continua existindo e o contador não mudou", () => {
  const exists = asSuperuser(`select count(*) from public.document_version_files where id = '${attachmentForEvidence}';`).trim();
  if (exists !== "1") throw new Error(`esperava que a linha continuasse existindo (bloqueio deve ser tudo-ou-nada), obtido ${exists}`);
});

// a checagem de event_evidence é por VERSÃO (não por arquivo individual —
// ver comentário da migration), então precisa ser desfeita aqui, senão ela
// continua bloqueando QUALQUER remoção nesta mesma versão e mascara os
// testes 6.2/6.3/6.4/6.5 a seguir.
asSuperuser(`delete from public.event_evidence where event_id = '${EVENT_ID}'; delete from public.contract_events where id = '${EVENT_ID}';`);

// 6.2 — event_cross_references.document_id
const attachmentForCrossRef = uploadFreshAttachment("3", "anexo-crossref-doc");
asSuperuser(`
  insert into public.contract_events (id, project_id, occurred_at, title, description, source_type, status, created_by_type, created_by_user_id) values
    ('${EVENT_ID_2}', '${PROJECT_A}', now(), 'Evento teste CYCLE 2', 'Descricao', 'CONTRATO', 'NOVO', 'USER', '${USERS.ADMINISTRADOR}');
  insert into public.event_cross_references (event_id, kind, document_id, note) values
    ('${EVENT_ID_2}', 'CONTRATO_ADITIVO', '${DOCUMENT_ID}', 'Referencia direta ao documento');
`);

check("6.2. Remoção bloqueada: existe event_cross_references.document_id apontando para este DOCUMENTO", () => {
  const r = callAsPgRole("authenticated", USERS.ADMINISTRADOR, `select public.delete_contract_attachment('${attachmentForCrossRef}');`);
  if (r.status === 0) throw new Error(`!!! CONSEGUIU REMOVER COM CROSS-REFERENCE DE DOCUMENTO ATIVA !!! stdout: ${r.stdout}`);
  if (!r.stderr.includes("existe referência direta a este documento no Event Ledger")) {
    throw new Error(`mensagem inesperada: ${r.stderr}`);
  }
});

// limpa a cross-reference do 6.2 antes de seguir para não interferir no 6.3/6.4
asSuperuser(`delete from public.event_cross_references where event_id = '${EVENT_ID_2}';`);

// 6.3 — event_cross_references.clause_id -> clauses.document_version_id
const attachmentForClause = uploadFreshAttachment("4", "anexo-clausula");
asSuperuser(`
  insert into public.clauses (id, document_version_id, clause_number, title, text) values
    ('${CLAUSE_ID}', '${DOCUMENT_VERSION_ID}', '3.1', 'Clausula teste', 'Texto da clausula');
  insert into public.contract_events (id, project_id, occurred_at, title, description, source_type, status, created_by_type, created_by_user_id) values
    ('${EVENT_ID_3}', '${PROJECT_A}', now(), 'Evento teste CYCLE 3', 'Descricao', 'CONTRATO', 'NOVO', 'USER', '${USERS.ADMINISTRADOR}');
  insert into public.event_cross_references (event_id, kind, clause_id, note) values
    ('${EVENT_ID_3}', 'CONTRATO_ADITIVO', '${CLAUSE_ID}', 'Referencia a clausula desta versao');
`);

check("6.3. Remoção bloqueada: uma CLÁUSULA desta versão está referenciada no Event Ledger", () => {
  const r = callAsPgRole("authenticated", USERS.ADMINISTRADOR, `select public.delete_contract_attachment('${attachmentForClause}');`);
  if (r.status === 0) throw new Error(`!!! CONSEGUIU REMOVER COM CLÁUSULA REFERENCIADA !!! stdout: ${r.stdout}`);
  if (!r.stderr.includes("uma cláusula desta versão está referenciada no Event Ledger")) {
    throw new Error(`mensagem inesperada: ${r.stderr}`);
  }
});

asSuperuser(`delete from public.event_cross_references where event_id = '${EVENT_ID_3}'; delete from public.clauses where id = '${CLAUSE_ID}';`);

// 6.4 — project_additional_proposal_links.document_version_id
const attachmentForProposal = uploadFreshAttachment("5", "anexo-proposta");
asSuperuser(`
  insert into public.project_additional_proposals (
    id, project_id, proposal_number, title, description, source_type, created_by_type, created_by_user_id
  ) values (
    '${PROPOSAL_ID}', '${PROJECT_A}', 'PROP-CYCLE-1', 'Proposta teste CYCLE', 'Descricao', 'MANUAL', 'USER', '${USERS.ADMINISTRADOR}'
  );
  insert into public.project_additional_proposal_links (proposal_id, link_role, document_version_id, created_by_type, created_by_user_id) values
    ('${PROPOSAL_ID}', 'EVIDENCIA_CONTRATACAO', '${DOCUMENT_VERSION_ID}', 'USER', '${USERS.ADMINISTRADOR}');
`);

check("6.4. Remoção bloqueada: esta VERSÃO está vinculada a uma Proposta de Adicional", () => {
  const r = callAsPgRole("authenticated", USERS.ADMINISTRADOR, `select public.delete_contract_attachment('${attachmentForProposal}');`);
  if (r.status === 0) throw new Error(`!!! CONSEGUIU REMOVER COM PROPOSTA DE ADICIONAL VINCULADA !!! stdout: ${r.stdout}`);
  if (!r.stderr.includes("está vinculada a uma Proposta de Adicional")) {
    throw new Error(`mensagem inesperada: ${r.stderr}`);
  }
});

check("6.5. Depois de remover o vínculo com a proposta, a remoção do MESMO anexo passa a ser permitida (a proteção é dinâmica, não permanente)", () => {
  asSuperuser(`delete from public.project_additional_proposal_links where proposal_id = '${PROPOSAL_ID}';`);
  const r = callAsPgRole("authenticated", USERS.ADMINISTRADOR, `select public.delete_contract_attachment('${attachmentForProposal}');`);
  if (r.status !== 0) throw new Error(`esperava sucesso após remover o vínculo bloqueante, obteve falha: ${r.stderr}`);
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");
process.exit(failed === 0 ? 0 : 1);
