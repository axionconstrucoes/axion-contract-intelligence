// Testes da aba "Anexos de E-mail" (Documentos) — lógica pura de
// registry (sem I/O, fixtures em memória) + a RPC nova
// promote_email_attachment_to_document contra o Supabase real (mesmo
// padrão de outras suítes: service-role para fixtures, client anônimo
// e um usuário autenticado real de verdade para provar RLS/permissão em
// runtime, não só por leitura de texto). NUNCA chama a API Anthropic —
// este pacote não envolve IA generativa, só leitura/composição de dados
// já existentes.
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/test-documentos-email-attachments-tab.mjs

import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const { resolveAttachmentDisplayStatus } = await import("../apps/web/lib/email/attachments/registry/resolve-display-status");
const { buildEmailAttachmentRegistryRows } = await import("../apps/web/lib/email/attachments/registry/build-registry-rows");
const { filterEmailAttachmentRows, searchEmailAttachmentRows, sortEmailAttachmentRows } = await import(
  "../apps/web/lib/email/attachments/registry/filter-sort-rows"
);
const { resolveFileExtensionLabel } = await import("../apps/web/lib/email/attachments/registry/resolve-file-extension");
const { ACC_FEATURE_HELP } = await import("../apps/web/lib/ui/feature-help");
const { severityLabels } = await import("../apps/web/lib/labels");
const { EXPERT_PROVIDER_ENV_VAR } = await import("../apps/web/lib/ai/providers/resolve-provider-for-expert");

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

// Nunca chama IA real, mesmo que nenhum teste aqui use Experts de verdade.
const ALL_PROVIDER_ENV_VARS = [...Object.values(EXPERT_PROVIDER_ENV_VAR), "AXION_AI_PROVIDER"];
const originalProviderEnv = Object.fromEntries(ALL_PROVIDER_ENV_VARS.map((name) => [name, process.env[name]]));
for (const name of ALL_PROVIDER_ENV_VARS) process.env[name] = "fake";
function restoreProviderEnv() {
  for (const name of ALL_PROVIDER_ENV_VARS) {
    if (originalProviderEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalProviderEnv[name];
  }
}

console.log("");
console.log("======================================");
console.log("ANEXOS DE E-MAIL (Documentos) — TESTES");
console.log("======================================");
console.log("");

// ---------------- resolveAttachmentDisplayStatus (mapeamento visual, nunca enum paralelo) ----------------

check("status: FAILED (promoção) => Falha no processamento, tone=failed", () => {
  const status = resolveAttachmentDisplayStatus("FAILED", null);
  assert(status.label === "Falha no processamento");
  assert(status.tone === "failed");
});

check("status: PENDING (ainda não promovido) => aguardando, tone=pending, nunca 'processado'", () => {
  const status = resolveAttachmentDisplayStatus("PENDING", null);
  assert(status.tone === "pending");
  assert(!/processado/i.test(status.label) || /aguardando/i.test(status.label));
});

check("status: PROCESSED (promovido) + document_version AWAITING_PROCESSING => aguardando, nunca 'processado'", () => {
  const status = resolveAttachmentDisplayStatus("PROCESSED", "AWAITING_PROCESSING");
  assert(status.tone === "pending");
  assert(status.label === "Aguardando processamento");
});

check("status: PROCESSED + document_version PROCESSING => Em processamento", () => {
  const status = resolveAttachmentDisplayStatus("PROCESSED", "PROCESSING");
  assert(status.label === "Em processamento");
  assert(status.tone === "processing");
});

check("status: PROCESSED + document_version PROCESSED => Processado (só aqui é realmente 'processado')", () => {
  const status = resolveAttachmentDisplayStatus("PROCESSED", "PROCESSED");
  assert(status.label === "Processado");
  assert(status.tone === "processed");
});

check("status: PROCESSED + document_version FAILED => Falha no processamento (extração, distinta da promoção)", () => {
  const status = resolveAttachmentDisplayStatus("PROCESSED", "FAILED");
  assert(status.tone === "failed");
});

// ---------------- buildEmailAttachmentRegistryRows (função pura, fixtures em memória) ----------------

function makeAttachment(overrides) {
  return {
    id: overrides.id ?? randomUUID(),
    projectId: "proj-1",
    emailId: overrides.emailId ?? "email-1",
    gmailMessageId: "gmail-msg-1",
    gmailThreadId: null,
    gmailAttachmentId: overrides.gmailAttachmentId ?? "att-1",
    originalFileName: overrides.originalFileName ?? "planilha.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    fileSizeBytes: 2048,
    sha256Hash: overrides.sha256Hash ?? "a".repeat(64),
    storageBucket: "project-documents",
    storagePath: "proj-1/email-attachments/email-1/att-1-planilha.xlsx",
    receivedAt: "2026-08-10T10:00:00.000Z",
    ingestedAt: "2026-08-10T10:00:05.000Z",
    processingStatus: overrides.processingStatus ?? "PENDING",
    processingError: null,
    documentVersionId: overrides.documentVersionId ?? null,
    sourceLanguage: null,
    driveSyncStatus: "PENDING",
    driveFileId: null,
    driveSyncedAt: null,
    driveSyncError: null,
    createdAt: "2026-08-10T10:00:05.000Z",
    ...overrides,
  };
}

function makeEmail(overrides) {
  return {
    id: overrides.id ?? "email-1",
    projectId: "proj-1",
    from: overrides.from ?? "cliente@example.com",
    to: "axion@example.com",
    subject: overrides.subject ?? "Planilha de quantitativos",
    date: overrides.date ?? "2026-08-09T08:00:00.000Z",
    snippet: "segue planilha",
    ...overrides,
  };
}

function makeFinding(overrides) {
  return {
    id: overrides.id ?? randomUUID(),
    projectId: "proj-1",
    curationRunId: null,
    findingType: "CLIENT_SOURCE_CONFRONTATION",
    classification: "COMPATIBLE",
    expertIds: overrides.expertIds ?? [],
    severity: overrides.severity ?? "MEDIUM",
    confidence: 0.8,
    facts: [],
    interpretation: "teste",
    recommendation: "teste",
    grounding: null,
    sourceRefs: overrides.sourceRefs ?? [],
    conflictingSourceRefs: overrides.conflictingSourceRefs ?? [],
    requiresHumanReview: true,
    lifecycleStatus: "NEW",
    supersededByFindingId: null,
    fingerprint: randomUUID(),
    reviewerNote: null,
    reviewedByUserId: null,
    reviewedAt: null,
    effectiveDate: null,
    resolutionDescription: null,
    resolutionApproximateDate: null,
    resolutionEvidenceNote: null,
    createdAt: "2026-08-10T10:00:00.000Z",
    updatedAt: "2026-08-10T10:00:00.000Z",
    ...overrides,
  };
}

function makeCurationRun(overrides) {
  return {
    id: overrides.id ?? randomUUID(),
    projectId: "proj-1",
    sourceType: overrides.sourceType ?? "EMAIL_ATTACHMENT",
    sourceId: overrides.sourceId,
    sourceFingerprint: "fp-1",
    triggerType: "AUTOMATIC",
    status: "COMPLETED",
    routedExpertIds: overrides.routedExpertIds ?? [],
    errorMessage: null,
    startedAt: "2026-08-10T10:00:00.000Z",
    completedAt: "2026-08-10T10:00:01.000Z",
    createdByType: "SYSTEM",
    createdByUserId: null,
    createdByLabel: null,
    createdAt: "2026-08-10T10:00:00.000Z",
    ...overrides,
  };
}

check("uma linha por email/attachment: 2 attachments do mesmo hash em e-mails diferentes => 2 linhas (nunca colapsa)", () => {
  const a1 = makeAttachment({ id: "att-a", emailId: "email-1", sha256Hash: "b".repeat(64) });
  const a2 = makeAttachment({ id: "att-b", emailId: "email-2", sha256Hash: "b".repeat(64) });
  const rows = buildEmailAttachmentRegistryRows({
    attachments: [a1, a2],
    emailsById: new Map([
      ["email-1", makeEmail({ id: "email-1" })],
      ["email-2", makeEmail({ id: "email-2", subject: "Reenvio" })],
    ]),
    findings: [],
    curationRuns: [],
    linkedDocumentVersionsById: new Map(),
  });
  assert(rows.length === 2, "mesmo hash em e-mails diferentes deve gerar 2 linhas, nunca 1");
  assert(rows.every((r) => r.sameContentOccurrenceCount === 2), "cada linha deve indicar 2 ocorrências do mesmo conteúdo");
});

check("hash diferente => sameContentOccurrenceCount = 1 em cada linha", () => {
  const a1 = makeAttachment({ id: "att-a", sha256Hash: "c".repeat(64) });
  const a2 = makeAttachment({ id: "att-b", emailId: "email-2", sha256Hash: "d".repeat(64) });
  const rows = buildEmailAttachmentRegistryRows({
    attachments: [a1, a2],
    emailsById: new Map([
      ["email-1", makeEmail({ id: "email-1" })],
      ["email-2", makeEmail({ id: "email-2" })],
    ]),
    findings: [],
    curationRuns: [],
    linkedDocumentVersionsById: new Map(),
  });
  assert(rows.every((r) => r.sameContentOccurrenceCount === 1));
});

check("data vem do e-mail (não da data de ingestão) quando o e-mail existe", () => {
  const attachment = makeAttachment({ id: "att-a", receivedAt: "2026-08-10T10:00:00.000Z" });
  const rows = buildEmailAttachmentRegistryRows({
    attachments: [attachment],
    emailsById: new Map([["email-1", makeEmail({ date: "2026-01-01T00:00:00.000Z" })]]),
    findings: [],
    curationRuns: [],
    linkedDocumentVersionsById: new Map(),
  });
  assert(rows[0].email.date === "2026-01-01T00:00:00.000Z", "linha deve carregar a data real do e-mail para exibição");
});

check("filename/tipo/subject/remetente presentes na linha", () => {
  const attachment = makeAttachment({ originalFileName: "contrato.pdf" });
  const rows = buildEmailAttachmentRegistryRows({
    attachments: [attachment],
    emailsById: new Map([["email-1", makeEmail({ from: "joao@cliente.com", subject: "Contrato assinado" })]]),
    findings: [],
    curationRuns: [],
    linkedDocumentVersionsById: new Map(),
  });
  const row = rows[0];
  assert(row.attachment.originalFileName === "contrato.pdf");
  assert(resolveFileExtensionLabel(row.attachment.originalFileName) === "PDF");
  assert(row.email.subject === "Contrato assinado");
  assert(row.email.from === "joao@cliente.com");
});

check("processado != considerado: attachment PROCESSED (promovido) sem finding/curation run => consideradoByAcc = false", () => {
  const attachment = makeAttachment({ id: "att-a", processingStatus: "PROCESSED", documentVersionId: "dv-1" });
  const rows = buildEmailAttachmentRegistryRows({
    attachments: [attachment],
    emailsById: new Map([["email-1", makeEmail({})]]),
    findings: [],
    curationRuns: [],
    linkedDocumentVersionsById: new Map([
      ["dv-1", { documentId: "doc-1", documentVersionId: "dv-1", documentTitle: "X", documentKind: "CLARIFICACAO_CLIENTE", processingStatus: "PROCESSED" }],
    ]),
  });
  assert(rows[0].displayStatus.label === "Processado", "conteúdo deveria estar processado");
  assert(rows[0].consideredByAcc === false, "processado nunca implica considerado, sem referência real");
});

check("considerado exige referência real via source_refs (finding) — nunca inferido por status/filename", () => {
  const attachment = makeAttachment({ id: "att-target" });
  const otherAttachment = makeAttachment({ id: "att-other", gmailAttachmentId: "att-2" });
  const finding = makeFinding({ sourceRefs: [{ type: "EMAIL_ATTACHMENT", id: "att-target" }] });
  const rows = buildEmailAttachmentRegistryRows({
    attachments: [attachment, otherAttachment],
    emailsById: new Map([["email-1", makeEmail({})]]),
    findings: [finding],
    curationRuns: [],
    linkedDocumentVersionsById: new Map(),
  });
  const target = rows.find((r) => r.attachment.id === "att-target");
  const other = rows.find((r) => r.attachment.id === "att-other");
  assert(target.consideredByAcc === true, "attachment referenciado no source_refs deve estar considerado");
  assert(other.consideredByAcc === false, "attachment NÃO referenciado nunca deve ser marcado considerado por engano");
});

check("considerado também via conflicting_source_refs", () => {
  const attachment = makeAttachment({ id: "att-target" });
  const finding = makeFinding({ conflictingSourceRefs: [{ type: "EMAIL_ATTACHMENT", id: "att-target" }] });
  const rows = buildEmailAttachmentRegistryRows({
    attachments: [attachment],
    emailsById: new Map([["email-1", makeEmail({})]]),
    findings: [finding],
    curationRuns: [],
    linkedDocumentVersionsById: new Map(),
  });
  assert(rows[0].consideredByAcc === true);
});

check("considerado também via ai_curation_run direto (mesmo sem finding gerado)", () => {
  const attachment = makeAttachment({ id: "att-target" });
  const run = makeCurationRun({ sourceType: "EMAIL_ATTACHMENT", sourceId: "att-target", routedExpertIds: ["legal-consultant"] });
  const rows = buildEmailAttachmentRegistryRows({
    attachments: [attachment],
    emailsById: new Map([["email-1", makeEmail({})]]),
    findings: [],
    curationRuns: [run],
    linkedDocumentVersionsById: new Map(),
  });
  assert(rows[0].consideredByAcc === true, "curation run sem finding ainda é evidência real de uso");
});

check("curation run de outro source_type (ex.: EMAIL) nunca marca o attachment como considerado", () => {
  const attachment = makeAttachment({ id: "att-target" });
  const run = makeCurationRun({ sourceType: "EMAIL", sourceId: "email-1" });
  const rows = buildEmailAttachmentRegistryRows({
    attachments: [attachment],
    emailsById: new Map([["email-1", makeEmail({})]]),
    findings: [],
    curationRuns: [run],
    linkedDocumentVersionsById: new Map(),
  });
  assert(rows[0].consideredByAcc === false, "evidência do e-mail como um todo nunca deve ser confundida com o attachment específico");
});

check("Experts agregados: múltiplos Experts não duplicam a linha, só agregam", () => {
  const attachment = makeAttachment({ id: "att-target" });
  const finding1 = makeFinding({ sourceRefs: [{ type: "EMAIL_ATTACHMENT", id: "att-target" }], expertIds: ["legal-consultant"] });
  const finding2 = makeFinding({ sourceRefs: [{ type: "EMAIL_ATTACHMENT", id: "att-target" }], expertIds: ["commercial-director", "legal-consultant"] });
  const rows = buildEmailAttachmentRegistryRows({
    attachments: [attachment],
    emailsById: new Map([["email-1", makeEmail({})]]),
    findings: [finding1, finding2],
    curationRuns: [],
    linkedDocumentVersionsById: new Map(),
  });
  assert(rows.length === 1, "nunca duplicar linha por finding/Expert");
  assert(rows[0].expertIds.length === 2, "Experts devem ser deduplicados (legal-consultant citado 2x)");
  assert(rows[0].expertIds.includes("legal-consultant") && rows[0].expertIds.includes("commercial-director"));
});

check("findings agregados: múltiplos findings não duplicam a linha, count correto e maior severidade", () => {
  const attachment = makeAttachment({ id: "att-target" });
  const findingLow = makeFinding({ sourceRefs: [{ type: "EMAIL_ATTACHMENT", id: "att-target" }], severity: "LOW" });
  const findingCritical = makeFinding({ sourceRefs: [{ type: "EMAIL_ATTACHMENT", id: "att-target" }], severity: "CRITICAL" });
  const findingMedium = makeFinding({ sourceRefs: [{ type: "EMAIL_ATTACHMENT", id: "att-target" }], severity: "MEDIUM" });
  const rows = buildEmailAttachmentRegistryRows({
    attachments: [attachment],
    emailsById: new Map([["email-1", makeEmail({})]]),
    findings: [findingLow, findingCritical, findingMedium],
    curationRuns: [],
    linkedDocumentVersionsById: new Map(),
  });
  assert(rows.length === 1);
  assert(rows[0].findings.count === 3, `esperado 3 findings, obtido ${rows[0].findings.count}`);
  assert(rows[0].findings.highestSeverity === "CRITICAL", "deve reportar a MAIOR severidade entre os findings");
});

check("Documento ACC: linkedDocument presente somente quando document_version_id aponta para um doc real conhecido", () => {
  const attachment = makeAttachment({ id: "att-a", processingStatus: "PROCESSED", documentVersionId: "dv-1" });
  const rows = buildEmailAttachmentRegistryRows({
    attachments: [attachment],
    emailsById: new Map([["email-1", makeEmail({})]]),
    findings: [],
    curationRuns: [],
    linkedDocumentVersionsById: new Map([
      ["dv-1", { documentId: "doc-1", documentVersionId: "dv-1", documentTitle: "Contrato", documentKind: "CONTRATO_BASE", processingStatus: "AWAITING_PROCESSING" }],
    ]),
  });
  assert(rows[0].linkedDocument !== null);
  assert(rows[0].linkedDocument.documentTitle === "Contrato");
});

check("promoção nunca automática: buildEmailAttachmentRegistryRows nunca escreve nada (função pura) — nenhuma referência a insert/update/rpc no arquivo", () => {
  const source = readSource("apps/web/lib/email/attachments/registry/build-registry-rows.ts");
  assert(!/\.insert\(|\.update\(|\.rpc\(/.test(source), "build-registry-rows.ts deveria ser puramente de leitura/composição");
});

// ---------------- filtros/busca/ordenação (puros) ----------------

const sampleRows = buildEmailAttachmentRegistryRows({
  attachments: [
    makeAttachment({ id: "att-1", originalFileName: "aditivo.pdf", processingStatus: "PROCESSED", documentVersionId: "dv-1" }),
    makeAttachment({ id: "att-2", originalFileName: "planilha.xlsx", emailId: "email-2", sha256Hash: "e".repeat(64), receivedAt: "2026-08-01T00:00:00.000Z" }),
    makeAttachment({ id: "att-3", originalFileName: "foto.jpg", emailId: "email-3", sha256Hash: "f".repeat(64), receivedAt: "2026-08-15T00:00:00.000Z" }),
  ],
  emailsById: new Map([
    ["email-1", makeEmail({ id: "email-1", subject: "Aditivo contratual", from: "gestor@cliente.com", date: "2026-08-10T00:00:00.000Z" })],
    ["email-2", makeEmail({ id: "email-2", subject: "Planilha", from: "engenharia@cliente.com", date: "2026-08-01T00:00:00.000Z" })],
    ["email-3", makeEmail({ id: "email-3", subject: "Fotos da obra", from: "campo@cliente.com", date: "2026-08-15T00:00:00.000Z" })],
  ]),
  findings: [makeFinding({ sourceRefs: [{ type: "EMAIL_ATTACHMENT", id: "att-3" }], severity: "HIGH" })],
  curationRuns: [],
  linkedDocumentVersionsById: new Map([
    ["dv-1", { documentId: "doc-1", documentVersionId: "dv-1", documentTitle: "Aditivo", documentKind: "ADITIVO", processingStatus: "PROCESSED" }],
  ]),
});

check("filtro CONSIDERADOS_PELO_ACC", () => {
  const result = filterEmailAttachmentRows(sampleRows, "CONSIDERADOS_PELO_ACC");
  assert(result.length === 1 && result[0].attachment.id === "att-3");
});

check("filtro INCORPORADOS_A_DOCUMENTOS", () => {
  const result = filterEmailAttachmentRows(sampleRows, "INCORPORADOS_A_DOCUMENTOS");
  assert(result.length === 1 && result[0].attachment.id === "att-1");
});

check("filtro COM_FINDINGS", () => {
  const result = filterEmailAttachmentRows(sampleRows, "COM_FINDINGS");
  assert(result.length === 1 && result[0].attachment.id === "att-3");
});

check("filtro TODOS devolve tudo", () => {
  assert(filterEmailAttachmentRows(sampleRows, "TODOS").length === 3);
});

check("busca por filename", () => {
  const result = searchEmailAttachmentRows(sampleRows, "planilha");
  assert(result.length === 1 && result[0].attachment.id === "att-2");
});

check("busca por subject", () => {
  const result = searchEmailAttachmentRows(sampleRows, "fotos da obra");
  assert(result.length === 1 && result[0].attachment.id === "att-3");
});

check("busca por remetente", () => {
  const result = searchEmailAttachmentRows(sampleRows, "engenharia@cliente.com");
  assert(result.length === 1 && result[0].attachment.id === "att-2");
});

check("ordenação por DATA desc (default): mais recente primeiro", () => {
  const result = sortEmailAttachmentRows(sampleRows, "DATA", "desc");
  assert(result[0].attachment.id === "att-3", "att-3 (15/08) deveria vir primeiro");
  assert(result[2].attachment.id === "att-2", "att-2 (01/08) deveria vir por último");
});

check("ordenação por NOME", () => {
  const result = sortEmailAttachmentRows(sampleRows, "NOME", "asc");
  assert(result[0].attachment.originalFileName === "aditivo.pdf");
});

check("ordenação por RISCO", () => {
  const result = sortEmailAttachmentRows(sampleRows, "RISCO", "desc");
  assert(result[0].attachment.id === "att-3", "único com finding (HIGH) deveria vir primeiro em ordenação desc por risco");
});

// ---------------- SOURCE_REQUIRES_PROCESSING / FAILED (seções 22/23) ----------------

check("attachment ainda não processado nunca aparece com conclusão/risco derivado do conteúdo (só status aguardando)", () => {
  const attachment = makeAttachment({ id: "att-a", processingStatus: "PENDING" });
  const rows = buildEmailAttachmentRegistryRows({
    attachments: [attachment],
    emailsById: new Map([["email-1", makeEmail({})]]),
    findings: [],
    curationRuns: [],
    linkedDocumentVersionsById: new Map(),
  });
  assert(rows[0].displayStatus.tone === "pending");
  assert(rows[0].findings.count === 0);
  assert(rows[0].consideredByAcc === false);
});

check("attachment com falha de processamento nunca é escondido — aparece com status FAILED", () => {
  const attachment = makeAttachment({ id: "att-a", processingStatus: "FAILED" });
  const rows = buildEmailAttachmentRegistryRows({
    attachments: [attachment],
    emailsById: new Map([["email-1", makeEmail({})]]),
    findings: [],
    curationRuns: [],
    linkedDocumentVersionsById: new Map(),
  });
  assert(rows.length === 1, "attachment com falha nunca deve ser omitido da listagem");
  assert(rows[0].displayStatus.tone === "failed");
});

// ---------------- Rótulos PT-BR / risco (nunca HIGH/CRITICAL/Alta/Crítica visível) ----------------

check("labels de risco PT-BR corretos (Baixo/Médio/Alto/Crítico)", () => {
  assert(severityLabels.BAIXA === "Baixo");
  assert(severityLabels.MEDIA === "Médio");
  assert(severityLabels.ALTA === "Alto");
  assert(severityLabels.CRITICA === "Crítico");
});

check("registry: documentos-tab-anexos-email, anexos-considerado, anexos-incorporado existem e não vazam HIGH/CRITICAL/Alta/Crítica", () => {
  for (const id of ["documentos-tab-anexos-email", "anexos-considerado", "anexos-incorporado"]) {
    const def = ACC_FEATURE_HELP[id];
    assert(def, `${id} ausente do registry`);
    const allText = `${def.title} ${def.shortDescription} ${def.description}`;
    assert(!/\bHIGH\b|\bCRITICAL\b|\bAlta\b|\bCrítica\b/.test(allText), `${id} vaza termo de risco incorreto: "${allText}"`);
  }
});

// ---------------- Estrutural: FeatureInfo, reuso de SeverityBadge/ícones de Expert, sem sistema paralelo ----------------

check("aba Documentos: TabsTrigger 'Anexos de E-mail' com FeatureInfo irmão (mesmo padrão das outras abas)", () => {
  const source = readSource("apps/web/app/[projectId]/documentos/page.tsx");
  assert(source.includes('value="anexos-email"'));
  assert(source.includes('helpId="documentos-tab-anexos-email"'));
  assert(source.includes("EmailAttachmentsPanel"));
});

check("linha do attachment: reutiliza SeverityBadge/AttachmentStatusBadge/ícones de Expert — nunca paleta nova", () => {
  const source = readSource("apps/web/components/documents/email-attachment-row.tsx");
  assert(source.includes('from "@/components/shared/badges"'));
  assert(source.includes("SeverityBadge"));
  assert(source.includes("AttachmentStatusBadge"));
  assert(source.includes("resolveExpertIcon"));
  assert(source.includes('helpId="anexos-considerado"'));
  assert(source.includes('helpId="anexos-incorporado"'));
});

check("promoção (Stage B) é sempre humana: o form nunca preenche kind/título automaticamente sem interação, e chama a Server Action existente (não reimplementa a escrita)", () => {
  const formSource = readSource("apps/web/components/documents/email-attachment-promote-form.tsx");
  assert(formSource.includes("promoteEmailAttachmentAction"));
  assert(!/\.from\(["']documents["']\)\.insert|\.from\(["']document_versions["']\)\.insert/.test(formSource), "o form client nunca deve escrever direto nas tabelas");

  const actionSource = readSource("apps/web/app/[projectId]/documentos/actions.ts");
  assert(actionSource.includes('rpc("promote_email_attachment_to_document"'));
  assert(!/\.from\(["']documents["']\)\.insert/.test(actionSource), "a Server Action deve delegar a escrita para a RPC, nunca reimplementar");
});

check("badges.tsx: AttachmentStatusBadge existe e reutiliza Badge/cn (sem paleta nova solta)", () => {
  const source = readSource("apps/web/components/shared/badges.tsx");
  assert(source.includes("export function AttachmentStatusBadge"));
});

// ---------------- Migration da RPC: EDITOR obrigatório, security definer, revoke/grant corretos ----------------

check("migration promote_email_attachment_to_document: security definer, exige EDITOR, nunca policy de INSERT ampla nova", () => {
  const source = readSource("supabase/migrations/20260823100000_promote_email_attachment_to_document.sql");
  assert(source.includes("security definer"));
  assert(source.includes("has_project_permission(v_attachment.project_id, 'EDITOR')"));
  assert(source.includes("auth.uid()"));
  assert(source.includes("revoke all"));
  assert(source.includes("grant execute"));
  assert(source.includes("to authenticated"));
  assert(!/create policy/.test(source), "esta migration não deveria criar nenhuma policy nova — só a RPC SECURITY DEFINER");
  assert(source.includes("actor_type"), "deve registrar auditoria");
});

check("migration: nunca re-upload — reaproveita storage_path/storage_bucket do anexo já ingerido", () => {
  const source = readSource("supabase/migrations/20260823100000_promote_email_attachment_to_document.sql");
  assert(source.includes("v_attachment.storage_path"));
  assert(source.includes("v_attachment.storage_bucket"));
  assert(!/storage\.objects/.test(source), "não deve manipular storage.objects diretamente — só reaproveitar a referência já existente");
});

// ---------------- Testes reais contra o Supabase ----------------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const REFERENCE_PROJECT_ID = "00000000-0000-4000-8000-000000000001";

if (!supabaseUrl || !serviceKey) {
  console.log("SKIP testes com Supabase real — Supabase não configurado.");
} else {
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const cleanup = {
    emailIds: [],
    attachmentIds: [],
    documentIds: [],
    membershipUserIds: [],
    authUserIds: [],
  };

  function fixtureHash(seed) {
    return createHash("sha256").update(seed).digest("hex");
  }

  async function insertFixtureEmailAndAttachment(suffix) {
    const { data: email, error: emailError } = await supabase
      .from("emails")
      .insert({
        project_id: REFERENCE_PROJECT_ID,
        from_address: "cliente@example.com",
        to_address: "axion@example.com",
        subject: `Anexo de teste ${suffix}`,
        sent_at: new Date().toISOString(),
        snippet: "teste automatizado",
      })
      .select("id")
      .single();
    if (emailError) throw new Error(`fixture email: ${emailError.message}`);
    cleanup.emailIds.push(email.id);

    const attachmentIdSeed = randomUUID();
    const { data: attachment, error: attachmentError } = await supabase
      .from("email_attachments")
      .insert({
        project_id: REFERENCE_PROJECT_ID,
        email_id: email.id,
        gmail_message_id: `gmail-msg-${suffix}`,
        gmail_attachment_id: `gmail-att-${suffix}`,
        original_file_name: `teste-${suffix}.pdf`,
        mime_type: "application/pdf",
        file_size_bytes: 1024,
        sha256_hash: fixtureHash(attachmentIdSeed),
        storage_bucket: "project-documents",
        storage_path: `${REFERENCE_PROJECT_ID}/email-attachments/${email.id}/${attachmentIdSeed}-teste-${suffix}.pdf`,
        received_at: new Date().toISOString(),
      })
      .select("id, project_id")
      .single();
    if (attachmentError) throw new Error(`fixture attachment: ${attachmentError.message}`);
    cleanup.attachmentIds.push(attachment.id);
    return { emailId: email.id, attachmentId: attachment.id };
  }

  await checkAsync("RPC promote_email_attachment_to_document: sessão anônima é rejeitada (auth.uid() nulo)", async () => {
    if (!anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ausente — não é possível testar RLS anônima.");
    const { attachmentId } = await insertFixtureEmailAndAttachment("anon");
    const anonClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await anonClient.rpc("promote_email_attachment_to_document", {
      p_attachment_id: attachmentId,
      p_kind: "CLARIFICACAO_CLIENTE",
      p_document_title: "Não deveria criar",
      p_document_date: "2026-08-10",
      p_author: "Teste",
      p_summary: "Teste",
    });
    assert(error !== null, "chamada anônima deveria ser rejeitada");

    const { count } = await supabase.from("documents").select("id", { count: "exact", head: true }).eq("title", "Não deveria criar");
    assert(!count, "nenhum documento deveria ter sido criado por uma chamada anônima");
  });

  await checkAsync("RPC: usuário autenticado sem EDITOR/ADMIN no projeto é rejeitado", async () => {
    if (!anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ausente.");
    const { attachmentId } = await insertFixtureEmailAndAttachment("noperm");

    const email = `teste-anexos-noperm-${Date.now()}@example.com`;
    const password = `Teste-${randomUUID()}`;
    const { data: created, error: createError } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
    if (createError) throw new Error(`criar usuário de teste: ${createError.message}`);
    cleanup.authUserIds.push(created.user.id);
    // Deliberadamente NENHUM project_memberships criado — usuário sem vínculo com o projeto.

    const sessionClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: signInError } = await sessionClient.auth.signInWithPassword({ email, password });
    if (signInError) throw new Error(`login de teste: ${signInError.message}`);

    const { error } = await sessionClient.rpc("promote_email_attachment_to_document", {
      p_attachment_id: attachmentId,
      p_kind: "CLARIFICACAO_CLIENTE",
      p_document_title: "Não deveria criar (sem permissão)",
      p_document_date: "2026-08-10",
      p_author: "Teste",
      p_summary: "Teste",
    });
    assert(error !== null, "usuário sem vínculo com o projeto deveria ser rejeitado");
    assert(/[Pp]ermiss/.test(error.message), `mensagem deveria indicar falta de permissão, obtido: "${error.message}"`);
  });

  await checkAsync("RPC: EDITOR promove com sucesso — cria documents/document_versions reaproveitando o Storage, atualiza o anexo, audita como USER, e é idempotente", async () => {
    if (!anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ausente.");
    const { attachmentId } = await insertFixtureEmailAndAttachment("editor");

    const email = `teste-anexos-editor-${Date.now()}@example.com`;
    const password = `Teste-${randomUUID()}`;
    const { data: created, error: createError } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
    if (createError) throw new Error(`criar usuário de teste: ${createError.message}`);
    cleanup.authUserIds.push(created.user.id);

    const { error: membershipError } = await supabase
      .from("project_memberships")
      .insert({ project_id: REFERENCE_PROJECT_ID, user_id: created.user.id, permission: "EDITOR" });
    if (membershipError) throw new Error(`vincular EDITOR: ${membershipError.message}`);
    cleanup.membershipUserIds.push(created.user.id);

    const sessionClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: signInError } = await sessionClient.auth.signInWithPassword({ email, password });
    if (signInError) throw new Error(`login de teste: ${signInError.message}`);

    const documentTitle = `Documento de teste ${Date.now()}`;
    const { data: firstResult, error: firstError } = await sessionClient
      .rpc("promote_email_attachment_to_document", {
        p_attachment_id: attachmentId,
        p_kind: "CLARIFICACAO_CLIENTE",
        p_document_title: documentTitle,
        p_document_date: "2026-08-10",
        p_author: "Cliente XYZ",
        p_summary: "Resumo de teste automatizado",
      })
      .single();
    if (firstError) throw new Error(`promoção deveria ter sucesso para EDITOR: ${firstError.message}`);
    assert(firstResult.document_id, "deveria devolver document_id");
    assert(firstResult.document_version_id, "deveria devolver document_version_id");
    cleanup.documentIds.push(firstResult.document_id);

    const { data: version } = await supabase
      .from("document_versions")
      .select("source_type, file_path, storage_bucket, processing_status, author, summary")
      .eq("id", firstResult.document_version_id)
      .single();
    assert(version.source_type === "EMAIL");
    assert(version.processing_status === "AWAITING_PROCESSING", "deve entrar na mesma fila de extração já existente");
    assert(version.author === "Cliente XYZ");

    const { data: attachmentRow } = await supabase
      .from("email_attachments")
      .select("document_version_id, processing_status, storage_path")
      .eq("id", attachmentId)
      .single();
    assert(attachmentRow.document_version_id === firstResult.document_version_id);
    assert(attachmentRow.processing_status === "PROCESSED");
    assert(attachmentRow.storage_path === version.file_path, "nunca re-upload — mesmo objeto do Storage reaproveitado");

    const { data: auditRows } = await supabase
      .from("audit_log_entries")
      .select("actor_type, actor_user_id, action")
      .eq("entity_type", "EMAIL_ATTACHMENT")
      .eq("entity_id", attachmentId)
      .eq("action", "EMAIL_ATTACHMENT_PROCESSED");
    assert(auditRows.length === 1, "deveria haver exatamente 1 entrada de auditoria para esta promoção");
    assert(auditRows[0].actor_type === "USER", "promoção humana deve ser auditada como USER, nunca SYSTEM");
    assert(auditRows[0].actor_user_id === created.user.id);

    // Idempotência: chamar de novo não deve criar um segundo documento.
    const { data: secondResult, error: secondError } = await sessionClient
      .rpc("promote_email_attachment_to_document", {
        p_attachment_id: attachmentId,
        p_kind: "CLARIFICACAO_CLIENTE",
        p_document_title: "Outro título — não deveria ser usado",
        p_document_date: "2026-08-10",
        p_author: "Outro autor",
        p_summary: "Outro resumo",
      })
      .single();
    if (secondError) throw new Error(`segunda chamada (idempotente) não deveria falhar: ${secondError.message}`);
    assert(secondResult.document_version_id === firstResult.document_version_id, "idempotente: mesmo document_version_id, nunca duplica");

    const { count: documentsCount } = await supabase
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("title", documentTitle);
    assert(documentsCount === 1, "nenhum documento duplicado deveria ter sido criado na segunda chamada");
  });

  console.log("");
  console.log("--- Limpando fixtures ---");
  if (cleanup.documentIds.length > 0) {
    await supabase.from("document_versions").delete().in("document_id", cleanup.documentIds);
    await supabase.from("documents").delete().in("id", cleanup.documentIds);
  }
  if (cleanup.attachmentIds.length > 0) {
    await supabase.from("email_attachments").delete().in("id", cleanup.attachmentIds);
  }
  if (cleanup.emailIds.length > 0) {
    await supabase.from("emails").delete().in("id", cleanup.emailIds);
  }
  if (cleanup.membershipUserIds.length > 0) {
    await supabase.from("project_memberships").delete().in("user_id", cleanup.membershipUserIds).eq("project_id", REFERENCE_PROJECT_ID);
  }
  for (const userId of cleanup.authUserIds) {
    await supabase.auth.admin.deleteUser(userId);
  }
  console.log("Fixtures removidas (exceto audit_log_entries, append-only por design).");
}

restoreProviderEnv();

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
