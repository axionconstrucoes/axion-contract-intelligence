// Escopo somente metadados do Construmanager.
//
// A integracao deixou de transferir desenhos: ela observa a obra e
// informa novos arquivos e novas revisoes. Esta suite prova as duas
// metades da decisao — que a coleta funciona com Arquivo/List sozinho, e
// que os caminhos de download ficaram inalcancaveis.
//
// Sem rede e sem credencial real: o client do Construmanager e o do
// Supabase sao dubles. Chamar ListaMestra/List ou Objeto/Download no
// duble e um erro imediato, nao um contador — se a coleta tentar, o
// teste quebra na hora.
//
// Uso: node scripts/test-construmanager-metadata-only.mjs

import { register } from "node:module";
import { readFileSync } from "node:fs";

register("./ts-module-resolver.mjs", import.meta.url);

const { collectConstrumanagerMetadata } = await import(
  "../apps/web/lib/integrations/construmanager/collect-metadata.ts"
);

const { normalizeFileListMetadata, normalizeFolders } = await import(
  "../apps/web/lib/integrations/construmanager/normalize-metadata.ts"
);

const { getConstrumanagerMetadataOverview } = await import(
  "../apps/web/lib/integrations/construmanager/get-metadata-overview.ts"
);

const { evaluateVigency } = await import(
  "../apps/web/lib/integrations/construmanager/version-vigency.ts"
);

let passaram = 0;
let falharam = 0;

function check(rotulo, condicao) {
  if (condicao) {
    passaram += 1;
    console.log(`OK   ${rotulo}`);
  } else {
    falharam += 1;
    console.log(`FALHA ${rotulo}`);
  }
}

function ler(rel) {
  return readFileSync(rel, "utf8").replace(/\r\n/g, "\n");
}

const COMPANY = 1645;
const WORK = 34164;
const TOKEN_FALSO = "TOKEN_FALSO_DE_TESTE_nunca_deve_vazar_0123456789abcdefghij";

const PASTAS = {
  listFolder: [
    { id: 900, parentId: 0, name: "Raiz", text: "Raiz", level: 1, path: "Raiz" },
    { id: 901, parentId: 900, name: "Projetos", text: "Projetos", level: 2, path: "Raiz\\Projetos" },
  ],
  status: { id: 0, description: "OK" },
};

function arquivo(id, review, extras = {}) {
  return {
    id,
    parentId: 901,
    name: `DOC-${id}-R${review}.dwg`,
    title: "",
    type: "Arquivo",
    statusId: 3,
    secondName: "",
    review,
    format: "",
    extension: "dwg",
    upload: "Pessoa Ficticia",
    dataUpload: "2026-08-21T13:35:00",
    size: "1,0 MB",
    sizeNumber: 1048576,
    hasVersion: false,
    ...extras,
  };
}

function clienteDuble(arquivos) {
  const chamadas = [];

  return {
    chamadas,
    async authenticate() {
      chamadas.push("authenticate");
      return { user: { id: 11, type: 3, companyId: COMPANY, token: "intermediario-falso" } };
    },
    async getAccessToken() {
      chamadas.push("getAccessToken");
      return { access_token: TOKEN_FALSO, token_type: "bearer", expires_in: 86400 };
    },
    async listWorks() {
      chamadas.push("listWorks");
      return { listWork: [{ id: WORK, name: "Obra de teste" }], status: { id: 0 } };
    },
    async listFolders() {
      chamadas.push("listFolders");
      return PASTAS;
    },
    async listFiles() {
      chamadas.push("listFiles");
      return { listFile: arquivos, status: { id: 0, description: "" } };
    },
    async listMasterList() {
      chamadas.push("listMasterList");
      throw new Error("ListaMestra/List foi chamada — proibido no escopo somente metadados.");
    },
    async downloadObjects() {
      chamadas.push("downloadObjects");
      throw new Error("Objeto/Download foi chamado — proibido no escopo somente metadados.");
    },
  };
}

console.log("=====================================================================");
console.log("CONSTRUMANAGER — ESCOPO SOMENTE METADADOS");
console.log("=====================================================================");
console.log("");

console.log("-- 1. Coleta completa apenas com Arquivo/List --");

const client192 = clienteDuble(
  Array.from({ length: 192 }, (_, i) => arquivo(37000000 + i, String(i % 10).padStart(2, "0")))
);

const coletado = await collectConstrumanagerMetadata(client192, COMPANY, WORK);

check("a coleta conclui sem lista mestra", coletado !== null);
check("192 documentos montados", coletado.documents.length === 192);
check("2 pastas normalizadas", coletado.folders.length === 2);
check("obra resolvida", coletado.workName === "Obra de teste");
check("companyId e workId preservados", coletado.companyId === COMPANY && coletado.workId === WORK);

const doc0 = coletado.documents[0];
check("id do documento vem de Arquivo/List.id", doc0.construmanager_object_id === 37000000);
check("pasta vem de parentId", doc0.construmanager_folder_id === 901);
check("caminho derivado de Pasta/List", doc0.folder_path === "Raiz\\Projetos");
check("revisao vem de review", doc0.revision === "00");
check("autor vem de upload (nome)", doc0.author_name === "Pessoa Ficticia");
check("data vem de dataUpload", String(doc0.source_created_at_raw) === "2026-08-21T13:35:00");
check("tamanho vem de sizeNumber", doc0.size_bytes === 1048576);
check("extensao preservada", doc0.extension === "dwg" && doc0.extension_normalized === "dwg");

console.log("");
console.log("-- 2. Campos sem fonte ficam NULOS, nunca inventados --");

check("author_id nulo (Arquivo/List nao traz id de autor)", doc0.author_id === null);
check("source_approved_at nulo", doc0.source_approved_at === null && doc0.source_approved_at_raw === null);
check("status_label nulo (statusId nao e rotulo)", doc0.status_label === null);
check(
  "statusId fica visivel no diagnostico, sem virar rotulo",
  coletado.fileListDiagnostics.statusIdCounts["3"] === 192
);

console.log("");
console.log("-- 3. ListaMestra/List e Objeto/Download nunca chamados --");

check("listMasterList nao foi chamada", !client192.chamadas.includes("listMasterList"));
check("downloadObjects nao foi chamado", !client192.chamadas.includes("downloadObjects"));
check(
  "as chamadas foram exatamente as cinco do escopo",
  client192.chamadas.join(",") ===
    "authenticate,getAccessToken,listWorks,listFolders,listFiles"
);

const FONTE_COLETA = ler("apps/web/lib/integrations/construmanager/collect-metadata.ts");
check("o coletor nao invoca listMasterList", !/client\.listMasterList\(/.test(FONTE_COLETA));
check("o coletor nao invoca downloadObjects", !/downloadObjects\(/.test(FONTE_COLETA));

console.log("");
console.log("-- 4 e 5. Documentos vigentes e versoes historicas preservados --");

check("nenhuma versao historica e coletada", coletado.versions.length === 0);
check("nenhuma versao orfa inventada", coletado.orphanVersionIds.length === 0);

const MIG = ler("supabase/migrations/20260905180000_construmanager_content_automation.sql");
const MIG_BASE = ler("supabase/migrations/20260904090000_construmanager_content_storage.sql");

// A preservacao nao depende de disciplina do chamador: o nucleo SQL nao
// tem instrucao de delete. Uma lista de versoes vazia nao pode apagar o
// que ja esta gravado.
check(
  "o nucleo SQL nao apaga documentos nem versoes",
  !/delete\s+from\s+public\.construmanager_(documents|document_versions)/i.test(MIG) &&
    !/delete\s+from\s+public\.construmanager_(documents|document_versions)/i.test(MIG_BASE)
);
check(
  "o upsert de documentos usa on conflict do update",
  /on conflict \(integration_id, construmanager_object_id\) do update/.test(MIG)
);

console.log("");
console.log("-- 6. Arquivo novo detectado --");

const clienteNovo = clienteDuble([arquivo(1, "00"), arquivo(2, "01"), arquivo(3, "00")]);
const comNovo = await collectConstrumanagerMetadata(clienteNovo, COMPANY, WORK);
const idsNovos = comNovo.documents.map((d) => d.construmanager_object_id);

check("o arquivo inedito entra na carga", idsNovos.includes(3));
check("os tres documentos sao montados", comNovo.documents.length === 3);
check(
  "id duplicado nao vira documento repetido",
  normalizeFileListMetadata(
    { listFile: [arquivo(1, "00"), arquivo(1, "00")] },
    normalizeFolders(PASTAS)
  ).documents.length === 1
);

console.log("");
console.log("-- 7 e 9. Revisao nova detectada; \"1\" e \"01\" sao a mesma --");

function observacao(revision) {
  return {
    objectId: 37272424,
    revision,
    name: "WLI-Topografia.dwg",
    sourceCreatedAt: "2026-07-23T14:57:00",
    authorName: "Pessoa Ficticia",
    sizeBytes: 7538716,
    folderPath: "Raiz\Projetos",
  };
}

check(
  "R04 -> R05 e NOVA VERSAO VIGENTE",
  evaluateVigency(observacao("04"), observacao("05")).outcome === "NOVA_VERSAO_VIGENTE"
);

// A regra de vigencia compara revisao NORMALIZADA. Sem isso, um "1"
// devolvido onde antes vinha "01" alertaria uma revisao que nao mudou.
check(
  '"01" -> "1" NAO gera transicao',
  evaluateVigency(observacao("01"), observacao("1")).outcome === "SEM_MUDANCA"
);

check(
  '"1" -> "01" NAO gera transicao',
  evaluateVigency(observacao("1"), observacao("01")).outcome === "SEM_MUDANCA"
);

check(
  "primeira observacao nao e transicao",
  evaluateVigency(null, observacao("00")).outcome === "PRIMEIRA_OBSERVACAO"
);

// A funcao SQL remove zeros a esquerda antes de comparar, entao "01" e
// "1" colapsam no mesmo valor — a mesma regra do lado TypeScript.
check(
  "a normalizacao de revisao do banco remove zeros a esquerda",
  /regexp_replace\(btrim\(coalesce\(p_revision, ''\)\), '\^0\+\(\[0-9\]\)'/.test(MIG)
);
check(
  "o detector compara revisoes NORMALIZADAS, nao cruas",
  /normalize_construmanager_revision\(v_previous\.current_revision\)/.test(MIG)
);

console.log("");
console.log("-- 8. Arquivo ausente nao e apagado --");

const clienteMenor = clienteDuble([arquivo(1, "00")]);
const menor = await collectConstrumanagerMetadata(clienteMenor, COMPANY, WORK);

check("a carga leva so o que a API devolveu", menor.documents.length === 1);
check(
  "nao existe lista de exclusao na carga",
  !("deletedIds" in menor) && !("toDelete" in menor)
);

const WORKER = ler("scripts/construmanager-metadata-worker.mjs");
check(
  "o worker conta documentos nao retornados via last_seen_at",
  /last_seen_at/.test(WORKER) && /nao vieram nesta/.test(WORKER)
);
check("o worker diz explicitamente que nada foi excluido", /Nada foi excluido/.test(WORKER));
check("o worker nao apaga documentos", !/\.delete\(\)/.test(WORKER));

console.log("");
console.log("-- 10. Nenhum vinculo de download novo --");

check(
  "o coletor nao chama ensure_construmanager_content_links",
  !/ensure_construmanager_content_links/.test(FONTE_COLETA)
);
check(
  "o worker de metadados nao chama ensure_construmanager_content_links",
  !/ensure_construmanager_content_links/.test(WORKER)
);

const CARD = ler("apps/web/components/integrations/integration-card.tsx");
const PAGE = ler("apps/web/app/[projectId]/integracoes/page.tsx");

check("o card nao monta mais o painel de download", !/<ConstrumanagerContentDownload/.test(CARD));
check(
  "a pagina nao carrega mais o overview de conteudo",
  !/getConstrumanagerContentOverview/.test(PAGE)
);

console.log("");
console.log("-- 11. Workflow sem worker de conteudo --");

const WORKFLOW = ler(".github/workflows/construmanager-content-ingestion.yml");

check("nenhum schedule ativo", !/^\s{2}schedule:/m.test(WORKFLOW));
check("apenas disparo manual", /workflow_dispatch:/.test(WORKFLOW));
check("permissions contents: read", /permissions:\s*\n\s*contents:\s*read/.test(WORKFLOW));
check("o worker de conteudo nao e invocado", !/construmanager-content-worker\.mjs/.test(WORKFLOW));
check("o step de ingestao nao existe", !/- name: Ingest Construmanager content/.test(WORKFLOW));
check(
  "o interruptor de download nao e lido",
  !/vars\.CONSTRUMANAGER_AUTO_DOWNLOAD_ENABLED/.test(WORKFLOW)
);
check(
  "restaram os dois steps do escopo",
  /- name: Sync Construmanager metadata/.test(WORKFLOW) &&
    /- name: Monitor Construmanager version vigency/.test(WORKFLOW)
);

// O worker continua no repositorio, sem chamador: reverter e voltar a
// chamar, nao reescrever.
check(
  "o worker de conteudo continua existindo no repositorio",
  ler("scripts/construmanager-content-worker.mjs").length > 0
);

console.log("");
console.log("-- 12 e 13. Interface: sem baixar, com monitoramento --");

const PAINEL = ler("apps/web/components/integrations/construmanager-monitoring-panel.tsx");

// Comentario nao e interface. O arquivo EXPLICA por que a fila de
// pendentes saiu, e procurar a palavra no fonte inteiro reprovaria
// justamente a explicacao. O que precisa estar limpo e o que a tela
// mostra.
const PAINEL_RENDERIZADO = PAINEL.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

check("o painel nao tem botao de baixar", !/Baixar/.test(PAINEL_RENDERIZADO));
check("o painel nao tem preparar conteudo", !/Preparar conteúdo/i.test(PAINEL_RENDERIZADO));
check("o painel nao destaca fila de pendentes", !/pendentes/i.test(PAINEL_RENDERIZADO));
check("o painel nao renderiza <form> nem <Button>", !/<form|<Button/.test(PAINEL_RENDERIZADO));
check("mostra arquivos monitorados", /Arquivos monitorados/.test(PAINEL));
check("mostra ultima verificacao", /Última verificação/.test(PAINEL));
check("mostra novos uploads", /Novos uploads/.test(PAINEL));
check("mostra novas revisoes", /Novas revisões/.test(PAINEL));
check("sinaliza revisoes a revisar", /para revisar/.test(PAINEL));
check(
  "sinaliza documento nao retornado sem excluir",
  /não\s*\n?\s*retornado|requer revisão humana/.test(PAINEL) && /Nada foi\s*\n?\s*excluído/.test(PAINEL)
);
check(
  "mantem discreto o conteudo ja armazenado",
  /anteriormente armazenado/.test(PAINEL)
);
check(
  "deixa claro que nao transfere desenhos",
  /Nenhum desenho é transferido/.test(PAINEL)
);

check("Validar conexao preservado", /<ConstrumanagerConnectionCheck/.test(CARD));
check("Sincronizar metadados preservado", /<ConstrumanagerMetadataSync/.test(CARD));
check("o painel de monitoramento entrou no card", /<ConstrumanagerMonitoringPanel/.test(CARD));

console.log("");
console.log("-- 14. Falha preserva os ultimos totais confirmados --");

// Duble minimo do client do Supabase: so o encadeamento que a leitura
// usa. Devolve linhas diferentes conforme a tabela e o filtro de status.
function supabaseDuble({ ultima, confirmada, contagens }) {
  function builder(tabela) {
    const estado = { tabela, status: null };

    const api = {
      select: () => api,
      eq: () => api,
      lt: () => api,
      order: () => api,
      limit: () => api,
      in: (_coluna, valores) => {
        estado.status = valores;
        return api;
      },
      maybeSingle: async () => ({
        data: estado.status ? confirmada : ultima,
        error: null,
      }),
      then: (resolve) =>
        resolve({ count: contagens[estado.tabela] ?? 0, error: null }),
    };

    return api;
  }

  return { from: builder };
}

const RUN_CONFIRMADA = {
  id: "run-confirmada",
  started_at: "2026-09-04T02:03:39Z",
  completed_at: "2026-09-04T02:04:00Z",
  status: "SUCESSO",
  error: null,
  folders_seen: 25,
  documents_seen: 192,
  historical_versions_seen: 11,
  documents_created: 3,
  versions_created: 0,
  versions_orphaned: 0,
};

const RUN_FALHA = {
  id: "run-falha",
  started_at: "2026-09-07T02:36:31Z",
  completed_at: null,
  status: "ERRO",
  error: "Construmanager ListaMestra/List failed",
  folders_seen: 0,
  documents_seen: 0,
  historical_versions_seen: 0,
  documents_created: 0,
  versions_created: 0,
  versions_orphaned: 0,
};

const overviewFalha = await getConstrumanagerMetadataOverview(
  supabaseDuble({
    ultima: RUN_FALHA,
    confirmada: RUN_CONFIRMADA,
    contagens: {
      construmanager_documents: 192,
      construmanager_document_versions: 11,
      construmanager_content_links: 2,
      construmanager_version_transitions: 0,
    },
  }),
  "projeto-de-teste"
);

check("a ultima tentativa aparece como ERRO", overviewFalha.lastSyncStatus === "ERRO");
check("o erro e exposto separadamente", overviewFalha.lastSyncError !== null);
check(
  "os totais NAO viram zero por causa da falha",
  overviewFalha.documentsSeen === 192 && overviewFalha.foldersSeen === 25
);
check("os novos uploads vem da execucao confirmada", overviewFalha.documentsCreated === 3);
check("a data confirmada e a da execucao que funcionou", overviewFalha.lastConfirmedSyncAt === "2026-09-04T02:04:00Z");
check("a tela sabe que esta mostrando totais anteriores", overviewFalha.showingPreviousTotals === true);
check("arquivos monitorados vem do acervo, nao da execucao", overviewFalha.storedDocuments === 192);
check("as 11 versoes historicas continuam contadas", overviewFalha.storedVersions === 11);
check("o conteudo legado continua visivel", overviewFalha.legacyStoredContent === 2);

const overviewOk = await getConstrumanagerMetadataOverview(
  supabaseDuble({
    ultima: RUN_CONFIRMADA,
    confirmada: RUN_CONFIRMADA,
    contagens: { construmanager_documents: 192, construmanager_document_versions: 11 },
  }),
  "projeto-de-teste"
);

check("execucao bem-sucedida nao marca totais anteriores", overviewOk.showingPreviousTotals === false);
check("sem falha, nao ha erro exibido", overviewOk.lastSyncError === null);

console.log("");
console.log("-- 15. Nenhum segredo em log ou mensagem --");

check(
  "a mensagem de divergencia de empresa nao interpola valor",
  !/A conta configurada \(\$\{/.test(FONTE_COLETA)
);
check("o coletor nao registra o token", !/console\.log[^\n]*access_token/.test(FONTE_COLETA));
check("o worker nao registra o token", !/console\.log[^\n]*access_token/.test(WORKER));
check("o painel nao recebe credencial", !/SECRET|senha|password|token/i.test(PAINEL));
check(
  "nenhum segredo literal nos arquivos alterados",
  ![FONTE_COLETA, WORKER, PAINEL, WORKFLOW].some((f) =>
    /sb_secret_[A-Za-z0-9]{6,}|eyJ[A-Za-z0-9_-]{20,}\./.test(f)
  )
);

let erroSemToken = null;
try {
  const clienteEmpresaErrada = clienteDuble([arquivo(1, "00")]);
  await collectConstrumanagerMetadata(clienteEmpresaErrada, 999999, WORK);
} catch (erro) {
  erroSemToken = erro;
}

check("empresa divergente lanca", erroSemToken !== null);
check(
  "a mensagem nao carrega o token nem cadeia opaca",
  !String(erroSemToken?.message ?? "").includes(TOKEN_FALSO) &&
    !/[A-Za-z0-9_-]{40,}/.test(String(erroSemToken?.message ?? ""))
);

console.log("");
console.log("=====================================================================");
console.log(`Resultado: ${passaram} passaram, ${falharam} falharam.`);
console.log("=====================================================================");

process.exit(falharam === 0 ? 0 : 1);
