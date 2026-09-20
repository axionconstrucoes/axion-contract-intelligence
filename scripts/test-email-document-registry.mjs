// Consolidação — e-mails, documentos, cronograma, Curva S e navegação.
// Executa as funções REAIS de apps/web/lib/** contra stores em memória
// (nunca Gmail/Supabase; a migration ainda não foi aplicada por decisão
// explícita) e valida migration/UI por leitura estática. Cobre os 61
// itens obrigatórios agrupados: ESCALÃO, DUPLICIDADE, CLASSIFICAÇÃO,
// WNN, ANEXOS, RELATÓRIO SEMANAL EM EXCEL (Curva S/Linha de Base/
// Financeiro/Histograma/SSMA), BUSCA, MENU, SEGURANÇA.
//
// Uso:
//   node scripts/test-email-document-registry.mjs

import { readFileSync, existsSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import JSZip from "jszip";

register("./ts-module-resolver.mjs", import.meta.url);

const { resolveUserResponsibilityTier, listMatrixTierMembers } = await import("../apps/web/lib/sla/resolve-user-responsibility-tier");
const { evaluateWeeklyScheduleEmail } = await import("../apps/web/lib/schedule/weekly-ingestion/evaluate-weekly-schedule-email");
const { processWeeklyScheduleEmailCandidate, sanitizeErrorMessage } = await import("../apps/web/lib/schedule/weekly-ingestion/ingest-weekly-schedule-email");
const { createWeeklyAbsenceAlert, createWeeklySCurveAbsenceAlert } = await import("../apps/web/lib/schedule/weekly-ingestion/create-absence-alerts");
const { promoteReviewedIntake } = await import("../apps/web/lib/schedule/weekly-ingestion/promote-reviewed-intake");
const { classifyEmail, classifyAttachment, isSentToClient } = await import("../apps/web/lib/email/registry/classify-email-document");
const { classifySyncedEmails } = await import("../apps/web/lib/email/registry/classify-synced-emails");
const { parseWorkWeekSubject } = await import("../apps/web/lib/email/registry/parse-work-week-subject");
const { resolveAttachmentOpenBehavior } = await import("../apps/web/lib/email/registry/resolve-attachment-open-behavior");
const { parseRegistrySearchParams, REGISTRY_CLASSIFICATION_OPTIONS } = await import("../apps/web/lib/email/registry/email-document-registry-shared");
const { analyzeSCurve } = await import("../apps/web/lib/schedule/s-curve/analyze-s-curve");
const { readWorkbookSafely } = await import("../apps/web/lib/schedule/weekly-report/read-workbook");
const { identifyWeeklyReportSheets, normalizeSheetName } = await import("../apps/web/lib/schedule/weekly-report/identify-sheets");
const { processWorkbookGrids } = await import("../apps/web/lib/schedule/weekly-report/process-workbook");
const { processWeeklyReportWorkbooks } = await import("../apps/web/lib/schedule/weekly-report/process-weekly-report-workbooks");
const { routeSheetToExpert, WEEKLY_REPORT_CONSOLIDATOR } = await import("../apps/web/lib/schedule/weekly-report/analyze-sheets");
const { NAV_ITEMS } = await import("../apps/web/lib/ui/nav-items");

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const readSource = (relative) => readFileSync(path.join(repoRoot, relative), "utf8");
const MIGRATION = "supabase/migrations/20260920120000_weekly_schedule_email_ingestion_foundation.sql";

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (!condition) throw new Error(message ?? "assertion failed");
}
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

const PROJECT = "11111111-1111-4111-8111-111111111111";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER_D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const config = {
  id: "cfg-1",
  projectId: PROJECT,
  enabled: true,
  authorizedArea: "PLANEJAMENTO",
  authorizedTiers: ["FIRST_TIER", "SECOND_TIER"],
  senderDomain: "axion.com.br",
  clientRecipientDomains: ["cliente-piloto.example"],
  clientRecipientAddresses: [],
  requireClientRecipient: true,
  cadence: "WEEKLY",
  deadlineWeekday: 5,
  deadlineTime: "18:00",
  timezone: "America/Sao_Paulo",
  monitoringStartAt: "2026-01-01T00:00:00Z",
  monitoringEndAt: null,
  targetDocumentId: null,
  attachmentNamePattern: null,
  alertRecipientUserIds: [USER_D],
  lastScannedSentAt: null,
};

const matrix = {
  responsible_direct_user_id: USER_A,
  secondary_responsible_user_id: USER_B,
  escalation_1_user_id: USER_C,
  escalation_2_user_id: null,
  board_user_id: USER_D,
};

const mpp = (id, name = "Cronograma_Semanal.mpp") => ({ gmailAttachmentId: id, fileName: name, mimeType: "application/octet-stream", sizeBytes: 1024 });
function candidate(overrides = {}) {
  return {
    emailId: "email-1",
    gmailMessageId: "msg-1",
    gmailThreadId: "thr-1",
    messageIdHeader: "<msg-1@axion.com.br>",
    mailboxAddress: "acc@axion.com.br",
    direction: "OUTBOUND",
    providerLabels: ["SENT"],
    fromAddress: "planejador@axion.com.br",
    toAddresses: ["gestor@cliente-piloto.example"],
    ccAddresses: [],
    subject: "(W37) CLIENTE - Relatório Semanal",
    sentAt: "2026-09-16T14:00:00Z",
    attachments: [mpp("att-1"), { gmailAttachmentId: "att-2", fileName: "Relatorio_W37.pdf", mimeType: "application/pdf", sizeBytes: 5000 }, { gmailAttachmentId: "att-3", fileName: "Curva_S_W37.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sizeBytes: 3000 }],
    ...overrides,
  };
}
function senderFromMatrix(userId, overrides = {}) {
  const tier = resolveUserResponsibilityTier({ userId, matrixRow: matrix });
  return { email: "planejador@axion.com.br", userId, standings: [{ projectId: PROJECT, membershipStatus: "ACTIVE", area: "PLANEJAMENTO", tier: tier.tier, tierReason: tier.reason }], ...overrides };
}

function createMemoryIngestionStore({ senderResolution, sha = () => "a".repeat(64), existingHashes = [] }) {
  const state = { intakes: [], documents: [], versions: existingHashes.map((hash, index) => ({ id: `dv-existing-${index}`, documentId: "doc-existing", sha256Hash: hash })), audits: [] };
  return {
    state,
    async findIntakeByMessage(projectId, gmailMessageId) {
      const hit = state.intakes.find((row) => row.projectId === projectId && row.gmailMessageId === gmailMessageId);
      return hit ? { id: hit.id, status: hit.status } : null;
    },
    async resolveSender() {
      return senderResolution;
    },
    async ingestAttachment(projectId, cand, attachment) {
      return { id: `ea-${attachment.gmailAttachmentId}`, sha256Hash: sha(attachment), storageBucket: "project-documents", storagePath: `${projectId}/email-attachments/${cand.emailId}/${attachment.gmailAttachmentId}`, originalFileName: attachment.fileName, mimeType: "application/vnd.ms-project", fileSizeBytes: 2048 };
    },
    async findDocumentVersionBySha(projectId, hash) {
      const hit = state.versions.find((row) => row.sha256Hash === hash);
      return hit ? { id: hit.id, documentId: hit.documentId } : null;
    },
    async ensureTargetDocument(cfg) {
      if (cfg.targetDocumentId) return cfg.targetDocumentId;
      const id = `doc-${state.documents.length + 1}`;
      state.documents.push({ id });
      cfg.targetDocumentId = id;
      return id;
    },
    async createScheduleDocumentVersion(input) {
      const versionIndex = state.versions.filter((row) => row.documentId === input.documentId).length + 1;
      const row = { id: `dv-${state.versions.length + 1}`, documentId: input.documentId, sha256Hash: input.attachment.sha256Hash, processingStatus: "AWAITING_PROCESSING", versionIndex };
      state.versions.push(row);
      return { documentVersionId: row.id, versionIndex };
    },
    async recordIntake(record) {
      const id = `intake-${state.intakes.length + 1}`;
      state.intakes.push({ id, ...record });
      return { id };
    },
    async writeAudit(entry) {
      state.audits.push(entry);
    },
  };
}

// ==================================================================
// ESCALÃO (1–7) — Matriz de responsabilidades e prazos é a fonte
// ==================================================================
await check("1. Matriz identifica 1º escalão (Nível 1 · Responsável e Corresponsável)", () => {
  assert(resolveUserResponsibilityTier({ userId: USER_A, matrixRow: matrix }).tier === "FIRST_TIER");
  assert(resolveUserResponsibilityTier({ userId: USER_B, matrixRow: matrix }).tier === "FIRST_TIER");
  const members = listMatrixTierMembers(matrix);
  assert(members.firstTier.includes(USER_A) && members.firstTier.includes(USER_B));
});

await check("2. Matriz identifica 2º escalão (Nível 2 · Gerência = escalation_1_user_id)", () => {
  const result = resolveUserResponsibilityTier({ userId: USER_C, matrixRow: matrix });
  assert(result.tier === "SECOND_TIER" && result.positions.includes("ESCALATION_1"));
  assert(listMatrixTierMembers(matrix).secondTier[0] === USER_C);
});

await check("3. Usuário fora dos dois escalões (Nível 3 / ausente) não é autorizado", () => {
  assert(resolveUserResponsibilityTier({ userId: USER_D, matrixRow: matrix }).tier === "NOT_AUTHORIZED", "diretoria não autoriza");
  assert(resolveUserResponsibilityTier({ userId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", matrixRow: matrix }).tier === "NOT_AUTHORIZED", "ausente da matriz");
  const decision = evaluateWeeklyScheduleEmail(candidate(), config, senderFromMatrix(USER_D));
  assert(decision.status === "REJECTED_UNAUTHORIZED_SENDER" && decision.rule === "SENDER_TIER_NOT_AUTHORIZED");
});

await check("4. Matriz ausente gera revisão (NOT_CONFIGURED → PENDING_HUMAN_REVIEW)", () => {
  assert(resolveUserResponsibilityTier({ userId: USER_A, matrixRow: null }).tier === "NOT_CONFIGURED");
  const empty = { responsible_direct_user_id: null, secondary_responsible_user_id: null, escalation_1_user_id: null, escalation_2_user_id: null, board_user_id: null };
  assert(resolveUserResponsibilityTier({ userId: USER_A, matrixRow: empty }).tier === "NOT_CONFIGURED");
  const tier = resolveUserResponsibilityTier({ userId: USER_A, matrixRow: null });
  const decision = evaluateWeeklyScheduleEmail(candidate(), config, { email: "x@axion.com.br", userId: USER_A, standings: [{ projectId: PROJECT, membershipStatus: "ACTIVE", area: "PLANEJAMENTO", tier: tier.tier, tierReason: tier.reason }] });
  assert(decision.status === "PENDING_HUMAN_REVIEW" && decision.rule === "MATRIX_NOT_CONFIGURED", `${decision.status}/${decision.rule}`);
});

await check("5. Matriz ambígua gera revisão (mesma pessoa em Nível 1 e 2; só no legado escalation_2)", () => {
  const both = resolveUserResponsibilityTier({ userId: USER_A, matrixRow: { ...matrix, escalation_1_user_id: USER_A } });
  assert(both.tier === "AMBIGUOUS", both.tier);
  const legacy = resolveUserResponsibilityTier({ userId: "ffffffff-ffff-4fff-8fff-ffffffffffff", matrixRow: { ...matrix, escalation_2_user_id: "ffffffff-ffff-4fff-8fff-ffffffffffff" } });
  assert(legacy.tier === "AMBIGUOUS" && legacy.positions.includes("ESCALATION_2_LEGACY"));
  const decision = evaluateWeeklyScheduleEmail(candidate(), config, { email: "x@axion.com.br", userId: USER_A, standings: [{ projectId: PROJECT, membershipStatus: "ACTIVE", area: "PLANEJAMENTO", tier: "AMBIGUOUS", tierReason: both.reason }] });
  assert(decision.status === "PENDING_HUMAN_REVIEW" && decision.rule === "MATRIX_AMBIGUOUS");
});

await check("6. Não existe segunda fonte divergente de escalão (migration, config, store, script)", () => {
  const sql = readSource(MIGRATION);
  assert(!sql.includes("authorized_senders"), "tabela de remetentes com nível removida");
  assert(!/authorized_level|sender_level|authorized_levels/.test(sql), "nenhuma coluna manual de nível");
  assert(sql.includes("authorized_tiers"), "config só habilita/bloqueia escalões");
  const store = readSource("apps/web/lib/schedule/weekly-ingestion/supabase-store.ts");
  assert(store.includes("resolveUserResponsibilityTier") && store.includes("sla_area_responsibles"), "store resolve escalão pela Matriz");
  assert(!store.includes("authorized_senders"), "store não lê tabela paralela");
  const helper = readSource("apps/web/lib/sla/resolve-user-responsibility-tier.ts");
  assert(helper.includes("responsible_direct_user_id") && helper.includes("secondary_responsible_user_id") && helper.includes("escalation_1_user_id") && helper.includes("board_user_id"));
  const form = readSource("apps/web/components/sla/sla-area-responsibles-form.tsx");
  assert(form.includes("Nível 1 · Responsável") && form.includes("Nível 2 · Gerência") && form.includes('name="escalation1UserId"'), "correspondência UI ↔ banco confirmada");
  const configure = readSource("scripts/configure-weekly-schedule-ingestion.mjs");
  assert(!/--levels|--senders|authorized_level/.test(configure), "script de configuração não define escalão");
  const users = readSource("apps/web/app/[projectId]/usuarios/page.tsx");
  assert(users.includes("weekly-schedule-planning-tiers") && users.includes("responsiblesByArea.get(\"PLANEJAMENTO\")"), "aba Usuários mostra os escalões derivados da própria matriz");
});

await check("7. Autorização exige ACTIVE + PLANEJAMENTO + vínculo com o projeto + escalão da Matriz + domínio + destinatário do cliente", () => {
  const ok = evaluateWeeklyScheduleEmail(candidate(), config, senderFromMatrix(USER_A));
  assert(ok.status === "AUTHORIZED_AUTO" && ok.senderTier === "FIRST_TIER");
  const inactive = evaluateWeeklyScheduleEmail(candidate(), config, senderFromMatrix(USER_A, { standings: [{ projectId: PROJECT, membershipStatus: "INACTIVE", area: "PLANEJAMENTO", tier: "FIRST_TIER", tierReason: "" }] }));
  assert(inactive.rule === "SENDER_MEMBERSHIP_NOT_ACTIVE");
  const otherArea = evaluateWeeklyScheduleEmail(candidate(), config, senderFromMatrix(USER_A, { standings: [{ projectId: PROJECT, membershipStatus: "ACTIVE", area: "ENGENHARIA", tier: "FIRST_TIER", tierReason: "" }] }));
  assert(otherArea.rule === "SENDER_AREA_NOT_AUTHORIZED");
  const noLink = evaluateWeeklyScheduleEmail(candidate(), config, senderFromMatrix(USER_A, { standings: [] }));
  assert(noLink.rule === "SENDER_NOT_PROJECT_MEMBER");
  const domain = evaluateWeeklyScheduleEmail(candidate({ fromAddress: "planejador@outro.example" }), config, senderFromMatrix(USER_A));
  assert(domain.rule === "SENDER_DOMAIN_NOT_CORPORATE");
  const recipient = evaluateWeeklyScheduleEmail(candidate({ toAddresses: ["x@fornecedor.example"] }), config, senderFromMatrix(USER_A));
  assert(recipient.status === "REJECTED_RECIPIENT_MISMATCH");
  const evaluate = readSource("apps/web/lib/schedule/weekly-ingestion/evaluate-weekly-schedule-email.ts");
  assert(!/job_title|cargo|displayName|\.name\b/.test(evaluate), "nunca infere escalão por cargo/nome");
});

// ==================================================================
// DUPLICIDADE (8–12)
// ==================================================================
let duplicateStore;
await check("8. MPP duplicado (SHA-256) não cria versão", async () => {
  duplicateStore = createMemoryIngestionStore({ senderResolution: senderFromMatrix(USER_A), existingHashes: ["a".repeat(64)] });
  const outcome = await processWeeklyScheduleEmailCandidate(duplicateStore, { ...config }, candidate());
  assert(outcome.status === "RECEIVED_DUPLICATE", outcome.status);
  assert(duplicateStore.state.versions.length === 1 && duplicateStore.state.documents.length === 0, "nenhuma document_version/documento novo");
});

await check("9. Registra o novo e-mail (message_id, thread, remetente, destinatários, assunto, data, anexo com SHA)", () => {
  const intake = duplicateStore.state.intakes[0];
  assert(intake.gmailMessageId === "msg-1" && intake.gmailThreadId === "thr-1" && intake.messageIdHeader && intake.fromAddress && intake.toAddresses.length && intake.subject && intake.sentAt);
  assert(intake.selectedSha256Hash === "a".repeat(64) && intake.duplicateOfDocumentVersionId === "dv-existing-0");
  assert(intake.attachments.length === 3, "todos os anexos preservados na evidência");
  assert(intake.workWeekLabel === "W37" && intake.mailboxAddress && intake.direction === "OUTBOUND");
});

await check("10./11. Conta como recebimento semanal e não gera alerta de ausência", async () => {
  const received = new Set([`${PROJECT}:2026-09-14`]); // semana civil do envio duplicado
  const alerts = [];
  const store = {
    async hasReceivedScheduleForWeek(projectId, weekStart) {
      return received.has(`${projectId}:${weekStart}`);
    },
    async hasSCurveForWeek() {
      return true;
    },
    async insertAlert(record) {
      alerts.push(record);
      return { created: true, id: "alert-1" };
    },
    async writeAudit() {},
  };
  const outcome = await createWeeklyAbsenceAlert(store, config, new Date("2026-09-18T23:00:00Z"));
  assert(outcome.result === "RECEIVED" && alerts.length === 0);
  const src = readSource("apps/web/lib/schedule/weekly-ingestion/supabase-store.ts");
  assert(/RECEIVED_STATUSES[^;]*"RECEIVED_DUPLICATE"/.test(src), "store real conta RECEIVED_DUPLICATE como recebido");
});

await check("12. Reexecução é idempotente (mesma mensagem → ALREADY_EVALUATED; nada duplicado)", async () => {
  const again = await processWeeklyScheduleEmailCandidate(duplicateStore, { ...config }, candidate());
  assert(again.kind === "ALREADY_EVALUATED" && duplicateStore.state.intakes.length === 1 && duplicateStore.state.versions.length === 1);
  // Promoção pós-revisão também é idempotente.
  const promoted = [];
  const promoStore = {
    async getIntakeForPromotion() {
      return { intakeId: "i", projectId: PROJECT, configId: "cfg-1", emailId: "email-1", gmailMessageId: "msg-1", subject: "s", fromAddress: "p@axion.com.br", sentAt: "2026-09-16T14:00:00Z", weekStart: "2026-09-14", status: "APPROVED_HUMAN_REVIEW", selectedEmailAttachmentId: null, documentVersionId: promoted[0] ?? null, attachments: [] };
    },
    async listIngestedAttachments() {
      return [{ id: "ea-1", sha256Hash: "c".repeat(64), storageBucket: "b", storagePath: "p", originalFileName: "Cronograma.mpp", mimeType: "application/vnd.ms-project", fileSizeBytes: 10 }];
    },
    async getConfig() {
      return { ...config, targetDocumentId: "doc-x" };
    },
    async findDocumentVersionBySha() {
      return null;
    },
    async ensureTargetDocument(cfg) {
      return cfg.targetDocumentId;
    },
    async createScheduleDocumentVersion() {
      promoted.push("dv-new");
      return { documentVersionId: "dv-new", versionIndex: 3 };
    },
    async updateIntakeAfterPromotion() {},
    async recordReprocessResult() {},
    async writeAudit() {},
  };
  const first = await promoteReviewedIntake(promoStore, "i", "evt-1");
  assert(first.outcome === "PROMOTED" && promoted.length === 1);
  const second = await promoteReviewedIntake(promoStore, "i", "evt-2");
  assert(second.outcome === "ALREADY_PROMOTED" && promoted.length === 1, "segunda execução não cria outra versão");
});

// ==================================================================
// CLASSIFICAÇÃO (13–21)
// ==================================================================
const client = { clientDomains: ["cliente-piloto.example"], ccAddresses: [], fromAddress: "x@axion.com.br", toAddresses: ["a@cliente-piloto.example"], direction: "OUTBOUND", attachmentFileNames: [] };
await check("13. Ata → ATA_REUNIAO", () => {
  const result = classifyEmail({ ...client, subject: "Ata de reunião semanal 12/09", attachmentFileNames: ["ATA_12-09.pdf"] });
  assert(result.classification === "ATA_REUNIAO" && result.status === "AUTO", JSON.stringify(result));
});
await check("14. RDO → DIARIO_OBRA (categoria existente reutilizada)", () => {
  const result = classifyEmail({ ...client, subject: "RDO 15/09 — frente norte", attachmentFileNames: ["RDO_150926.pdf"] });
  assert(result.classification === "DIARIO_OBRA" && result.status === "AUTO");
});
await check("15. Alteração de projeto → ALTERACAO_PROJETO", () => {
  const result = classifyEmail({ ...client, subject: "Alteração de projeto — fundações rev 03", attachmentFileNames: ["FUND-PL-001_rev03.dwg"] });
  assert(result.classification === "ALTERACAO_PROJETO", JSON.stringify(result));
});
await check("16. SSMA/ESG → ESG_SSMA (categoria existente reutilizada)", () => {
  const result = classifyEmail({ ...client, subject: "Relatório diário SSMA 15/09", attachmentFileNames: ["SSMA_diario.pdf"] });
  assert(result.classification === "ESG_SSMA" && result.status === "AUTO");
});
await check("17. Relatório semanal → RELATORIO_SEMANAL (com WNN e pacote .mpp/Curva S)", () => {
  const result = classifyEmail({ ...client, subject: "(W37) CLIENTE - Relatório Semanal", attachmentFileNames: ["Cronograma.mpp", "Relatorio.pdf", "Curva_S.xlsx"] });
  assert(result.classification === "RELATORIO_SEMANAL" && result.status === "AUTO" && result.workWeekLabel === "W37");
});
await check("18. Planilha Excel do relatório semanal → RELATORIO_SEMANAL_PLANEJAMENTO (unidade inteira); .mpp → CRONOGRAMA_MPP", () => {
  assert(classifyAttachment({ fileName: "Curva_S_W37.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", emailClassification: "RELATORIO_SEMANAL" }).classification === "RELATORIO_SEMANAL_PLANEJAMENTO");
  assert(classifyAttachment({ fileName: "Relatorio_Semanal_W37.xlsx", mimeType: "application/octet-stream", emailClassification: "UNCLASSIFIED" }).classification === "RELATORIO_SEMANAL_PLANEJAMENTO");
  assert(classifyAttachment({ fileName: "Curva S.pdf", mimeType: "application/pdf", emailClassification: "RELATORIO_SEMANAL" }).classification !== "RELATORIO_SEMANAL_PLANEJAMENTO", "PDF nunca é a planilha do relatório");
  assert(classifyAttachment({ fileName: "Cronograma.mpp", mimeType: "application/octet-stream", emailClassification: "UNCLASSIFIED" }).classification === "CRONOGRAMA_MPP");
});
await check("19. Baixa confiança gera revisão / UNCLASSIFIED (original preservado)", () => {
  const unknown = classifyEmail({ ...client, subject: "Re: reunião de amanhã", attachmentFileNames: [] });
  assert(unknown.classification === "UNCLASSIFIED" && unknown.status === "UNCLASSIFIED");
  const inherited = classifyAttachment({ fileName: "arquivo.pdf", mimeType: "application/pdf", emailClassification: "ATA_REUNIAO" });
  assert(inherited.status === "PENDING_HUMAN_REVIEW" && inherited.confidence < 0.8);
  const ambiguous = classifyEmail({ ...client, subject: "Ata de reunião e RDO do dia", attachmentFileNames: [] });
  assert(ambiguous.status !== "AUTO" || ambiguous.confidence < 0.9, "conflito de padrões reduz confiança");
  const classifier = readSource("apps/web/lib/email/registry/classify-email-document.ts");
  assert(!/anthropic|openai|fetch\(/i.test(classifier), "sem chamadas de IA fictícias — determinístico");
});
await check("20. Correção humana é auditada (RPC grava evento com valor anterior/novo + audit_log) e não é sobrescrita pelo automático", async () => {
  const sql = readSource(MIGRATION);
  assert(sql.includes("create or replace function public.confirm_email_document_classification"));
  assert(/insert into public\.email_document_review_events[\s\S]{0,600}'SET_CLASSIFICATION'/.test(sql));
  assert(sql.includes("'EMAIL_DOCUMENT_CLASSIFICATION_CONFIRMED'"));
  // Orquestrador pula e-mails CONFIRMED e anexos com confirmed_classification.
  const saved = [];
  const store = {
    async listEmailsToClassify() {
      return [
        { emailId: "e1", projectId: PROJECT, subject: "Ata", fromAddress: "a@axion.com.br", toAddresses: [], direction: "OUTBOUND", classificationStatus: "CONFIRMED", attachments: [] },
        { emailId: "e2", projectId: PROJECT, subject: "RDO 01", fromAddress: "a@axion.com.br", toAddresses: [], direction: "OUTBOUND", classificationStatus: "UNCLASSIFIED", attachments: [{ id: "at1", fileName: "x.pdf", mimeType: "application/pdf", confirmedClassification: "ATA_REUNIAO" }] },
      ];
    },
    async getClientRecipientRules() {
      return { domains: [], addresses: [] };
    },
    async saveEmailClassification(id, patch) {
      saved.push({ id, patch });
    },
    async saveAttachmentClassification(id) {
      saved.push({ id });
    },
  };
  const result = await classifySyncedEmails(store, PROJECT);
  assert(result.examined === 2 && saved.length === 1 && saved[0].id === "e2", "CONFIRMED intocado; anexo confirmado intocado");
});
await check("21. E-mail enviado ao cliente é filtro transversal (ata OUTBOUND ao cliente aparece nas duas listas)", () => {
  const result = classifyEmail({ ...client, subject: "Ata de reunião 12/09", attachmentFileNames: [] });
  assert(result.classification === "ATA_REUNIAO" && result.sentToClient === true, "mantém ATA e marca enviado ao cliente");
  assert(isSentToClient({ direction: "INBOUND", toAddresses: ["a@cliente-piloto.example"], ccAddresses: [], clientDomains: ["cliente-piloto.example"] }) === false, "INBOUND nunca é 'enviado ao cliente'");
  const sql = readSource(MIGRATION);
  assert(sql.includes("sent_to_client boolean") && !/'SENT_TO_CLIENT'|'EMAIL_ENVIADO/.test(sql), "não é categoria: é coluna transversal");
  assert(REGISTRY_CLASSIFICATION_OPTIONS.some((option) => option.value === "SENT_TO_CLIENT") && REGISTRY_CLASSIFICATION_OPTIONS.some((option) => option.value === "ATA_REUNIAO"));
  const data = readSource("apps/web/lib/email/registry/email-document-registry-data.ts");
  assert(data.includes('case "SENT_TO_CLIENT":') && data.includes("sentToClient = true"), "filtro SENT_TO_CLIENT não altera a classificação");
});

// ==================================================================
// WNN (22–25)
// ==================================================================
await check("22. Extrai W37 em todas as variações", () => {
  for (const subject of ["(W37) ACME - Relatório Semanal", "(w37) ACME – relatório semanal", "W37 ACME Relatório Semanal", "[W37]  ACME  -  Relatório  Semanal", "W 37 - Relatório Semanal"]) {
    const parsed = parseWorkWeekSubject(subject);
    assert(parsed.workWeekNumber === 37 && parsed.workWeekLabel === "W37" && parsed.workWeekStatus === "IDENTIFIED" && parsed.isWeeklyReport, subject);
  }
  assert(parseWorkWeekSubject("(W37) ACME - Relatório Semanal").clientToken === "ACME", "cliente extraído só quando inequívoco");
  assert(parseWorkWeekSubject("(W37) Relatório Semanal").clientToken === null);
});
await check("23. Não converte W37 para semana ISO/civil", () => {
  const parser = readSource("apps/web/lib/email/registry/parse-work-week-subject.ts");
  assert(!/getISOWeek|isoWeek|weekNumber\(|Date\(/.test(parser), "parser não toca em datas");
  const parsed = parseWorkWeekSubject("(W37) X - Relatório Semanal");
  assert(!("isoWeek" in parsed) && !("weekStart" in parsed));
});
await check("24. Sem WNN gera revisão (NOT_IDENTIFIED) e preserva e-mail/anexos", async () => {
  const parsed = parseWorkWeekSubject("Relatório Semanal");
  assert(parsed.workWeekNumber === null && parsed.workWeekStatus === "NOT_IDENTIFIED" && parsed.isWeeklyReport);
  const store = createMemoryIngestionStore({ senderResolution: senderFromMatrix(USER_A) });
  const outcome = await processWeeklyScheduleEmailCandidate(store, { ...config }, candidate({ subject: "Cronograma atualizado" }));
  assert(outcome.status === "AUTHORIZED_AUTO", "envio válido não é descartado");
  const intake = store.state.intakes[0];
  assert(intake.workWeekStatus === "NOT_IDENTIFIED" && intake.workWeekNumber === null && intake.attachments.length === 3);
  const panel = readSource("apps/web/components/documents/email-registry/email-registry-panel.tsx");
  assert(panel.includes('row.workWeekStatus === "NOT_IDENTIFIED"'), "lista marca semana não identificada como pendente de revisão");
  assert(readSource(MIGRATION).includes("'SET_WORK_WEEK'"), "revisão humana pode identificar a semana");
});
await check("25. Múltiplos W37 preservados (ordenados por sent_at, versões nunca sobrescritas)", async () => {
  const store = createMemoryIngestionStore({ senderResolution: senderFromMatrix(USER_A), sha: (attachment) => (attachment.gmailAttachmentId === "att-1b" ? "b".repeat(64) : "a".repeat(64)) });
  const cfg = { ...config };
  const first = await processWeeklyScheduleEmailCandidate(store, cfg, candidate());
  const second = await processWeeklyScheduleEmailCandidate(store, cfg, candidate({ gmailMessageId: "msg-2", sentAt: "2026-09-17T09:00:00Z", attachments: [mpp("att-1b")] }));
  assert(first.status === "AUTHORIZED_AUTO" && second.status === "AUTHORIZED_AUTO");
  assert(store.state.intakes.length === 2 && store.state.versions.length === 2 && store.state.versions[0].versionIndex === 1 && store.state.versions[1].versionIndex === 2);
  const sorted = [...store.state.intakes].sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  assert(sorted[0].gmailMessageId === "msg-2", "envio válido mais recente identificável por sent_at");
  const data = readSource("apps/web/lib/email/registry/email-document-registry-data.ts");
  assert(data.includes("otherSendsSameWeek"), "detalhe lista os outros envios da mesma semana da obra");
});

// ==================================================================
// ANEXOS (26–32)
// ==================================================================
await check("26. Todos os anexos aparecem (lista por message_id; nenhum filtro por tipo)", () => {
  const data = readSource("apps/web/lib/email/registry/email-document-registry-data.ts");
  assert(data.includes('.from("email_attachments").select("*").eq("email_id", emailId)'), "todos os anexos do e-mail");
  const page = readSource("apps/web/app/[projectId]/documentos/emails/[emailId]/page.tsx");
  assert(page.includes("Anexos ({attachments.length})") && page.includes("attachments.map((attachment)"));
  assert(!/attachments\.filter\(.*(mpp|pdf)/i.test(page), "página não filtra anexos por tipo");
});
await check("27. PDF, MPP e planilha Excel (Curva S…) ficam no mesmo pacote (mesmo e-mail/intake)", async () => {
  const store = createMemoryIngestionStore({ senderResolution: senderFromMatrix(USER_A) });
  await processWeeklyScheduleEmailCandidate(store, { ...config }, candidate());
  const names = store.state.intakes[0].attachments.map((attachment) => attachment.fileName);
  assert(names.some((name) => name.endsWith(".mpp")) && names.some((name) => name.endsWith(".pdf")) && names.some((name) => name.endsWith(".xlsx")));
  const sql = readSource(MIGRATION);
  assert(sql.includes("intake_id uuid") && sql.includes("email_attachment_id uuid not null"), "planilha do relatório vinculada ao intake e ao anexo");
});
await check("28. SHA duplicado preserva evidência do anexo (nome/MIME/tamanho/SHA)", () => {
  const intake = duplicateStore.state.intakes[0];
  const mppEvidence = intake.attachments.find((attachment) => attachment.gmailAttachmentId === "att-1");
  assert(mppEvidence.fileName.endsWith(".mpp") && mppEvidence.mimeType && mppEvidence.sizeBytes === 2048 && mppEvidence.sha256Hash === "a".repeat(64));
});
await check("29. PDF abre viewer do ACC (iframe sandbox com URL assinada)", () => {
  assert(resolveAttachmentOpenBehavior({ mimeType: "application/pdf", fileName: "r.pdf" }).kind === "PDF");
  const viewer = readSource("apps/web/app/[projectId]/documentos/emails/[emailId]/anexos/[attachmentId]/page.tsx");
  assert(viewer.includes("<iframe") && viewer.includes('sandbox=""') && viewer.includes("createSignedUrl"), "viewer sandboxado");
  assert(viewer.includes(".eq(\"project_id\", projectId)") && viewer.includes("createSupabaseServerClient"), "acesso via client de sessão (RLS)");
});
await check("30. MPP abre cronograma estruturado", () => {
  assert(resolveAttachmentOpenBehavior({ mimeType: "application/octet-stream", fileName: "c.mpp" }).kind === "MPP");
  const page = readSource("apps/web/app/[projectId]/documentos/emails/[emailId]/page.tsx");
  assert(page.includes('behavior.kind === "MPP"') && page.includes("tab=cronograma"), "link para o cronograma estruturado");
});
await check("31. Planilha do relatório semanal abre seções (Resumo, Curva S com gráfico, Linha de Base, Financeiro, Histograma, SSMA, Dados de origem, Arquivo original)", () => {
  const page = readSource("apps/web/app/[projectId]/documentos/emails/[emailId]/page.tsx");
  const section = readSource("apps/web/components/documents/email-registry/weekly-report-workbook-section.tsx");
  assert(page.includes("<WeeklyReportWorkbookSection") && section.includes("<SCurveChart") && section.includes("arquivo original"));
  for (const label of ["Resumo", "Dados de origem", "Arquivo original", "Curva S", "Linha de Base", "Financeiro", "Histograma", "SSMA"]) assert(section.includes(label), label);
  assert(section.includes("Aba original") && section.includes("confiança") && section.includes("EXPERT_LABELS"), "cada seção mostra aba original, confiança e Expert");
  const chart = readSource("apps/web/components/documents/email-registry/s-curve-chart.tsx");
  assert(chart.includes("<svg") && chart.includes("PHYSICAL_PLANNED") && chart.includes("PHYSICAL_ACTUAL") && chart.includes("PHYSICAL_FORECAST"));
});
await check("32. Formato não suportado tem fallback seguro (metadados + motivo + download; nunca executa)", () => {
  const zip = resolveAttachmentOpenBehavior({ mimeType: "application/zip", fileName: "pacote.zip" });
  assert(zip.kind === "ZIP" && zip.viewerAvailable === false && zip.reason);
  const exe = resolveAttachmentOpenBehavior({ mimeType: "application/octet-stream", fileName: "tool.exe" });
  assert(exe.kind === "UNSUPPORTED" && exe.reason.includes("EXE"));
  const doc = resolveAttachmentOpenBehavior({ mimeType: "application/msword", fileName: "x.doc" });
  assert(doc.kind === "DOC" && doc.viewerAvailable === false);
  const viewer = readSource("apps/web/app/[projectId]/documentos/emails/[emailId]/anexos/[attachmentId]/page.tsx");
  assert(viewer.includes("nunca executa o conteúdo do anexo"));
});

// ==================================================================
// RELATÓRIO SEMANAL EM EXCEL (33–50) — Curva S vem SÓ do Excel
// ==================================================================
async function buildWorkbook(sheets) {
  const workbook = new ExcelJS.Workbook();
  for (const [name, rows] of sheets) {
    const sheet = workbook.addWorksheet(name);
    for (const row of rows) sheet.addRow(row);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const CURVA_ROWS = [
  ["Curva S física — Projeto Piloto"],
  ["Semana", "Previsto acumulado (%)", "Realizado acumulado (%)", "Projetado (%)", "Realizado financeiro (R$)"],
  ["W34", 30, 28, 28, 1000000],
  ["W35", 36, 33, 34, 1200000],
  ["W36", 42, 38, 39, 1400000],
  ["W37", 48, 42, 45, 1600000],
  ["W38", 54, null, 51, 1800000],
  ["Data de corte", "2026-09-17"],
];
const BASE_ROWS = [
  ["Atividade", "Início planejado", "Término planejado", "% planejado", "Marco"],
  ["Mobilização", "2026-01-05", "2026-01-20", 5, ""],
  ["Fundações", "2026-01-21", "2026-03-15", 30, ""],
  ["Entrega da estrutura", "2026-05-01", "2026-05-01", 60, "Marco"],
  ["Comissionamento", "2026-08-01", "2026-10-30", 100, ""],
];
const FIN_ROWS = [
  ["Período", "Previsto (R$)", "Realizado (R$)", "Acumulado previsto (R$)", "Acumulado realizado (R$)", "Faturado (R$)"],
  ["W35", 100000, 90000, 1200000, 1100000, 95000],
  ["W36", 100000, 95000, 1300000, 1195000, 90000],
  ["W37", 100000, 80000, 1400000, 1275000, 85000],
];
const HIST_ROWS = [
  ["Semana", "Categoria", "Previsto", "Realizado", "Unidade"],
  ["W35", "Pedreiro", 40, 38, "pessoas"],
  ["W36", "Pedreiro", 42, 35, "pessoas"],
  ["W37", "Pedreiro", 45, 30, "pessoas"],
];
const SSMA_ROWS = [
  ["Semana", "Horas trabalhadas", "Efetivo", "Acidentes com afastamento", "Quase acidentes", "Treinamentos (DDS)"],
  ["W36", 4200, 105, 0, 1, 5],
  ["W37", 4400, 110, 1, 2, 5],
];

const FULL_WORKBOOK = [
  ["Curva S", CURVA_ROWS],
  ["Linha de Base", BASE_ROWS],
  ["Financeiro", FIN_ROWS],
  ["Histograma", HIST_ROWS],
  ["SSMA", SSMA_ROWS],
];

const thresholdsAll = [
  { dimension: "S_CURVE_DEVIATION_PP", medium: 3, high: 6, critical: 10 },
  { dimension: "S_CURVE_FULFILLMENT_PERCENT", medium: 95, high: 85, critical: 75 },
  { dimension: "S_CURVE_AGGRAVATION_PP", medium: 1, high: 3, critical: 5 },
  { dimension: "S_CURVE_MPP_DIVERGENCE_PP", medium: 2, high: 5, critical: 10 },
  { dimension: "FINANCIAL_DEVIATION_PERCENT", medium: 3, high: 6, critical: 10 },
  { dimension: "HISTOGRAM_SHORTFALL_PERCENT", medium: 5, high: 10, critical: 20 },
  { dimension: "BASELINE_SHEET_DIVERGENCE_DAYS", medium: 1, high: 7, critical: 15 },
];
const baseContext = (overrides = {}) => ({
  fileName: "RS_W37.xlsx",
  workWeekLabel: "W37",
  thresholds: thresholdsAll,
  mppFacts: { progressPercent: 42, finalDateSlipDays: 0, overdueCount: 3, statusDate: "2026-09-17", workWeekLabel: "W37" },
  officialBaseline: { scheduleVersionId: "sv-base", finalPlannedDate: "2026-10-30", milestones: [{ name: "Entrega da estrutura", plannedEnd: "2026-05-01" }] },
  previousDeviationPp: null,
  previousBaselineSheet: null,
  criticalActivityCount: 4,
  humanDecisions: {},
  ...overrides,
});

let fullReading;
let fullResult;
await check("33. Identifica as cinco abas no XLSX (leitura segura com valores armazenados)", async () => {
  fullReading = await readWorkbookSafely({ buffer: await buildWorkbook(FULL_WORKBOOK), fileName: "RS_W37.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  assert(fullReading.safety.detectedFormat === "XLSX" && fullReading.safety.signatureValid && fullReading.sheetIndex.length === 5);
  const matches = identifyWeeklyReportSheets(fullReading.sheetIndex);
  assert(matches.every((match) => match.status === "MATCHED"), JSON.stringify(matches));
  fullResult = processWorkbookGrids(fullReading, baseContext());
  assert(fullResult.status === "EXTRACTED", `${fullResult.status} ${JSON.stringify(fullResult.summary)}`);
  assert(fullResult.sheets.length === 5 && fullResult.sheets.every((sheet) => sheet.status === "EXTRACTED"), fullResult.sheets.map((sheet) => `${sheet.category}=${sheet.status}`).join(","));
});

await check("34. Aceita diferenças de caixa, acento, espaços, hífen e underscore", () => {
  const variants = [
    { name: "CURVA-S", index: 0 },
    { name: "linha_de_base", index: 1 },
    { name: "Curva Financeira", index: 2 },
    { name: "Histograma de Mão de Obra", index: 3 },
    { name: "Segurança e Meio Ambiente", index: 4 },
  ];
  const matches = identifyWeeklyReportSheets(variants);
  assert(matches.find((m) => m.category === "CURVA_S").sheetName === "CURVA-S");
  assert(matches.find((m) => m.category === "LINHA_BASE").sheetName === "linha_de_base");
  assert(matches.find((m) => m.category === "FINANCEIRO").sheetName === "Curva Financeira");
  assert(matches.find((m) => m.category === "HISTOGRAMA").sheetName === "Histograma de Mão de Obra");
  assert(matches.find((m) => m.category === "SSMA").sheetName === "Segurança e Meio Ambiente");
  for (const [a, b] of [["Curva S", "curva_s"], ["Base Line", "baseline"], ["Financial", "financeiro"], ["Workforce", "efetivo"], ["HSE", "ehs"]]) {
    assert(identifyWeeklyReportSheets([{ name: a, index: 0 }]).some((m) => m.status === "MATCHED") && identifyWeeklyReportSheets([{ name: b, index: 0 }]).some((m) => m.status === "MATCHED"), `${a}/${b}`);
  }
  assert(normalizeSheetName("Ságurança  e-Meio_Ambiente") === "saguranaemeioambiente".replace("agurana", "aguranca") || normalizeSheetName("Segurança") === "seguranca");
});

await check("35. Preserva nomes originais, índices, faixas, método e hash", () => {
  for (const sheet of fullResult.sheets) {
    assert(sheet.originalSheetName && sheet.sheetIndex !== null && sheet.locator.sheet === sheet.originalSheetName && sheet.locator.range && sheet.extractionMethod === "xlsx-stored-values-v1", sheet.category);
  }
  const curva = fullResult.sheets.find((sheet) => sheet.category === "CURVA_S");
  assert(curva.originalSheetName === "Curva S" && curva.sheetIndex === 0 && curva.locator.headerRow === 2 && /^A2:/.test(curva.locator.range), JSON.stringify(curva.locator));
  assert(fullResult.sheetIndex.map((entry) => entry.name).join("|") === "Curva S|Linha de Base|Financeiro|Histograma|SSMA");
  const sql = readSource(MIGRATION);
  assert(sql.includes("file_sha256 text not null") && sql.includes("original_sheet_name text") && sql.includes("sheet_index integer") && sql.includes("source_locator jsonb") && sql.includes("extracted_at timestamptz") && sql.includes("extraction_method text not null"));
});

await check("36. Aba ausente gera MISSING_SHEET (visível, mapeável, nunca inventada)", async () => {
  const reading = await readWorkbookSafely({ buffer: await buildWorkbook([["Curva S", CURVA_ROWS], ["Financeiro", FIN_ROWS]]), fileName: "RS.xlsx", mimeType: "application/vnd.ms-excel" });
  const result = processWorkbookGrids(reading, baseContext());
  const missing = result.sheets.filter((sheet) => sheet.status === "MISSING_SHEET").map((sheet) => sheet.category);
  assert(missing.join(",") === "LINHA_BASE,HISTOGRAMA,SSMA", missing.join(","));
  assert(result.status === "PARTIAL" && result.sheets.every((sheet) => sheet.status !== "MISSING_SHEET" || sheet.originalSheetName === null));
  const ui = readSource("apps/web/components/documents/email-registry/weekly-report-workbook-section.tsx");
  assert(ui.includes("Aba não localizada") && ui.includes("SheetMappingForm"), "UI mostra ausência e permite mapear");
  assert(readSource(MIGRATION).includes("create or replace function public.map_weekly_report_sheet"), "mapeamento humano auditado via RPC");
});

await check("37. Duas correspondências geram AMBIGUOUS_SHEET (revisão humana)", () => {
  const matches = identifyWeeklyReportSheets([{ name: "Curva S Fase 1", index: 0 }, { name: "Curva S Fase 2", index: 1 }, { name: "SSMA", index: 2 }, { name: "ESG", index: 3 }]);
  const curva = matches.find((m) => m.category === "CURVA_S");
  assert(curva.status === "AMBIGUOUS_SHEET" && curva.candidates.length === 2 && curva.sheetName === null, JSON.stringify(curva));
  const ssma = matches.find((m) => m.category === "SSMA");
  assert(ssma.status === "AMBIGUOUS_SHEET", "SSMA e ESG exatos => ambíguo");
  // Exata única vence parcial: "Curva S" + "Curva S Financeira"? (financeira é FINANCEIRO, não Curva S)
  const clear = identifyWeeklyReportSheets([{ name: "Curva S", index: 0 }, { name: "Curva S Financeira", index: 1 }]);
  assert(clear.find((m) => m.category === "CURVA_S").sheetName === "Curva S" && clear.find((m) => m.category === "FINANCEIRO").sheetName === "Curva S Financeira");
});

await check("38. Fórmula sem valor cached não é inventada (valor não disponível; fórmula preservada como evidência)", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Curva S");
  sheet.addRow(["Semana", "Previsto acumulado (%)", "Realizado acumulado (%)"]);
  sheet.addRow(["W36", 42, 38]);
  sheet.addRow(["W37", 48, { formula: "C2+4" }]); // sem result armazenado
  sheet.addRow(["W38", 54, { formula: "C3+4", result: 46 }]); // com result armazenado
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const reading = await readWorkbookSafely({ buffer, fileName: "f.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const grid = reading.grids[0];
  const cellW37 = grid.rows[2][2];
  assert(cellW37.cachedValueMissing === true && cellW37.value === null && cellW37.formula === "C2+4", JSON.stringify(cellW37));
  const cellW38 = grid.rows[3][2];
  assert(cellW38.cachedValueMissing === false && cellW38.value === 46 && cellW38.formula === "C3+4");
  assert(reading.safety.formulasWithoutCachedValue === 1 && reading.safety.formulasPreserved === 2);
  const result = processWorkbookGrids(reading, baseContext({ mppFacts: null, officialBaseline: null }));
  const curva = result.sheets.find((s) => s.category === "CURVA_S");
  const actual = curva.data.series.find((s) => s.type === "PHYSICAL_ACTUAL");
  assert(!actual.points.some((p) => p.period === "W37"), "W37 sem valor armazenado não entra na série");
  assert(actual.points.some((p) => p.period === "W38" && p.value === 46), "valor cached é usado");
  const reader = readSource("apps/web/lib/schedule/weekly-report/read-workbook.ts").replace(/\/\/.*$/gm, "");
  assert(!/eval\(|new Function|calculate\(|recalc/i.test(reader), "leitor nunca recalcula");
});

await check("39. Macro/conexão externa/link externo não é executado (detectado, reportado e ignorado)", async () => {
  // Pacote XLSX com vbaProject.bin, externalLinks e connections injetados — só a presença é reportada.
  const base = await buildWorkbook([["Curva S", CURVA_ROWS]]);
  const zip = await JSZip.loadAsync(base);
  zip.file("xl/vbaProject.bin", Buffer.from("fake-macro-bytes"));
  zip.file("xl/externalLinks/externalLink1.xml", "<externalLink/>");
  zip.file("xl/connections.xml", "<connections/>");
  const tampered = Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
  const reading = await readWorkbookSafely({ buffer: tampered, fileName: "macro.xlsm", mimeType: "application/vnd.ms-excel.sheet.macroenabled.12" });
  assert(reading.safety.macrosDetected === true && reading.safety.externalLinksDetected === 1 && reading.safety.dataConnectionsDetected === 1, JSON.stringify(reading.safety));
  assert(reading.grids.length === 1, "valores armazenados continuam legíveis");
  assert(reading.safety.notes.some((note) => /ignorada, nunca executada/.test(note)) && reading.safety.notes.some((note) => /nunca seguidos/.test(note)));
  const reader = readSource("apps/web/lib/schedule/weekly-report/read-workbook.ts");
  assert(!/child_process|exec\(|fetch\(|http/i.test(reader), "nenhuma execução/rede no leitor");
});

let curvaSheet;
await check("40. Curva S é extraída somente do Excel (PDF nunca é fonte; cálculos: −6 p.p., 87,5%)", async () => {
  curvaSheet = fullResult.sheets.find((sheet) => sheet.category === "CURVA_S");
  assert(curvaSheet.metrics.plannedCumulative === 48 && curvaSheet.metrics.actualCumulative === 42 && curvaSheet.metrics.deviationPp === -6 && curvaSheet.metrics.fulfillmentPercent === 87.5, JSON.stringify(curvaSheet.metrics));
  assert(curvaSheet.metrics.plannedWeekProgress === 6 && curvaSheet.metrics.actualWeekProgress === 4 && curvaSheet.metrics.trend === "AGGRAVATION" && curvaSheet.metrics.negativeDeviationStreak === 4);
  const recovering = analyzeSCurve(curvaSheet.data.series, { cutoffDate: "2026-09-17", previousDeviationPp: -9 });
  assert(recovering.trend === "RECOVERY" && recovering.deviationTrendPp === 3);
  assert(!existsSync(path.join(repoRoot, "apps/web/lib/schedule/s-curve/process-s-curves.ts")) && !existsSync(path.join(repoRoot, "apps/web/lib/schedule/s-curve/extract-s-curve-xlsx.ts")), "orquestração antiga (PDF/imagem) removida");
  const processor = readSource("apps/web/lib/schedule/weekly-report/process-weekly-report-workbooks.ts");
  assert(!/pdf|image/i.test(processor.replace(/\/\/.*$/gm, "")), "processador de planilha não trata PDF/imagem como fonte");
  const store = readSource("apps/web/lib/schedule/weekly-ingestion/supabase-store.ts");
  assert(!/application\/pdf|image\//.test(store.slice(store.indexOf("createSupabaseWeeklyReportWorkbookStore"))), "candidatos são só planilhas");
});

await check("41. Curva S confronta o MPP (avanço, corte, semana) e gera alerta de divergência", async () => {
  assert(curvaSheet.crossCheck.divergencePp === 0 && curvaSheet.crossCheck.cutoffMatches === true, JSON.stringify(curvaSheet.crossCheck));
  const divergent = processWorkbookGrids(fullReading, baseContext({ mppFacts: { progressPercent: 35, finalDateSlipDays: 10, overdueCount: 3, statusDate: "2026-09-10", workWeekLabel: "W36" }, previousDeviationPp: -9 }));
  const curva = divergent.sheets.find((sheet) => sheet.category === "CURVA_S");
  const codes = curva.alerts.map((alert) => alert.code);
  assert(codes.includes("S_CURVE_MPP_PROGRESS_DIVERGENCE") && codes.includes("RECOVERY_WITH_FINAL_DATE_SLIP") && codes.includes("CUTOFF_DATE_MISMATCH") && codes.includes("POSSIBLE_OTHER_PROJECT_OR_WEEK"), codes.join(","));
  assert(curva.riskClassification === "HIGH", `${curva.riskClassification} — ${curva.riskReasons.join(" | ")}`);
  const noThresholds = processWorkbookGrids(fullReading, baseContext({ thresholds: [] }));
  assert(noThresholds.sheets.find((sheet) => sheet.category === "CURVA_S").riskClassification === "REVIEW_REQUIRED", "sem limites => REVIEW_REQUIRED");
});

await check("42. Linha de Base do Excel não substitui a baseline oficial do MPP (só compara e alerta)", () => {
  const base = fullResult.sheets.find((sheet) => sheet.category === "LINHA_BASE");
  assert(base.data.kind === "WEEKLY_REPORT_BASELINE_SHEET" && base.data.finalPlannedDate === "2026-10-30" && base.data.rows.length === 4);
  assert(base.metrics.divergences.length === 0 && base.riskClassification === "LOW", JSON.stringify(base.metrics));
  const shifted = processWorkbookGrids(fullReading, baseContext({ officialBaseline: { scheduleVersionId: "sv-base", finalPlannedDate: "2026-10-20", milestones: [{ name: "Entrega da estrutura", plannedEnd: "2026-04-25" }] } }));
  const diverged = shifted.sheets.find((sheet) => sheet.category === "LINHA_BASE");
  const codes = diverged.metrics.divergences.map((item) => item.code);
  assert(codes.includes("FINAL_DATE_DIFFERS") && codes.includes("MILESTONE_DIFFERS") && diverged.riskClassification === "HIGH", `${codes} ${diverged.riskClassification}`);
  assert(diverged.riskReasons.some((reason) => /nunca substitui a baseline oficial/.test(reason)));
  const none = processWorkbookGrids(fullReading, baseContext({ officialBaseline: null }));
  assert(none.sheets.find((sheet) => sheet.category === "LINHA_BASE").alerts.some((alert) => alert.code === "OFFICIAL_BASELINE_NOT_SET"));
  const retro = processWorkbookGrids(fullReading, baseContext({ previousBaselineSheet: { kind: "WEEKLY_REPORT_BASELINE_SHEET", rows: [], plannedSeries: { type: "PHYSICAL_PLANNED", unit: "PERCENT", scale: "CUMULATIVE", sourceLabel: "prev", points: [{ period: "W37", date: null, value: 50 }] }, finalPlannedDate: null, headers: [] } }));
  void retro;
  const analyze = readSource("apps/web/lib/schedule/weekly-report/analyze-sheets.ts");
  assert(!/set_project_schedule_baseline|project_schedule_baselines/.test(analyze), "análise nunca grava baseline");
  const store = readSource("apps/web/lib/schedule/weekly-ingestion/supabase-store.ts");
  assert(!/from\("project_schedule_baselines"\)\s*\.(insert|update|upsert|delete)/.test(store), "worker nunca escreve baseline oficial");
});

await check("43. Financeiro mantém valores e percentuais separados (colunas mapeadas pelos cabeçalhos reais)", () => {
  const fin = fullResult.sheets.find((sheet) => sheet.category === "FINANCEIRO");
  assert(fin.data.unit === "CURRENCY" && Object.keys(fin.data.columns).includes("previsto") && Object.keys(fin.data.columns).includes("faturado") && !Object.keys(fin.data.columns).includes("recebido"), JSON.stringify(fin.data.columns));
  assert(fin.metrics.plannedTotal === 1400000 && fin.metrics.actualTotal === 1275000 && fin.metrics.deviationAbsolute === -125000 && fin.metrics.deviationPercent === -8.93, JSON.stringify(fin.metrics));
  assert(fin.metrics.trend === "WORSENING" && fin.metrics.faturado === 270000 && fin.metrics.recebido === null, "campos ausentes ficam null (não presumidos)");
  assert(fin.riskClassification === "HIGH" && fin.expertId === "commercial-director");
  const curva = fullResult.sheets.find((sheet) => sheet.category === "CURVA_S");
  assert(curva.metrics.actualCumulative === 42 && curva.metrics.warnings.some((w) => /financ/i.test(w)), "Curva S física não absorve a série financeira");
});

await check("44. Histograma não presume mão de obra sem evidência", async () => {
  const hist = fullResult.sheets.find((sheet) => sheet.category === "HISTOGRAMA");
  assert(hist.data.resourceType === "LABOR" && hist.data.resourceEvidence, "com 'Pedreiro'/'pessoas' há evidência de mão de obra");
  assert(hist.metrics.shortfallPercent === 18.9 && hist.metrics.trend === "WORSENING" && hist.riskClassification === "HIGH", JSON.stringify(hist.metrics));
  assert(hist.alerts.some((alert) => alert.code === "INSUFFICIENT_RESOURCES_FOR_RECOVERY"), "falta de recurso + agravamento físico => indício de insuficiência para recuperação");
  const neutral = await readWorkbookSafely({ buffer: await buildWorkbook([["Histograma", [["Semana", "Categoria", "Previsto", "Realizado"], ["W36", "Tipo A", 10, 9], ["W37", "Tipo B", 12, 12]]]]), fileName: "h.xlsx", mimeType: "application/vnd.ms-excel" });
  const result = processWorkbookGrids(neutral, baseContext({ mppFacts: null, officialBaseline: null }));
  const sheet = result.sheets.find((s) => s.category === "HISTOGRAMA");
  assert(sheet.data.resourceType === "UNKNOWN" && sheet.alerts.some((alert) => alert.code === "RESOURCE_TYPE_UNKNOWN"), JSON.stringify(sheet.data.resourceType));
});

await check("45. SSMA semanal não vira relatório diário (componente do RELATORIO_SEMANAL_PLANEJAMENTO; Expert ESG/SSMA)", () => {
  const ssma = fullResult.sheets.find((sheet) => sheet.category === "SSMA");
  assert(ssma.expertId === "esg-director" && ssma.metrics.classificationNote.includes("não é RELATORIO_DIARIO_SSMA_ESG"));
  const keys = ssma.data.indicators.map((item) => item.key);
  assert(keys.includes("horas_trabalhadas") && keys.includes("efetivo") && keys.includes("acidentes_com_afastamento") && keys.includes("quase_acidentes") && keys.includes("treinamentos"), keys.join(","));
  assert(!keys.includes("inspecoes") && !keys.includes("residuos"), "indicadores ausentes não são inventados");
  assert(ssma.alerts.some((alert) => alert.code === "SSMA_OCCURRENCE" && alert.severity === "CRITICAL"), "acidente com afastamento gera ocorrência crítica");
  const excel = classifyAttachment({ fileName: "RS_W37.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", emailClassification: "RELATORIO_SEMANAL" });
  assert(excel.classification === "RELATORIO_SEMANAL_PLANEJAMENTO" && excel.classification !== "ESG_SSMA");
  const sql = readSource(MIGRATION);
  assert(sql.includes("'RELATORIO_SEMANAL_PLANEJAMENTO'") && !sql.includes("'CURVA_S', 'UNCLASSIFIED'"), "anexo Excel é a unidade documental; Curva S não é classificação de anexo");
});

await check("46. Cada seção é encaminhada ao Expert correto (existentes; CEO consolida)", () => {
  assert(routeSheetToExpert("CURVA_S") === "planning-director" && routeSheetToExpert("LINHA_BASE") === "planning-director" && routeSheetToExpert("HISTOGRAMA") === "planning-director");
  assert(routeSheetToExpert("FINANCEIRO") === "commercial-director" && routeSheetToExpert("SSMA") === "esg-director");
  assert(WEEKLY_REPORT_CONSOLIDATOR === "ceo");
  const experts = fullResult.summary.experts;
  assert(experts.CURVA_S === "planning-director" && experts.FINANCEIRO === "commercial-director" && experts.SSMA === "esg-director" && fullResult.summary.consolidator === "ceo");
  const definitions = readSource("apps/web/lib/ai/types.ts");
  for (const id of ["planning-director", "commercial-director", "esg-director", "ceo"]) assert(definitions.includes(`"${id}"`), `Expert existente ${id}`);
  assert(readSource(MIGRATION).includes("check (expert_id in ('planning-director', 'commercial-director', 'esg-director', 'ceo'))"), "nenhum Expert novo");
});

await check("47. Todas as abas permanecem vinculadas ao mesmo arquivo e message_id", () => {
  const sql = readSource(MIGRATION);
  assert(sql.includes("workbook_id uuid not null\n    references public.weekly_report_workbooks (id) on delete cascade") && sql.includes("unique (workbook_id, category)"));
  assert(sql.includes("email_attachment_id uuid not null\n    references public.email_attachments (id) on delete cascade") && sql.includes("unique (email_attachment_id)"));
  assert(fullResult.sheets.every((sheet) => sheet.locator.file === "RS_W37.xlsx"));
  const data = readSource("apps/web/lib/email/registry/email-document-registry-data.ts");
  assert(data.includes('.from("weekly_report_workbooks").select("*").in("email_attachment_id", attachmentIds)') && data.includes('.from("weekly_report_sheets")'), "detalhe carrega planilhas pelos anexos do e-mail");
});

await check("48. Arquivo XLS legado não suportado gera revisão segura (não é aberto como XLSX)", async () => {
  const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(600, 0)]);
  const reading = await readWorkbookSafely({ buffer: ole, fileName: "relatorio.xls", mimeType: "application/vnd.ms-excel" });
  assert(reading.safety.detectedFormat === "XLS_LEGACY" && reading.grids.length === 0 && reading.sheetIndex.length === 0);
  const saved = [];
  const store = {
    async listWorkbookCandidates() {
      return [{ attachmentId: "at-xls", emailId: "e", projectId: PROJECT, intakeId: null, scheduleVersionId: null, workWeekNumber: 37, workWeekLabel: "W37", fileName: "relatorio.xls", mimeType: "application/vnd.ms-excel", storageBucket: "b", storagePath: "p", sha256Hash: null }];
    },
    async downloadAttachment() {
      return ole;
    },
    async computeSha256() {
      return "c".repeat(64);
    },
    async loadProcessingContext() {
      throw new Error("não deveria processar contexto de XLS legado");
    },
    async saveWorkbook(candidate, input) {
      saved.push(input);
      return { id: "wb-1" };
    },
    async writeAudit() {},
  };
  const result = await processWeeklyReportWorkbooks(store);
  assert(result.legacy === 1 && saved[0].status === "LEGACY_FORMAT_REVIEW_REQUIRED" && saved[0].sheets.length === 0 && saved[0].detectedFormat === "XLS_LEGACY");
  const mislabeled = await readWorkbookSafely({ buffer: ole, fileName: "relatorio.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  assert(mislabeled.safety.signatureValid === false, "assinatura real prevalece sobre a extensão");
});

await check("49. Arquivo original continua disponível (Storage preservado; UI com link e download)", () => {
  const ui = readSource("apps/web/components/documents/email-registry/weekly-report-workbook-section.tsx");
  assert(ui.includes("Arquivo original") && ui.includes("arquivo original") && ui.includes("/anexos/${workbook.emailAttachmentId}"));
  const page = readSource("apps/web/app/[projectId]/documentos/emails/[emailId]/page.tsx");
  assert(page.includes("DocumentDownloadButton") && page.includes("WeeklyReportWorkbookSection"));
  const processor = readSource("apps/web/lib/schedule/weekly-report/process-weekly-report-workbooks.ts");
  assert(!/storage[\s\S]{0,40}\.(remove|update|upload)\(/.test(processor), "processador nunca altera/remove o arquivo");
  assert(processor.includes("integridade comprometida"), "SHA-256 do arquivo conferido antes de ler");
});

await check("50. Reprocessamento é idempotente (mesmo hash => mesma leitura; decisões humanas preservadas)", async () => {
  const saved = [];
  const candidate = { attachmentId: "at-1", emailId: "e", projectId: PROJECT, intakeId: null, scheduleVersionId: null, workWeekNumber: 37, workWeekLabel: "W37", fileName: "RS_W37.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", storageBucket: "b", storagePath: "p", sha256Hash: null };
  const buffer = await buildWorkbook(FULL_WORKBOOK);
  const store = {
    async listWorkbookCandidates() {
      return [candidate];
    },
    async downloadAttachment() {
      return buffer;
    },
    async computeSha256() {
      return "d".repeat(64);
    },
    async loadProcessingContext() {
      return { ...baseContext(), humanDecisions: { LINHA_BASE: { status: "HUMAN_MAPPED", sheetName: "Linha de Base", data: null, cutoffDate: null } } };
    },
    async saveWorkbook(cand, input) {
      saved.push(input);
      return { id: "wb-1" };
    },
    async writeAudit() {},
  };
  const first = await processWeeklyReportWorkbooks(store);
  const second = await processWeeklyReportWorkbooks(store);
  assert(first.extracted === 1 && second.extracted === 1 && saved.length === 2);
  assert(JSON.stringify(saved[0].sheets.map((s) => [s.category, s.status, s.originalSheetName])) === JSON.stringify(saved[1].sheets.map((s) => [s.category, s.status, s.originalSheetName])), "mesma leitura nas duas execuções");
  assert(saved[0].sheets.find((s) => s.category === "LINHA_BASE").status === "HUMAN_MAPPED", "mapeamento humano preservado");
  assert(saved[0].sha256 === saved[1].sha256);
  const sql = readSource(MIGRATION);
  assert(sql.includes("unique (email_attachment_id)") && sql.includes("unique (workbook_id, category)"), "UNIQUE garante upsert, nunca duplicação");
});

await check("50b. Ausência da aba Curva S gera alerta configurável e idempotente (MISSING_S_CURVE)", async () => {
  const alerts = [];
  const store = {
    async hasReceivedScheduleForWeek() {
      return true;
    },
    async hasSCurveForWeek() {
      return false;
    },
    async insertAlert(record) {
      const key = `${record.projectId}:${record.weekStart}:${record.kind}`;
      if (alerts.some((row) => row.key === key)) return { created: false, id: null };
      alerts.push({ key, ...record });
      return { created: true, id: `a${alerts.length}` };
    },
    async writeAudit() {},
  };
  const first = await createWeeklySCurveAbsenceAlert(store, config, new Date("2026-09-18T22:00:00Z"));
  assert(first.result === "CREATED" && alerts[0].kind === "MISSING_S_CURVE");
  const again = await createWeeklySCurveAbsenceAlert(store, config, new Date("2026-09-19T08:00:00Z"));
  assert(again.result === "ALREADY_ALERTED" && alerts.length === 1);
  assert((await createWeeklySCurveAbsenceAlert(store, { ...config, sCurveAlertEnabled: false }, new Date("2026-09-19T08:00:00Z"))).result === "DISABLED");
});

// ==================================================================
// BUSCA (51–58 — itens 45–52 do plano)
// ==================================================================
const searchSql = (() => {
  const sql = readSource(MIGRATION);
  const start = sql.indexOf("create or replace function public.search_email_document_registry");
  const end = sql.indexOf("-- 12b. ACESSO AO DASHBOARD FINANCEIRO", start);
  return sql.slice(start, end > 0 ? end : undefined);
})();
await check("45. Busca por título/assunto", () => assert(searchSql.includes("e.subject ilike '%' || p_query || '%'")));
await check("46. Busca por arquivo (nome do anexo)", () => assert(searchSql.includes("ea.original_file_name ilike '%' || p_query || '%'")));
await check("47. Busca/filtro por remetente", () => assert(searchSql.includes("e.from_address ilike '%' || p_query || '%'") && searchSql.includes("p_sender")));
await check("48. Busca/filtro por destinatário/domínio", () => assert(searchSql.includes("e.to_address ilike '%' || p_query || '%'") && searchSql.includes("p_recipient")));
await check("49. Busca por W37 (rótulo e filtro por semana da obra)", () => {
  assert(searchSql.includes("work_week_label, '') ilike") && searchSql.includes("p_work_week"));
  const params = parseRegistrySearchParams({ semana: "37", q: "W37", classificacao: "RELATORIO_SEMANAL", pagina: "2" });
  assert(params.workWeek === 37 && params.query === "W37" && params.classification === "RELATORIO_SEMANAL" && params.page === 2);
  assert(parseRegistrySearchParams({ semana: "abc", classificacao: "INVALIDA", pagina: "-3" }).workWeek === null);
  assert(parseRegistrySearchParams({ classificacao: "INVALIDA" }).classification === "ALL" && parseRegistrySearchParams({ pagina: "-3" }).page === 1);
});
await check("50. Busca por conteúdo extraído (document_extractions), atividades MPP e Curva S", () => {
  assert(searchSql.includes("de.text_content ilike") && searchSql.includes("sa.name ilike") && searchSql.includes("ws.data::text ilike") && searchSql.includes("ws.original_sheet_name"));
});
await check("51. Projeto/RLS: função SECURITY INVOKER filtrada por projeto; leitura via client de sessão", () => {
  assert(searchSql.includes("security invoker") && searchSql.includes("e.project_id = p_project_id"));
  assert(!searchSql.includes("security definer"));
  const data = readSource("apps/web/lib/email/registry/email-document-registry-data.ts");
  assert(data.includes("createSupabaseServerClient") && !data.includes("createSupabaseAdminClient"));
});
await check("52. Paginação e ordenação por data recente (limit/offset limitados, count total, sem carregar tudo no cliente)", () => {
  assert(searchSql.includes("order by en.sent_at desc") && searchSql.includes("count(*) over ()") && searchSql.includes("least(coalesce(p_limit, 25), 100)"));
  const panel = readSource("apps/web/components/documents/email-registry/email-registry-panel.tsx");
  assert(panel.includes('method="get"') && panel.includes("Paginação") && panel.includes("Carregando") && panel.includes('role="alert"') && panel.includes("EmptyState"), "GET, paginação, loading, erro, vazio");
  assert(!panel.includes('"use client"'), "lista é server component (nada carregado no cliente)");
});

// ==================================================================
// MENU (itens 53–56 do plano)
// ==================================================================
await check("53. Análise Contratual ausente da navegação", () => assert(!NAV_ITEMS.some((item) => item.label === "Análise Contratual" || item.href === "revisao-contratual")));
await check("54. Análise de Cláusulas ausente da navegação", () => assert(!NAV_ITEMS.some((item) => item.label === "Análise de Cláusulas" || item.href === "revisao-clausulas")));
await check("55. Expert Jurídico presente; rotas/páginas/ajuda preservadas", () => {
  assert(NAV_ITEMS.some((item) => item.href === "juridico"));
  assert(existsSync(path.join(repoRoot, "apps/web/app/[projectId]/revisao-contratual/page.tsx")) && existsSync(path.join(repoRoot, "apps/web/app/[projectId]/revisao-clausulas/page.tsx")));
  const help = readSource("apps/web/lib/ui/feature-help.ts");
  assert(help.includes('"analise-contratual"') && help.includes('"analise-clausulas"'), "ajuda preservada (nada apagado)");
});
await check("56. Sem grupo vazio: sidebar usa uma única lista NAV_ITEMS (desktop/mobile/recolhido) sem grupos/separadores", () => {
  const sidebar = readSource("apps/web/components/layout/app-sidebar.tsx");
  assert(sidebar.includes("NAV_ITEMS") && !/Separator|navGroups|NAV_GROUPS/.test(sidebar));
  assert(NAV_ITEMS.length === 14 && new Set(NAV_ITEMS.map((item) => item.href)).size === 14, "13 itens + Financeiro (restrito por acesso financeiro)");
});

// ==================================================================
// SEGURANÇA (itens 57–61 do plano)
// ==================================================================
await check("57. Usuário sem projeto não acessa registros (RLS SELECT por is_project_member em todas as tabelas novas)", () => {
  const sql = readSource(MIGRATION);
  for (const table of ["project_weekly_schedule_ingestion_configs", "project_schedule_risk_thresholds", "project_schedule_baselines", "weekly_schedule_email_intakes", "schedule_version_comparisons", "weekly_report_workbooks", "weekly_report_sheets", "weekly_schedule_ingestion_alerts", "email_document_review_events"]) {
    assert(sql.includes(`alter table public.${table} enable row level security`), `RLS ${table}`);
    assert(new RegExp(`on public\\.${table} for select\\s+using \\(\\s*public\\.is_project_member\\(project_id\\)`).test(sql), `select policy ${table}`);
  }
  assert(sql.includes("(category <> 'FINANCEIRO' or public.can_view_project_financial_dashboard(project_id))"), "aba FINANCEIRO exige acesso financeiro além de membership");
});
await check("58. Cliente não altera campos técnicos (sem policy de UPDATE em intakes/comparações/Curva S/alertas; GRANT por coluna só nas regras de negócio)", () => {
  const sql = readSource(MIGRATION);
  for (const table of ["weekly_schedule_email_intakes", "schedule_version_comparisons", "weekly_report_workbooks", "weekly_report_sheets", "weekly_schedule_ingestion_alerts", "project_schedule_baselines", "email_document_review_events"]) {
    assert(!new RegExp(`on public\\.${table} for (update|insert|delete)`).test(sql), `${table} sem escrita para authenticated`);
  }
  assert(sql.includes("revoke update on public.project_weekly_schedule_ingestion_configs from authenticated"));
  const grant = /grant update \(([\s\S]*?)\) on public\.project_weekly_schedule_ingestion_configs to authenticated/.exec(sql);
  assert(grant && !grant[1].includes("target_document_id") && !grant[1].includes("last_scanned_sent_at"), "colunas técnicas fora do GRANT");
  assert(!/grant update on public\./.test(sql), "nenhum GRANT UPDATE amplo");
  assert(!/alter table public\.emails[\s\S]{0,400}grant/.test(sql));
});
await check("59. Service role processa (worker) — ações humanas só via RPC SECURITY DEFINER com permissão validada", () => {
  const sql = readSource(MIGRATION);
  for (const fn of ["review_weekly_schedule_intake", "set_project_schedule_baseline", "confirm_email_document_classification", "map_weekly_report_sheet", "validate_weekly_report_sheet_values"]) {
    const body = sql.slice(sql.indexOf(`create or replace function public.${fn}`));
    assert(body.slice(0, 4000).includes("security definer") && /has_project_permission\([^)]*'ADMINISTRADOR'\)|can_manage_project_documents\(/.test(body.slice(0, 4000)), fn);
    assert(!body.slice(0, 4000).includes("'EDITOR'"), `${fn} não usa papel fora do modelo`);
    assert(sql.includes(`revoke all on function public.${fn}`), `${fn} revogada de public/anon`);
  }
  const actions = readSource("apps/web/app/[projectId]/documentos/emails/actions.ts");
  assert(actions.includes("createSupabaseServerClient") && !actions.includes("createSupabaseAdminClient"), "server actions nunca usam service role");
  const workflow = readSource(".github/workflows/weekly-schedule-email-ingestion.yml");
  assert(workflow.includes("SUPABASE_SECRET_KEY") && workflow.includes("--apply"), "worker roda com service role");
});
await check("60. Logs não expõem secrets/tokens (sanitização) nem corpo de e-mail", () => {
  const sanitized = sanitizeErrorMessage(new Error("Falha: Bearer abcdefghijklmnopqrstuvwxyz token=ZYXWVUTSRQPONMLK password: supersecret123"));
  assert(!sanitized.includes("abcdefghijklmnopqrstuvwxyz") && !sanitized.includes("ZYXWVUTSRQPONMLK") && !sanitized.includes("supersecret123"), sanitized);
  const script = readSource("scripts/weekly-schedule-email-ingest.mjs");
  assert(!/console\.log\([^)]*(refresh_token|CLIENT_SECRET|SECRET_KEY|snippet|body)/i.test(script), "script não imprime tokens nem corpo");
  assert(!script.includes("format: \"raw\"") && !script.includes("payload.body"), "corpo da mensagem não é lido/persistido");
});
await check("61. Decisão humana fica auditada (evento com anterior/novo/justificativa/usuário + audit_log_entries)", () => {
  const sql = readSource(MIGRATION);
  const review = sql.slice(sql.indexOf("create or replace function public.review_weekly_schedule_intake"), sql.indexOf("create or replace function public.confirm_email_document_classification"));
  assert(review.includes("previous_value") && review.includes("new_value") && review.includes("justification") && review.includes("decided_by_user_id") && review.includes("insert into public.audit_log_entries"));
  assert(review.includes("raise exception 'Justificativa é obrigatória.'"));
  assert(sql.includes("reprocess_result jsonb"), "resultado do reprocessamento volta ao evento");
  const page = readSource("apps/web/app/[projectId]/documentos/emails/[emailId]/page.tsx");
  assert(page.includes("Histórico de revisão e auditoria") && page.includes("event.previousValue") && page.includes("event.newValue"));
});

// Hardcode guard
await check("Guarda: nenhum WEG/weg.net/pessoa na lógica geral (lib, migration, scripts de produção)", () => {
  for (const file of [
    MIGRATION,
    "apps/web/lib/sla/resolve-user-responsibility-tier.ts",
    "apps/web/lib/email/registry/classify-email-document.ts",
    "apps/web/lib/email/registry/classify-synced-emails.ts",
    "apps/web/lib/email/registry/email-document-registry-data.ts",
    "apps/web/lib/schedule/weekly-ingestion/evaluate-weekly-schedule-email.ts",
    "apps/web/lib/schedule/weekly-ingestion/ingest-weekly-schedule-email.ts",
    "apps/web/lib/schedule/weekly-ingestion/supabase-store.ts",
    "apps/web/lib/schedule/s-curve/analyze-s-curve.ts",
    "apps/web/lib/schedule/weekly-report/process-weekly-report-workbooks.ts",
    "apps/web/lib/schedule/weekly-report/identify-sheets.ts",
    "apps/web/lib/schedule/weekly-report/analyze-sheets.ts",
    "scripts/weekly-schedule-email-ingest.mjs",
    "scripts/configure-weekly-schedule-ingestion.mjs",
  ]) {
    assert(!/weg\.net|ricardo|martins/i.test(readSource(file)), `${file} contém valor WEG/pessoa`);
    assert(!/\bWEG\b/.test(readSource(file)), `${file} contém WEG hardcoded`);
  }
});

console.log("");
console.log(`Resultado: ${passed} OK, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
