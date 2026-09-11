// Testes do CRONOGRAMA em XLSX no fluxo juridico pre-contratual.
//
// O que esta em jogo: as regras de prazo do Consultor Juridico
// (extensao day-for-day, multa por atraso, proporcionalidade da mora)
// nao decidem nada sem DATA, e ate aqui nenhuma data de cronograma
// chegava ao contexto. Este script cobre o caminho inteiro — formato,
// extracao, papel documental e isolamento — com planilhas .xlsx REAIS
// geradas em memoria pelo proprio exceljs, nunca com um stub que
// concorda com a implementacao.
//
// Zero rede, zero Supabase real, zero Anthropic, zero escrita.
//
// Uso:
//   node scripts/test-schedule-xlsx-legal-context.mjs

import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const ExcelJS = (await import("exceljs")).default;

const {
  resolveExtractionFormat,
  unsupportedFormatDetail,
  isMicrosoftProjectFile,
  SUPPORTED_FORMATS_LABEL,
} = await import("../apps/web/lib/documents/extraction/document-format");
const { extractXlsxText } = await import("../apps/web/lib/documents/extraction/extract-xlsx-text");
const { extractDocumentText, UnsupportedDocumentFormatError, EmptyDocumentTextError } = await import(
  "../apps/web/lib/documents/extraction/extract-document-text"
);
const { loadPrecontractDocumentTexts, resolveDocumentRole, CONTRACTUAL_KINDS } = await import(
  "../apps/web/lib/documents/extraction/load-precontract-document-texts"
);
const { itemsFromBatchVerification, precontractQueryBlockReason } = await import(
  "../apps/web/lib/legal/precontract-document-state"
);
const { runPrecontractUpload } = await import("../apps/web/lib/legal/run-precontract-upload");

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

async function assertThrows(promise, ErrorClass, message) {
  try {
    await promise;
  } catch (error) {
    if (ErrorClass && !(error instanceof ErrorClass)) {
      throw new Error(`${message ?? "esperado throw"} - tipo inesperado: ${error.constructor.name}`);
    }
    return error;
  }
  throw new Error(message ?? "esperado throw, mas resolveu");
}

// ---------------------------------------------------------------------
// Fixtures: planilhas .xlsx de verdade, montadas em memoria. E o ponto
// do script — um .xlsx sintetico exercita o parser real do exceljs
// (tipos de celula, datas seriais, formulas), nao a nossa suposicao
// sobre ele.
// ---------------------------------------------------------------------

/** Cronograma tipico: atividade, inicio, termino, e uma linha com buraco. */
async function buildCronogramaXlsx() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Cronograma");

  sheet.addRow(["Atividade", "Inicio", "Termino", "Status"]);
  sheet.addRow(["Terraplenagem", new Date(Date.UTC(2026, 2, 2)), new Date(Date.UTC(2026, 3, 15)), "CONCLUIDA"]);
  sheet.addRow(["Fundacoes", new Date(Date.UTC(2026, 3, 16)), new Date(Date.UTC(2026, 5, 30)), "NO_PRAZO"]);
  // Linha com a data de inicio NAO preenchida: a posicao da coluna tem
  // de sobreviver, senao o termino viraria o inicio.
  sheet.addRow(["Estrutura metalica", null, new Date(Date.UTC(2026, 8, 10)), "ATRASADA"]);

  const marcos = workbook.addWorksheet("Marcos");
  marcos.addRow(["Marco contratual", "Data limite"]);
  marcos.addRow(["Entrega definitiva", new Date(Date.UTC(2026, 11, 20))]);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

async function buildEmptyXlsx() {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Vazia");
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function toArrayBuffer(nodeBuffer) {
  return nodeBuffer.buffer.slice(nodeBuffer.byteOffset, nodeBuffer.byteOffset + nodeBuffer.byteLength);
}

console.log("");
console.log("======================================");
console.log("CRONOGRAMA XLSX NO FLUXO JURIDICO");
console.log("======================================");
console.log("");

// --- 1. Reconhecimento de formato ------------------------------------

check("FORMATO: XLSX e reconhecido por MIME e por extensao", () => {
  assert(
    resolveExtractionFormat(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "cronograma.xlsx"
    ) === "XLSX",
    "MIME de planilha"
  );
  assert(resolveExtractionFormat(null, "CRONOGRAMA BASELINE.XLSX") === "XLSX", "extensao em maiuscula");
  assert(resolveExtractionFormat("application/pdf", "minuta.pdf") === "PDF", "PDF continua PDF");
});

check("FORMATO: .mpp continua sem parser e e reconhecido como tal", () => {
  assert(resolveExtractionFormat("application/vnd.ms-project", "obra.mpp") === null, "MPP nao e legivel");
  assert(resolveExtractionFormat(null, "obra.mpp") === null, "MPP por extensao tambem nao");
  assert(isMicrosoftProjectFile(null, "obra.mpp"), "identificacao por extensao");
  assert(isMicrosoftProjectFile("application/vnd.ms-project", "sem-extensao"), "identificacao por MIME");
  assert(!isMicrosoftProjectFile(null, "cronograma.xlsx"), "XLSX nunca e MPP");
});

check("FORMATO: a recusa do .mpp diz COMO exportar, nunca so 'formato nao suportado'", () => {
  const detail = unsupportedFormatDetail("application/vnd.ms-project", "obra.mpp");
  assert(detail.includes(".mpp"), "precisa nomear o formato recusado");
  assert(detail.includes(".xlsx"), "precisa indicar o formato de saida");
  assert(/export/i.test(detail), "precisa dizer o que o usuario deve fazer");
  // Um cronograma guardado e nao lido seria pior que a recusa: passaria a
  // impressao de que as datas entraram na analise.
  assert(!/armazenad|guardad/i.test(detail), "nunca sugerir que o arquivo foi aproveitado");
});

check("FORMATO: formato desconhecido cai na mensagem generica, com a lista atualizada", () => {
  const detail = unsupportedFormatDetail("image/png", "foto.png");
  assert(detail.includes("foto.png"), "precisa nomear o arquivo");
  assert(detail.includes(SUPPORTED_FORMATS_LABEL), "precisa listar os formatos aceitos");
  assert(SUPPORTED_FORMATS_LABEL.includes("XLSX"), "XLSX precisa constar da lista exibida");
});

// --- 2. Extracao real da planilha ------------------------------------

await checkAsync("EXTRACAO: le todas as abas, com aba e numero da linha no prefixo", async () => {
  const result = await extractXlsxText(toArrayBuffer(await buildCronogramaXlsx()));

  assert(result.sheetCount === 2, `esperado 2 abas com conteudo, veio ${result.sheetCount}`);
  assert(result.rowCount === 6, `esperado 6 linhas preenchidas, veio ${result.rowCount}`);
  assert(result.text.includes("[Cronograma - linha 2] Terraplenagem"), "prefixo de aba/linha ausente");
  assert(result.text.includes("[Marcos - linha 2] Entrega definitiva"), "a segunda aba precisa ser lida");
});

await checkAsync("EXTRACAO: data sai em ISO YYYY-MM-DD, nunca no formato ambiguo da celula", async () => {
  const result = await extractXlsxText(toArrayBuffer(await buildCronogramaXlsx()));

  assert(result.text.includes("2026-03-02"), "inicio da terraplenagem em ISO");
  assert(result.text.includes("2026-04-15"), "termino da terraplenagem em ISO");
  assert(result.text.includes("2026-12-20"), "marco contratual em ISO");

  // 03/04 nao pode chegar ao modelo: 3 de abril ou 4 de marco?
  assert(!/\d{2}\/\d{2}\/\d{2,4}/.test(result.text), `formato ambiguo de data no texto: ${result.text.slice(0, 200)}`);
});

await checkAsync("EXTRACAO: celula vazia preserva a POSICAO da coluna", async () => {
  const result = await extractXlsxText(toArrayBuffer(await buildCronogramaXlsx()));

  const linha = result.text.split("\n").find((line) => line.includes("Estrutura metalica"));
  assert(linha, "a linha com buraco precisa existir");

  // Sem a celula vazia, "Estrutura metalica | 2026-09-10" faria a data de
  // TERMINO ser lida como data de INICIO.
  assert(
    linha.includes("Estrutura metalica |  | 2026-09-10"),
    `posicao da coluna vazia perdida: ${linha}`
  );
});

await checkAsync("EXTRACAO: formula de data entrega o RESULTADO, nunca o texto da formula", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Calculado");
  sheet.addRow(["Marco", "Data"]);
  const row = sheet.addRow(["Entrega", null]);
  row.getCell(2).value = { formula: "A1+30", result: new Date(Date.UTC(2026, 6, 1)) };

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const result = await extractXlsxText(toArrayBuffer(buffer));

  assert(result.text.includes("2026-07-01"), `resultado da formula ausente: ${result.text}`);
  assert(!result.text.includes("A1+30"), "o texto da formula nunca vai ao modelo");
});

// --- 3. Integracao com o extrator unico ------------------------------

await checkAsync("EXTRATOR: extractDocumentText roteia XLSX para o exceljs", async () => {
  const extracted = await extractDocumentText({
    buffer: toArrayBuffer(await buildCronogramaXlsx()),
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    fileName: "cronograma.xlsx",
  });

  assert(extracted.format === "XLSX", `formato errado: ${extracted.format}`);
  assert(extracted.extractor === "exceljs", `extrator errado: ${extracted.extractor}`);
  assert(extracted.pageCount === null, "planilha nao tem pagina");
  assert(extracted.characterCount === extracted.text.length, "contagem precisa bater com o texto");
  assert(extracted.text.includes("2026-04-15"), "as datas precisam chegar ao texto final");
});

await checkAsync("EXTRATOR: planilha vazia vira EmptyDocumentTextError, nunca texto vazio", async () => {
  const error = await assertThrows(
    extractDocumentText({
      buffer: toArrayBuffer(await buildEmptyXlsx()),
      mimeType: null,
      fileName: "vazio.xlsx",
    }),
    EmptyDocumentTextError,
    "planilha vazia precisa falhar declaradamente"
  );
  assert(/planilha/i.test(error.detail), `mensagem precisa falar de planilha: ${error.detail}`);
  assert(!/OCR/i.test(error.detail), "mensagem de PDF digitalizado nao serve para planilha");
});

await checkAsync("EXTRATOR: .mpp cai em UnsupportedDocumentFormatError com a instrucao de exportacao", async () => {
  const error = await assertThrows(
    extractDocumentText({
      buffer: new ArrayBuffer(8),
      mimeType: "application/vnd.ms-project",
      fileName: "obra.mpp",
    }),
    UnsupportedDocumentFormatError,
    "MPP precisa ser recusado no servidor tambem"
  );
  assert(error.detail.includes(".xlsx"), `a instrucao de exportacao precisa chegar ao usuario: ${error.detail}`);
});

// --- 4. Papel documental: cronograma NAO e clausula ------------------

check("PAPEL: cronograma e marcado como CRONOGRAMA, contrato como CONTRATO", () => {
  assert(resolveDocumentRole("CRONOGRAMA_BASELINE") === "CRONOGRAMA");
  assert(resolveDocumentRole("CRONOGRAMA_REVISAO") === "CRONOGRAMA");
  assert(resolveDocumentRole("CONTRATO_BASE") === "CONTRATO");
  assert(resolveDocumentRole("ADITIVO") === "CONTRATO");
  assert(resolveDocumentRole("PROPOSTA_COMERCIAL") === "CONTRATO");
  // Tipo desconhecido nunca vira cronograma por acidente.
  assert(resolveDocumentRole("QUALQUER_OUTRO") === "CONTRATO");
});

check("PAPEL: os tipos de cronograma entraram SEM remover nenhum tipo contratual", () => {
  for (const kind of ["CRONOGRAMA_BASELINE", "CRONOGRAMA_REVISAO"]) {
    assert(CONTRACTUAL_KINDS.includes(kind), `tipo de cronograma ausente: ${kind}`);
  }
  // Guarda contra o risco real desta mudanca: alguem "arrumar" a lista e
  // derrubar a base contratual que ja funcionava.
  for (const kind of [
    "CONTRATO_BASE",
    "ADITIVO",
    "EDITAL",
    "PROPOSTA_COMERCIAL",
    "PROPOSTA_TECNICA",
    "PROPOSTA_AXION",
    "PLANILHA_CONTRATUAL",
    "ESPECIFICACAO",
    "CLARIFICACAO_CLIENTE",
  ]) {
    assert(CONTRACTUAL_KINDS.includes(kind), `tipo contratual removido: ${kind}`);
  }
});

// --- 5. Carregamento no contexto, com isolamento ---------------------

const PROJECT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const PATH_CONTRATO = `${PROJECT_A}/doc-contrato/ver-1/minuta.txt`;
const PATH_CRONO = `${PROJECT_A}/doc-crono/ver-1/cronograma.xlsx`;
const PATH_CRONO_B = `${PROJECT_B}/doc-crono-b/ver-1/cronograma-b.xlsx`;

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

  return {
    writes,
    downloads,
    from(table) {
      const rows = tables[table] ?? [];
      const filters = [];
      const builder = {
        select: () => builder,
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
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve({ data: applyFilters(rows, filters)[0] ?? null, error: null }),
        insert(payload) {
          writes.push({ table, op: "insert", payload });
          return Promise.resolve({ data: null, error: null });
        },
        update(payload) {
          writes.push({ table, op: "update", payload });
          return builder;
        },
        delete() {
          writes.push({ table, op: "delete" });
          return builder;
        },
        then(resolve, reject) {
          return Promise.resolve({ data: applyFilters(rows, filters), error: null }).then(resolve, reject);
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
            const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
            return Promise.resolve({
              data: { arrayBuffer: async () => toArrayBuffer(bytes) },
              error: null,
            });
          },
        };
      },
    },
  };
}

async function buildScheduleStub() {
  const cronograma = await buildCronogramaXlsx();

  return createSupabaseStub({
    tables: {
      documents: [
        {
          id: "doc-contrato",
          project_id: PROJECT_A,
          kind: "CONTRATO_BASE",
          title: "Minuta Alfa",
          deleted_at: null,
          created_at: "2026-01-02T00:00:00Z",
        },
        {
          id: "doc-crono",
          project_id: PROJECT_A,
          kind: "CRONOGRAMA_BASELINE",
          title: "Cronograma baseline",
          deleted_at: null,
          created_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "doc-crono-b",
          project_id: PROJECT_B,
          kind: "CRONOGRAMA_BASELINE",
          title: "Cronograma do projeto B",
          deleted_at: null,
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
      document_versions: [
        {
          id: "ver-contrato",
          document_id: "doc-contrato",
          version_index: 1,
          version_label: "1.0",
          file_path: PATH_CONTRATO,
          storage_bucket: "project-documents",
          original_file_name: "minuta.txt",
          mime_type: "text/plain",
          file_size_bytes: 120,
          processing_status: "PROCESSADO",
        },
        {
          id: "ver-crono",
          document_id: "doc-crono",
          version_index: 1,
          version_label: "1.0",
          file_path: PATH_CRONO,
          storage_bucket: "project-documents",
          original_file_name: "cronograma.xlsx",
          mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          file_size_bytes: cronograma.byteLength,
          processing_status: "PROCESSADO",
        },
        {
          id: "ver-crono-b",
          document_id: "doc-crono-b",
          version_index: 1,
          version_label: "1.0",
          file_path: PATH_CRONO_B,
          storage_bucket: "project-documents",
          original_file_name: "cronograma-b.xlsx",
          mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          file_size_bytes: cronograma.byteLength,
          processing_status: "PROCESSADO",
        },
      ],
    },
    storage: {
      [PATH_CONTRATO]: "CLAUSULA 8.1 - PRAZO. A obra sera entregue conforme o cronograma anexo.",
      [PATH_CRONO]: cronograma,
      [PATH_CRONO_B]: cronograma,
    },
  });
}

await checkAsync("CONTEXTO: o cronograma entra na base documental, com as datas legiveis", async () => {
  const supabase = await buildScheduleStub();
  const result = await loadPrecontractDocumentTexts(supabase, { projectId: PROJECT_A });

  assert(result.documents.length === 2, `esperado contrato + cronograma, veio ${result.documents.length}`);
  assert(result.failures.length === 0, `nenhuma falha esperada: ${JSON.stringify(result.failures)}`);

  const crono = result.documents.find((document) => document.kind === "CRONOGRAMA_BASELINE");
  assert(crono, "o cronograma precisa estar na base documental");
  assert(crono.text.includes("2026-04-15"), "as datas do cronograma precisam chegar ao contexto");
  assert(crono.text.includes("[Cronograma - linha 2]"), "a rastreabilidade ate a linha precisa sobreviver");
});

await checkAsync("CONTEXTO: cada documento carrega seu PAPEL — cronograma nunca se passa por clausula", async () => {
  const supabase = await buildScheduleStub();
  const result = await loadPrecontractDocumentTexts(supabase, { projectId: PROJECT_A });

  const crono = result.documents.find((document) => document.kind === "CRONOGRAMA_BASELINE");
  const contrato = result.documents.find((document) => document.kind === "CONTRATO_BASE");

  assert(crono.documentRole === "CRONOGRAMA", `papel errado no cronograma: ${crono.documentRole}`);
  assert(contrato.documentRole === "CONTRATO", `papel errado no contrato: ${contrato.documentRole}`);
});

await checkAsync("ISOLAMENTO: o cronograma do projeto B nunca entra na analise do projeto A", async () => {
  const supabase = await buildScheduleStub();
  const result = await loadPrecontractDocumentTexts(supabase, { projectId: PROJECT_A });

  const ids = result.documents.map((document) => document.documentId);
  assert(!ids.includes("doc-crono-b"), "documento de outro projeto vazou para a analise");

  for (const download of supabase.downloads) {
    assert(download.path.startsWith(`${PROJECT_A}/`), `download fora do projeto: ${download.path}`);
  }
});

await checkAsync("SEM PERSISTENCIA: ler o cronograma nao grava nada", async () => {
  const supabase = await buildScheduleStub();
  await loadPrecontractDocumentTexts(supabase, { projectId: PROJECT_A });

  assert(supabase.writes.length === 0, `escrita inesperada: ${JSON.stringify(supabase.writes)}`);
});

// --- 6. Tela: hidratacao e mensagens ---------------------------------

check("TELA: apos F5 o cronograma volta com o tipo REAL, nao como contrato", () => {
  const items = itemsFromBatchVerification([
    {
      documentId: "doc-crono",
      documentVersionId: "ver-crono",
      title: "Cronograma baseline",
      kind: "CRONOGRAMA_BASELINE",
      fileName: "cronograma.xlsx",
      versionLabel: "1.0",
      sizeBytes: 4096,
      status: "PRONTO",
      pageCount: null,
      characterCount: 900,
      message: null,
    },
  ]);

  assert(items.length === 1);
  assert(items[0].kind === "CRONOGRAMA_BASELINE", `tipo perdido na hidratacao: ${items[0].kind}`);
  assert(items[0].status === "PRONTO", "o status confirmado pelo servidor precisa ser preservado");
});

check("TELA: o motivo de bloqueio menciona o XLSX como caminho valido", () => {
  const erro = [
    {
      id: "item-1",
      fileName: "obra.mpp",
      kind: "CRONOGRAMA_BASELINE",
      sizeBytes: 10,
      status: "ERRO",
      uploadPercent: 0,
      documentId: null,
      documentVersionId: null,
      versionLabel: null,
      pageCount: null,
      characterCount: null,
      message: null,
      pendingDecision: null,
      hydrated: false,
    },
  ];

  const reason = precontractQueryBlockReason(erro);
  assert(reason.includes("XLSX"), `o motivo precisa citar o XLSX: ${reason}`);
});

check("TELA: um cronograma em ERRO nao bloqueia a consulta quando ha contrato PRONTO", () => {
  const base = {
    id: "item-1",
    fileName: "obra.mpp",
    kind: "CRONOGRAMA_BASELINE",
    sizeBytes: 10,
    status: "ERRO",
    uploadPercent: 0,
    documentId: null,
    documentVersionId: null,
    versionLabel: null,
    pageCount: null,
    characterCount: null,
    message: null,
    pendingDecision: null,
    hydrated: false,
  };

  const comContrato = [
    base,
    { ...base, id: "item-2", fileName: "minuta.pdf", kind: "CONTRATO_BASE", status: "PRONTO", characterCount: 5000 },
  ];

  assert(precontractQueryBlockReason(comContrato) === null, "o contrato lido libera a consulta");
});

// --- 7. Upload: recusa antes de qualquer byte ------------------------

function makeUploadDeps(overrides = {}) {
  const calls = { transport: [], register: [], verify: [] };
  let idCounter = 0;

  const deps = {
    transport: async (request) => {
      calls.transport.push(request.path ?? "upload");
      request.onProgress(100);
    },
    computeSha256: async () => "a".repeat(64),
    getSession: async () => ({ accessToken: "token-de-teste", userEmail: "quem@axion.com.br" }),
    storageBaseUrl: "https://exemplo.supabase.co",
    newId: () => `id-${++idCounter}`,
    registerUpload: async (args) => {
      calls.register.push(args);
      return { error: null };
    },
    removeStorageObject: async () => ({ error: null }),
    verifyDocument: async () => ({
      ok: true,
      status: "PRONTO",
      pageCount: null,
      characterCount: 900,
      message: null,
    }),
    ...overrides,
  };

  return { deps, calls };
}

await checkAsync("UPLOAD: .mpp e recusado ANTES de qualquer byte sair do navegador", async () => {
  const { deps, calls } = makeUploadDeps();
  const patches = [];

  const outcome = await runPrecontractUpload(deps, {
    projectId: PROJECT_A,
    file: new Blob(["binario"], { type: "application/vnd.ms-project" }),
    fileName: "obra.mpp",
    fileSize: 7,
    mimeType: "application/vnd.ms-project",
    kind: "CRONOGRAMA_BASELINE",
    existingDocuments: [],
    batchHashIndex: new Map(),
    itemId: "item-1",
    onPatch: (patch) => patches.push(patch),
  });

  assert(outcome.status === "ERRO", `esperado ERRO, veio ${outcome.status}`);
  assert(calls.transport.length === 0, "nenhum byte pode ter sido enviado");
  assert(calls.register.length === 0, "nada pode ter sido registrado no banco");

  const message = patches.map((patch) => patch.message).filter(Boolean).join(" ");
  assert(message.includes(".xlsx"), `a instrucao de exportacao precisa chegar a tela: ${message}`);
});

await checkAsync("UPLOAD: .xlsx passa pelo pipeline completo e termina PRONTO", async () => {
  const { deps, calls } = makeUploadDeps();
  const patches = [];

  const outcome = await runPrecontractUpload(deps, {
    projectId: PROJECT_A,
    file: new Blob(["planilha"], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    fileName: "cronograma.xlsx",
    fileSize: 8,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    kind: "CRONOGRAMA_BASELINE",
    existingDocuments: [],
    batchHashIndex: new Map(),
    itemId: "item-1",
    onPatch: (patch) => patches.push(patch),
  });

  assert(outcome.status === "PRONTO", `esperado PRONTO, veio ${outcome.status}`);
  assert(calls.register.length === 1, "o cronograma precisa ser registrado como qualquer documento");
  assert(
    calls.register[0].p_kind === "CRONOGRAMA_BASELINE",
    `tipo documental perdido: ${calls.register[0].p_kind}`
  );
  assert(calls.register[0].p_file_path.startsWith(`${PROJECT_A}/`), "o path precisa comecar pelo projectId");
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");
console.log("");

process.exit(failed === 0 ? 0 : 1);
