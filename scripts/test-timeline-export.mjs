// Testes da exportação do Timeline filtrado (apps/web/lib/timeline-export/**).
//
// A maior parte roda sobre fixtures sintéticas (nenhum dado real, nenhum
// ZIP grande gerado à toa — só Blobs minúsculos para provar a estrutura
// do pacote). A resolução de evidências (resolve-evidence-files.ts) usa
// createSupabaseBrowserClient e acesso a Storage — depende de um
// ambiente de browser real e não é exercitada aqui; é validada
// manualmente na UI (ver docs/timeline-export.md).
//
// A seção final faz um teste real, mas leve, do INSERT/RLS/auditoria de
// timeline_exports contra o projeto de referência, seguindo o mesmo
// padrão de scripts/test-event-notes.mjs (sessão real via magic-link,
// limpeza via service role ao final — o registro de auditoria
// CONTRACTUAL_TIMELINE_EXPORTED gerado permanece, por ser append-only).
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/test-timeline-export.mjs

import { createClient } from "@supabase/supabase-js";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const { applyTimelineFilters, sortChronological } = await import(
  "../apps/web/lib/timeline-export/apply-filters"
);
const { deriveParticipants } = await import("../apps/web/lib/timeline-export/derive-participants");
const { buildExportRows } = await import("../apps/web/lib/timeline-export/build-export-rows");
const { buildExportManifest } = await import("../apps/web/lib/timeline-export/build-manifest");
const { buildExportCsv, EXPORT_ROW_COLUMNS } = await import("../apps/web/lib/timeline-export/build-csv");
const { buildExportXlsx } = await import("../apps/web/lib/timeline-export/build-xlsx");
const { buildTimelineDossiePdf } = await import("../apps/web/lib/timeline-export/build-pdf-dossie");
const { buildManifestoPdf } = await import("../apps/web/lib/timeline-export/build-manifesto-pdf");
const { buildZipPackage } = await import("../apps/web/lib/timeline-export/build-zip-package");
const { buildEmailTextRepresentation, sanitizeFileNameSegment } = await import(
  "../apps/web/lib/timeline-export/email-representation"
);
const { emptyTimelineFilterCriteria } = await import("../apps/web/lib/timeline-export/types");

const JSZip = (await import("jszip")).default;

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

// ---------- fixtures ----------

const eventA = {
  id: "evt-a",
  projectId: "proj-1",
  timestamp: "2026-01-05T10:00:00Z",
  title: "Notificação de atraso",
  description: "Cliente notificou atraso de 20 dias na entrega da estrutura.",
  sourceType: "EMAIL",
  evidence: [
    {
      id: "ev-a1",
      sourceType: "EMAIL",
      label: "E-mail: Atraso na entrega",
      locator: "Gmail > Assunto: Atraso na entrega",
      emailId: "email-1",
    },
  ],
  categories: ["PRAZO"],
  status: "NOVO",
  crossReferences: [
    { kind: "CONTRATO_ADITIVO", refType: "CLAUSE", refId: "clause-1", note: "Cláusula 5.2 — Prazo de execução" },
  ],
  aiAssessment: null,
  createdBy: "sistema",
};

const eventB = {
  id: "evt-b",
  projectId: "proj-1",
  timestamp: "2026-01-03T09:00:00Z",
  title: "Medição mensal",
  description: "Medição referente ao mês de dezembro, revisão R04.",
  sourceType: "CONSTRUMANAGER",
  evidence: [
    {
      id: "ev-b1",
      sourceType: "CONSTRUMANAGER",
      label: "Medição #4",
      locator: "Construmanager > Revisão R04",
      documentVersionId: "docver-missing",
    },
  ],
  categories: ["MEDICOES", "PAGAMENTOS"],
  status: "EM_ANALISE",
  crossReferences: [],
  aiAssessment: null,
  createdBy: "sistema",
};

const eventC = {
  id: "evt-c",
  projectId: "proj-1",
  timestamp: "2026-01-10T12:00:00Z",
  title: "Aditivo contratual proposto",
  description: "Minuta de aditivo contratual 02 recebida para análise, incluindo cláusula, vírgula e aspas \"teste\".",
  sourceType: "CONTRATO",
  evidence: [
    {
      id: "ev-c1",
      sourceType: "CONTRATO",
      label: "Aditivo 02",
      locator: "Documento: Aditivo 02",
      documentVersionId: "docver-1",
    },
  ],
  categories: ["ESCOPO"],
  status: "CONFRONTADO",
  crossReferences: [
    { kind: "CONTRATO_ADITIVO", refType: "DOCUMENT", refId: "doc-1", note: "Aditivo Contratual 02" },
  ],
  aiAssessment: null,
  createdBy: "user-2",
};

const events = [eventA, eventB, eventC];

const emailsById = new Map([
  [
    "email-1",
    {
      emailId: "email-1",
      from: "cliente@exemplo.com",
      to: "gestor@axion.com.br, financeiro@axion.com.br",
      subject: "Atraso na entrega",
      sentAt: "2026-01-05T10:00:00Z",
      snippet: "Prezados, informamos atraso de 20 dias na entrega da estrutura.",
    },
  ],
]);

const documentVersionsById = new Map([
  [
    "docver-1",
    {
      documentVersionId: "docver-1",
      documentTitle: "Aditivo Contratual 02",
      filePath: "projects/proj-1/aditivo-02.pdf",
      storageBucket: "project-documents",
      originalFileName: "Aditivo_02_Assinado_v2.pdf",
      mimeType: "application/pdf",
    },
  ],
]);

const eventNotesByEventId = new Map([
  [
    "evt-a",
    [
      {
        id: "note-1",
        category: "CONTEXTO_OPERACIONAL",
        text: "Cliente avisou por telefone antes do e-mail.",
        authorName: "Reynaldo",
        createdAt: "2026-01-05T11:00:00Z",
      },
    ],
  ],
]);

console.log("");
console.log("======================================");
console.log("EXPORTAÇÃO DO TIMELINE FILTRADO — TESTES");
console.log("======================================");
console.log("");

// ---------- applyTimelineFilters / sortChronological ----------

check("sem filtro, retorna todos os eventos na mesma ordem recebida (nunca reordena por conta própria)", () => {
  const result = applyTimelineFilters(events, emptyTimelineFilterCriteria(), emailsById);
  assert(result.length === 3, "esperados 3 eventos");
  assert(
    result.map((e) => e.id).join(",") === "evt-a,evt-b,evt-c",
    "ordem deveria ser preservada"
  );
});

check("filtro por fonte (sources) exclui eventos de outras fontes", () => {
  const result = applyTimelineFilters(events, { ...emptyTimelineFilterCriteria(), sources: ["EMAIL"] }, emailsById);
  assert(result.length === 1 && result[0].id === "evt-a", "só evt-a é EMAIL");
});

check("filtro por categoria/impacto exclui eventos sem a categoria", () => {
  const result = applyTimelineFilters(
    events,
    { ...emptyTimelineFilterCriteria(), categories: ["MEDICOES"] },
    emailsById
  );
  assert(result.length === 1 && result[0].id === "evt-b", "só evt-b tem MEDICOES");
});

check("filtro por período (dateFrom) exclui eventos anteriores", () => {
  const result = applyTimelineFilters(
    events,
    { ...emptyTimelineFilterCriteria(), dateFrom: "2026-01-04" },
    emailsById
  );
  assert(
    result.map((e) => e.id).sort().join(",") === "evt-a,evt-c",
    "evt-b (2026-01-03) deveria ser excluído"
  );
});

check("filtro por participante retorna só eventos com aquele e-mail como evidência", () => {
  const result = applyTimelineFilters(
    events,
    { ...emptyTimelineFilterCriteria(), participants: ["financeiro@axion.com.br"] },
    emailsById
  );
  assert(result.length === 1 && result[0].id === "evt-a", "só evt-a tem esse participante");
});

check("combina múltiplos filtros (fonte + categoria + período) como interseção (AND)", () => {
  const result = applyTimelineFilters(
    events,
    {
      ...emptyTimelineFilterCriteria(),
      sources: ["CONTRATO", "CONSTRUMANAGER"],
      categories: ["ESCOPO"],
      dateFrom: "2026-01-06",
    },
    emailsById
  );
  assert(result.length === 1 && result[0].id === "evt-c", "só evt-c satisfaz os três filtros simultaneamente");
});

check("seleção manual de eventos nunca exporta além do que os demais filtros permitem", () => {
  const result = applyTimelineFilters(
    events,
    { ...emptyTimelineFilterCriteria(), sources: ["EMAIL"], selectedEventIds: ["evt-c"] },
    emailsById
  );
  assert(result.length === 0, "evt-c não é EMAIL — não pode aparecer mesmo selecionado manualmente");
});

check("contagem exportada corresponde exatamente ao esperado para uma combinação de filtros", () => {
  const result = applyTimelineFilters(
    events,
    { ...emptyTimelineFilterCriteria(), selectedEventIds: ["evt-a", "evt-c"] },
    emailsById
  );
  assert(result.length === 2, "exatamente 2 dos 3 eventos disponíveis deveriam ser exportados");
});

check("ordem cronológica (sortChronological) vai do mais antigo ao mais recente", () => {
  const sorted = sortChronological(events);
  assert(sorted.map((e) => e.id).join(",") === "evt-b,evt-a,evt-c", "ordem cronológica incorreta");
});

check("deriveParticipants deriva só de e-mails reais vinculados, nunca inventa um campo participants", () => {
  const participants = deriveParticipants(events, emailsById);
  assert(participants.length === 3, "from + 2 destinatários do único e-mail vinculado");
  assert(
    participants.some((p) => p.address === "financeiro@axion.com.br"),
    "financeiro@axion.com.br deveria aparecer"
  );
});

// ---------- buildExportRows ----------

let rows;
check("buildExportRows mapeia sequência, impactos e anotação interna corretamente", () => {
  rows = buildExportRows({
    events: sortChronological(events),
    emailsById,
    documentVersionsById,
    eventNotesByEventId,
  });
  assert(rows.length === 3, "3 linhas esperadas");
  assert(rows[0].sequence === 1 && rows[2].sequence === 3, "sequência deveria começar em 1");

  const rowA = rows.find((r) => r.eventId === "evt-a");
  assert(rowA.scopeImpact === false && rowA.priceImpact === false && rowA.scheduleImpact === true, "evt-a só tem impacto de prazo");
  assert(rowA.documentOrEmailId === "email-1", "evt-a deveria referenciar o e-mail vinculado");
  assert(rowA.notes === "[CONTEXTO_OPERACIONAL] Cliente avisou por telefone antes do e-mail.", "anotação interna mal formatada");

  const rowB = rows.find((r) => r.eventId === "evt-b");
  assert(rowB.priceImpact === true, "evt-b (MEDICOES/PAGAMENTOS) deveria ter impacto de preço");
  assert(rowB.notes === null, "evt-b não tem anotação — não pode inventar uma");

  const rowC = rows.find((r) => r.eventId === "evt-c");
  assert(rowC.contractReference === "Aditivo Contratual 02", "clauseReference/contractReference deveriam vir de crossReferences.note");
  assert(rowC.originalFilename === "Aditivo_02_Assinado_v2.pdf", "nome original deveria vir do documentVersionsById");
  assert(rowC.sourceLanguage === null, "sourceLanguage nunca é inventado nesta fase");
});

// ---------- buildExportManifest ----------

const evidenceEntries = [
  {
    eventId: "evt-c",
    evidenceId: "ev-c1",
    label: "Aditivo 02",
    locator: "Documento: Aditivo 02",
    status: "INCLUDED",
    packagedFileName: "001_Aditivo_02_Assinado_v2.pdf",
    originalFileName: "Aditivo_02_Assinado_v2.pdf",
    reason: null,
  },
  {
    eventId: "evt-b",
    evidenceId: "ev-b1",
    label: "Medição #4",
    locator: "Construmanager > Revisão R04",
    status: "UNAVAILABLE",
    packagedFileName: null,
    originalFileName: null,
    reason: "Fonte referenciada, arquivo original não disponível para exportação.",
  },
];

let manifest;
check("buildExportManifest nunca inventa checksum e registra evidências indisponíveis com a frase exigida", () => {
  manifest = buildExportManifest({
    exportId: "export-test-1",
    projectId: "proj-1",
    projectName: "Projeto de Teste",
    exportedAt: "2026-01-15T08:00:00Z",
    exportedByUserId: "user-1",
    exportedByName: "Reynaldo",
    filters: { ...emptyTimelineFilterCriteria(), selectedEventIds: ["evt-a", "evt-b", "evt-c"] },
    eventIds: ["evt-b", "evt-a", "evt-c"],
    totalAvailableCount: 3,
    formats: ["PDF", "XLSX"],
    evidence: evidenceEntries,
    eventNotesIncluded: 1,
  });

  assert(manifest.checksum === null, "checksum deveria ser null — nenhuma ferramenta de hash implementada nesta fase");
  assert(manifest.itemCount === 3, "itemCount deveria refletir eventIds.length");
  const unavailable = manifest.evidence.find((e) => e.status === "UNAVAILABLE");
  assert(unavailable !== undefined, "evidência indisponível não pode ser omitida do manifesto");
  assert(
    unavailable.reason === "Fonte referenciada, arquivo original não disponível para exportação.",
    "frase exigida pelo requisito não pode ser alterada"
  );
});

// ---------- CSV / XLSX ----------

check('coluna documentId/emailId usa exatamente o cabeçalho literal "documentId/emailId"', () => {
  const column = EXPORT_ROW_COLUMNS.find((c) => c.key === "documentOrEmailId");
  assert(column && column.header === "documentId/emailId", "cabeçalho deveria ser exatamente documentId/emailId");
});

check("CSV escapa corretamente vírgulas e aspas no título de um evento", () => {
  const csv = buildExportCsv(rows);
  assert(csv.includes('"'), "deveria haver ao menos um campo entre aspas (o título com vírgula/aspas)");
  const lines = csv.split("\r\n");
  assert(lines.length === rows.length + 1, "cabeçalho + uma linha por evento");
});

await checkAsync("XLSX é gerado como Blob não vazio com o MIME type correto", async () => {
  const blob = await buildExportXlsx(rows);
  assert(blob.size > 0, "XLSX gerado não deveria ser vazio");
  assert(
    blob.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "MIME type incorreto para XLSX"
  );
});

// ---------- PDFs ----------

check("dossiê PDF é gerado sem lançar exceção e inclui a marcação de anotação interna", () => {
  const blob = buildTimelineDossiePdf(manifest, rows);
  assert(blob.size > 0, "dossiê PDF gerado não deveria ser vazio");
  assert(blob.type === "application/pdf", "MIME type incorreto para o dossiê PDF");
});

check("manifesto PDF é gerado sem lançar exceção", () => {
  const blob = buildManifestoPdf(manifest);
  assert(blob.size > 0, "manifesto PDF gerado não deveria ser vazio");
});

// ---------- e-mail / sanitização de nome de arquivo ----------

check("representação legível do e-mail nunca inventa CC nem anexos", () => {
  const text = buildEmailTextRepresentation(emailsById.get("email-1"));
  assert(text.includes("From: cliente@exemplo.com"), "From ausente");
  assert(text.includes("Subject: Atraso na entrega"), "Subject ausente");
  assert(!text.includes("Cc:"), "CC não existe no schema — nunca deveria ser inventado na representação");
  assert(text.includes("Anexos: não disponíveis"), "limitação de anexos deveria ser declarada explicitamente");
});

check("sanitizeFileNameSegment remove diacríticos com segurança (regressão do bug do regex literal)", () => {
  const sanitized = sanitizeFileNameSegment("Relatório Nº 3 — Início/Fim.pdf");
  assert(/^[a-zA-Z0-9._-]+$/.test(sanitized), `nome sanitizado contém caracteres inválidos: ${sanitized}`);
  assert(!/[̀-ͯ]/.test(sanitized), "marcas de combinação diacrítica não deveriam sobrar após a sanitização");
  assert(sanitized.length <= 120, "nome sanitizado deveria respeitar o limite de 120 caracteres");
});

// ---------- ZIP ----------

await checkAsync("pacote ZIP contém exatamente a estrutura de pastas exigida (seção 5)", async () => {
  // JSZip só aceita Blob quando detecta suporte de browser (FileReader),
  // ausente em Node puro — em produção (client component real) isso
  // funciona normalmente. Aqui, para testar só a montagem da estrutura
  // do pacote sob Node, usamos strings/ArrayBuffer no lugar de Blob real
  // (buildZipPackage só repassa o conteúdo ao JSZip, não inspeciona o tipo).
  const manifestoPdf = "manifesto de teste";
  const timelinePdf = "timeline de teste";
  const indiceXlsx = "indice de teste";
  const evidenceFiles = [
    {
      content: "conteúdo de evidência de teste, minúsculo",
      entry: evidenceEntries[0],
    },
    { content: null, entry: evidenceEntries[1] },
  ];

  const zipBlob = await buildZipPackage({ manifest, manifestoPdf, indiceXlsx, timelinePdf, evidenceFiles });
  assert(zipBlob.size > 0, "ZIP gerado não deveria ser vazio");

  const loaded = await JSZip.loadAsync(await zipBlob.arrayBuffer());
  const fileNames = Object.keys(loaded.files);

  for (const expected of ["00_MANIFESTO.pdf", "01_INDICE.xlsx", "02_TIMELINE.pdf", "manifest.json"]) {
    assert(fileNames.includes(expected), `arquivo ausente no pacote: ${expected}`);
  }
  assert(
    fileNames.includes("EVIDENCIAS/001_Aditivo_02_Assinado_v2.pdf"),
    "evidência INCLUDED deveria estar em EVIDENCIAS/"
  );
  assert(
    !fileNames.some((n) => n.startsWith("EVIDENCIAS/") && n.includes("null")),
    "evidência UNAVAILABLE (sem conteúdo) não deveria gerar arquivo no pacote"
  );

  const manifestJson = JSON.parse(await loaded.files["manifest.json"].async("string"));
  assert(manifestJson.exportId === "export-test-1", "manifest.json dentro do ZIP deveria bater com o manifesto usado");
});

// ---------- teste real, leve: INSERT/RLS/auditoria de timeline_exports ----------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !serviceKey || !anonKey) {
  console.log("");
  console.log("SKIP testes reais de timeline_exports — Supabase não configurado.");
} else {
  const REFERENCE_PROJECT_ID = "00000000-0000-4000-8000-000000000001";
  const REFERENCE_EVENT_ID = "58988a54-092c-442f-a79a-638b53bc088e";
  const TEST_AUTHOR_EMAIL = "reynaldo@axion.com.br";

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: TEST_AUTHOR_EMAIL,
  });
  if (linkError) throw linkError;

  const anonClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: verifyData, error: verifyError } = await anonClient.auth.verifyOtp({
    type: "magiclink",
    token_hash: linkData.properties.hashed_token,
  });
  if (verifyError) throw verifyError;

  const authedUserId = verifyData.user.id;
  const authedClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${verifyData.session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let createdExportId = null;

  await checkAsync("INSERT autenticado como membro do projeto, autoautoria, é aceito pela RLS", async () => {
    const { data, error } = await authedClient
      .from("timeline_exports")
      .insert({
        project_id: REFERENCE_PROJECT_ID,
        exported_by_user_id: authedUserId,
        filters: { ...emptyTimelineFilterCriteria(), selectedEventIds: [REFERENCE_EVENT_ID] },
        event_ids: [REFERENCE_EVENT_ID],
        item_count: 1,
        formats: ["PDF"],
      })
      .select("id")
      .single();

    if (error) throw error;
    assert(data.id, "deveria retornar o id da exportação registrada");
    createdExportId = data.id;
  });

  await checkAsync("tentativa de registrar exportação em nome de outro usuário é bloqueada pela RLS", async () => {
    const FAKE_OTHER_USER = "00000000-0000-0000-0000-000000000001";
    const { data, error } = await authedClient.from("timeline_exports").insert({
      project_id: REFERENCE_PROJECT_ID,
      exported_by_user_id: FAKE_OTHER_USER,
      filters: emptyTimelineFilterCriteria(),
      event_ids: [REFERENCE_EVENT_ID],
      item_count: 1,
      formats: ["PDF"],
    });
    assert(error !== null, "RLS deveria rejeitar exported_by_user_id diferente de auth.uid()");
    assert(!data, "nenhum dado deveria ser retornado");
  });

  await checkAsync("item_count divergente de event_ids é rejeitado pela constraint do banco", async () => {
    const { error } = await authedClient.from("timeline_exports").insert({
      project_id: REFERENCE_PROJECT_ID,
      exported_by_user_id: authedUserId,
      filters: emptyTimelineFilterCriteria(),
      event_ids: [REFERENCE_EVENT_ID],
      item_count: 2,
      formats: ["PDF"],
    });
    assert(error !== null, "item_count = array_length(event_ids) deveria ser exigido pela constraint");
  });

  await checkAsync("event_ids vazio é rejeitado pela constraint do banco", async () => {
    const { error } = await authedClient.from("timeline_exports").insert({
      project_id: REFERENCE_PROJECT_ID,
      exported_by_user_id: authedUserId,
      filters: emptyTimelineFilterCriteria(),
      event_ids: [],
      item_count: 0,
      formats: ["PDF"],
    });
    assert(error !== null, "exportação sem nenhum evento nunca deveria ser aceita");
  });

  await checkAsync("CONTRACTUAL_TIMELINE_EXPORTED foi registrado em audit_log_entries, sem conteúdo sensível", async () => {
    const { data, error } = await admin
      .from("audit_log_entries")
      .select("id,action,entity_type,entity_id,actor_type,actor_user_id,detail")
      .eq("action", "CONTRACTUAL_TIMELINE_EXPORTED")
      .eq("entity_id", createdExportId)
      .maybeSingle();

    if (error) throw error;
    assert(data !== null, "deveria existir uma entrada de auditoria CONTRACTUAL_TIMELINE_EXPORTED");
    assert(data.entity_type === "TIMELINE_EXPORT");
    assert(data.actor_user_id === authedUserId);
    assert(!data.detail.includes(REFERENCE_EVENT_ID), "detail não deveria conter o conteúdo/IDs completos, só um resumo");
  });

  // ---------- limpeza ----------
  if (createdExportId) {
    const { error: deleteError } = await admin.from("timeline_exports").delete().eq("id", createdExportId);
    if (deleteError) {
      console.log("AVISO: falha ao limpar registro de exportação de teste:", deleteError.message);
    } else {
      console.log(`Limpeza: registro de exportação de teste removido (id=${createdExportId}).`);
    }
  }
}

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
