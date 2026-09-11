// Testes COMPORTAMENTAIS do pipeline de upload da analise juridica
// pre-contratual e do provider estruturado.
//
// Tudo com stubs em memoria e fixtures locais: zero rede, zero Supabase,
// zero Anthropic. O transporte de upload e injetado (ver
// lib/legal/precontract-upload-transport.ts), entao progresso, timeout,
// cancelamento e HTTP nao-2xx sao exercitados de verdade.
//
// Uso:
//   node scripts/test-precontract-legal-upload-pipeline.mjs

import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const { runPrecontractUpload } = await import("../apps/web/lib/legal/run-precontract-upload");
const { UploadTransportError, UPLOAD_FAILURE_MESSAGES } = await import(
  "../apps/web/lib/legal/precontract-upload-transport"
);
const { planContractualBudget, MIN_USEFUL_CHARS } = await import(
  "../apps/web/lib/legal/precontract-context-budget"
);
const {
  hydrateItemsFromExisting,
  hasReadyPrecontractDocument,
  precontractQueryBlockReason,
} = await import("../apps/web/lib/legal/precontract-document-state");
const { toPrecontractExistingDocuments, toClassificationSnapshots } = await import(
  "../apps/web/lib/legal/precontract-existing-documents"
);
const { findMissingRequiredFields, findSchemaViolations } = await import(
  "../apps/web/lib/ai/providers/anthropic-provider"
);
const { extractDocumentText, resolveStandardFontDataUrl } = await import(
  "../apps/web/lib/documents/extraction/extract-document-text"
);
const {
  xhrUploadTransport,
  uploadTimeoutForSize,
  MIN_UPLOAD_TIMEOUT_MS,
  MAX_UPLOAD_TIMEOUT_MS,
  MIN_UPLOAD_BYTES_PER_SECOND,
} = await import("../apps/web/lib/legal/precontract-upload-transport");
const { createAnthropicAiProvider } = await import("../apps/web/lib/ai/providers/anthropic-provider");
const { validateExpertQueryResponse } = await import("../apps/web/lib/ai/query/validate-expert-query-response");
const { loadPrecontractDocumentTexts } = await import(
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

function assertThrows(fn, ErrorClass, message) {
  try {
    fn();
  } catch (error) {
    if (ErrorClass && !(error instanceof ErrorClass)) {
      throw new Error(`${message ?? "esperado throw"} - tipo inesperado: ${error.constructor.name}`);
    }
    return error;
  }
  throw new Error(message ?? "esperado throw, mas nao lancou");
}

const PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// --- Fabrica de dependencias injetadas -------------------------------
function makeDeps(overrides = {}) {
  const calls = { register: [], remove: [], verify: [], progress: [] };
  let idCounter = 0;

  const deps = {
    transport: async (request) => {
      request.onProgress(25);
      request.onProgress(60);
      calls.progress.push(25, 60);
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
    removeStorageObject: async (paths) => {
      calls.remove.push(...paths);
      return { error: null };
    },
    verifyDocument: async (projectId, documentVersionId) => {
      calls.verify.push({ projectId, documentVersionId });
      return { ok: true, status: "PRONTO", pageCount: 3, characterCount: 5000, message: null };
    },
    ...overrides,
  };

  return { deps, calls };
}

function makeParams(overrides = {}) {
  const patches = [];
  return {
    patches,
    params: {
      projectId: PROJECT,
      file: new Blob(["conteudo"], { type: "text/plain" }),
      fileName: "minuta.txt",
      fileSize: 8,
      mimeType: "text/plain",
      kind: "CONTRATO_BASE",
      existingDocuments: [],
      batchHashIndex: new Map(),
      itemId: "item-1",
      onPatch: (patch) => patches.push(patch),
      ...overrides,
    },
  };
}

console.log("");
console.log("======================================");
console.log("UPLOAD PRE-CONTRATUAL + STRUCTURED OUTPUT");
console.log("======================================");
console.log("");

// --- 1. Caminho feliz, hash e RPC ------------------------------------

await checkAsync("PIPELINE: envia, registra com SHA-256 real e so fica PRONTO apos verificacao", async () => {
  const { deps, calls } = makeDeps();
  const { params, patches } = makeParams();

  const outcome = await runPrecontractUpload(deps, params);

  assert(outcome.status === "PRONTO", `esperado PRONTO, veio ${outcome.status}`);
  assert(calls.register.length === 1, "a RPC deveria ter sido chamada uma vez");

  const args = calls.register[0];
  assert(args.p_sha256_hash === "a".repeat(64), "o hash real precisa ir a RPC");
  assert(args.p_sha256_hash !== null, "p_sha256_hash nunca pode ser null");
  assert(args.p_kind === "CONTRATO_BASE", "tipo documental preservado");
  assert(args.p_version_label === "1.0", "documento novo comeca em 1.0");
  assert(args.p_file_path.startsWith(`${PROJECT}/`), "path precisa comecar pelo projectId");
  assert(calls.verify.length === 1, "a verificacao server-side deveria rodar");

  const statuses = patches.filter((patch) => patch.status).map((patch) => patch.status);
  assert(statuses.includes("ENVIANDO"), "faltou ENVIANDO");
  assert(statuses.includes("PROCESSANDO"), "faltou PROCESSANDO");
  assert(statuses.indexOf("PROCESSANDO") < statuses.indexOf("PRONTO"), "PROCESSANDO precede PRONTO");
});

await checkAsync("PROGRESSO: o percentual real do transporte chega a UI", async () => {
  const { deps } = makeDeps();
  const { params, patches } = makeParams();

  await runPrecontractUpload(deps, params);

  const percents = patches.filter((p) => typeof p.uploadPercent === "number").map((p) => p.uploadPercent);
  assert(percents.includes(25) && percents.includes(60), `progresso incremental ausente: ${percents}`);
  assert(percents[percents.length - 1] === 100, "deveria terminar em 100");
});

// --- 2. Deduplicacao e nova versao -----------------------------------

await checkAsync("DEDUP: arquivo identico ja existente vira DUPLICADO e nao sobe", async () => {
  const { deps, calls } = makeDeps();
  let uploaded = false;
  deps.transport = async () => {
    uploaded = true;
  };

  const { params } = makeParams({
    existingDocuments: [
      {
        documentId: "doc-1",
        title: "Minuta",
        kind: "CONTRATO_BASE",
        versions: [{ sha256Hash: "a".repeat(64) }],
        nextVersionIndex: 2,
      },
    ],
  });

  const outcome = await runPrecontractUpload(deps, params);

  assert(outcome.status === "DUPLICADO", `esperado DUPLICADO, veio ${outcome.status}`);
  assert(uploaded === false, "arquivo duplicado nunca deve ser enviado");
  assert(calls.register.length === 0, "duplicado nunca registra");
});

await checkAsync("NOVA VERSAO: exige confirmacao humana antes de qualquer envio", async () => {
  const { deps, calls } = makeDeps();
  let uploaded = false;
  deps.transport = async () => {
    uploaded = true;
  };

  const { params, patches } = makeParams({
    fileName: "minuta.txt",
    existingDocuments: [
      {
        documentId: "doc-1",
        title: "Minuta",
        kind: "CONTRATO_BASE",
        versions: [{ sha256Hash: "b".repeat(64) }],
        nextVersionIndex: 2,
      },
    ],
  });

  const outcome = await runPrecontractUpload(deps, params);

  assert(outcome.status === "AGUARDANDO_DECISAO", `esperado AGUARDANDO_DECISAO, veio ${outcome.status}`);
  assert(uploaded === false, "nada sobe antes da decisao humana");
  assert(calls.register.length === 0, "nada registra antes da decisao humana");

  const decision = patches.find((patch) => patch.pendingDecision)?.pendingDecision;
  assert(decision?.classification === "NOVA_VERSAO");
  assert(decision?.matchedDocumentTitle === "Minuta");
});

await checkAsync("NOVA VERSAO: confirmada, reaproveita o documento e usa version_label correto", async () => {
  const { deps, calls } = makeDeps();
  const { params } = makeParams({
    fileName: "minuta.txt",
    decision: "NOVA_VERSAO",
    existingDocuments: [
      {
        documentId: "doc-1",
        title: "Minuta",
        kind: "CONTRATO_BASE",
        versions: [{ sha256Hash: "b".repeat(64) }],
        nextVersionIndex: 3,
      },
    ],
  });

  const outcome = await runPrecontractUpload(deps, params);

  assert(outcome.status === "PRONTO");
  const args = calls.register[0];
  assert(args.p_document_id === "doc-1", "nova versao reaproveita o documentId existente");
  assert(args.p_version_label === "3.0", `esperado 3.0, veio ${args.p_version_label}`);
  assert(args.p_title === "Minuta", "nova versao mantem o titulo do documento");
  assert(args.p_document_version_id !== "doc-1", "a versao sempre ganha id novo (caminho imutavel)");
});

await checkAsync("DOCUMENTO SEPARADO: confirmado, cria documento novo em 1.0", async () => {
  const { deps, calls } = makeDeps();
  const { params } = makeParams({
    fileName: "minuta.txt",
    decision: "DOCUMENTO_SEPARADO",
    existingDocuments: [
      {
        documentId: "doc-1",
        title: "Minuta",
        kind: "CONTRATO_BASE",
        versions: [{ sha256Hash: "b".repeat(64) }],
        nextVersionIndex: 3,
      },
    ],
  });

  await runPrecontractUpload(deps, params);

  const args = calls.register[0];
  assert(args.p_document_id !== "doc-1", "documento separado nunca reaproveita o id");
  assert(args.p_version_label === "1.0");
});

// --- 3. Falhas de transporte e limpeza de orfao ----------------------

const TRANSPORT_FAILURES = [
  ["TIMEOUT", "TIMEOUT"],
  ["CANCELADO", "CANCELADO"],
  ["REDE", "REDE"],
  ["HTTP", "HTTP"],
];

for (const [label, kind] of TRANSPORT_FAILURES) {
  await checkAsync(`TRANSPORTE: ${label} vira ERRO com mensagem segura e limpa o orfao`, async () => {
    const { deps, calls } = makeDeps();
    deps.transport = async () => {
      throw new UploadTransportError(kind, UPLOAD_FAILURE_MESSAGES[kind], kind === "HTTP" ? 413 : null);
    };

    const { params, patches } = makeParams();
    const outcome = await runPrecontractUpload(deps, params);

    assert(outcome.status === "ERRO", `esperado ERRO, veio ${outcome.status}`);
    assert(calls.register.length === 0, "falha de envio nunca registra documento");
    assert(calls.remove.length === 1, "o objeto do Storage precisa ser removido");
    assert(calls.remove[0].startsWith(`${PROJECT}/`), "removeu o path certo");

    const message = patches.filter((p) => p.message).pop()?.message;
    assert(message === UPLOAD_FAILURE_MESSAGES[kind], `mensagem inesperada: ${message}`);
    assert(!/\d{3}\b/.test(message ?? "") || kind !== "HTTP", "status HTTP cru nunca vai a UI");
  });
}

await checkAsync("TRANSPORTE: resposta invalida (erro nao tipado) tambem limpa e usa mensagem segura", async () => {
  const { deps, calls } = makeDeps();
  deps.transport = async () => {
    throw new Error("SyntaxError: Unexpected token < in JSON at position 0");
  };

  const { params, patches } = makeParams();
  const outcome = await runPrecontractUpload(deps, params);

  assert(outcome.status === "ERRO");
  assert(calls.remove.length === 1, "orfao removido");
  const message = patches.filter((p) => p.message).pop()?.message;
  assert(message === UPLOAD_FAILURE_MESSAGES.RESPOSTA_INVALIDA, `mensagem inesperada: ${message}`);
  assert(!message.includes("SyntaxError"), "detalhe tecnico nunca chega a UI");
});

await checkAsync("RPC FALHOU: o objeto do Storage e removido (nunca fica orfao)", async () => {
  const { deps, calls } = makeDeps({
    registerUpload: async () => ({ error: { message: 'duplicate key value violates unique constraint "documents_pkey"' } }),
  });

  const { params, patches } = makeParams();
  const outcome = await runPrecontractUpload(deps, params);

  assert(outcome.status === "ERRO", `esperado ERRO, veio ${outcome.status}`);
  assert(calls.remove.length === 1, "o objeto precisa ser removido apos falha da RPC");
  assert(calls.remove[0] === outcome.storagePath, "removeu exatamente o path enviado");
  assert(calls.verify.length === 0, "nunca verifica um documento que nao foi registrado");

  const message = patches.filter((p) => p.message).pop()?.message;
  assert(!message.includes("documents_pkey"), "erro cru do Postgres nunca chega a UI");
});

await checkAsync("RPC FALHOU e limpeza tambem: erro de reconciliacao e propagado, nunca engolido", async () => {
  const { deps } = makeDeps({
    registerUpload: async () => ({ error: { message: "falha qualquer" } }),
    removeStorageObject: async () => ({ error: { message: "storage indisponivel" } }),
  });

  const { params } = makeParams();
  const outcome = await runPrecontractUpload(deps, params);

  assert(outcome.status === "ERRO");
  assert(typeof outcome.reconciliationError === "string" && outcome.reconciliationError.length > 0,
    "reconciliationError deveria ser preenchido");
  assert(outcome.reconciliationError.includes("orfao") || outcome.reconciliationError.includes("órfão"),
    `mensagem de reconciliacao inesperada: ${outcome.reconciliationError}`);
});

await checkAsync("FORMATO: arquivo nao suportado e recusado antes de qualquer byte sair", async () => {
  const { deps, calls } = makeDeps();
  let uploaded = false;
  deps.transport = async () => {
    uploaded = true;
  };

  const { params } = makeParams({ fileName: "foto.png", mimeType: "image/png" });
  const outcome = await runPrecontractUpload(deps, params);

  assert(outcome.status === "ERRO");
  assert(uploaded === false, "nada sobe com formato nao suportado");
  assert(calls.register.length === 0);
});

await checkAsync("SESSAO: sem sessao valida, nada e enviado nem registrado", async () => {
  const { deps, calls } = makeDeps({ getSession: async () => null });
  let uploaded = false;
  deps.transport = async () => {
    uploaded = true;
  };

  const { params } = makeParams();
  const outcome = await runPrecontractUpload(deps, params);

  assert(outcome.status === "ERRO");
  assert(uploaded === false && calls.register.length === 0);
});

// --- 4. Hidratacao / reload ------------------------------------------

check("RELOAD: documentos do servidor entram como PROCESSANDO, nunca PRONTO direto", () => {
  const items = hydrateItemsFromExisting([
    {
      documentId: "doc-1",
      documentVersionId: "ver-1",
      title: "Minuta Alfa",
      kind: "CONTRATO_BASE",
      versionLabel: "1.0",
      fileName: "minuta.pdf",
      sizeBytes: 1234,
    },
  ]);

  assert(items.length === 1);
  assert(items[0].status === "PROCESSANDO", "hidratado nunca nasce PRONTO — so o servidor promove");
  assert(items[0].uploadPercent === 100, "o arquivo ja esta enviado");
  assert(items[0].hydrated === true);
  assert(items[0].documentVersionId === "ver-1");
  assert(hasReadyPrecontractDocument(items) === false, "consulta bloqueada enquanto verifica");
  assert(precontractQueryBlockReason(items).includes("Processando"));
});

check("RELOAD: apos verificacao bem-sucedida a consulta libera sem reenviar arquivo", () => {
  const items = hydrateItemsFromExisting([
    {
      documentId: "doc-1",
      documentVersionId: "ver-1",
      title: "Minuta Alfa",
      kind: "CONTRATO_BASE",
      versionLabel: "1.0",
      fileName: "minuta.pdf",
      sizeBytes: 1234,
    },
  ]).map((item) => ({ ...item, status: "PRONTO", characterCount: 8000 }));

  assert(hasReadyPrecontractDocument(items) === true);
  assert(precontractQueryBlockReason(items) === null, "consulta deveria estar liberada");
});

check("RELOAD: a pagina deriva os documentos existentes sem query nova", () => {
  const managed = [
    {
      id: "doc-1",
      kind: "CONTRATO_BASE",
      title: "Minuta Alfa",
      versions: [
        { id: "ver-1", versionIndex: 1, versionLabel: "1.0", originalFileName: "v1.pdf", fileSizeBytes: 10, sha256Hash: "c".repeat(64) },
        { id: "ver-2", versionIndex: 2, versionLabel: "2.0", originalFileName: "v2.pdf", fileSizeBytes: 20, sha256Hash: "d".repeat(64) },
      ],
    },
    { id: "doc-2", kind: "RELATORIO_SEMANAL", title: "Relatorio", versions: [{ id: "ver-3", versionIndex: 1, versionLabel: "1.0", originalFileName: "r.pdf", fileSizeBytes: 5, sha256Hash: "e".repeat(64) }] },
  ];

  const existing = toPrecontractExistingDocuments(managed);
  assert(existing.length === 1, "so documentos contratuais hidratam o card");
  assert(existing[0].documentVersionId === "ver-2", "hidrata a versao VIGENTE, nunca a antiga");
  assert(existing[0].versionLabel === "2.0");

  const snapshots = toClassificationSnapshots(managed);
  assert(snapshots.length === 2, "a deduplicacao considera TODOS os documentos do projeto");
  assert(snapshots[0].nextVersionIndex === 3, "proxima versao de doc-1 e 3");
});

// --- 5. Rateio de contexto -------------------------------------------

check("RATEIO: o primeiro documento nao consome o orcamento inteiro", () => {
  const plan = planContractualBudget(
    [
      { id: "a", characterCount: 200000 },
      { id: "b", characterCount: 5000 },
      { id: "c", characterCount: 5000 },
    ],
    120000
  );

  const byId = new Map(plan.allocations.map((item) => [item.id, item]));
  assert(byId.get("a").allowedCharacters < 200000, "o maior documento precisa ser cortado");
  assert(byId.get("b").allowedCharacters === 5000, "documento pequeno cabe inteiro");
  assert(byId.get("c").allowedCharacters === 5000, "documento pequeno cabe inteiro");
  assert(plan.includedCount === 3, "todos deveriam entrar");

  const total = plan.allocations.reduce((sum, item) => sum + item.allowedCharacters, 0);
  assert(total <= 120000, `orcamento estourado: ${total}`);
});

check("RATEIO: a sobra de quem precisa de pouco e redistribuida", () => {
  const plan = planContractualBudget(
    [
      { id: "grande", characterCount: 100000 },
      { id: "pequeno", characterCount: 100 },
    ],
    10000
  );

  const byId = new Map(plan.allocations.map((item) => [item.id, item]));
  assert(byId.get("pequeno").allowedCharacters === 100, "pequeno cabe inteiro");
  assert(byId.get("grande").allowedCharacters === 9900, `sobra nao redistribuida: ${byId.get("grande").allowedCharacters}`);
});

check("RATEIO: todo documento incluido recebe um trecho util (piso)", () => {
  const plan = planContractualBudget(
    Array.from({ length: 10 }, (_, index) => ({ id: `d${index}`, characterCount: 50000 })),
    10000
  );

  for (const allocation of plan.allocations.filter((item) => item.included)) {
    assert(allocation.allowedCharacters >= MIN_USEFUL_CHARS, `trecho inutil: ${allocation.allowedCharacters}`);
  }
  assert(plan.omittedCount > 0, "os que nao couberam devem ser declarados omitidos");
  assert(plan.includedCount + plan.omittedCount === 10);
});

check("RATEIO: documento com texto vazio nunca e incluido", () => {
  const plan = planContractualBudget([{ id: "vazio", characterCount: 0 }], 120000);
  assert(plan.allocations[0].included === false, "texto vazio nunca entra no contexto");
  assert(plan.includedCount === 0);
});

// --- 6. Structured output / severity ---------------------------------

const QUERY_SCHEMA = { required: ["expertId", "severity", "interpretacao"] };

check("SCHEMA: campo ausente e detectado (era a causa do erro de severity)", () => {
  const missing = findMissingRequiredFields(
    { expertId: "legal-consultant", interpretacao: "texto" },
    QUERY_SCHEMA
  );
  assert(missing.includes("severity"), `esperado severity, veio ${missing}`);
});

check("SCHEMA: campo vazio conta como ausente, e saida completa nao dispara nada", () => {
  assert(findMissingRequiredFields({ expertId: "x", severity: "   ", interpretacao: "y" }, QUERY_SCHEMA).length === 1);
  assert(findMissingRequiredFields({ expertId: "x", severity: "LOW", interpretacao: "y" }, QUERY_SCHEMA).length === 0);
  // Saida que nem e objeto vira uma violacao unica na raiz — mais util
  // para o modelo do que listar cada campo de um objeto inexistente.
  assert(findMissingRequiredFields(null, QUERY_SCHEMA)[0] === "(raiz)", "saida nao-objeto: violacao na raiz");
});

check("SCHEMA: severity NUNCA e preenchido automaticamente pelo provider", () => {
  // Guarda explicita: findMissingRequiredFields apenas RELATA. Se algum
  // dia alguem fizer o provider inventar severity, isto falha.
  const output = { expertId: "x", interpretacao: "y" };
  const antes = JSON.stringify(output);
  findMissingRequiredFields(output, QUERY_SCHEMA);
  assert(JSON.stringify(output) === antes, "o provider nunca pode mutar/preencher a saida do modelo");
});

check("SCHEMA: null e aceito quando o proprio schema admite null (nunca repete a toa)", () => {
  // rascunhoSugerido e declarado como oneOf [null, objeto]: uma resposta
  // correta SEM rascunho traz null e nao pode disparar repeticao paga.
  const schema = {
    required: ["severity", "rascunhoSugerido"],
    properties: {
      severity: { type: "string" },
      rascunhoSugerido: { oneOf: [{ type: "null" }, { type: "object" }] },
    },
  };

  assert(findMissingRequiredFields({ severity: "LOW", rascunhoSugerido: null }, schema).length === 0,
    "null valido pelo schema nunca conta como ausente");
  assert(findMissingRequiredFields({ severity: null, rascunhoSugerido: null }, schema).includes("severity"),
    "null em campo que NAO admite null continua sendo ausencia");
  assert(findMissingRequiredFields({ severity: "LOW" }, schema).includes("rascunhoSugerido"),
    "undefined e sempre ausencia, mesmo com null permitido");
});

// --- 7. Extracao de fixtures reais (PDF e DOCX) ----------------------

function buildMinimalPdf(text) {
  // PDF 1.4 minimo, valido, com um unico Tj — fixture local, sem rede.
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

await checkAsync("EXTRACAO: PDF pequeno real e lido (fixture local, sem rede)", async () => {
  const buffer = buildMinimalPdf("CLAUSULA 12.3 REAJUSTE PELO INCC");
  const result = await extractDocumentText({
    buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    mimeType: "application/pdf",
    fileName: "minuta.pdf",
  });

  assert(result.extractor === "pdfjs-dist", `extrator inesperado: ${result.extractor}`);
  assert(result.pageCount === 1, `paginas: ${result.pageCount}`);
  assert(result.text.includes("REAJUSTE"), `texto extraido: ${result.text.slice(0, 120)}`);
  assert(result.characterCount > 0);
});

await checkAsync("EXTRACAO: DOCX pequeno real e lido (fixture local, sem rede)", async () => {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  );
  zip.folder("_rels").file(
    ".rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  );
  zip.folder("word").file(
    "document.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>CLAUSULA 4.1 CONFIDENCIALIDADE</w:t></w:r></w:p></w:body></w:document>'
  );

  const nodeBuffer = await zip.generateAsync({ type: "nodebuffer" });
  const result = await extractDocumentText({
    buffer: nodeBuffer.buffer.slice(nodeBuffer.byteOffset, nodeBuffer.byteOffset + nodeBuffer.byteLength),
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fileName: "minuta.docx",
  });

  assert(result.extractor === "mammoth", `extrator inesperado: ${result.extractor}`);
  assert(result.text.includes("CONFIDENCIALIDADE"), `texto extraido: ${result.text}`);
});

// --- 8. Transporte XHR real, com XMLHttpRequest falso ----------------
// Exercita o transporte de verdade (lib/legal/precontract-upload-transport.ts),
// trocando apenas o objeto XMLHttpRequest global. Zero rede.

function installFakeXhr(behaviour) {
  const instances = [];

  class FakeXhr {
    constructor() {
      this.upload = {};
      this.headers = {};
      this.status = 0;
      this.responseText = "";
      this.timeout = 0;
      this.aborted = false;
      instances.push(this);
    }
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(name, value) {
      this.headers[name] = value;
    }
    abort() {
      this.aborted = true;
      this.onabort?.();
    }
    send(body) {
      this.body = body;
      behaviour(this);
    }
  }

  const original = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = FakeXhr;
  return {
    instances,
    restore: () => {
      globalThis.XMLHttpRequest = original;
    },
  };
}

async function withFakeXhr(behaviour, run) {
  const fake = installFakeXhr(behaviour);
  try {
    return await run(fake);
  } finally {
    fake.restore();
  }
}

function transportRequest(overrides = {}) {
  return {
    url: "https://exemplo.supabase.co/storage/v1/object/project-documents/p/d/v/a.txt",
    accessToken: "token-de-teste",
    body: new Blob(["x"]),
    contentType: "text/plain",
    timeoutMs: 1000,
    onProgress: () => {},
    ...overrides,
  };
}

await checkAsync("XHR: metodo, headers e progresso incremental reais", async () => {
  const percents = [];

  await withFakeXhr(
    (xhr) => {
      xhr.upload.onprogress?.({ lengthComputable: true, loaded: 30, total: 100 });
      xhr.upload.onprogress?.({ lengthComputable: true, loaded: 90, total: 100 });
      xhr.status = 200;
      xhr.onload();
    },
    async (fake) => {
      await xhrUploadTransport(transportRequest({ onProgress: (p) => percents.push(p) }));

      const xhr = fake.instances[0];
      assert(xhr.method === "POST", `metodo: ${xhr.method}`);
      assert(xhr.headers.Authorization === "Bearer token-de-teste", "Authorization com o token da sessao");
      assert(xhr.headers["x-upsert"] === "false", "x-upsert precisa ser false (caminho imutavel)");
      assert(xhr.headers["Content-Type"] === "text/plain");
      assert(xhr.timeout === 1000, "timeout explicito precisa ser configurado");
    }
  );

  assert(percents.includes(30) && percents.includes(90), `progresso: ${percents}`);
  assert(percents[percents.length - 1] === 100, "100% so depois do onload");
  assert(Math.max(...percents.slice(0, -1)) <= 99, "durante o envio o teto e 99%");
});

await checkAsync("XHR: timeout dispara ontimeout e vira UploadTransportError TIMEOUT", async () => {
  await withFakeXhr(
    (xhr) => xhr.ontimeout(),
    async () => {
      let captured = null;
      try {
        await xhrUploadTransport(transportRequest());
      } catch (error) {
        captured = error;
      }
      assert(captured instanceof UploadTransportError, "tipo de erro inesperado");
      assert(captured.kind === "TIMEOUT", `kind: ${captured.kind}`);
      assert(captured.message === UPLOAD_FAILURE_MESSAGES.TIMEOUT);
    }
  );
});

await checkAsync("XHR: abort() cancela de verdade e vira CANCELADO", async () => {
  await withFakeXhr(
    () => {},
    async () => {
      let abortFn = null;
      const promise = xhrUploadTransport(
        transportRequest({ onAbortHandle: (abort) => (abortFn = abort) })
      );

      assert(typeof abortFn === "function", "o transporte precisa expor o cancelamento");
      abortFn();

      let captured = null;
      try {
        await promise;
      } catch (error) {
        captured = error;
      }
      assert(captured?.kind === "CANCELADO", `kind: ${captured?.kind}`);
    }
  );
});

await checkAsync("XHR: HTTP nao-2xx vira erro seguro, sem vazar o corpo da resposta", async () => {
  await withFakeXhr(
    (xhr) => {
      xhr.status = 413;
      xhr.responseText = '{"error":"Payload too large","bucket":"project-documents"}';
      xhr.onload();
    },
    async () => {
      let captured = null;
      try {
        await xhrUploadTransport(transportRequest());
      } catch (error) {
        captured = error;
      }
      assert(captured?.kind === "HTTP");
      assert(captured.status === 413, "o status fica no erro para log, nunca na mensagem");
      assert(!captured.message.includes("413"), "status cru nunca vai a mensagem do usuario");
      assert(!captured.message.includes("bucket"), "nome do bucket nunca vaza");
    }
  );
});

await checkAsync("XHR: falha de rede vira REDE", async () => {
  await withFakeXhr(
    (xhr) => xhr.onerror(),
    async () => {
      let captured = null;
      try {
        await xhrUploadTransport(transportRequest());
      } catch (error) {
        captured = error;
      }
      assert(captured?.kind === "REDE");
    }
  );
});

// --- 9. Repeticao controlada do provider Anthropic -------------------

function fakeAnthropicClient(responses) {
  const calls = [];
  return {
    calls,
    messages: {
      async create(params) {
        calls.push(params);
        const next = responses[calls.length - 1];
        if (typeof next === "function") return next();
        return next;
      },
    },
  };
}

function toolUseMessage(input, usage = { input_tokens: 100, output_tokens: 50 }) {
  return {
    content: [{ type: "tool_use", name: "emit_expert_structured_output", input }],
    stop_reason: "tool_use",
    usage,
  };
}

const PROVIDER_CONFIG = { model: "claude-sonnet-5", maxTokens: 4096, timeoutMs: 5000, apiKey: "nao-usado" };

const QUERY_OUTPUT_SCHEMA = {
  type: "object",
  properties: {},
  required: ["expertId", "severity", "interpretacao"],
};

function validQueryOutput() {
  return { expertId: "commercial-director", severity: "LOW", interpretacao: "ok" };
}

await checkAsync("PROVIDER: tool-call sai com strict: true", async () => {
  const client = fakeAnthropicClient([toolUseMessage(validQueryOutput())]);
  const provider = createAnthropicAiProvider({ client, config: PROVIDER_CONFIG });

  await provider.generateAssessment({
    expertId: "commercial-director",
    expertName: "Diretor Comercial IA",
    expertVersion: "1",
    instructions: "instrucoes",
    analysisType: "GENERIC",
    context: {},
    outputSchema: QUERY_OUTPUT_SCHEMA,
  });

  const tool = client.calls[0].tools[0];
  assert(tool.strict === true, "strict: true precisa ir na tool");
  assert(tool.input_schema === QUERY_OUTPUT_SCHEMA, "o schema do Expert e usado como esta");
  assert(client.calls.length === 1, "saida valida nunca repete");
});

await checkAsync("PROVIDER: 1a resposta sem severity, 2a valida — uma unica repeticao", async () => {
  const client = fakeAnthropicClient([
    toolUseMessage({ expertId: "commercial-director", interpretacao: "ok" }, { input_tokens: 100, output_tokens: 40 }),
    toolUseMessage(validQueryOutput(), { input_tokens: 120, output_tokens: 60 }),
  ]);
  const provider = createAnthropicAiProvider({ client, config: PROVIDER_CONFIG });

  const response = await provider.generateAssessment({
    expertId: "commercial-director",
    expertName: "Diretor Comercial IA",
    expertVersion: "1",
    instructions: "instrucoes",
    analysisType: "GENERIC",
    context: {},
    outputSchema: QUERY_OUTPUT_SCHEMA,
  });

  assert(client.calls.length === 2, `esperado 2 chamadas, houve ${client.calls.length}`);
  assert(response.output.severity === "LOW", "a saida final e a da segunda tentativa");

  // Mesmo contexto autorizado reenviado + instrucao do que faltou.
  const retryContent = client.calls[1].messages[0].content;
  assert(retryContent.includes("severity"), "a repeticao precisa dizer qual campo faltou");
  assert(
    retryContent.startsWith(client.calls[0].messages[0].content),
    "a repeticao reenvia EXATAMENTE o mesmo contexto autorizado"
  );
  assert(client.calls[1].system === client.calls[0].system, "mesmo system prompt");

  // Uso acumulado das duas tentativas.
  assert(response.usage.inputTokens === 220, `inputTokens: ${response.usage.inputTokens}`);
  assert(response.usage.outputTokens === 100, `outputTokens: ${response.usage.outputTokens}`);
});

await checkAsync("PROVIDER: duas respostas sem severity — nao inventa, nao repete de novo", async () => {
  const incompleto = { expertId: "commercial-director", interpretacao: "ok" };
  const client = fakeAnthropicClient([toolUseMessage(incompleto), toolUseMessage(incompleto)]);
  const provider = createAnthropicAiProvider({ client, config: PROVIDER_CONFIG });

  const response = await provider.generateAssessment({
    expertId: "commercial-director",
    expertName: "Diretor Comercial IA",
    expertVersion: "1",
    instructions: "instrucoes",
    analysisType: "GENERIC",
    context: {},
    outputSchema: QUERY_OUTPUT_SCHEMA,
  });

  assert(client.calls.length === 2, "no maximo UMA repeticao — nunca loop");
  assert(response.output.severity === undefined, "severity nunca e inventado pelo provider");

  // Quem falha fechado e o validador TypeScript, com mensagem propria.
  assertThrows(
    () =>
      validateExpertQueryResponse(response.output, {
        expertId: "commercial-director",
        expertName: "Diretor Comercial IA",
        expertVersion: "1",
        scope: "PROJECT",
      }),
    undefined,
    "o validador deveria rejeitar a saida incompleta"
  );
});

const NAO_REPETIVEIS = [
  ["autenticacao (401)", Object.assign(new Error("invalid api key"), { status: 401 })],
  ["rate limit (429)", Object.assign(new Error("rate limited"), { status: 429 })],
  ["rede", Object.assign(new Error("fetch failed"), { name: "FetchError" })],
  ["timeout", Object.assign(new Error("timeout"), { name: "AxionTimeoutError" })],
];

for (const [label, erro] of NAO_REPETIVEIS) {
  await checkAsync(`PROVIDER: erro de ${label} NAO e repetido`, async () => {
    const client = fakeAnthropicClient([
      () => {
        throw erro;
      },
      toolUseMessage(validQueryOutput()),
    ]);
    const provider = createAnthropicAiProvider({ client, config: PROVIDER_CONFIG });

    let lancou = false;
    try {
      await provider.generateAssessment({
        expertId: "commercial-director",
        expertName: "Diretor Comercial IA",
        expertVersion: "1",
        instructions: "instrucoes",
        analysisType: "GENERIC",
        context: {},
        outputSchema: QUERY_OUTPUT_SCHEMA,
      });
    } catch {
      lancou = true;
    }

    assert(lancou, "deveria lancar");
    assert(client.calls.length === 1, `nenhuma repeticao esperada, houve ${client.calls.length} chamadas`);
  });
}

// --- 10. Fontes padrao do PDF ---------------------------------------

check("FONTES: standardFontDataUrl e resolvido a partir do cwd, sem caminho de maquina", () => {
  const url = resolveStandardFontDataUrl();
  assert(typeof url === "string" && url.length > 0, "deveria encontrar o diretorio das fontes padrao");
  assert(url.includes("pdfjs-dist"), `caminho inesperado: ${url}`);
  assert(url.endsWith("/") || url.endsWith("\\"), "o pdfjs concatena o nome do arquivo: barra final obrigatoria");
  // Nao pode ser um caminho cravado no codigo: tem de sair do cwd atual.
  // Normaliza as barras: no Windows o cwd usa "\\" e a URL do pdfjs usa "/".
  const cwdNormalizado = process.cwd().split("\\").join("/");
  assert(url.startsWith(cwdNormalizado), `o caminho precisa derivar de process.cwd(): ${url}`);
});

await checkAsync("FONTES: PDF com fonte padrao nao embutida extrai texto E nao emite o aviso", async () => {
  // Helvetica declarada sem FontFile: o pdfjs precisa das base-14. Era
  // exatamente este caso que produzia
  // "Ensure that the `standardFontDataUrl` API parameter is provided".
  const buffer = buildMinimalPdf("CLAUSULA 7.2 GARANTIA CONTRATUAL");

  const capturado = [];
  const originais = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...args) => capturado.push(args.join(" "));
  console.warn = (...args) => capturado.push(args.join(" "));
  console.error = (...args) => capturado.push(args.join(" "));

  let result;
  try {
    result = await extractDocumentText({
      buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      mimeType: "application/pdf",
      fileName: "garantia.pdf",
    });
  } finally {
    console.log = originais.log;
    console.warn = originais.warn;
    console.error = originais.error;
  }

  assert(result.text.includes("GARANTIA"), `texto extraido: ${result.text.slice(0, 120)}`);
  assert(result.pageCount === 1);

  const aviso = capturado.find((linha) => linha.includes("standardFontDataUrl"));
  assert(aviso === undefined, `o aviso ainda aparece: ${aviso}`);
});

// --- 11. Timeout proporcional ao tamanho ------------------------------

check("TIMEOUT: arquivo pequeno usa o minimo de 120 s", () => {
  assert(uploadTimeoutForSize(1024) === MIN_UPLOAD_TIMEOUT_MS, "1 KB deve usar o piso");
  assert(uploadTimeoutForSize(0) === MIN_UPLOAD_TIMEOUT_MS, "tamanho zero cai no piso");
  assert(uploadTimeoutForSize(Number.NaN) === MIN_UPLOAD_TIMEOUT_MS, "tamanho invalido cai no piso");
  // 7 MB / 64 KB/s = ~112 s, ainda abaixo do piso.
  assert(uploadTimeoutForSize(7 * 1024 * 1024) === MIN_UPLOAD_TIMEOUT_MS);
});

check("TIMEOUT: arquivo grande recebe timeout proporcional (64 KB/s)", () => {
  const vinteMb = 20 * 1024 * 1024;
  const esperado = Math.ceil((vinteMb / MIN_UPLOAD_BYTES_PER_SECOND) * 1000);

  assert(uploadTimeoutForSize(vinteMb) === esperado, `esperado ${esperado}, veio ${uploadTimeoutForSize(vinteMb)}`);
  assert(esperado > MIN_UPLOAD_TIMEOUT_MS, "20 MB precisa de mais que o piso");
  assert(esperado < MAX_UPLOAD_TIMEOUT_MS, "20 MB ainda cabe abaixo do teto");

  // 50 MB e o teto do bucket: precisa caber dentro do teto de 15 min.
  const cinquentaMb = 50 * 1024 * 1024;
  assert(uploadTimeoutForSize(cinquentaMb) === MAX_UPLOAD_TIMEOUT_MS || uploadTimeoutForSize(cinquentaMb) < MAX_UPLOAD_TIMEOUT_MS);
});

check("TIMEOUT: teto de 15 minutos nunca e ultrapassado", () => {
  assert(MAX_UPLOAD_TIMEOUT_MS === 900000, "o teto precisa ser 15 min");
  assert(uploadTimeoutForSize(500 * 1024 * 1024) === MAX_UPLOAD_TIMEOUT_MS, "arquivo enorme grampeia no teto");
  assert(uploadTimeoutForSize(Number.MAX_SAFE_INTEGER) === MAX_UPLOAD_TIMEOUT_MS);
});

await checkAsync("TIMEOUT: o pipeline repassa o timeout calculado ao transporte", async () => {
  const vistos = [];
  const { deps } = makeDeps({
    transport: async (request) => {
      vistos.push(request.timeoutMs);
      request.onProgress(100);
    },
  });

  const grande = 20 * 1024 * 1024;
  const { params } = makeParams({ fileSize: grande });
  await runPrecontractUpload(deps, params);

  assert(vistos[0] === uploadTimeoutForSize(grande), `timeout repassado: ${vistos[0]}`);
  assert(vistos[0] > MIN_UPLOAD_TIMEOUT_MS, "arquivo grande precisa de mais tempo que o piso");
});

// --- 12. Deteccao estrutural que decide a repeticao -------------------

const SCHEMA_COMPLETO = {
  required: ["expertId", "severity", "riscos", "rascunhoSugerido", "requiresHumanReview", "grounding"],
  properties: {
    expertId: { type: "string" },
    severity: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
    riscos: { type: "array", items: { type: "string" }, minItems: 1 },
    rascunhoSugerido: {
      oneOf: [{ type: "null" }, { type: "object", required: ["type", "body"] }],
    },
    requiresHumanReview: { const: true },
    grounding: { type: "object", required: ["performed"] },
  },
};

function baseOutput(overrides = {}) {
  return {
    expertId: "legal-consultant",
    severity: "LOW",
    riscos: ["um risco"],
    rascunhoSugerido: null,
    requiresHumanReview: true,
    grounding: { performed: true },
    ...overrides,
  };
}

const CASOS_ESTRUTURAIS = [
  ["required ausente", { expertId: undefined }, "expertId", "ausente"],
  ["string vazia proibida", { expertId: "   " }, "expertId", "string vazia"],
  ["tipo incorreto", { riscos: "nao e array" }, "riscos", "tipo inválido"],
  ["enum invalido", { severity: "GRAVISSIMO" }, "severity", "fora do conjunto"],
  ["array abaixo de minItems", { riscos: [] }, "riscos", "menos de 1"],
  ["objeto incompleto", { grounding: {} }, "grounding", "objeto incompleto"],
  ["null onde nao e permitido", { severity: null }, "severity", "null não permitido"],
  ["const violado", { requiresHumanReview: false }, "requiresHumanReview", "exatamente true"],
];

for (const [label, override, campo, fragmento] of CASOS_ESTRUTURAIS) {
  check(`SCHEMA: ${label} e detectado como violacao reparavel`, () => {
    const output = baseOutput(override);
    if (override.expertId === undefined && "expertId" in override) delete output.expertId;

    const violations = findSchemaViolations(output, SCHEMA_COMPLETO);
    const encontrada = violations.find((violation) => violation.field === campo);

    assert(encontrada !== undefined, `nao detectou violacao em ${campo}: ${JSON.stringify(violations)}`);
    assert(
      encontrada.problem.includes(fragmento),
      `problema inesperado para ${campo}: "${encontrada.problem}" (esperava conter "${fragmento}")`
    );
  });
}

check("SCHEMA: saida completa e valida nao produz violacao nenhuma", () => {
  assert(findSchemaViolations(baseOutput(), SCHEMA_COMPLETO).length === 0);
  // null permitido pelo oneOf continua valido.
  assert(findSchemaViolations(baseOutput({ rascunhoSugerido: null }), SCHEMA_COMPLETO).length === 0);
  // objeto completo na variante nao-nula tambem.
  assert(
    findSchemaViolations(baseOutput({ rascunhoSugerido: { type: "EMAIL", body: "x" } }), SCHEMA_COMPLETO).length === 0
  );
});

check("SCHEMA: saida que nao e objeto e reportada na raiz", () => {
  const violations = findSchemaViolations("texto livre", SCHEMA_COMPLETO);
  assert(violations.length === 1 && violations[0].field === "(raiz)");
});

check("SCHEMA: a checagem NAO se apresenta como validador completo de JSON Schema", () => {
  // Limites declarados: aninhamento profundo nao e checado, e isso e
  // deliberado — quem decide a aceitacao e o validador TypeScript final.
  const schemaProfundo = {
    required: ["a"],
    properties: { a: { type: "object", required: ["b"], properties: { b: { type: "object", required: ["c"] } } } },
  };
  const violations = findSchemaViolations({ a: { b: {} } }, schemaProfundo);
  assert(violations.length === 0, "nivel 2+ nao e checado — e o comportamento documentado");
});

await checkAsync("SCHEMA: max_tokens LANCA e nunca vira repeticao", async () => {
  const client = fakeAnthropicClient([
    { content: [], stop_reason: "max_tokens", usage: { input_tokens: 10, output_tokens: 4096 } },
    toolUseMessage(validQueryOutput()),
  ]);
  const provider = createAnthropicAiProvider({ client, config: PROVIDER_CONFIG });

  let mensagem = "";
  try {
    await provider.generateAssessment({
      expertId: "commercial-director",
      expertName: "Diretor Comercial IA",
      expertVersion: "1",
      instructions: "instrucoes",
      analysisType: "GENERIC",
      context: {},
      outputSchema: QUERY_OUTPUT_SCHEMA,
    });
  } catch (error) {
    mensagem = error.message;
  }

  assert(mensagem.includes("truncada") || mensagem.includes("max_tokens"), `mensagem: ${mensagem}`);
  assert(client.calls.length === 1, "resposta truncada nunca e repetida");
});

await checkAsync("SCHEMA: tool-use ausente LANCA e nunca vira repeticao", async () => {
  const client = fakeAnthropicClient([
    { content: [{ type: "text", text: "resposta em texto livre" }], stop_reason: "end_turn" },
    toolUseMessage(validQueryOutput()),
  ]);
  const provider = createAnthropicAiProvider({ client, config: PROVIDER_CONFIG });

  let lancou = false;
  try {
    await provider.generateAssessment({
      expertId: "commercial-director",
      expertName: "Diretor Comercial IA",
      expertVersion: "1",
      instructions: "instrucoes",
      analysisType: "GENERIC",
      context: {},
      outputSchema: QUERY_OUTPUT_SCHEMA,
    });
  } catch {
    lancou = true;
  }

  assert(lancou, "deveria lancar");
  assert(client.calls.length === 1, "tool-use ausente nunca e repetido");
});

// --- 13. Colunas reais de document_versions (regressao 42703) --------
//
// O Preview do PR #54 falhou com:
//   column document_versions.storage_path does not exist
// Os tres fluxos juridicos consultavam `storage_path`, que existe em
// email_attachments/contract_attachments mas NAO em document_versions —
// la os nomes sao `file_path` e `storage_bucket`.
//
// Os stubs nao pegaram porque as fixtures repetiam a mesma suposicao
// errada do codigo: um stub que espelha a crenca do autor testa o autor
// contra ele mesmo. Por isso, alem do comportamento, a guarda abaixo
// inspeciona os SELECTs literais dos tres fluxos.

const { readFileSync } = await import("node:fs");
const { fileURLToPath } = await import("node:url");
const nodePath = await import("node:path");
const repoRoot = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (relativePath) => readFileSync(nodePath.join(repoRoot, relativePath), "utf8");

const FLUXOS_JURIDICOS = [
  "apps/web/lib/documents/extraction/load-precontract-document-texts.ts",
  "apps/web/lib/legal/precontract-document-verify-action.ts",
];

/** Extrai os SELECTs literais que consultam document_versions. */
function selectsDeDocumentVersions(source) {
  const selects = [];
  const regex = /\.select\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g;
  let match;
  while ((match = regex.exec(source)) !== null) {
    const literal = match[1].slice(1, -1);
    if (literal.includes("document_id") || literal.includes("version_index")) selects.push(literal);
  }
  return selects;
}

for (const relativePath of FLUXOS_JURIDICOS) {
  check(`COLUNAS: ${nodePath.basename(relativePath)} nunca consulta storage_path em document_versions`, () => {
    const source = readSource(relativePath);

    // O nome errado nao pode aparecer em SELECT nem em acesso de campo.
    const usos = source.match(/\bstorage_path\b/g) ?? [];
    const emComentario = (source.match(/\/\/[^\n]*\bstorage_path\b/g) ?? []).length;
    assert(
      usos.length === emComentario,
      `storage_path usado fora de comentario em ${relativePath} (${usos.length} ocorrencia(s), ${emComentario} em comentario)`
    );

    const selects = selectsDeDocumentVersions(source);
    assert(selects.length > 0, `nenhum SELECT de document_versions encontrado em ${relativePath}`);

    for (const select of selects) {
      assert(!select.includes("storage_path"), `SELECT com coluna inexistente: ${select}`);
      assert(select.includes("file_path"), `SELECT sem file_path: ${select}`);
      assert(select.includes("storage_bucket"), `SELECT sem storage_bucket: ${select}`);
    }
  });
}

check("COLUNAS: os nomes usados batem com os do codigo pre-existente e do worker offline", () => {
  // Fontes de verdade independentes do meu codigo: o mapeamento que ja
  // existia antes desta feature e o script que processa versoes.
  const documentManagement = readSource("apps/web/lib/document-management.ts");
  const worker = readSource("scripts/process-document-version.mjs");

  assert(documentManagement.includes("version.file_path"), "document-management le file_path");
  assert(documentManagement.includes("version.storage_bucket"), "document-management le storage_bucket");
  assert(worker.includes("file_path"), "o worker offline usa file_path");
  assert(worker.includes("storage_bucket"), "o worker offline usa storage_bucket");
});

await checkAsync("COLUNAS: o download usa o bucket REGISTRADO NA VERSAO, nunca uma constante presumida", async () => {
  const bucketsUsados = [];
  const caminho = `${PROJECT}/doc-b/ver-b/minuta.txt`;

  const supabase = {
    from() {
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        is: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (resolve) => Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return builder;
    },
    storage: {
      from(bucket) {
        bucketsUsados.push(bucket);
        return { download: () => Promise.resolve({ data: null, error: { message: "nao usado" } }) };
      },
    },
  };

  // Exercita o loader com um projeto sem documentos: o que importa aqui e
  // que a assinatura exige (bucket, path) e nao um bucket fixo.
  const resultado = await loadPrecontractDocumentTexts(supabase, { projectId: PROJECT });
  assert(resultado.documents.length === 0 && resultado.availableCount === 0);

  const fonte = readSource("apps/web/lib/documents/extraction/load-precontract-document-texts.ts");
  assert(
    /\.from\(\s*bucket\s*\)/.test(fonte),
    "o download precisa usar o bucket recebido da linha, nao uma constante"
  );
  assert(
    /version\.storage_bucket/.test(fonte),
    "o bucket precisa vir de version.storage_bucket"
  );
  assert(caminho.startsWith(`${PROJECT}/`), "sanity check do proprio teste");
});

check("COLUNAS: bucket ausente ou diferente do autorizado e recusado, sem fallback", () => {
  for (const relativePath of FLUXOS_JURIDICOS) {
    const source = readSource(relativePath);
    assert(
      /storage_bucket !== STORAGE_BUCKET/.test(source),
      `${relativePath} precisa recusar bucket diferente do autorizado`
    );
    // Fallback silencioso proibido: nada de `?? STORAGE_BUCKET`.
    assert(
      !/storage_bucket\s*\?\?\s*STORAGE_BUCKET/.test(source),
      `${relativePath} nao pode cair em bucket padrao quando a coluna vem nula`
    );
  }
});

check("COLUNAS: a validacao de prefixo do path continua ativa nos dois fluxos", () => {
  for (const relativePath of FLUXOS_JURIDICOS) {
    assert(
      readSource(relativePath).includes("isStoragePathInsideProject"),
      `${relativePath} perdeu a checagem de prefixo do projeto`
    );
  }
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
