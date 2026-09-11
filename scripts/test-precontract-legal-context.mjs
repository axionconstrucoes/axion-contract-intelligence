// Testes da analise juridica pre-contratual (/{projectId}/juridico).
//
// Cobre exatamente o que a auditoria mostrou faltar antes: o escopo
// PROJECT montava um contexto SEM nenhum documento, e o Consultor
// Juridico respondia sobre uma minuta que nunca tinha visto.
//
// Quatro eixos exigidos:
//   1. isolamento documental entre projetos;
//   2. conteudo efetivamente enviado ao provider;
//   3. ausencia de persistencia (nenhuma escrita em banco);
//   4. estados do upload (Enviando / Processando / Pronto / Erro).
//
// Tudo com stubs em memoria: nenhuma rede, nenhum Supabase real,
// nenhuma chamada ao Anthropic, nenhuma escrita.
//
// Uso:
//   node scripts/test-precontract-legal-context.mjs

import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const { buildProjectAnalysisContext } = await import("../apps/web/lib/ai/context/build-project-context");
const { loadPrecontractDocumentTexts } = await import(
  "../apps/web/lib/documents/extraction/load-precontract-document-texts"
);
const { truncateForContext, resolveExtractionFormat } = await import(
  "../apps/web/lib/documents/extraction/extract-document-text"
);
const { answerLegalConsultantQuery } = await import("../apps/web/lib/ai/experts/legal-consultant/query");
const {
  hasReadyPrecontractDocument,
  precontractQueryBlockReason,
  PRECONTRACT_STATUS_LABELS,
} = await import("../apps/web/lib/legal/precontract-document-state");
const { resolveExpertQueryErrorMessage } = await import("../apps/web/lib/ai/expert-query-request");
const { isStoragePathInsideProject } = await import(
  "../apps/web/lib/documents/extraction/load-precontract-document-texts"
);

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

async function assertRejectsWith(promise, fragment, message) {
  try {
    await promise;
  } catch (error) {
    assert(String(error.message).includes(fragment), `${message ?? "rejeicao inesperada"}: ${error.message}`);
    return error;
  }
  throw new Error(message ?? "esperado rejeicao, mas resolveu");
}

// ---------------------------------------------------------------------
// Stub de Supabase em memoria: filtra de verdade por .eq/.in/.is e
// REGISTRA qualquer tentativa de escrita. Nenhuma linha real e tocada.
// ---------------------------------------------------------------------
function createSupabaseStub({ tables, storage }) {
  const writes = [];
  const downloads = [];

  function applyFilters(rows, filters) {
    return rows.filter((row) =>
      filters.every((filter) => {
        if (filter.type === "eq") return row[filter.column] === filter.value;
        if (filter.type === "in") return filter.values.includes(row[filter.column]);
        if (filter.type === "is") return (row[filter.column] ?? null) === filter.value;
        return true;
      })
    );
  }

  const client = {
    writes,
    downloads,
    from(table) {
      const rows = tables[table] ?? [];
      const filters = [];
      let headCount = false;

      const builder = {
        select(_columns, options) {
          if (options && options.head) headCount = true;
          return builder;
        },
        eq(column, value) {
          filters.push({ type: "eq", column, value });
          return builder;
        },
        in(column, values) {
          filters.push({ type: "in", column, values });
          return builder;
        },
        is(column, value) {
          filters.push({ type: "is", column, value });
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({ data: applyFilters(rows, filters)[0] ?? null, error: null });
        },
        single() {
          return Promise.resolve({ data: applyFilters(rows, filters)[0] ?? null, error: null });
        },
        insert(payload) {
          writes.push({ table, op: "insert", payload });
          return Promise.resolve({ data: null, error: null });
        },
        update(payload) {
          writes.push({ table, op: "update", payload });
          return builder;
        },
        upsert(payload) {
          writes.push({ table, op: "upsert", payload });
          return Promise.resolve({ data: null, error: null });
        },
        delete() {
          writes.push({ table, op: "delete" });
          return builder;
        },
        then(resolve, reject) {
          const filtered = applyFilters(rows, filters);
          const result = headCount
            ? { data: null, count: filtered.length, error: null }
            : { data: filtered, error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };

      return builder;
    },
    rpc(name, args) {
      writes.push({ table: `rpc:${name}`, op: "rpc", payload: args });
      return { single: () => Promise.resolve({ data: null, error: null }) };
    },
    storage: {
      from(bucket) {
        return {
          download(path) {
            downloads.push({ bucket, path });
            const content = storage[path];
            if (content === undefined) {
              return Promise.resolve({ data: null, error: { message: "Object not found" } });
            }
            const bytes = Buffer.from(content, "utf8");
            return Promise.resolve({
              data: { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) },
              error: null,
            });
          },
        };
      },
    },
  };

  return client;
}

const PROJECT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const MINUTA_A = "CLAUSULA 12.3 - REAJUSTE. O preco sera reajustado pelo INCC-DI a cada 12 meses contados da assinatura.";
const MINUTA_B = "CLAUSULA 4.1 - CONFIDENCIALIDADE EXCLUSIVA DO PROJETO B. Segredo industrial do cliente B.";

const PATH_A = `${PROJECT_A}/doc-a/ver-a/minuta-a.txt`;
const PATH_B = `${PROJECT_B}/doc-b/ver-b/minuta-b.txt`;

function buildStub() {
  return createSupabaseStub({
    tables: {
      projects: [
        {
          id: PROJECT_A,
          name: "Oportunidade Alfa",
          client: "Cliente Alfa",
          status: "ATIVO",
          contract_number: null,
          workspace_type: "PRE_CONTRATUAL",
        },
        {
          id: PROJECT_B,
          name: "Oportunidade Beta",
          client: "Cliente Beta",
          status: "ATIVO",
          contract_number: null,
          workspace_type: "PRE_CONTRATUAL",
        },
      ],
      documents: [
        { id: "doc-a", project_id: PROJECT_A, kind: "CONTRATO_BASE", title: "Minuta Alfa", deleted_at: null },
        { id: "doc-b", project_id: PROJECT_B, kind: "CONTRATO_BASE", title: "Minuta Beta", deleted_at: null },
      ],
      document_versions: [
        {
          id: "ver-a",
          document_id: "doc-a",
          version_index: 1,
          version_label: "1.0",
          storage_path: PATH_A,
          original_file_name: "minuta-a.txt",
          mime_type: "text/plain",
          processing_status: "AWAITING_PROCESSING",
        },
        {
          id: "ver-b",
          document_id: "doc-b",
          version_index: 1,
          version_label: "1.0",
          storage_path: PATH_B,
          original_file_name: "minuta-b.txt",
          mime_type: "text/plain",
          processing_status: "AWAITING_PROCESSING",
        },
      ],
      contract_events: [],
      event_categories: [],
      esg_obligations: [],
      esg_obligation_submissions: [],
      esg_obligation_evidence: [],
    },
    storage: { [PATH_A]: MINUTA_A, [PATH_B]: MINUTA_B },
  });
}

console.log("");
console.log("======================================");
console.log("ANALISE JURIDICA PRE-CONTRATUAL - TESTES");
console.log("======================================");
console.log("");

// --- 1. Isolamento documental ----------------------------------------

await checkAsync("ISOLAMENTO: carrega somente o documento do projeto consultado", async () => {
  const supabase = buildStub();
  const result = await loadPrecontractDocumentTexts(supabase, { projectId: PROJECT_A });

  assert(result.documents.length === 1, `esperado 1 documento, veio ${result.documents.length}`);
  assert(result.documents[0].documentId === "doc-a");
  assert(result.documents[0].text.includes("INCC-DI"), "deveria trazer o texto da minuta A");
  assert(!result.documents[0].text.includes("PROJETO B"), "nunca pode trazer texto do projeto B");
});

await checkAsync("ISOLAMENTO: nenhum download do Storage sai do prefixo do projeto", async () => {
  const supabase = buildStub();
  await loadPrecontractDocumentTexts(supabase, { projectId: PROJECT_A });

  assert(supabase.downloads.length === 1, "deveria baixar exatamente um objeto");
  assert(
    supabase.downloads.every((download) => download.path.startsWith(`${PROJECT_A}/`)),
    `download fora do projeto: ${JSON.stringify(supabase.downloads)}`
  );
});

await checkAsync("ISOLAMENTO: o contexto do projeto B nunca contem a minuta do projeto A", async () => {
  const supabase = buildStub();
  const context = await buildProjectAnalysisContext(supabase, {
    projectId: PROJECT_B,
    includeContractualDocuments: true,
  });

  const serialized = JSON.stringify(context);
  assert(serialized.includes("PROJETO B"), "deveria conter a minuta do proprio projeto");
  assert(!serialized.includes("INCC-DI"), "vazou texto do projeto A");
  assert(!serialized.includes(PROJECT_A), "vazou id do projeto A");
});

// --- 2. Conteudo enviado ao provider ---------------------------------

await checkAsync("PAYLOAD: o texto do contrato chega efetivamente ao provider", async () => {
  const supabase = buildStub();
  let capturedPayload = null;

  const spyProvider = {
    id: "spy",
    async answerQuery(request) {
      capturedPayload = request;
      return {
        providerId: "fake",
        model: null,
        output: {
          expertId: "legal-consultant",
          expertName: "Consultor Jurídico IA",
          expertVersion: request.expertVersion,
          question: request.question,
          fatosDocumentados: [],
          contextoInternoDeclarado: [],
          baseContratual: [],
          baseLegal: [],
          praticasNegociais: [],
          interpretacao: "resposta de teste",
          riscos: [],
          severity: "LOW",
          recomendacoes: [],
          acoesSugeridas: [],
          informacoesFaltantes: [],
          rascunhoSugerido: null,
          confidence: 0.4,
          requiresHumanReview: true,
        },
      };
    },
    async generateAssessment() {
      throw new Error("nao usado");
    },
    async consolidateExecutiveCuration() {
      throw new Error("nao usado");
    },
  };

  const result = await answerLegalConsultantQuery(
    supabase,
    { scope: "PROJECT", projectId: PROJECT_A, question: "A clausula de reajuste e aplicavel?" },
    spyProvider,
    { requireContractualDocuments: true }
  );

  assert(capturedPayload !== null, "o provider deveria ter sido chamado");

  const serialized = JSON.stringify(capturedPayload.projectContext);
  assert(serialized.includes("INCC-DI"), "o texto contratual precisa estar no payload");
  assert(serialized.includes("CLAUSULA 12.3"), "a clausula precisa estar no payload");
  assert(capturedPayload.projectContext.contractualDocuments.length === 1, "1 documento contratual esperado");
  assert(capturedPayload.projectContext.workspaceType === "PRE_CONTRATUAL", "workspaceType deve ir ao contexto");
  assert(capturedPayload.projectContext.contractualDocuments[0].truncated === false, "nao deveria truncar aqui");
  assert(result.response.requiresHumanReview === true, "revisao humana obrigatoria preservada");
  assert(result.response.scope === "PROJECT", "escopo derivado do servidor preservado");
});

await checkAsync("PAYLOAD: sem documento legivel a consulta falha e o provider NAO e chamado", async () => {
  const supabase = createSupabaseStub({
    tables: {
      projects: [
        {
          id: PROJECT_A,
          name: "Oportunidade Alfa",
          client: "Cliente Alfa",
          status: "ATIVO",
          contract_number: null,
          workspace_type: "PRE_CONTRATUAL",
        },
      ],
      documents: [],
      document_versions: [],
      contract_events: [],
      event_categories: [],
      esg_obligations: [],
      esg_obligation_submissions: [],
      esg_obligation_evidence: [],
    },
    storage: {},
  });

  let calls = 0;
  const provider = {
    id: "spy",
    async answerQuery() {
      calls += 1;
      throw new Error("nunca deveria ser chamado");
    },
    async generateAssessment() {},
    async consolidateExecutiveCuration() {},
  };

  const error = await assertRejectsWith(
    answerLegalConsultantQuery(
      supabase,
      { scope: "PROJECT", projectId: PROJECT_A, question: "Analise a minuta." },
      provider,
      { requireContractualDocuments: true }
    ),
    "Nenhum documento desta analise pode ser lido",
    "deveria falhar fechado"
  );

  assert(calls === 0, "o provider nunca pode ser consultado sem documento");
  // A mensagem e segura por tipo (ExpertQuerySafeError) e chega a UI.
  assert(
    resolveExpertQueryErrorMessage(error, "fallback") !== "fallback",
    "a mensagem deveria ser exibivel (ExpertQuerySafeError)"
  );
});

await checkAsync("PAYLOAD: demais Experts continuam SEM texto de contrato (escopo PROJECT leve)", async () => {
  const supabase = buildStub();
  const context = await buildProjectAnalysisContext(supabase, { projectId: PROJECT_A });

  assert(context.contractualDocuments.length === 0, "sem includeContractualDocuments nao carrega texto");
  assert(!JSON.stringify(context).includes("INCC-DI"), "nenhum texto contratual deveria vazar por default");
  assert(supabase.downloads.length === 0, "nenhum download deveria acontecer");
});

check("PAYLOAD: truncamento e sempre declarado, nunca silencioso", () => {
  const longo = "x".repeat(500);
  const cortado = truncateForContext(longo, 100);

  assert(cortado.truncated === true, "deveria marcar truncated");
  assert(cortado.text.length === 100);
  assert(cortado.omittedCharacters === 400);

  const inteiro = truncateForContext("abc", 100);
  assert(inteiro.truncated === false && inteiro.omittedCharacters === 0);
});

// --- 3. Ausencia de persistencia -------------------------------------

await checkAsync("SEM PERSISTENCIA: a consulta juridica nao escreve nada no banco", async () => {
  const supabase = buildStub();

  await answerLegalConsultantQuery(
    supabase,
    { scope: "PROJECT", projectId: PROJECT_A, question: "Alguma clausula abusiva?" },
    {
      id: "spy",
      async answerQuery(request) {
        return {
          providerId: "fake",
          model: null,
          output: {
            expertId: "legal-consultant",
            expertName: "Consultor Jurídico IA",
            expertVersion: request.expertVersion,
            question: request.question,
            fatosDocumentados: [],
            contextoInternoDeclarado: [],
            baseContratual: [],
            baseLegal: [],
            praticasNegociais: [],
            interpretacao: "resposta de teste",
            riscos: [],
            severity: "LOW",
            recomendacoes: [],
            acoesSugeridas: [],
            informacoesFaltantes: [],
            rascunhoSugerido: null,
            confidence: 0.4,
            requiresHumanReview: true,
          },
        };
      },
      async generateAssessment() {},
      async consolidateExecutiveCuration() {},
    },
    { requireContractualDocuments: true }
  );

  assert(
    supabase.writes.length === 0,
    `nenhuma escrita esperada, houve: ${JSON.stringify(supabase.writes.map((w) => `${w.table}:${w.op}`))}`
  );
});

await checkAsync("SEM PERSISTENCIA: carregar o contexto documental nao grava extracao", async () => {
  const supabase = buildStub();
  await loadPrecontractDocumentTexts(supabase, { projectId: PROJECT_A });

  const forbidden = supabase.writes.filter((write) =>
    ["document_extractions", "document_text_segments", "document_versions"].includes(write.table)
  );
  assert(forbidden.length === 0, `gravou em tabela de extracao: ${JSON.stringify(forbidden)}`);
  assert(supabase.writes.length === 0, "nenhuma escrita de qualquer tipo esperada");
});

// --- 4. Estados do upload --------------------------------------------

check("ESTADOS: os quatro estados exigidos existem e tem rotulo", () => {
  for (const status of ["ENVIANDO", "PROCESSANDO", "PRONTO", "ERRO"]) {
    assert(typeof PRECONTRACT_STATUS_LABELS[status] === "string", `sem rotulo para ${status}`);
  }
  assert(PRECONTRACT_STATUS_LABELS.PROCESSANDO === "Processando documento");
  assert(PRECONTRACT_STATUS_LABELS.PRONTO === "Pronto");
});

check("ESTADOS: 100% enviado NAO libera a consulta enquanto processa", () => {
  const itens = [
    {
      id: "1",
      fileName: "minuta.pdf",
      kind: "CONTRATO_BASE",
      sizeBytes: 10,
      status: "PROCESSANDO",
      uploadPercent: 100,
      documentId: "d",
      documentVersionId: "v",
      pageCount: null,
      characterCount: null,
      message: null,
    },
  ];

  assert(hasReadyPrecontractDocument(itens) === false, "PROCESSANDO nunca libera a consulta");
  assert(
    precontractQueryBlockReason(itens).includes("Processando documento"),
    "o motivo do bloqueio deve explicar o processamento"
  );
});

check("ESTADOS: PRONTO sem conteudo extraido tambem nao libera (fail-closed)", () => {
  const base = {
    id: "1",
    fileName: "scan.pdf",
    kind: "CONTRATO_BASE",
    sizeBytes: 10,
    uploadPercent: 100,
    documentId: "d",
    documentVersionId: "v",
    pageCount: 3,
    message: null,
  };

  assert(hasReadyPrecontractDocument([{ ...base, status: "PRONTO", characterCount: 0 }]) === false);
  assert(hasReadyPrecontractDocument([{ ...base, status: "PRONTO", characterCount: null }]) === false);
  assert(hasReadyPrecontractDocument([{ ...base, status: "PRONTO", characterCount: 4200 }]) === true);
});

check("ESTADOS: sem documento, ENVIANDO e ERRO produzem motivos distintos", () => {
  assert(precontractQueryBlockReason([]).includes("Envie um documento"));

  const enviando = [
    {
      id: "1",
      fileName: "a.pdf",
      kind: "CONTRATO_BASE",
      sizeBytes: 1,
      status: "ENVIANDO",
      uploadPercent: 42,
      documentId: null,
      documentVersionId: null,
      pageCount: null,
      characterCount: null,
      message: null,
    },
  ];
  assert(precontractQueryBlockReason(enviando).includes("Aguarde o envio"));

  const erro = [{ ...enviando[0], status: "ERRO", uploadPercent: 100 }];
  assert(precontractQueryBlockReason(erro).includes("Nenhum documento pode ser lido") || precontractQueryBlockReason(erro).includes("Nenhum documento"));

  const pronto = [{ ...enviando[0], status: "PRONTO", characterCount: 10 }];
  assert(precontractQueryBlockReason(pronto) === null, "documento pronto libera a consulta");
});

check("ESTADOS: formatos aceitos sao reconhecidos, os demais sao recusados", () => {
  assert(resolveExtractionFormat("application/pdf", "minuta.pdf") === "PDF");
  assert(resolveExtractionFormat(null, "minuta.docx") === "DOCX");
  assert(resolveExtractionFormat("text/plain", "notas.txt") === "TXT");
  assert(resolveExtractionFormat("image/png", "foto.png") === null, "PNG nunca e tratado como documento legivel");
  assert(resolveExtractionFormat(null, "planilha.xlsx") === null, "XLSX fora do escopo juridico desta tela");
});

await checkAsync("ESTADOS: documento com formato nao suportado vira falha declarada, nao some", async () => {
  const supabase = createSupabaseStub({
    tables: {
      projects: [
        {
          id: PROJECT_A,
          name: "Oportunidade Alfa",
          client: "Cliente Alfa",
          status: "ATIVO",
          contract_number: null,
          workspace_type: "PRE_CONTRATUAL",
        },
      ],
      documents: [{ id: "doc-x", project_id: PROJECT_A, kind: "CONTRATO_BASE", title: "Escaneado", deleted_at: null }],
      document_versions: [
        {
          id: "ver-x",
          document_id: "doc-x",
          version_index: 1,
          version_label: "1.0",
          storage_path: `${PROJECT_A}/doc-x/ver-x/foto.png`,
          original_file_name: "foto.png",
          mime_type: "image/png",
          processing_status: "AWAITING_PROCESSING",
        },
      ],
      contract_events: [],
      event_categories: [],
      esg_obligations: [],
      esg_obligation_submissions: [],
      esg_obligation_evidence: [],
    },
    storage: {},
  });

  const result = await loadPrecontractDocumentTexts(supabase, { projectId: PROJECT_A });

  assert(result.documents.length === 0, "nenhum documento legivel");
  assert(result.failures.length === 1, "a falha precisa ser declarada");
  assert(result.failures[0].reason.includes("Formato nao suportado") || result.failures[0].reason.includes("Formato"));
});

// --- 5. Isolamento por path e cobertura documental -------------------

check("ISOLAMENTO: prefixo do path e conferido explicitamente", () => {
  assert(isStoragePathInsideProject(`${PROJECT_A}/doc/ver/a.pdf`, PROJECT_A) === true);
  assert(isStoragePathInsideProject(`${PROJECT_B}/doc/ver/a.pdf`, PROJECT_A) === false, "path de outro projeto");
  assert(isStoragePathInsideProject(`${PROJECT_A}x/doc/ver/a.pdf`, PROJECT_A) === false, "prefixo parcial nao vale");
  assert(isStoragePathInsideProject("doc/ver/a.pdf", PROJECT_A) === false, "path sem projeto");
});

await checkAsync("ISOLAMENTO: path divergente no banco nao vira download nem texto", async () => {
  const pathDivergente = `${PROJECT_B}/doc-x/ver-x/minuta.txt`;
  const supabase = createSupabaseStub({
    tables: {
      projects: [
        {
          id: PROJECT_A,
          name: "Oportunidade Alfa",
          client: "Cliente Alfa",
          status: "ATIVO",
          contract_number: null,
          workspace_type: "PRE_CONTRATUAL",
        },
      ],
      // Linha "envenenada": pertence ao projeto A, mas aponta para um
      // objeto na pasta do projeto B.
      documents: [{ id: "doc-x", project_id: PROJECT_A, kind: "CONTRATO_BASE", title: "Suspeita", deleted_at: null }],
      document_versions: [
        {
          id: "ver-x",
          document_id: "doc-x",
          version_index: 1,
          version_label: "1.0",
          storage_path: pathDivergente,
          original_file_name: "minuta.txt",
          mime_type: "text/plain",
          file_size_bytes: 10,
          processing_status: "AWAITING_PROCESSING",
        },
      ],
      contract_events: [],
      event_categories: [],
      esg_obligations: [],
      esg_obligation_submissions: [],
      esg_obligation_evidence: [],
    },
    storage: { [pathDivergente]: "CONTEUDO SECRETO DO PROJETO B" },
  });

  const result = await loadPrecontractDocumentTexts(supabase, { projectId: PROJECT_A });

  assert(supabase.downloads.length === 0, "nenhum download pode acontecer com path divergente");
  assert(result.documents.length === 0, "nenhum texto e carregado");
  assert(result.failures.length === 1, "a recusa precisa ser declarada");
  assert(result.failures[0].reason.includes("nao pertence") || result.failures[0].reason.includes("não pertence"));
  assert(!JSON.stringify(result).includes("SECRETO"), "conteudo de outro projeto nunca vaza");
});

await checkAsync("ISOLAMENTO: documento na lixeira (deleted_at) nao entra na analise", async () => {
  const supabase = createSupabaseStub({
    tables: {
      projects: [
        {
          id: PROJECT_A,
          name: "Oportunidade Alfa",
          client: "Cliente Alfa",
          status: "ATIVO",
          contract_number: null,
          workspace_type: "PRE_CONTRATUAL",
        },
      ],
      documents: [
        { id: "doc-a", project_id: PROJECT_A, kind: "CONTRATO_BASE", title: "Apagado", deleted_at: "2026-09-01" },
      ],
      document_versions: [
        {
          id: "ver-a",
          document_id: "doc-a",
          version_index: 1,
          version_label: "1.0",
          storage_path: PATH_A,
          original_file_name: "minuta-a.txt",
          mime_type: "text/plain",
          file_size_bytes: 10,
          processing_status: "AWAITING_PROCESSING",
        },
      ],
      contract_events: [],
      event_categories: [],
      esg_obligations: [],
      esg_obligation_submissions: [],
      esg_obligation_evidence: [],
    },
    storage: { [PATH_A]: MINUTA_A },
  });

  const result = await loadPrecontractDocumentTexts(supabase, { projectId: PROJECT_A });
  assert(result.documents.length === 0, "documento na lixeira nunca alimenta a analise");
  assert(supabase.downloads.length === 0, "nem chega a baixar");
});

await checkAsync("COBERTURA: metadado do servidor descreve incluidos, omitidos e caracteres", async () => {
  const supabase = buildStub();
  const context = await buildProjectAnalysisContext(supabase, {
    projectId: PROJECT_A,
    includeContractualDocuments: true,
  });

  const coverage = context.documentCoverage;
  assert(coverage.availableCount === 1, `disponiveis: ${coverage.availableCount}`);
  assert(coverage.includedCount === 1, `incluidos: ${coverage.includedCount}`);
  assert(coverage.omittedCount === 0);
  assert(coverage.unreadableCount === 0);
  assert(coverage.includedCharacters === MINUTA_A.length, `caracteres: ${coverage.includedCharacters}`);
  assert(coverage.omittedCharacters === 0);
  assert(coverage.truncated === false, "documento inteiro cabe — sem aviso de parcial");
});

await checkAsync("COBERTURA: truncamento e sinalizado quando o orcamento nao comporta", async () => {
  const grande = "C".repeat(50000);
  const pathGrande = `${PROJECT_A}/doc-g/ver-g/grande.txt`;

  const supabase = createSupabaseStub({
    tables: {
      projects: [
        {
          id: PROJECT_A,
          name: "Oportunidade Alfa",
          client: "Cliente Alfa",
          status: "ATIVO",
          contract_number: null,
          workspace_type: "PRE_CONTRATUAL",
        },
      ],
      documents: [{ id: "doc-g", project_id: PROJECT_A, kind: "CONTRATO_BASE", title: "Minuta Longa", deleted_at: null }],
      document_versions: [
        {
          id: "ver-g",
          document_id: "doc-g",
          version_index: 1,
          version_label: "1.0",
          storage_path: pathGrande,
          original_file_name: "grande.txt",
          mime_type: "text/plain",
          file_size_bytes: grande.length,
          processing_status: "AWAITING_PROCESSING",
        },
      ],
      contract_events: [],
      event_categories: [],
      esg_obligations: [],
      esg_obligation_submissions: [],
      esg_obligation_evidence: [],
    },
    storage: { [pathGrande]: grande },
  });

  const loaded = await loadPrecontractDocumentTexts(supabase, { projectId: PROJECT_A, budget: 10000 });

  assert(loaded.documents.length === 1);
  assert(loaded.documents[0].truncated === true, "o corte precisa ser declarado");
  assert(loaded.documents[0].text.length === 10000, `texto incluido: ${loaded.documents[0].text.length}`);
  assert(loaded.documents[0].characterCount === 50000, "characterCount e o tamanho ORIGINAL");
  assert(loaded.documents[0].omittedCharacters === 40000);
  assert(loaded.truncated === true, "o resultado inteiro sinaliza conteudo parcial");
  assert(loaded.omittedCharacters === 40000);
});

await checkAsync("COBERTURA: versao vigente ilegivel nunca cai para a versao anterior", async () => {
  const pathAntigo = `${PROJECT_A}/doc-v/ver-1/antiga.txt`;
  const pathNovo = `${PROJECT_A}/doc-v/ver-2/nova.png`;

  const supabase = createSupabaseStub({
    tables: {
      projects: [
        {
          id: PROJECT_A,
          name: "Oportunidade Alfa",
          client: "Cliente Alfa",
          status: "ATIVO",
          contract_number: null,
          workspace_type: "PRE_CONTRATUAL",
        },
      ],
      documents: [{ id: "doc-v", project_id: PROJECT_A, kind: "CONTRATO_BASE", title: "Minuta", deleted_at: null }],
      document_versions: [
        {
          id: "ver-1",
          document_id: "doc-v",
          version_index: 1,
          version_label: "1.0",
          storage_path: pathAntigo,
          original_file_name: "antiga.txt",
          mime_type: "text/plain",
          file_size_bytes: 10,
          processing_status: "PROCESSED",
        },
        {
          id: "ver-2",
          document_id: "doc-v",
          version_index: 2,
          version_label: "2.0",
          storage_path: pathNovo,
          original_file_name: "nova.png",
          mime_type: "image/png",
          file_size_bytes: 10,
          processing_status: "AWAITING_PROCESSING",
        },
      ],
      contract_events: [],
      event_categories: [],
      esg_obligations: [],
      esg_obligation_submissions: [],
      esg_obligation_evidence: [],
    },
    storage: { [pathAntigo]: "TEXTO DA VERSAO ANTIGA QUE NAO PODE SER USADO" },
  });

  const result = await loadPrecontractDocumentTexts(supabase, { projectId: PROJECT_A });

  assert(result.documents.length === 0, "nada e carregado: a versao vigente e ilegivel");
  assert(result.failures.length === 1, "a falha da versao vigente precisa ser declarada");
  assert(!JSON.stringify(result).includes("VERSAO ANTIGA"), "fallback silencioso para versao antiga e proibido");
  assert(supabase.downloads.length === 0, "nem baixa a versao antiga");
});

await checkAsync("COBERTURA: a consulta juridica expoe o metadado de truncamento (fonte do aviso na UI)", async () => {
  // Acima do orcamento padrao (120k) — forca o truncamento real.
  const grande = "D".repeat(150000);
  const pathGrande = `${PROJECT_A}/doc-g/ver-g/grande.txt`;

  const supabase = createSupabaseStub({
    tables: {
      projects: [
        {
          id: PROJECT_A,
          name: "Oportunidade Alfa",
          client: "Cliente Alfa",
          status: "ATIVO",
          contract_number: null,
          workspace_type: "PRE_CONTRATUAL",
        },
      ],
      documents: [{ id: "doc-g", project_id: PROJECT_A, kind: "CONTRATO_BASE", title: "Longa", deleted_at: null }],
      document_versions: [
        {
          id: "ver-g",
          document_id: "doc-g",
          version_index: 1,
          version_label: "1.0",
          storage_path: pathGrande,
          original_file_name: "grande.txt",
          mime_type: "text/plain",
          file_size_bytes: grande.length,
          processing_status: "AWAITING_PROCESSING",
        },
      ],
      contract_events: [],
      event_categories: [],
      esg_obligations: [],
      esg_obligation_submissions: [],
      esg_obligation_evidence: [],
    },
    storage: { [pathGrande]: grande },
  });

  const result = await answerLegalConsultantQuery(
    supabase,
    { scope: "PROJECT", projectId: PROJECT_A, question: "Analise a minuta." },
    {
      id: "spy",
      async answerQuery(request) {
        return {
          providerId: "fake",
          model: null,
          output: {
            expertId: "legal-consultant",
            expertName: "Consultor Jurídico IA",
            expertVersion: request.expertVersion,
            question: request.question,
            fatosDocumentados: [],
            contextoInternoDeclarado: [],
            baseContratual: [],
            baseLegal: [],
            praticasNegociais: [],
            interpretacao: "ok",
            riscos: [],
            severity: "LOW",
            recomendacoes: [],
            acoesSugeridas: [],
            informacoesFaltantes: [],
            rascunhoSugerido: null,
            confidence: 0.4,
            requiresHumanReview: true,
          },
        };
      },
      async generateAssessment() {},
      async consolidateExecutiveCuration() {},
    },
    { requireContractualDocuments: true }
  );

  const coverage = result.documentCoverage;
  assert(coverage !== null, "a consulta precisa devolver a cobertura documental");
  assert(coverage.truncated === true, "o aviso de parcial nasce deste metadado do SERVIDOR");
  assert(coverage.omittedCharacters > 0, "caracteres omitidos precisam ser contados");
  assert(coverage.includedCount === 1 && coverage.availableCount === 1);
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
