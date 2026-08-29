// Bloco 1.3 — cenários REAIS (RPC de verdade, nunca reimplementação em
// JS) contra a stack descartável:
//   (a) documento com uma VERSÃO vinculada a project_additional_proposal_links
//       não pode ir para a lixeira;
//   (b) documento SEM vínculo pode ir para a lixeira normalmente;
//   (c) "após desvínculo legítimo, a regra normal volta a valer" — NÃO
//       se aplica a project_additional_proposal_links (ver nota abaixo);
//       demonstrado com o mecanismo real que SUPORTA desvínculo
//       (document_contractual_attachment_linkage / unlink_document_
//       contractual_attachment), que já protege a lixeira do mesmo jeito;
//   (d) uma tentativa recusada nunca produz auditoria parcial (nenhuma
//       linha em audit_log_entries para o documento cuja exclusão foi
//       bloqueada);
//   + dedup-em-lixeira: comportamento restaurar-vs-reenviar (depois de
//     restore_project_document, find_document_by_sha256 deixa de marcar
//     is_trashed=true para aquele documento).
//
// NOTA IMPORTANTE (achado desta rodada, não um bug): a migration
// 20260823070000_additional_proposal_lifecycle.sql documenta
// explicitamente "Sem UPDATE/DELETE em links: um vínculo incorreto é
// substituído por um novo registro... preserva rastreabilidade" — não
// existe NENHUMA RPC/policy de desvínculo para
// project_additional_proposal_links, por design deliberado (CLAUDE.md
// #11, rastreabilidade). Um vínculo a uma Proposta de Adicional é
// permanente; o cenário (c) do requisito desta rodada, portanto, não
// tem um caminho real para ser exercido NESTA tabela especificamente —
// documentado aqui, nunca simulado/forjado com um DELETE direto (o que
// testaria um caminho que a aplicação real nunca usa).
//
// SEGURANÇA DE AMBIENTE — mesmas 4 camadas dos outros runners desta
// família (porta e container EXATOS desta execução, confirmação
// explícita, host restrito).
//
// Uso (só depois de ter a stack descartável real rodando):
//   ACC_PROPOSAL_TRASH_TEST_API_URL="http://127.0.0.1:55513" \
//   ACC_PROPOSAL_TRASH_TEST_DB_CONTAINER="supabase_db_acc-disposable-20260829" \
//   ACC_PROPOSAL_TRASH_TEST_I_UNDERSTAND_THIS_IS_DISPOSABLE=true \
//     node scripts/sql/run-trash-proposal-link-and-dedup-test.mjs

import { spawnSync } from "node:child_process";

const EXACT_API_URL = "http://127.0.0.1:55513";
const EXACT_DB_CONTAINER = "supabase_db_acc-disposable-20260829";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

if (process.env.ACC_PROPOSAL_TRASH_TEST_API_URL !== EXACT_API_URL) {
  console.error(`ACC_PROPOSAL_TRASH_TEST_API_URL precisa ser exatamente "${EXACT_API_URL}".`);
  process.exit(1);
}
if (process.env.ACC_PROPOSAL_TRASH_TEST_DB_CONTAINER !== EXACT_DB_CONTAINER) {
  console.error(`ACC_PROPOSAL_TRASH_TEST_DB_CONTAINER precisa ser exatamente "${EXACT_DB_CONTAINER}".`);
  process.exit(1);
}
if (process.env.ACC_PROPOSAL_TRASH_TEST_I_UNDERSTAND_THIS_IS_DISPOSABLE !== "true") {
  console.error('ACC_PROPOSAL_TRASH_TEST_I_UNDERSTAND_THIS_IS_DISPOSABLE precisa ser exatamente "true".');
  process.exit(1);
}

let passed = 0;
let failed = 0;
async function check(name, fn) {
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

function psql(sql) {
  const result = spawnSync(
    "docker",
    ["exec", "-i", EXACT_DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "--no-psqlrc", "--quiet", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(`psql falhou (exit ${result.status}): ${result.stderr}`);
  }
  return result.stdout;
}

async function signupAndGetToken(email, password) {
  const resp = await fetch(`${EXACT_API_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const body = await resp.json();
  if (body.access_token && body.user?.id) {
    return { userId: body.user.id, accessToken: body.access_token };
  }
  if (body.error_code === "user_already_exists") {
    const loginResp = await fetch(`${EXACT_API_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON_KEY },
      body: JSON.stringify({ email, password }),
    });
    const loginBody = await loginResp.json();
    if (!loginBody.access_token || !loginBody.user?.id) {
      throw new Error(`login falhou para ${email} (usuário já existia): ${JSON.stringify(loginBody)}`);
    }
    return { userId: loginBody.user.id, accessToken: loginBody.access_token };
  }
  throw new Error(`signup falhou para ${email}: ${JSON.stringify(body)}`);
}

async function callRpc(fn, accessToken, args) {
  const resp = await fetch(`${EXACT_API_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(args),
  });
  const text = await resp.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: resp.status, body };
}

const PASSWORD = "Disposable-Test-Pw-2026!";
const PROJECT = "77777777-7777-4777-8777-777777779901";
const REASON = "Justificativa de teste real para envio à lixeira, com mais de vinte caracteres.";

async function main() {
  console.log("");
  console.log("======================================");
  console.log("LIXEIRA — vínculo a Proposta de Adicional, desvínculo real, dedup restaurar-vs-reenviar");
  console.log("======================================");
  console.log("");

  const admin = await signupAndGetToken("acc-proposal-trash-admin@axion-test.local", PASSWORD);

  psql(`
    insert into public.projects (id, code, name, client, status, location, start_date, baseline_end_date) values
      ('${PROJECT}', 'TRASH-PROPOSAL-1', 'Projeto (vínculo proposta x lixeira)', 'Cliente Teste', 'ATIVO', 'Teste', '2026-01-01', '2026-12-31')
    on conflict (id) do nothing;
    insert into public.project_memberships (project_id, user_id, permission, status) values
      ('${PROJECT}', '${admin.userId}', 'ADMINISTRADOR', 'ACTIVE')
    on conflict (project_id, user_id) do nothing;
  `);

  // ---------- (a) vinculado a proposta → RECUSADO ----------

  const DOC_LINKED = "77777777-7777-4777-8777-777777779910";
  const VERSION_LINKED = "77777777-7777-4777-8777-777777779911";
  const PROPOSAL = "77777777-7777-4777-8777-777777779912";

  psql(`
    insert into public.documents (id, project_id, kind, title) values
      ('${DOC_LINKED}', '${PROJECT}', 'ESPECIFICACAO', 'Doc vinculado a proposta de adicional')
    on conflict (id) do nothing;
    insert into public.document_versions (id, document_id, version_label, version_index, document_date, source_type, author, summary) values
      ('${VERSION_LINKED}', '${DOC_LINKED}', '01', 1, '2026-01-01', 'CONTRATO', 'Teste', 'Resumo de teste')
    on conflict (id) do nothing;
    insert into public.project_additional_proposals (id, project_id, proposal_number, title, description, source_type, status, created_by_type, created_by_user_id) values
      ('${PROPOSAL}', '${PROJECT}', 'ADD-TEST-001', 'Proposta de teste (bloqueio lixeira)', 'Descrição de teste', 'MANUAL', 'UNDER_ANALYSIS', 'USER', '${admin.userId}')
    on conflict (id) do nothing;
    insert into public.project_additional_proposal_links (proposal_id, link_role, document_version_id, created_by_type, created_by_user_id) values
      ('${PROPOSAL}', 'ORIGIN_SOURCE', '${VERSION_LINKED}', 'USER', '${admin.userId}')
    on conflict do nothing;
  `);

  await check("(a) documento com versão vinculada a project_additional_proposal_links → RECUSADO ao ir para a lixeira", async () => {
    const { status, body } = await callRpc("trash_project_document", admin.accessToken, {
      p_document_id: DOC_LINKED,
      p_reason: REASON,
    });
    if (status < 400) throw new Error(`esperado recusa, obtido sucesso ${status}`);
    if (!JSON.stringify(body).includes("Proposta de Adicional")) throw new Error(`mensagem inesperada: ${JSON.stringify(body)}`);
  });

  await check("(d) a tentativa recusada em (a) NÃO produziu nenhuma linha DOCUMENT_TRASHED para o documento", async () => {
    const result = psql(
      `select count(*) from public.audit_log_entries where entity_type = 'DOCUMENT' and entity_id = '${DOC_LINKED}' and action = 'DOCUMENT_TRASHED';`
    );
    const count = parseInt(result.trim().split("\n").find((l) => /^\s*\d+\s*$/.test(l))?.trim() ?? "-1", 10);
    if (count !== 0) throw new Error(`esperado 0 linhas DOCUMENT_TRASHED (falha nunca é parcial), encontrado ${count}`);
  });

  // ---------- (b) sem vínculo → PERMITIDO ----------

  const DOC_UNLINKED = "77777777-7777-4777-8777-777777779913";
  psql(`
    insert into public.documents (id, project_id, kind, title) values
      ('${DOC_UNLINKED}', '${PROJECT}', 'ESPECIFICACAO', 'Doc sem vínculo a proposta')
    on conflict (id) do nothing;
  `);

  await check("(b) documento SEM vínculo a nenhuma proposta → PERMITIDO ir para a lixeira normalmente", async () => {
    const { status, body } = await callRpc("trash_project_document", admin.accessToken, {
      p_document_id: DOC_UNLINKED,
      p_reason: REASON,
    });
    if (status >= 400) throw new Error(`esperado sucesso, obtido ${status}: ${JSON.stringify(body)}`);
    const result = psql(`select deleted_at is not null as trashed from public.documents where id = '${DOC_UNLINKED}';`);
    if (!result.includes(" t")) throw new Error(`documento não ficou marcado como trashed: ${result}`);
  });

  await check("(d) o envio bem-sucedido em (b) produziu EXATAMENTE 1 linha de auditoria (DOCUMENT_TRASHED)", async () => {
    const result = psql(
      `select count(*) from public.audit_log_entries where entity_type = 'DOCUMENT' and entity_id = '${DOC_UNLINKED}' and action = 'DOCUMENT_TRASHED';`
    );
    const count = parseInt(result.trim().split("\n").find((l) => /^\s*\d+\s*$/.test(l))?.trim() ?? "-1", 10);
    if (count !== 1) throw new Error(`esperado exatamente 1 linha de auditoria, encontrado ${count}`);
  });

  // ---------- (c) project_additional_proposal_links é IMUTÁVEL por design ----------
  // Não há RPC/policy de UPDATE/DELETE para esta tabela (ver nota no
  // cabeçalho do arquivo) — nenhum teste comportamental é possível aqui
  // sem simular um caminho de escrita que a aplicação real nunca
  // oferece. O cenário (c) do requisito é demonstrado abaixo com o
  // mecanismo real do sistema que SUPORTA desvínculo (anexo contratual).

  // ---------- (c, real) desvínculo real de ANEXO CONTRATUAL (mecanismo que DE FATO suporta unlink) → regra normal volta a valer ----------

  const DOC_ATTACH_PARENT = "77777777-7777-4777-8777-777777779914";
  const DOC_ATTACH_CHILD = "77777777-7777-4777-8777-777777779915";
  psql(`
    insert into public.documents (id, project_id, kind, title) values
      ('${DOC_ATTACH_PARENT}', '${PROJECT}', 'CONTRATO_BASE', 'Contrato pai (desvínculo real)'),
      ('${DOC_ATTACH_CHILD}', '${PROJECT}', 'ESPECIFICACAO', 'Anexo a ser desvinculado')
    on conflict (id) do nothing;
  `);

  await check("(c) vincula anexo contratual real; tentar trashar o FILHO é recusado enquanto vinculado", async () => {
    const link = await callRpc("link_document_as_contractual_attachment", admin.accessToken, {
      p_project_id: PROJECT,
      p_child_document_id: DOC_ATTACH_CHILD,
      p_parent_document_id: DOC_ATTACH_PARENT,
      p_incorporation_basis: "Fundamento de teste real do desvínculo antes da lixeira, mais de vinte caracteres.",
      p_expected_parent_document_id: null,
      p_confirm_parent_change: false,
    });
    if (link.status >= 400) throw new Error(`vínculo real falhou: ${JSON.stringify(link.body)}`);

    const { status, body } = await callRpc("trash_project_document", admin.accessToken, {
      p_document_id: DOC_ATTACH_CHILD,
      p_reason: REASON,
    });
    if (status < 400) throw new Error(`esperado recusa (ainda vinculado), obtido sucesso ${status}`);
    if (!JSON.stringify(body).includes("é um anexo contratual vinculado")) throw new Error(`mensagem inesperada: ${JSON.stringify(body)}`);
  });

  await check("(d) a tentativa recusada acima (filho ainda vinculado) não produziu NENHUMA linha DOCUMENT_TRASHED — filtra por action, não por entity_id (o vínculo em si já gravou sua PRÓPRIA auditoria legítima antes, e isso não pode ser confundido com auditoria parcial da lixeira)", async () => {
    const result = psql(
      `select count(*) from public.audit_log_entries where entity_type = 'DOCUMENT' and entity_id = '${DOC_ATTACH_CHILD}' and action = 'DOCUMENT_TRASHED';`
    );
    const count = parseInt(result.trim().split("\n").find((l) => /^\s*\d+\s*$/.test(l))?.trim() ?? "-1", 10);
    if (count !== 0) throw new Error(`esperado 0 linhas DOCUMENT_TRASHED (falha nunca é parcial), encontrado ${count}`);
  });

  await check("(c) desvínculo LEGÍTIMO real (unlink_document_contractual_attachment) → a regra normal volta a valer, trash agora é PERMITIDO", async () => {
    const unlink = await callRpc("unlink_document_contractual_attachment", admin.accessToken, {
      p_project_id: PROJECT,
      p_child_document_id: DOC_ATTACH_CHILD,
      p_reason: "Desvínculo de teste real, com justificativa de mais de vinte caracteres.",
    });
    if (unlink.status >= 400) throw new Error(`desvínculo real falhou: ${JSON.stringify(unlink.body)}`);

    const { status, body } = await callRpc("trash_project_document", admin.accessToken, {
      p_document_id: DOC_ATTACH_CHILD,
      p_reason: REASON,
    });
    if (status >= 400) throw new Error(`esperado sucesso após desvínculo legítimo, obtido ${status}: ${JSON.stringify(body)}`);
    const result = psql(`select deleted_at is not null as trashed from public.documents where id = '${DOC_ATTACH_CHILD}';`);
    if (!result.includes(" t")) throw new Error(`documento não ficou marcado como trashed após desvínculo: ${result}`);
  });

  // ---------- dedup-em-lixeira: restaurar-vs-reenviar ----------

  const DOC_DEDUP = "77777777-7777-4777-8777-777777779916";
  const VERSION_DEDUP = "77777777-7777-4777-8777-777777779917";
  const HASH_DEDUP = "b".repeat(64);
  psql(`
    insert into public.documents (id, project_id, kind, title, deleted_at, deleted_by_user_id) values
      ('${DOC_DEDUP}', '${PROJECT}', 'ESPECIFICACAO', 'Doc na lixeira (dedup restaurar-vs-reenviar)', now(), '${admin.userId}')
    on conflict (id) do nothing;
    insert into public.document_versions (id, document_id, version_label, version_index, document_date, source_type, author, summary, sha256_hash) values
      ('${VERSION_DEDUP}', '${DOC_DEDUP}', '01', 1, '2026-01-01', 'CONTRATO', 'Teste', 'Resumo', '${HASH_DEDUP}')
    on conflict (id) do nothing;
  `);

  await check("dedup: ANTES de restaurar, find_document_by_sha256 sinaliza is_trashed=true (UI deveria sugerir RESTAURAR, nunca reenviar)", async () => {
    const { status, body } = await callRpc("find_document_by_sha256", admin.accessToken, {
      p_project_id: PROJECT,
      p_sha256_hash: HASH_DEDUP,
    });
    if (status >= 400) throw new Error(`esperado sucesso, obtido ${status}: ${JSON.stringify(body)}`);
    const row = Array.isArray(body) ? body[0] : body;
    if (!row || row.is_trashed !== true) throw new Error(`esperado is_trashed=true antes de restaurar, obtido: ${JSON.stringify(body)}`);
  });

  await check("dedup: restaura o documento (restore_project_document real)", async () => {
    const { status, body } = await callRpc("restore_project_document", admin.accessToken, { p_document_id: DOC_DEDUP });
    if (status >= 400) throw new Error(`esperado sucesso, obtido ${status}: ${JSON.stringify(body)}`);
  });

  await check("dedup: DEPOIS de restaurar, find_document_by_sha256 do MESMO hash sinaliza is_trashed=false (documento voltou a ativo — reenvio duplicado deveria ser bloqueado pelo caminho normal de dedup ativo, nunca mais tratado como \"na lixeira\")", async () => {
    const { status, body } = await callRpc("find_document_by_sha256", admin.accessToken, {
      p_project_id: PROJECT,
      p_sha256_hash: HASH_DEDUP,
    });
    if (status >= 400) throw new Error(`esperado sucesso, obtido ${status}: ${JSON.stringify(body)}`);
    const row = Array.isArray(body) ? body[0] : body;
    if (!row || row.is_trashed !== false) throw new Error(`esperado is_trashed=false depois de restaurar, obtido: ${JSON.stringify(body)}`);
    if (row.document_id !== DOC_DEDUP) throw new Error(`esperado apontar para o mesmo documento restaurado (${DOC_DEDUP}), obtido: ${JSON.stringify(row)}`);
  });

  console.log("");
  console.log("======================================");
  console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
  console.log("======================================");
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
