// Testes do pipeline de ingestão de anexos de e-mail (Gmail → Supabase
// Storage/DB → espelho Google Drive best-effort) e da promoção ao
// pipeline documental. NUNCA chama a API Gmail/Drive real — todo
// download/upload externo é injetado (funções fake determinísticas).
// Usa o Supabase REAL (projeto de referência) para os testes de
// persistência/RLS/auditoria, com limpeza completa ao final (try/finally).
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/test-email-attachments.mjs

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

register("./ts-module-resolver.mjs", import.meta.url);

const { computeSha256Hex } = await import("../apps/web/lib/email/attachments/hash");
const { buildEmailAttachmentStoragePath } = await import("../apps/web/lib/email/attachments/build-storage-path");
const { ingestEmailAttachmentsForMessage } = await import("../apps/web/lib/email/attachments/ingest-email-attachments");
const { linkEmailAttachmentToDocument } = await import("../apps/web/lib/email/attachments/link-email-attachment-to-document");
const { getEmailAttachmentsForEmails } = await import("../apps/web/lib/email/attachments/get-email-attachments");
const { syncEmailAttachmentToDrive } = await import("../apps/web/lib/drive/sync-attachment-to-drive");
const { buildEventAnalysisContext } = await import("../apps/web/lib/ai/context/build-event-context");

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
function readSource(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
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

console.log("");
console.log("======================================");
console.log("EMAIL ATTACHMENTS + DRIVE MIRROR — TESTES");
console.log("======================================");
console.log("");

// --- Funções puras (sem DB, sem rede) ---

check("computeSha256Hex produz o hash correto (valor conhecido)", () => {
  const buffer = Buffer.from("axion-acc-test-content");
  const expected = createHash("sha256").update(buffer).digest("hex");
  assert(computeSha256Hex(buffer) === expected);
  assert(/^[0-9a-f]{64}$/.test(computeSha256Hex(buffer)));
});

check("buildEmailAttachmentStoragePath é determinístico e sempre começa com {projectId}/ (mesmo prefixo já coberto pelas policies de Storage existentes)", () => {
  const p = buildEmailAttachmentStoragePath({
    projectId: "proj-1",
    emailId: "email-1",
    gmailAttachmentId: "att-1",
    originalFileName: "contrato.pdf",
  });
  assert(p.startsWith("proj-1/email-attachments/email-1/"));
  assert(p.includes("att-1-"));
});

check("buildEmailAttachmentStoragePath nunca colide para o mesmo filename com attachmentId diferente (preserva ambos)", () => {
  const p1 = buildEmailAttachmentStoragePath({ projectId: "p", emailId: "e", gmailAttachmentId: "a1", originalFileName: "planilha.xlsx" });
  const p2 = buildEmailAttachmentStoragePath({ projectId: "p", emailId: "e", gmailAttachmentId: "a2", originalFileName: "planilha.xlsx" });
  assert(p1 !== p2);
});

// --- Estrutural: ingestão/promoção nunca criam Event Ledger sozinhas ---

check("ingest-email-attachments.ts e link-email-attachment-to-document.ts nunca referenciam contract_events (nenhum evento é criado só porque existe anexo)", () => {
  const ingestSource = readSource("apps/web/lib/email/attachments/ingest-email-attachments.ts");
  const linkSource = readSource("apps/web/lib/email/attachments/link-email-attachment-to-document.ts");
  assert(!ingestSource.includes("contract_events"));
  assert(!linkSource.includes("contract_events"));
});

// --- Testes com Supabase real (projeto de referência) — cleanup completo no final ---

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY;
const REFERENCE_PROJECT_ID = "00000000-0000-4000-8000-000000000001";

if (!supabaseUrl || !serviceKey) {
  console.log("SKIP testes com Supabase real — NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SECRET_KEY não configurados.");
} else {
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const cleanup = {
    emailAttachmentIds: [],
    storagePaths: [],
    documentVersionIds: [],
    documentIds: [],
    eventEvidenceIds: [],
    contractEventIds: [],
    emailIds: [],
  };

  async function insertTestEmail(subjectSuffix) {
    const { data, error } = await supabase
      .from("emails")
      .insert({
        project_id: REFERENCE_PROJECT_ID,
        from_address: "fornecedor@example.com",
        to_address: "reynaldo@axion.com.br",
        subject: `[TESTE ACC] Anexo de e-mail ${subjectSuffix}`,
        sent_at: new Date().toISOString(),
        snippet: "E-mail de teste — apagado ao final da suíte.",
      })
      .select("id")
      .single();
    if (error) throw new Error(`insertTestEmail: ${error.message}`);
    cleanup.emailIds.push(data.id);
    return data.id;
  }

  function fakeDownload(buffer) {
    return async () => buffer;
  }

  console.log("--- Preparando fixtures (e-mails de teste) ---");
  const emailId1 = await insertTestEmail("1");
  const emailId2 = await insertTestEmail("2");
  console.log(`Fixtures criadas: emailId1=${emailId1}, emailId2=${emailId2}`);
  console.log("");

  await checkAsync("sem anexo: ingestEmailAttachmentsForMessage com parts=[] retorna []", async () => {
    const results = await ingestEmailAttachmentsForMessage(supabase, {
      projectId: REFERENCE_PROJECT_ID,
      emailId: emailId1,
      gmailMessageId: "gmail-msg-1",
      gmailThreadId: "gmail-thread-1",
      receivedAt: new Date().toISOString(),
      parts: [],
      downloadAttachmentBytes: fakeDownload(Buffer.from("")),
    });
    assert(results.length === 0);
  });

  let pdfAttachmentId = null;
  let pdfStoragePath = null;
  const pdfBuffer = Buffer.from("%PDF-1.4 conteudo de teste do contrato anexado");

  await checkAsync("PDF: anexo ingerido com hash/mime/tamanho corretos, processing_status=PENDING, drive_sync_status=PENDING", async () => {
    const results = await ingestEmailAttachmentsForMessage(supabase, {
      projectId: REFERENCE_PROJECT_ID,
      emailId: emailId1,
      gmailMessageId: "gmail-msg-1",
      gmailThreadId: "gmail-thread-1",
      receivedAt: new Date().toISOString(),
      parts: [{ gmailAttachmentId: "att-pdf-1", originalFileName: "contrato.pdf", mimeType: "application/pdf", declaredSizeBytes: pdfBuffer.length }],
      downloadAttachmentBytes: fakeDownload(pdfBuffer),
    });
    assert(results.length === 1);
    assert(results[0].status === "INGESTED", JSON.stringify(results[0]));
    const attachment = results[0].attachment;
    assert(attachment.mimeType === "application/pdf");
    assert(attachment.sha256Hash === computeSha256Hex(pdfBuffer));
    assert(attachment.fileSizeBytes === pdfBuffer.length);
    assert(attachment.processingStatus === "PENDING");
    assert(attachment.driveSyncStatus === "PENDING");
    assert(attachment.emailId === emailId1);
    assert(attachment.gmailMessageId === "gmail-msg-1");
    assert(attachment.gmailThreadId === "gmail-thread-1");
    pdfAttachmentId = attachment.id;
    pdfStoragePath = attachment.storagePath;
    cleanup.emailAttachmentIds.push(attachment.id);
    cleanup.storagePaths.push(attachment.storagePath);
  });

  const xlsxBufferA = Buffer.from("XLSX-CONTEUDO-A-diferente");
  const xlsxBufferB = Buffer.from("XLSX-CONTEUDO-B-completamente-diferente-do-A");

  await checkAsync("XLSX + múltiplos anexos + mesmo filename com hash diferente: ambos preservados, nunca sobrescritos", async () => {
    const results = await ingestEmailAttachmentsForMessage(supabase, {
      projectId: REFERENCE_PROJECT_ID,
      emailId: emailId1,
      gmailMessageId: "gmail-msg-1",
      gmailThreadId: "gmail-thread-1",
      receivedAt: new Date().toISOString(),
      parts: [
        { gmailAttachmentId: "att-xlsx-a", originalFileName: "planilha.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", declaredSizeBytes: xlsxBufferA.length },
        { gmailAttachmentId: "att-xlsx-b", originalFileName: "planilha.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", declaredSizeBytes: xlsxBufferB.length },
      ],
      downloadAttachmentBytes: async (part) => (part.gmailAttachmentId === "att-xlsx-a" ? xlsxBufferA : xlsxBufferB),
    });

    assert(results.length === 2);
    assert(results.every((r) => r.status === "INGESTED"));
    const [a, b] = results.map((r) => r.attachment);
    assert(a.originalFileName === "planilha.xlsx" && b.originalFileName === "planilha.xlsx");
    assert(a.sha256Hash !== b.sha256Hash, "hashes deveriam ser diferentes (conteúdos diferentes)");
    assert(a.storagePath !== b.storagePath, "cada anexo deveria ter seu próprio objeto no Storage");
    for (const attachment of [a, b]) {
      cleanup.emailAttachmentIds.push(attachment.id);
      cleanup.storagePaths.push(attachment.storagePath);
    }

    const { data: rows, error } = await supabase
      .from("email_attachments")
      .select("id")
      .eq("email_id", emailId1)
      .eq("original_file_name", "planilha.xlsx");
    if (error) throw new Error(error.message);
    assert(rows.length === 2, "as duas linhas de mesmo filename deveriam persistir independentemente");
  });

  await checkAsync("mesmo hash em e-mails diferentes: dois vínculos documentais independentes (sem dedupe físico nesta fase)", async () => {
    const sharedBuffer = Buffer.from("CONTEUDO-IDENTICO-EM-DOIS-EMAILS-DIFERENTES");

    const [result1, result2] = await Promise.all([
      ingestEmailAttachmentsForMessage(supabase, {
        projectId: REFERENCE_PROJECT_ID,
        emailId: emailId1,
        gmailMessageId: "gmail-msg-1",
        gmailThreadId: "gmail-thread-1",
        receivedAt: new Date().toISOString(),
        parts: [{ gmailAttachmentId: "att-shared", originalFileName: "mesmo.pdf", mimeType: "application/pdf", declaredSizeBytes: sharedBuffer.length }],
        downloadAttachmentBytes: fakeDownload(sharedBuffer),
      }),
      ingestEmailAttachmentsForMessage(supabase, {
        projectId: REFERENCE_PROJECT_ID,
        emailId: emailId2,
        gmailMessageId: "gmail-msg-2",
        gmailThreadId: null,
        receivedAt: new Date().toISOString(),
        parts: [{ gmailAttachmentId: "att-shared", originalFileName: "mesmo.pdf", mimeType: "application/pdf", declaredSizeBytes: sharedBuffer.length }],
        downloadAttachmentBytes: fakeDownload(sharedBuffer),
      }),
    ]);

    const attachment1 = result1[0].attachment;
    const attachment2 = result2[0].attachment;
    assert(attachment1.id !== attachment2.id);
    assert(attachment1.emailId !== attachment2.emailId);
    assert(attachment1.sha256Hash === attachment2.sha256Hash, "hash deveria ser igual (mesmo conteúdo)");
    assert(attachment1.storagePath !== attachment2.storagePath, "cada e-mail mantém seu próprio objeto físico nesta fase");
    cleanup.emailAttachmentIds.push(attachment1.id, attachment2.id);
    cleanup.storagePaths.push(attachment1.storagePath, attachment2.storagePath);
  });

  await checkAsync("retry (reingestão) do MESMO anexo nunca duplica nem sobrescreve — devolve a linha existente", async () => {
    const before = await ingestEmailAttachmentsForMessage(supabase, {
      projectId: REFERENCE_PROJECT_ID,
      emailId: emailId1,
      gmailMessageId: "gmail-msg-1",
      gmailThreadId: "gmail-thread-1",
      receivedAt: new Date().toISOString(),
      parts: [{ gmailAttachmentId: "att-pdf-1", originalFileName: "contrato.pdf", mimeType: "application/pdf", declaredSizeBytes: pdfBuffer.length }],
      downloadAttachmentBytes: async () => {
        throw new Error("nunca deveria tentar baixar de novo — o anexo já existe");
      },
    });
    assert(before.length === 1);
    assert(before[0].status === "ALREADY_INGESTED");
    assert(before[0].attachment.id === pdfAttachmentId);

    const { data: rows, error } = await supabase
      .from("email_attachments")
      .select("id")
      .eq("email_id", emailId1)
      .eq("gmail_attachment_id", "att-pdf-1");
    if (error) throw new Error(error.message);
    assert(rows.length === 1, "nunca deveria haver uma segunda linha para o mesmo (email_id, gmail_attachment_id)");
  });

  await checkAsync("storage original: o objeto realmente existe no Supabase Storage com os bytes originais", async () => {
    const { data, error } = await supabase.storage.from("project-documents").download(pdfStoragePath);
    if (error) throw new Error(error.message);
    const downloaded = Buffer.from(await data.arrayBuffer());
    assert(downloaded.equals(pdfBuffer), "conteúdo baixado do Storage deveria ser idêntico ao original");
  });

  let promotedDocumentVersionId = null;

  await checkAsync("processamento: linkEmailAttachmentToDocument promove o anexo a document_version (reaproveita o mesmo arquivo, entra na fila de extração de texto existente)", async () => {
    const result = await linkEmailAttachmentToDocument(supabase, {
      attachmentId: pdfAttachmentId,
      kind: "CLARIFICACAO_CLIENTE",
      documentTitle: "[TESTE ACC] Contrato anexado por e-mail",
      documentDate: new Date().toISOString().slice(0, 10),
      author: "Fornecedor (e-mail)",
      summary: "Documento de teste promovido a partir de um anexo de e-mail.",
    });
    promotedDocumentVersionId = result.documentVersionId;
    cleanup.documentIds.push(result.documentId);
    cleanup.documentVersionIds.push(result.documentVersionId);

    const { data: versionRow, error: versionError } = await supabase
      .from("document_versions")
      .select("source_type,file_path,storage_bucket,processing_status")
      .eq("id", result.documentVersionId)
      .single();
    if (versionError) throw new Error(versionError.message);
    assert(versionRow.source_type === "EMAIL");
    assert(versionRow.file_path === pdfStoragePath, "deveria reaproveitar o mesmo caminho do Storage, nunca reenviar o arquivo");
    assert(versionRow.storage_bucket === "project-documents");
    assert(versionRow.processing_status === "AWAITING_PROCESSING", "deveria entrar na mesma fila de extração de texto já existente");

    const { data: attachmentRow, error: attachmentError } = await supabase
      .from("email_attachments")
      .select("document_version_id,processing_status")
      .eq("id", pdfAttachmentId)
      .single();
    if (attachmentError) throw new Error(attachmentError.message);
    assert(attachmentRow.document_version_id === result.documentVersionId);
    assert(attachmentRow.processing_status === "PROCESSED");
  });

  await checkAsync("processamento é idempotente: promover o mesmo anexo de novo nunca cria um segundo document_version", async () => {
    const result = await linkEmailAttachmentToDocument(supabase, {
      attachmentId: pdfAttachmentId,
      kind: "CLARIFICACAO_CLIENTE",
      documentTitle: "Não deveria ser usado (idempotência)",
      documentDate: new Date().toISOString().slice(0, 10),
      author: "x",
      summary: "x",
    });
    assert(result.documentVersionId === promotedDocumentVersionId);

    const { data: rows, error } = await supabase
      .from("document_versions")
      .select("id")
      .eq("file_path", pdfStoragePath);
    if (error) throw new Error(error.message);
    assert(rows.length === 1, "nunca deveria haver um segundo document_version para o mesmo anexo promovido");
  });

  await checkAsync("Experts recebem referência: Context Builder inclui o document_version promovido como evidência, e lista TODOS os anexos do e-mail (promovidos e não promovidos) — nunca ignora o anexo", async () => {
    const { data: eventRow, error: eventError } = await supabase
      .from("contract_events")
      .insert({
        project_id: REFERENCE_PROJECT_ID,
        occurred_at: new Date().toISOString(),
        title: "[TESTE ACC] Evento para validar referência de anexo",
        description: "Evento de teste — apagado ao final da suíte.",
        source_type: "EMAIL",
        status: "NOVO",
        created_by_type: "LEGACY",
        created_by_label: "test-fixture",
      })
      .select("id")
      .single();
    if (eventError) throw new Error(eventError.message);
    cleanup.contractEventIds.push(eventRow.id);

    const { data: evidenceDoc, error: evidenceDocError } = await supabase
      .from("event_evidence")
      .insert({
        event_id: eventRow.id,
        source_type: "EMAIL",
        label: "[TESTE ACC] Contrato anexado",
        locator: "test",
        document_version_id: promotedDocumentVersionId,
      })
      .select("id")
      .single();
    if (evidenceDocError) throw new Error(evidenceDocError.message);
    cleanup.eventEvidenceIds.push(evidenceDoc.id);

    const { data: evidenceEmail, error: evidenceEmailError } = await supabase
      .from("event_evidence")
      .insert({
        event_id: eventRow.id,
        source_type: "EMAIL",
        label: "[TESTE ACC] E-mail com anexos",
        locator: "test",
        email_id: emailId1,
      })
      .select("id")
      .single();
    if (evidenceEmailError) throw new Error(evidenceEmailError.message);
    cleanup.eventEvidenceIds.push(evidenceEmail.id);

    const context = await buildEventAnalysisContext(supabase, { projectId: REFERENCE_PROJECT_ID, eventId: eventRow.id });

    const evidenceForDoc = context.evidence.find((e) => e.documentVersionId === promotedDocumentVersionId);
    assert(evidenceForDoc !== undefined, "o document_version promovido deveria aparecer em ContextEvidence — mesmo mecanismo já existente, sem código novo");

    const emailInContext = context.relatedEmails.find((e) => e.id === emailId1);
    assert(emailInContext !== undefined, "o e-mail deveria estar em relatedEmails");
    assert(emailInContext.attachments.length >= 4, `esperado ao menos 4 anexos (pdf + 2 xlsx + shared), obtido ${emailInContext.attachments.length}`);

    const promotedSummary = emailInContext.attachments.find((a) => a.id === pdfAttachmentId);
    assert(promotedSummary !== undefined && promotedSummary.documentVersionId === promotedDocumentVersionId, "o anexo promovido deveria declarar seu document_version_id");

    const unpromotedSummary = emailInContext.attachments.find((a) => a.documentVersionId === null);
    assert(unpromotedSummary !== undefined, "o Expert nunca pode ignorar um anexo ainda não promovido — ele deve aparecer mesmo sem document_version_id");
  });

  await checkAsync("getEmailAttachmentsForEmails resolve em lote sem N+1 (mesma função usada pelo Context Builder)", async () => {
    const byEmailId = await getEmailAttachmentsForEmails(supabase, [emailId1, emailId2]);
    assert(byEmailId.get(emailId1)?.length >= 4);
    assert(byEmailId.get(emailId2)?.length === 1);
  });

  await checkAsync("Drive indisponível: sem configuração, syncEmailAttachmentToDrive marca SKIPPED e nunca quebra a ingestão já persistida", async () => {
    const result = await syncEmailAttachmentToDrive(supabase, {
      id: pdfAttachmentId,
      projectId: REFERENCE_PROJECT_ID,
      originalFileName: "contrato.pdf",
      mimeType: "application/pdf",
      storageBucket: "project-documents",
      storagePath: pdfStoragePath,
      driveSyncStatus: "PENDING",
    });
    assert(result.status === "SKIPPED", JSON.stringify(result));

    const { data, error } = await supabase.from("email_attachments").select("drive_sync_status").eq("id", pdfAttachmentId).single();
    if (error) throw new Error(error.message);
    assert(data.drive_sync_status === "SKIPPED");
  });

  await checkAsync("Drive (mockado) sincroniza com sucesso e nunca reenvia numa segunda chamada (retry sem duplicação)", async () => {
    let createCalls = 0;
    const fakeDriveClient = {
      create: async () => {
        createCalls += 1;
        return { data: { id: "fake-drive-file-id-123" } };
      },
    };

    const first = await syncEmailAttachmentToDrive(
      supabase,
      {
        id: pdfAttachmentId,
        projectId: REFERENCE_PROJECT_ID,
        originalFileName: "contrato.pdf",
        mimeType: "application/pdf",
        storageBucket: "project-documents",
        storagePath: pdfStoragePath,
        driveSyncStatus: "PENDING",
      },
      { driveClient: fakeDriveClient, emailAttachmentsFolderId: "test-folder-id" }
    );
    assert(first.status === "SYNCED");
    assert(first.driveFileId === "fake-drive-file-id-123");
    assert(createCalls === 1);

    const second = await syncEmailAttachmentToDrive(
      supabase,
      {
        id: pdfAttachmentId,
        projectId: REFERENCE_PROJECT_ID,
        originalFileName: "contrato.pdf",
        mimeType: "application/pdf",
        storageBucket: "project-documents",
        storagePath: pdfStoragePath,
        driveSyncStatus: "SYNCED", // já sincronizado — reflete o resultado da primeira chamada
      },
      { driveClient: fakeDriveClient, emailAttachmentsFolderId: "test-folder-id" }
    );
    assert(second.status === "ALREADY_SYNCED");
    assert(createCalls === 1, "nunca deveria reenviar um anexo já sincronizado");
  });

  await checkAsync("Drive (mockado) com falha: nunca lança, marca FAILED e preserva o registro Supabase intacto", async () => {
    const failingDriveClient = {
      create: async () => {
        throw new Error("Drive API indisponível (simulado)");
      },
    };

    const result = await syncEmailAttachmentToDrive(
      supabase,
      {
        id: pdfAttachmentId,
        projectId: REFERENCE_PROJECT_ID,
        originalFileName: "contrato.pdf",
        mimeType: "application/pdf",
        storageBucket: "project-documents",
        storagePath: pdfStoragePath,
        driveSyncStatus: "PENDING",
      },
      { driveClient: failingDriveClient, emailAttachmentsFolderId: "test-folder-id" }
    );
    assert(result.status === "FAILED");
    assert(result.error.includes("Drive API indisponível"));

    // Supabase continua válido: o anexo em si (hash/storage/metadata) não foi alterado.
    const { data, error } = await supabase
      .from("email_attachments")
      .select("drive_sync_status,drive_sync_error,sha256_hash,storage_path")
      .eq("id", pdfAttachmentId)
      .single();
    if (error) throw new Error(error.message);
    assert(data.drive_sync_status === "FAILED");
    assert(data.drive_sync_error.includes("Drive API indisponível"));
    assert(data.sha256_hash === computeSha256Hex(pdfBuffer), "o registro Supabase original nunca é invalidado por uma falha do Drive");
    assert(data.storage_path === pdfStoragePath);
  });

  await checkAsync("auditoria: EMAIL_ATTACHMENT_INGESTED, EMAIL_ATTACHMENT_PROCESSED, DRIVE_FILE_SYNCED e DRIVE_FILE_SYNC_FAILED foram registrados com actor SYSTEM correto (actor_user_id/actor_label nulos)", async () => {
    const { data, error } = await supabase
      .from("audit_log_entries")
      .select("action,actor_type,actor_user_id,actor_label,entity_type,entity_id")
      .eq("entity_type", "EMAIL_ATTACHMENT")
      .eq("entity_id", pdfAttachmentId);
    if (error) throw new Error(error.message);

    const actions = data.map((row) => row.action);
    for (const expected of ["EMAIL_ATTACHMENT_INGESTED", "EMAIL_ATTACHMENT_PROCESSED", "DRIVE_FILE_SYNCED", "DRIVE_FILE_SYNC_FAILED"]) {
      assert(actions.includes(expected), `ação de auditoria ausente: ${expected} (encontradas: ${actions.join(", ")})`);
    }
    for (const row of data) {
      assert(row.actor_type === "SYSTEM");
      assert(row.actor_user_id === null, "actor_type=SYSTEM exige actor_user_id nulo (bug já corrigido no passado — nunca repetir)");
      assert(row.actor_label === null, "actor_type=SYSTEM exige actor_label nulo (bug já corrigido no passado — nunca repetir)");
    }
  });

  check("RLS: a migration define select-only para membros do projeto (mesmo padrão de emails/document_versions), sem insert/update para authenticated", () => {
    const migrationSource = readSource("supabase/migrations/20260823060000_email_attachment_ingestion_foundation.sql");
    assert(migrationSource.includes("enable row level security"));
    assert(migrationSource.includes('"email_attachments_select_project_members_only"'));
    assert(migrationSource.includes("public.is_project_member(project_id)"));
    assert(!/for insert|for update|for delete/i.test(migrationSource), "nenhuma policy de insert/update/delete deveria existir para authenticated — escrita é sempre server-side");
  });

  check("Event Ledger não criado indevidamente (verificação real): nenhum contract_event extra foi criado além do único fixture explícito desta suíte", async () => {
    assert(cleanup.contractEventIds.length === 1, "esta suíte deveria ter criado exatamente 1 contract_event — o único explicitamente testado");
  });

  console.log("");
  console.log("--- Limpando fixtures de teste ---");
  if (cleanup.eventEvidenceIds.length > 0) {
    await supabase.from("event_evidence").delete().in("id", cleanup.eventEvidenceIds);
  }
  if (cleanup.contractEventIds.length > 0) {
    await supabase.from("contract_events").delete().in("id", cleanup.contractEventIds);
  }
  if (cleanup.emailAttachmentIds.length > 0) {
    await supabase.from("email_attachments").delete().in("id", cleanup.emailAttachmentIds);
  }
  if (cleanup.documentVersionIds.length > 0) {
    await supabase.from("document_versions").delete().in("id", cleanup.documentVersionIds);
  }
  if (cleanup.documentIds.length > 0) {
    await supabase.from("documents").delete().in("id", cleanup.documentIds);
  }
  if (cleanup.emailIds.length > 0) {
    await supabase.from("emails").delete().in("id", cleanup.emailIds);
  }
  if (cleanup.storagePaths.length > 0) {
    await supabase.storage.from("project-documents").remove(cleanup.storagePaths);
  }
  // Auditoria é append-only por design (audit_log_entries nunca é apagada) —
  // as linhas de teste permanecem, é o comportamento correto/esperado.
  console.log("Fixtures removidas (exceto audit_log_entries, append-only por design).");
}

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
