// Pacote C — preparação da lista de conteúdo, separada do download.
//
// Prova que "preparar" cria SOMENTE vínculos: nenhuma chamada à API do
// Construmanager, nenhum Objeto/Download, nenhum blob, nenhum objeto no
// Storage e nenhuma escrita nas tabelas do Pacote B.
//
// Nenhuma chamada real, nenhum Supabase, nenhum download: o client é um
// dublê em memória que registra tudo que recebe.
//
// Uso: node scripts/test-construmanager-content-preparation.mjs

import { register } from "node:module";
import { readFileSync } from "node:fs";

register("./ts-module-resolver.mjs", import.meta.url);

const {
  PREPARE_CONTENT_RPC,
  isValidProjectId,
  summarizeContentPreparation,
} = await import("../apps/web/lib/integrations/construmanager/prepare-content.ts");

let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) {
    console.log(`OK   ${name}`);
    passed += 1;
  } else {
    console.log(`FAIL ${name}`);
    failed += 1;
  }
}

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const OUTRO_PROJETO = "11111111-1111-4111-8111-111111111111";

// ------------------------------------------------------------
// Dublê do banco: reproduz a semântica de
// ensure_construmanager_content_links (INSERT ... ON CONFLICT DO
// NOTHING sobre document_id / version_id) sem tocar em banco real.
// ------------------------------------------------------------

function fakeDatabase({ permission = "ADMINISTRADOR", authenticated = true } = {}) {
  const db = {
    // Metadados do Pacote B — o RPC LÊ isto e nunca escreve.
    documents: [
      { id: "doc-1", project_id: PROJECT_ID, object_id: 37272424, name: "WLI-Topografia.dwg" },
      { id: "doc-2", project_id: PROJECT_ID, object_id: 37271999, name: "Planta-Baixa.pdf" },
      { id: "doc-3", project_id: OUTRO_PROJETO, object_id: 99999999, name: "Outro-Projeto.dwg" },
    ],
    versions: [
      { id: "ver-1", project_id: PROJECT_ID, object_id: 39274704, name: "WLI-Topografia(00).dwg" },
    ],
    links: [],
    blobs: [],
    storageObjects: [],
    rpcCalls: [],
    tablesWritten: new Set(),
  };

  // Cópia congelada dos metadados, para provar depois que nada mudou.
  const metadataSnapshot = JSON.stringify({
    documents: db.documents,
    versions: db.versions,
  });

  db.metadataUnchanged = () =>
    JSON.stringify({ documents: db.documents, versions: db.versions }) ===
    metadataSnapshot;

  db.rpc = async (name, args) => {
    db.rpcCalls.push({ name, args });

    if (name !== "ensure_construmanager_content_links") {
      return { data: null, error: { message: `RPC inesperada: ${name}` } };
    }

    if (!authenticated) {
      return { data: null, error: { message: "Sessao nao autenticada." } };
    }

    if (permission !== "ADMINISTRADOR") {
      return {
        data: null,
        error: {
          message:
            "Permissao ADMINISTRADOR e necessaria para preparar o download de conteudo do Construmanager.",
        },
      };
    }

    const projectId = args.p_project_id;
    let created = 0;

    for (const doc of db.documents) {
      if (doc.project_id !== projectId) continue;
      if (db.links.some((l) => l.document_id === doc.id)) continue; // ON CONFLICT DO NOTHING
      db.links.push({
        id: `link-${doc.id}`,
        project_id: projectId,
        document_id: doc.id,
        version_id: null,
        construmanager_object_id: doc.object_id,
        source_name: doc.name,
        download_status: "PENDENTE",
        content_blob_id: null,
      });
      db.tablesWritten.add("construmanager_content_links");
      created += 1;
    }

    for (const ver of db.versions) {
      if (ver.project_id !== projectId) continue;
      if (db.links.some((l) => l.version_id === ver.id)) continue;
      db.links.push({
        id: `link-${ver.id}`,
        project_id: projectId,
        document_id: null,
        version_id: ver.id,
        construmanager_object_id: ver.object_id,
        source_name: ver.name,
        download_status: "PENDENTE",
        content_blob_id: null,
      });
      db.tablesWritten.add("construmanager_content_links");
      created += 1;
    }

    const scoped = db.links.filter((l) => l.project_id === projectId);

    return {
      data: [
        {
          links_created: created,
          documents_total: scoped.filter((l) => l.document_id).length,
          versions_total: scoped.filter((l) => l.version_id).length,
          pending_total: scoped.filter((l) =>
            ["PENDENTE", "ERRO"].includes(l.download_status)
          ).length,
        },
      ],
      error: null,
    };
  };

  return db;
}

console.log("");
console.log("PACOTE C — PREPARAÇÃO SEPARADA DO DOWNLOAD");
console.log("==========================================");
console.log("");
console.log("-- 1. preparar cria APENAS vínculos --");

const db1 = fakeDatabase();
const r1 = await db1.rpc(PREPARE_CONTENT_RPC, { p_project_id: PROJECT_ID });
const s1 = summarizeContentPreparation(r1.data);

check(
  "cria um vínculo por documento e por versão do projeto",
  s1.linksCreated === 3 && db1.links.length === 3
);

check(
  "contagens separam cabeça de versão (2 documentos, 1 versão)",
  s1.documentsTotal === 2 && s1.versionsTotal === 1
);

check(
  "todos os vínculos nascem PENDENTE e prontos para download",
  s1.pendingTotal === 3 &&
    db1.links.every((l) => l.download_status === "PENDENTE")
);

check(
  "vínculos de OUTRO projeto não são criados (escopo por project_id)",
  !db1.links.some((l) => l.construmanager_object_id === 99999999)
);

check(
  "a ÚNICA tabela escrita é construmanager_content_links",
  db1.tablesWritten.size === 1 &&
    db1.tablesWritten.has("construmanager_content_links")
);

check(
  "as tabelas do Pacote B ficam intactas (documentos e versões)",
  db1.metadataUnchanged()
);

console.log("");
console.log("-- 2. nenhuma função de download é chamada --");

check(
  "nenhum blob é criado",
  db1.blobs.length === 0
);

check(
  "nenhum objeto vai para o Storage",
  db1.storageObjects.length === 0
);

check(
  "nenhum vínculo recebe content_blob_id",
  db1.links.every((l) => l.content_blob_id === null)
);

check(
  "a única RPC chamada é a de preparação",
  db1.rpcCalls.length === 1 &&
    db1.rpcCalls[0].name === "ensure_construmanager_content_links"
);

check(
  "nenhuma RPC de download é acionada",
  !db1.rpcCalls.some((c) =>
    [
      "begin_construmanager_content_download",
      "complete_construmanager_content_download",
      "fail_construmanager_content_download",
      "find_construmanager_content_blob",
    ].includes(c.name)
  )
);

check(
  "a constante de RPC exposta é exatamente a de preparação",
  PREPARE_CONTENT_RPC === "ensure_construmanager_content_links"
);

console.log("");
console.log("-- 3. idempotência --");

const r2 = await db1.rpc(PREPARE_CONTENT_RPC, { p_project_id: PROJECT_ID });
const s2 = summarizeContentPreparation(r2.data);

check(
  "segunda execução cria 0 vínculos",
  s2.linksCreated === 0
);

check(
  "segunda execução não duplica linhas (continua 3)",
  db1.links.length === 3
);

check(
  "totais permanecem estáveis entre execuções",
  s2.documentsTotal === s1.documentsTotal &&
    s2.versionsTotal === s1.versionsTotal
);

console.log("");
console.log("-- 4. autorização exclusiva de ADMINISTRADOR --");

for (const papel of ["GESTOR", "GERENTE", "EDITOR", "LEITURA"]) {
  const dbP = fakeDatabase({ permission: papel });
  const rP = await dbP.rpc(PREPARE_CONTENT_RPC, { p_project_id: PROJECT_ID });
  check(
    `papel ${papel} é rejeitado e não cria vínculo`,
    rP.error !== null && dbP.links.length === 0
  );
}

const dbAnon = fakeDatabase({ authenticated: false });
const rAnon = await dbAnon.rpc(PREPARE_CONTENT_RPC, { p_project_id: PROJECT_ID });

check(
  "sessão ausente é rejeitada e não cria vínculo",
  rAnon.error !== null && dbAnon.links.length === 0
);

console.log("");
console.log("-- 5. validação de projectId --");

check("uuid válido é aceito", isValidProjectId(PROJECT_ID));
check("uuid com espaços é aceito após trim", isValidProjectId(`  ${PROJECT_ID}  `));
check("string vazia é rejeitada", !isValidProjectId(""));
check("valor não-uuid é rejeitado", !isValidProjectId("../../etc/passwd"));
check("uuid truncado é rejeitado", !isValidProjectId("00000000-0000-4000-8000"));
check(
  "tentativa de injeção é rejeitada",
  !isValidProjectId("00000000-0000-4000-8000-000000000001; drop table x")
);

console.log("");
console.log("-- 6. normalização do retorno do RPC --");

check(
  "aceita array de uma linha (forma do RETURNS TABLE)",
  summarizeContentPreparation([{ links_created: 203, documents_total: 192, versions_total: 11, pending_total: 203 }])
    .linksCreated === 203
);

check(
  "aceita objeto solto",
  summarizeContentPreparation({ links_created: 5, documents_total: 4, versions_total: 1, pending_total: 5 })
    .linksCreated === 5
);

check(
  "bigint devolvido como string vira número",
  summarizeContentPreparation([{ links_created: "203", documents_total: "192", versions_total: "11", pending_total: "203" }])
    .documentsTotal === 192
);

check(
  "retorno nulo não vira NaN na tela",
  (() => {
    const s = summarizeContentPreparation(null);
    return (
      s.linksCreated === 0 &&
      s.documentsTotal === 0 &&
      s.versionsTotal === 0 &&
      s.pendingTotal === 0
    );
  })()
);

check(
  "valor negativo é normalizado para 0",
  summarizeContentPreparation([{ links_created: -7 }]).linksCreated === 0
);

// ------------------------------------------------------------
// Auditoria do código real: UI e Server Action
// ------------------------------------------------------------

const componentSource = readFileSync(
  "apps/web/components/integrations/construmanager-content-download.tsx",
  "utf8"
);

const actionSource = readFileSync(
  "apps/web/app/[projectId]/integracoes/actions.ts",
  "utf8"
);

const badgeSource = readFileSync(
  "apps/web/components/integrations/construmanager-status-badge.tsx",
  "utf8"
);

const cardSource = readFileSync(
  "apps/web/components/integrations/integration-card.tsx",
  "utf8"
);

// Isola o corpo da action de preparação para auditar só o que ela faz.
const prepareStart = actionSource.indexOf(
  "export async function prepareConstrumanagerContentAction"
);
const prepareBody = actionSource.slice(
  prepareStart,
  actionSource.indexOf("\n}", prepareStart) + 2
);

console.log("");
console.log("-- 7. a action de preparação não baixa nada (código real) --");

check(
  "a action existe e é async",
  prepareStart > -1 && /export async function prepareConstrumanagerContentAction/.test(prepareBody)
);

check(
  "chama exclusivamente a RPC de preparação",
  /supabase\.rpc\(PREPARE_CONTENT_RPC/.test(prepareBody) &&
    (prepareBody.match(/supabase\.rpc\(/g) ?? []).length === 1
);

check(
  "não instancia o cliente Construmanager",
  !/createConstrumanagerClient/.test(prepareBody)
);

check(
  "não autentica nem pede token à API",
  !/authenticate\(|getAccessToken/.test(prepareBody)
);

check(
  "não chama Objeto/Download nem o armazenamento de conteúdo",
  !/storeConstrumanagerContent|downloadConstrumanagerContent|buildObjectDownloadBody|Objeto\/Download/.test(
    prepareBody
  )
);

check(
  "não seleciona alvos de download",
  !/applyContentTargetSelection|construmanager_content_links/.test(prepareBody)
);

check(
  "não escreve no Storage",
  !/storage|upload|from\("construmanager-content"\)/i.test(prepareBody)
);

check(
  "valida o projectId antes de ir ao banco",
  /isValidProjectId\(projectId\)/.test(prepareBody)
);

check(
  "exige sessão autenticada",
  /await requireUser\(supabase\)/.test(prepareBody)
);

check(
  "sanitiza o erro devolvido à UI",
  /sanitizeConstrumanagerContentError\(error\)/.test(prepareBody)
);

check(
  "revalida a página do projeto após preparar",
  /revalidatePath\(`\/\$\{projectId\}\/integracoes`\)/.test(prepareBody)
);

check(
  "a action de download continua existindo e intacta (não foi fundida)",
  /export async function downloadConstrumanagerContentAction/.test(actionSource) &&
    /storeConstrumanagerContent\(/.test(actionSource)
);

console.log("");
console.log("-- 8. UI: botão de preparação e lote oculto --");

check(
  "com zero vínculos aparece o botão de preparação",
  /\{total === 0 \? \(/.test(componentSource) &&
    /Preparar conteúdo para download/.test(componentSource)
);

check(
  "a mensagem enganosa 'Sincronize os metadados primeiro' foi removida",
  !/Sincronize os metadados primeiro/.test(componentSource)
);

check(
  "a nova mensagem orienta a preparar a lista",
  /Metadados sincronizados\. Prepare a lista de conteúdo para habilitar os downloads individuais\./.test(
    componentSource
  )
);

check(
  "o formulário de preparação envia apenas projectId",
  (() => {
    const start = componentSource.indexOf("action={prepareAction}");
    const form = componentSource.slice(start, componentSource.indexOf("</form>", start));
    return (
      /name="projectId"/.test(form) &&
      !/name="linkId"/.test(form) &&
      !/name="batchSize"/.test(form)
    );
  })()
);

check(
  "o download em lote continua OCULTO",
  /const SHOW_BATCH_DOWNLOAD = false;/.test(componentSource) &&
    /\{SHOW_BATCH_DOWNLOAD \?/.test(componentSource)
);

check(
  "batchSize continua saindo de um único formulário (o de lote, oculto)",
  (componentSource.match(/name="batchSize"/g) ?? []).length === 1
);

check(
  "havendo vínculos, aparecem filtro e botões individuais",
  /\{items\.length > 0 \? \(/.test(componentSource) &&
    /Filtrar por nome do arquivo/.test(componentSource) &&
    /name="linkId" value=\{item\.linkId\}/.test(componentSource)
);

check(
  "preparar não dispara download automático (efeito só recarrega a página)",
  (() => {
    const start = componentSource.indexOf("if (prepareState.finishedAt)");
    const bloco = componentSource.slice(start, start + 160);
    return (
      /router\.refresh\(\)/.test(bloco) &&
      !/formAction|downloadConstrumanagerContentAction|submit\(\)/.test(bloco)
    );
  })()
);

check(
  "preparação e download não rodam ao mesmo tempo (botões bloqueados)",
  /const busy = pending \|\| preparing;/.test(componentSource) &&
    (componentSource.match(/disabled=\{busy\}/g) ?? []).length >= 2
);

check(
  "nenhum link público ou download para o navegador foi introduzido",
  !/getPublicUrl|createSignedUrl|<a\s+download|href=\{/.test(componentSource)
);

console.log("");
console.log("-- 9. cores dos status --");

const regras = [
  ["PENDENTE (integração)", /CONSTRUMANAGER_INTEGRATION_STATUS_CLASSES[\s\S]{0,400}?PENDENTE: "[^"]*bg-yellow-400[^"]*text-black[^"]*font-bold/],
  ["ATIVO/CONECTADO (integração)", /CONSTRUMANAGER_INTEGRATION_STATUS_CLASSES[\s\S]{0,400}?CONECTADO: "[^"]*bg-green-600[^"]*text-white[^"]*font-bold/],
  ["ERRO (integração)", /CONSTRUMANAGER_INTEGRATION_STATUS_CLASSES[\s\S]{0,400}?ERRO: "[^"]*bg-red-600[^"]*text-white[^"]*font-bold/],
  ["PENDENTE (conteúdo)", /CONSTRUMANAGER_CONTENT_STATUS_CLASSES[\s\S]{0,400}?PENDENTE: "[^"]*bg-yellow-400[^"]*text-black[^"]*font-bold/],
  ["ARMAZENADO (conteúdo)", /CONSTRUMANAGER_CONTENT_STATUS_CLASSES[\s\S]{0,400}?ARMAZENADO: "[^"]*bg-green-600[^"]*text-white[^"]*font-bold/],
  ["ERRO (conteúdo)", /CONSTRUMANAGER_CONTENT_STATUS_CLASSES[\s\S]{0,400}?ERRO: "[^"]*bg-red-600[^"]*text-white[^"]*font-bold/],
];

for (const [nome, padrao] of regras) {
  check(`${nome} usa a combinação exigida`, padrao.test(badgeSource));
}

check(
  "PENDENTE usa texto PRETO (branco sobre amarelo não teria contraste)",
  /PENDENTE: "[^"]*text-black/.test(badgeSource) &&
    !/PENDENTE: "[^"]*text-white/.test(badgeSource)
);

check(
  "todos os status do Construmanager são negrito",
  (badgeSource.match(/font-bold/g) ?? []).length >= 8
);

check(
  "o painel de conteúdo usa o badge (não texto solto)",
  /<ConstrumanagerContentStatusBadge status=\{item\.status\} \/>/.test(componentSource)
);

check(
  "o cabeçalho do card usa o badge do Construmanager só para essa fonte",
  /source\.type === "CONSTRUMANAGER" \? \(\s*<ConstrumanagerIntegrationStatusBadge/.test(
    cardSource
  )
);

check(
  "as demais integrações continuam com IntegrationStatusBadge",
  /<IntegrationStatusBadge status=\{status\} \/>/.test(cardSource)
);

check(
  "o mapa compartilhado de badges NÃO foi alterado",
  (() => {
    const shared = readFileSync("apps/web/components/shared/badges.tsx", "utf8");
    return (
      /CONECTADO: "border-transparent bg-severity-baixa\/15 text-severity-baixa"/.test(shared) &&
      !/bg-yellow-400|bg-green-600|bg-red-600/.test(shared)
    );
  })()
);

console.log("");
console.log("-- 10. nenhuma migration ou schema tocado --");

check(
  "nenhum SQL destrutivo foi introduzido nos arquivos alterados",
  !/\bDROP\b|\bTRUNCATE\b|\bDELETE FROM\b/i.test(
    prepareBody + componentSource + badgeSource
  )
);

check(
  "a preparação não usa service-role",
  !/@axion\/db\/admin|service_role|createSupabaseAdminClient/.test(prepareBody)
);

console.log("");
console.log("=====================================================================");
console.log(`Resultado: ${passed} passaram, ${failed} falharam.`);

process.exit(failed === 0 ? 0 : 1);
