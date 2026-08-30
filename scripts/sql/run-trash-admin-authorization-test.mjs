// Prova REAL de que excluir/ver lixeira/restaurar documentos é
// ADMIN-only NO SERVIDOR — chama trash_project_document/
// restore_project_document/list_trashed_project_documents de verdade,
// via REST, com sessões reais de usuários com cada papel canônico
// (ADMINISTRADOR/GESTOR/COLABORADOR/LEITURA), uma membership suspensa,
// um usuário de outro projeto, e anon — nunca uma reimplementação da
// checagem em JS.
//
// SEGURANÇA DE AMBIENTE — mesmas 4 camadas do runner de concorrência
// (scripts/sql/run-contractual-link-concurrency-test.mjs): porta e
// container EXATOS desta execução, confirmação explícita, host restrito.
//
// Uso (só depois de ter a stack descartável real rodando):
//   ACC_TRASH_AUTH_TEST_API_URL="http://127.0.0.1:55513" \
//   ACC_TRASH_AUTH_TEST_DB_CONTAINER="supabase_db_acc-disposable-20260829" \
//   ACC_TRASH_AUTH_TEST_I_UNDERSTAND_THIS_IS_DISPOSABLE=true \
//     node scripts/sql/run-trash-admin-authorization-test.mjs

import { spawnSync } from "node:child_process";

const EXACT_API_URL = "http://127.0.0.1:55513";
const EXACT_DB_CONTAINER = "supabase_db_acc-disposable-20260829";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

if (process.env.ACC_TRASH_AUTH_TEST_API_URL !== EXACT_API_URL) {
  console.error(`ACC_TRASH_AUTH_TEST_API_URL precisa ser exatamente "${EXACT_API_URL}".`);
  process.exit(1);
}
if (process.env.ACC_TRASH_AUTH_TEST_DB_CONTAINER !== EXACT_DB_CONTAINER) {
  console.error(`ACC_TRASH_AUTH_TEST_DB_CONTAINER precisa ser exatamente "${EXACT_DB_CONTAINER}".`);
  process.exit(1);
}
if (process.env.ACC_TRASH_AUTH_TEST_I_UNDERSTAND_THIS_IS_DISPOSABLE !== "true") {
  console.error('ACC_TRASH_AUTH_TEST_I_UNDERSTAND_THIS_IS_DISPOSABLE precisa ser exatamente "true".');
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

  // Reexecução do script contra a MESMA stack descartável ainda viva —
  // o usuário já existe de uma execução anterior, faz login real em
  // vez de sinalizar erro (idempotência do runner, mesmo padrão do
  // ON CONFLICT DO NOTHING dos fixtures SQL).
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
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
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
const PROJECT_X = "77777777-7777-4777-8777-777777777801";
const PROJECT_Y = "77777777-7777-4777-8777-777777777802"; // outro projeto
const DOC_ADMIN_TEST = "77777777-7777-4777-8777-777777777803";
const DOC_GESTOR_TEST = "77777777-7777-4777-8777-777777777804";
const DOC_COLAB_TEST = "77777777-7777-4777-8777-777777777805";
const DOC_LEITURA_TEST = "77777777-7777-4777-8777-777777777806";
const DOC_SUSPENSA_TEST = "77777777-7777-4777-8777-777777777807";
const DOC_OUTRO_PROJETO_TEST = "77777777-7777-4777-8777-777777777808";
const DOC_ANON_TEST = "77777777-7777-4777-8777-777777777809";
const DOC_LIST_TEST = "77777777-7777-4777-8777-777777777810";
const REASON = "Justificativa de teste real de autorização, com bem mais de vinte caracteres.";

async function main() {
  console.log("");
  console.log("======================================");
  console.log("LIXEIRA — autorização ADMIN-only NO SERVIDOR (chamada real às RPCs)");
  console.log("======================================");
  console.log("");

  const admin = await signupAndGetToken("acc-trash-admin@axion-test.local", PASSWORD);
  const gestor = await signupAndGetToken("acc-trash-gestor@axion-test.local", PASSWORD);
  const colaborador = await signupAndGetToken("acc-trash-colab@axion-test.local", PASSWORD);
  const leitura = await signupAndGetToken("acc-trash-leitura@axion-test.local", PASSWORD);
  const suspenso = await signupAndGetToken("acc-trash-suspenso@axion-test.local", PASSWORD);
  const outroProjeto = await signupAndGetToken("acc-trash-outro-projeto@axion-test.local", PASSWORD);

  psql(`
    insert into public.projects (id, code, name, client, status, location, start_date, baseline_end_date) values
      ('${PROJECT_X}', 'TRASH-AUTH-X', 'Projeto X (autorização lixeira)', 'Cliente Teste', 'ATIVO', 'Teste', '2026-01-01', '2026-12-31'),
      ('${PROJECT_Y}', 'TRASH-AUTH-Y', 'Projeto Y (outro projeto)', 'Cliente Teste', 'ATIVO', 'Teste', '2026-01-01', '2026-12-31')
    on conflict (id) do nothing;

    insert into public.project_memberships (project_id, user_id, permission, status) values
      ('${PROJECT_X}', '${admin.userId}', 'ADMINISTRADOR', 'ACTIVE'),
      ('${PROJECT_X}', '${gestor.userId}', 'GESTOR', 'ACTIVE'),
      ('${PROJECT_X}', '${colaborador.userId}', 'COLABORADOR', 'ACTIVE'),
      ('${PROJECT_X}', '${leitura.userId}', 'LEITURA', 'ACTIVE'),
      ('${PROJECT_X}', '${suspenso.userId}', 'ADMINISTRADOR', 'INACTIVE'),
      ('${PROJECT_Y}', '${outroProjeto.userId}', 'ADMINISTRADOR', 'ACTIVE')
    on conflict (project_id, user_id) do nothing;

    insert into public.documents (id, project_id, kind, title) values
      ('${DOC_ADMIN_TEST}', '${PROJECT_X}', 'ESPECIFICACAO', 'Doc teste ADMINISTRADOR'),
      ('${DOC_GESTOR_TEST}', '${PROJECT_X}', 'ESPECIFICACAO', 'Doc teste GESTOR'),
      ('${DOC_COLAB_TEST}', '${PROJECT_X}', 'ESPECIFICACAO', 'Doc teste COLABORADOR'),
      ('${DOC_LEITURA_TEST}', '${PROJECT_X}', 'ESPECIFICACAO', 'Doc teste LEITURA'),
      ('${DOC_SUSPENSA_TEST}', '${PROJECT_X}', 'ESPECIFICACAO', 'Doc teste membership suspensa'),
      ('${DOC_OUTRO_PROJETO_TEST}', '${PROJECT_X}', 'ESPECIFICACAO', 'Doc teste usuario de outro projeto'),
      ('${DOC_ANON_TEST}', '${PROJECT_X}', 'ESPECIFICACAO', 'Doc teste anon'),
      ('${DOC_LIST_TEST}', '${PROJECT_X}', 'ESPECIFICACAO', 'Doc teste listagem')
    on conflict (id) do nothing;
  `);

  // ---------- trash_project_document ----------

  await check("ADMINISTRADOR ativo do projeto → PERMITIDO enviar para a lixeira", async () => {
    const { status, body } = await callRpc("trash_project_document", admin.accessToken, {
      p_document_id: DOC_ADMIN_TEST,
      p_reason: REASON,
    });
    if (status >= 400) throw new Error(`esperado sucesso, obtido ${status}: ${JSON.stringify(body)}`);
    const check2 = psql(`select deleted_at is not null as trashed from public.documents where id = '${DOC_ADMIN_TEST}';`);
    if (!check2.includes(" t")) throw new Error(`documento não ficou marcado como trashed: ${check2}`);
  });

  await check("GESTOR ativo do projeto → RECUSADO (só ADMINISTRADOR)", async () => {
    const { status, body } = await callRpc("trash_project_document", gestor.accessToken, {
      p_document_id: DOC_GESTOR_TEST,
      p_reason: REASON,
    });
    if (status < 400) throw new Error(`esperado recusa, obtido sucesso ${status}`);
    if (!JSON.stringify(body).includes("Somente Administrador")) throw new Error(`mensagem inesperada: ${JSON.stringify(body)}`);
  });

  await check("COLABORADOR ativo do projeto → RECUSADO", async () => {
    const { status, body } = await callRpc("trash_project_document", colaborador.accessToken, {
      p_document_id: DOC_COLAB_TEST,
      p_reason: REASON,
    });
    if (status < 400) throw new Error(`esperado recusa, obtido sucesso ${status}`);
    if (!JSON.stringify(body).includes("Somente Administrador")) throw new Error(`mensagem inesperada: ${JSON.stringify(body)}`);
  });

  await check("LEITURA ativo do projeto → RECUSADO", async () => {
    const { status, body } = await callRpc("trash_project_document", leitura.accessToken, {
      p_document_id: DOC_LEITURA_TEST,
      p_reason: REASON,
    });
    if (status < 400) throw new Error(`esperado recusa, obtido sucesso ${status}`);
    if (!JSON.stringify(body).includes("Somente Administrador")) throw new Error(`mensagem inesperada: ${JSON.stringify(body)}`);
  });

  await check("membership ADMINISTRADOR SUSPENSA (status INACTIVE) → RECUSADO — permissão certa, status errado", async () => {
    const { status, body } = await callRpc("trash_project_document", suspenso.accessToken, {
      p_document_id: DOC_SUSPENSA_TEST,
      p_reason: REASON,
    });
    if (status < 400) throw new Error(`esperado recusa, obtido sucesso ${status}`);
    if (!JSON.stringify(body).includes("Somente Administrador")) throw new Error(`mensagem inesperada: ${JSON.stringify(body)}`);
  });

  await check("ADMINISTRADOR de OUTRO projeto (Y) tentando excluir documento do projeto X → RECUSADO", async () => {
    const { status, body } = await callRpc("trash_project_document", outroProjeto.accessToken, {
      p_document_id: DOC_OUTRO_PROJETO_TEST,
      p_reason: REASON,
    });
    if (status < 400) throw new Error(`esperado recusa, obtido sucesso ${status}`);
    if (!JSON.stringify(body).includes("Somente Administrador")) throw new Error(`mensagem inesperada: ${JSON.stringify(body)}`);
  });

  await check("anon (sem sessão) → RECUSADO pelo GRANT (42501 permission denied, nunca chega a rodar a function)", async () => {
    const { status, body } = await callRpc("trash_project_document", ANON_KEY, {
      p_document_id: DOC_ANON_TEST,
      p_reason: REASON,
    });
    if (status < 400) throw new Error(`esperado recusa, obtido sucesso ${status}`);
    if (!JSON.stringify(body).toLowerCase().includes("permission denied")) throw new Error(`esperado permission denied, obtido: ${JSON.stringify(body)}`);
  });

  // ---------- restore_project_document (mesma matriz, sobre o doc já trashed pelo admin) ----------

  await check("GESTOR tentando RESTAURAR → RECUSADO", async () => {
    const { status, body } = await callRpc("restore_project_document", gestor.accessToken, { p_document_id: DOC_ADMIN_TEST });
    if (status < 400) throw new Error(`esperado recusa, obtido sucesso ${status}`);
    if (!JSON.stringify(body).includes("Somente Administrador")) throw new Error(`mensagem inesperada: ${JSON.stringify(body)}`);
  });

  await check("ADMINISTRADOR → PERMITIDO restaurar", async () => {
    const { status } = await callRpc("restore_project_document", admin.accessToken, { p_document_id: DOC_ADMIN_TEST });
    if (status >= 400) throw new Error(`esperado sucesso, obtido ${status}`);
    const result = psql(`select deleted_at is null as active from public.documents where id = '${DOC_ADMIN_TEST}';`);
    if (!result.includes(" t")) throw new Error(`documento não voltou a ativo: ${result}`);
  });

  // ---------- list_trashed_project_documents ----------

  psql(`update public.documents set deleted_at = now(), deleted_by_user_id = '${admin.userId}' where id = '${DOC_LIST_TEST}';`);

  await check("listar a lixeira: COLABORADOR → RECUSADO (visualizar a lixeira também é ADMIN-only no servidor)", async () => {
    const { status, body } = await callRpc("list_trashed_project_documents", colaborador.accessToken, { p_project_id: PROJECT_X });
    if (status < 400) throw new Error(`esperado recusa, obtido sucesso ${status}: ${JSON.stringify(body)}`);
    if (!JSON.stringify(body).includes("Somente Administrador")) throw new Error(`mensagem inesperada: ${JSON.stringify(body)}`);
  });

  await check("listar a lixeira: ADMINISTRADOR → PERMITIDO, vê o documento na lixeira", async () => {
    const { status, body } = await callRpc("list_trashed_project_documents", admin.accessToken, { p_project_id: PROJECT_X });
    if (status >= 400) throw new Error(`esperado sucesso, obtido ${status}: ${JSON.stringify(body)}`);
    const ids = Array.isArray(body) ? body.map((r) => r.id) : [];
    if (!ids.includes(DOC_LIST_TEST)) throw new Error(`esperava ver ${DOC_LIST_TEST} na lixeira, obtido: ${JSON.stringify(body)}`);
  });

  await check("listar a lixeira: SELECT direto em documents como COLABORADOR NÃO vê o documento trashed (policy RESTRICTIVE, não só a RPC)", async () => {
    const resp = await fetch(`${EXACT_API_URL}/rest/v1/documents?id=eq.${DOC_LIST_TEST}&select=id,deleted_at`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${colaborador.accessToken}` },
    });
    const body = await resp.json();
    if (Array.isArray(body) && body.length > 0) {
      throw new Error(`COLABORADOR conseguiu ler um documento na lixeira via SELECT direto — a policy RESTRICTIVE não está funcionando: ${JSON.stringify(body)}`);
    }
  });

  await check("listar a lixeira: SELECT direto em documents como ADMINISTRADOR VÊ o documento trashed", async () => {
    const resp = await fetch(`${EXACT_API_URL}/rest/v1/documents?id=eq.${DOC_LIST_TEST}&select=id,deleted_at`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${admin.accessToken}` },
    });
    const body = await resp.json();
    if (!Array.isArray(body) || body.length === 0) {
      throw new Error(`ADMINISTRADOR deveria ver o documento na lixeira via SELECT direto: ${JSON.stringify(body)}`);
    }
  });

  // ---------- item 2: bloqueios reais, justificativa, dedup-em-lixeira ----------

  await check("justificativa com menos de 20 caracteres úteis → RECUSADO pela RPC (nunca só pela UI)", async () => {
    const { status, body } = await callRpc("trash_project_document", admin.accessToken, {
      p_document_id: DOC_GESTOR_TEST,
      p_reason: "curta demais",
    });
    if (status < 400) throw new Error(`esperado recusa, obtido sucesso ${status}`);
    if (!JSON.stringify(body).includes("pelo menos 20")) throw new Error(`mensagem inesperada: ${JSON.stringify(body)}`);
  });

  const DOC_ANEXO_PARENT = "77777777-7777-4777-8777-777777777811";
  const DOC_ANEXO_CHILD = "77777777-7777-4777-8777-777777777812";
  psql(`
    insert into public.documents (id, project_id, kind, title) values
      ('${DOC_ANEXO_PARENT}', '${PROJECT_X}', 'CONTRATO_BASE', 'Contrato pai (bloqueio anexo)'),
      ('${DOC_ANEXO_CHILD}', '${PROJECT_X}', 'ESPECIFICACAO', 'Anexo contratual (bloqueio)')
    on conflict (id) do nothing;
  `);

  await check("vincular anexo real via RPC, depois tentar mandar o PAI para a lixeira → RECUSADO (tem anexo ativo)", async () => {
    const link = await callRpc("link_document_as_contractual_attachment", admin.accessToken, {
      p_project_id: PROJECT_X,
      p_child_document_id: DOC_ANEXO_CHILD,
      p_parent_document_id: DOC_ANEXO_PARENT,
      p_incorporation_basis: "Fundamento de teste real do bloqueio de lixeira, mais de vinte caracteres.",
      p_expected_parent_document_id: null,
      p_confirm_parent_change: false,
    });
    if (link.status >= 400) throw new Error(`vínculo real falhou: ${JSON.stringify(link.body)}`);

    const { status, body } = await callRpc("trash_project_document", admin.accessToken, {
      p_document_id: DOC_ANEXO_PARENT,
      p_reason: REASON,
    });
    if (status < 400) throw new Error(`esperado recusa (pai com anexo ativo), obtido sucesso ${status}`);
    if (!JSON.stringify(body).includes("anexo(s) contratual(is) vinculado(s)")) throw new Error(`mensagem inesperada: ${JSON.stringify(body)}`);
  });

  await check("tentar mandar o PRÓPRIO ANEXO (documento filho vinculado) para a lixeira → RECUSADO (é um anexo contratual ativo)", async () => {
    const { status, body } = await callRpc("trash_project_document", admin.accessToken, {
      p_document_id: DOC_ANEXO_CHILD,
      p_reason: REASON,
    });
    if (status < 400) throw new Error(`esperado recusa (é anexo contratual), obtido sucesso ${status}`);
    if (!JSON.stringify(body).includes("é um anexo contratual vinculado")) throw new Error(`mensagem inesperada: ${JSON.stringify(body)}`);
  });

  const DOC_EVIDENCE_TEST = "77777777-7777-4777-8777-777777777813";
  const VERSION_EVIDENCE_TEST = "77777777-7777-4777-8777-777777777814";
  const EVENT_TEST = "77777777-7777-4777-8777-777777777815";
  await check("documento com uma VERSÃO usada como evidência de um evento real → RECUSADO ao tentar ir para a lixeira", async () => {
    psql(`
      insert into public.documents (id, project_id, kind, title) values
        ('${DOC_EVIDENCE_TEST}', '${PROJECT_X}', 'ESPECIFICACAO', 'Doc com evidência real')
      on conflict (id) do nothing;
      insert into public.document_versions (id, document_id, version_label, version_index, document_date, source_type, author, summary) values
        ('${VERSION_EVIDENCE_TEST}', '${DOC_EVIDENCE_TEST}', '01', 1, '2026-01-01', 'CONTRATO', 'Teste', 'Resumo de teste')
      on conflict (id) do nothing;
      insert into public.contract_events (id, project_id, title, description, occurred_at, source_type, status, created_by_type) values
        ('${EVENT_TEST}', '${PROJECT_X}', 'Evento de teste (bloqueio evidência)', 'Descrição de teste', now(), 'CONTRATO', 'NOVO', 'SYSTEM')
      on conflict (id) do nothing;
      insert into public.event_evidence (event_id, source_type, label, locator, document_version_id) values
        ('${EVENT_TEST}', 'CONTRATO', 'Evidência de teste', 'teste', '${VERSION_EVIDENCE_TEST}')
      on conflict do nothing;
    `);
    const { status, body } = await callRpc("trash_project_document", admin.accessToken, {
      p_document_id: DOC_EVIDENCE_TEST,
      p_reason: REASON,
    });
    if (status < 400) throw new Error(`esperado recusa (evidência real de evento), obtido sucesso ${status}`);
    if (!JSON.stringify(body).includes("evidência de um evento")) throw new Error(`mensagem inesperada: ${JSON.stringify(body)}`);
  });

  await check("dedup-em-lixeira: find_document_by_sha256 encontra o hash mesmo quando o documento está na lixeira, sinalizando is_trashed=true", async () => {
    const HASH = "a".repeat(64);
    const DOC_HASH_TEST = "77777777-7777-4777-8777-777777777816";
    const VERSION_HASH_TEST = "77777777-7777-4777-8777-777777777817";
    psql(`
      insert into public.documents (id, project_id, kind, title, deleted_at, deleted_by_user_id) values
        ('${DOC_HASH_TEST}', '${PROJECT_X}', 'ESPECIFICACAO', 'Doc já na lixeira (dedup)', now(), '${admin.userId}')
      on conflict (id) do nothing;
      insert into public.document_versions (id, document_id, version_label, version_index, document_date, source_type, author, summary, sha256_hash) values
        ('${VERSION_HASH_TEST}', '${DOC_HASH_TEST}', '01', 1, '2026-01-01', 'CONTRATO', 'Teste', 'Resumo', '${HASH}')
      on conflict (id) do nothing;
    `);
    const { status, body } = await callRpc("find_document_by_sha256", admin.accessToken, {
      p_project_id: PROJECT_X,
      p_sha256_hash: HASH,
    });
    if (status >= 400) throw new Error(`esperado sucesso, obtido ${status}: ${JSON.stringify(body)}`);
    const row = Array.isArray(body) ? body[0] : body;
    if (!row || row.is_trashed !== true) throw new Error(`esperado is_trashed=true, obtido: ${JSON.stringify(body)}`);
  });

  console.log("");
  console.log("======================================");
  console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
  console.log("======================================");
  process.exitCode = failed > 0 ? 1 : 0;
}

await main();
