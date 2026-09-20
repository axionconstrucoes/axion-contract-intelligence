// Testes da ingestão automática do cronograma semanal (.mpp) por e-mail.
// Executa as funções REAIS de apps/web/lib/schedule/weekly-ingestion/**
// (regra pura + orquestradores) contra stores EM MEMÓRIA — nunca chama
// Gmail nem Supabase (a migration desta feature ainda não foi aplicada
// ao banco remoto por decisão explícita). Também valida a migration por
// leitura estática (RLS, unicidade, ausência de valores WEG hardcoded).
//
// Uso:
//   node scripts/test-weekly-schedule-email-ingestion.mjs

import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const { evaluateWeeklyScheduleEmail, selectMppAttachment, hasClientRecipient } = await import(
  "../apps/web/lib/schedule/weekly-ingestion/evaluate-weekly-schedule-email"
);
const { processWeeklyScheduleEmailCandidate } = await import("../apps/web/lib/schedule/weekly-ingestion/ingest-weekly-schedule-email");
const { prepareScheduleComparisons } = await import("../apps/web/lib/schedule/weekly-ingestion/prepare-schedule-comparisons");
const { createWeeklyAbsenceAlert } = await import("../apps/web/lib/schedule/weekly-ingestion/create-absence-alerts");
const { compareScheduleSnapshots } = await import("../apps/web/lib/schedule/weekly-ingestion/compare-schedule-versions");
const { classifyScheduleRisk } = await import("../apps/web/lib/schedule/weekly-ingestion/classify-schedule-risk");
const { resolveWeekStart, resolveWeeklyDeadline, resolveCurrentWeekDeadline } = await import(
  "../apps/web/lib/schedule/weekly-ingestion/week-window"
);

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const readSource = (relative) => readFileSync(path.join(repoRoot, relative), "utf8");

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

// ------------------------------------------------------------------
// Fixtures — nenhum valor WEG/Ricardo no código de produção: tudo aqui
// é CONFIGURAÇÃO do projeto de teste.
// ------------------------------------------------------------------
const PROJECT = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT = "22222222-2222-4222-8222-222222222222";
const PLANNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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
  alertRecipientUserIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
  lastScannedSentAt: null,
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
    subject: "Cronograma semanal — semana 38",
    sentAt: "2026-09-16T14:00:00Z",
    attachments: [mpp("att-1")],
    ...overrides,
  };
}

function sender(overrides = {}) {
  return {
    email: "planejador@axion.com.br",
    userId: PLANNER,
    standings: [{ projectId: PROJECT, membershipStatus: "ACTIVE", area: "PLANEJAMENTO", tier: "FIRST_TIER", tierReason: "Nível 1 (Responsável/Corresponsável) na Matriz." }],
    ...overrides,
  };
}

// ------------------------------------------------------------------
// Store em memória (porta WeeklyScheduleIngestionStore)
// ------------------------------------------------------------------
function createMemoryIngestionStore({ senderResolution, sha = "a".repeat(64), existingHashes = [] }) {
  const state = {
    intakes: [],
    documents: [],
    versions: existingHashes.map((hash, index) => ({ id: `dv-existing-${index}`, documentId: "doc-existing", sha256Hash: hash, processingStatus: "PROCESSED" })),
    attachmentsIngested: [],
    audits: [],
  };
  const store = {
    state,
    async findIntakeByMessage(projectId, gmailMessageId) {
      const hit = state.intakes.find((row) => row.projectId === projectId && row.gmailMessageId === gmailMessageId);
      return hit ? { id: hit.id, status: hit.status } : null;
    },
    async resolveSender() {
      return senderResolution;
    },
    async ingestAttachment(projectId, cand, attachment) {
      const row = {
        id: `ea-${attachment.gmailAttachmentId}`,
        sha256Hash: typeof sha === "function" ? sha(attachment) : sha,
        storageBucket: "project-documents",
        storagePath: `${projectId}/email-attachments/${cand.emailId}/${attachment.gmailAttachmentId}-${attachment.fileName}`,
        originalFileName: attachment.fileName,
        mimeType: "application/vnd.ms-project",
        fileSizeBytes: 2048,
      };
      state.attachmentsIngested.push(row);
      return row;
    },
    async findDocumentVersionBySha(projectId, hash) {
      const hit = state.versions.find((row) => row.sha256Hash === hash);
      return hit ? { id: hit.id, documentId: hit.documentId } : null;
    },
    async ensureTargetDocument(cfg) {
      if (cfg.targetDocumentId) return cfg.targetDocumentId;
      const id = `doc-${state.documents.length + 1}`;
      state.documents.push({ id, kind: "CRONOGRAMA_REVISAO" });
      cfg.targetDocumentId = id;
      return id;
    },
    async createScheduleDocumentVersion(input) {
      const versionIndex = state.versions.filter((row) => row.documentId === input.documentId).length + 1;
      const row = {
        id: `dv-${state.versions.length + 1}`,
        documentId: input.documentId,
        sha256Hash: input.attachment.sha256Hash,
        processingStatus: "AWAITING_PROCESSING",
        versionIndex,
        filePath: input.attachment.storagePath,
      };
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
  return store;
}

// ==================================================================
// Regra pura — casos 1 a 7 e 9
// ==================================================================
const standing = (overrides = {}) => ({ projectId: PROJECT, membershipStatus: "ACTIVE", area: "PLANEJAMENTO", tier: "FIRST_TIER", tierReason: "Nível 1 na Matriz.", ...overrides });

await check("1. Planejador ACTIVE, área PLANEJAMENTO, 1º escalão pela Matriz, projeto correto → AUTHORIZED_AUTO", () => {
  const decision = evaluateWeeklyScheduleEmail(candidate(), config, sender());
  assert(decision.status === "AUTHORIZED_AUTO", `status ${decision.status} (${decision.rule})`);
  assert(decision.rule === "AUTHORIZED_PLANNER_TIER");
  assert(decision.senderTier === "FIRST_TIER");
  assert(decision.selectedAttachment?.gmailAttachmentId === "att-1");
});

await check("2. Planejador 2º escalão (Nível 2 · Gerência na Matriz) → AUTHORIZED_AUTO", () => {
  const decision = evaluateWeeklyScheduleEmail(candidate(), config, sender({ standings: [standing({ tier: "SECOND_TIER", tierReason: "Nível 2 (Gerência) na Matriz." })] }));
  assert(decision.status === "AUTHORIZED_AUTO", `status ${decision.status} (${decision.rule})`);
  assert(decision.senderTier === "SECOND_TIER");
});

await check("3. Fora do 1º/2º escalão (Nível 3 / ausente da Matriz) → REJECTED_UNAUTHORIZED_SENDER", () => {
  const board = evaluateWeeklyScheduleEmail(candidate(), config, sender({ standings: [standing({ tier: "NOT_AUTHORIZED", tierReason: "Nível 3 (Diretoria)." })] }));
  assert(board.status === "REJECTED_UNAUTHORIZED_SENDER" && board.rule === "SENDER_TIER_NOT_AUTHORIZED", `${board.status}/${board.rule}`);
  assert(board.senderUserId === PLANNER && board.senderTier === "NOT_AUTHORIZED", "evidência preserva usuário e escalão");
  // Projeto que só habilita o 1º escalão bloqueia o 2º (habilita/bloqueia, nunca redefine).
  const blocked = evaluateWeeklyScheduleEmail(candidate(), { ...config, authorizedTiers: ["FIRST_TIER"] }, sender({ standings: [standing({ tier: "SECOND_TIER" })] }));
  assert(blocked.status === "REJECTED_UNAUTHORIZED_SENDER" && blocked.rule === "SENDER_TIER_NOT_AUTHORIZED");
});

await check("3b. Matriz ausente (NOT_CONFIGURED) ou ambígua (AMBIGUOUS) → PENDING_HUMAN_REVIEW, nunca autoriza", () => {
  const missing = evaluateWeeklyScheduleEmail(candidate(), config, sender({ standings: [standing({ tier: "NOT_CONFIGURED", tierReason: "Matriz não configurada." })] }));
  assert(missing.status === "PENDING_HUMAN_REVIEW" && missing.rule === "MATRIX_NOT_CONFIGURED", `${missing.status}/${missing.rule}`);
  const ambiguous = evaluateWeeklyScheduleEmail(candidate(), config, sender({ standings: [standing({ tier: "AMBIGUOUS", tierReason: "Nível 1 e Nível 2 ao mesmo tempo." })] }));
  assert(ambiguous.status === "PENDING_HUMAN_REVIEW" && ambiguous.rule === "MATRIX_AMBIGUOUS", `${ambiguous.status}/${ambiguous.rule}`);
});

await check("4. Usuário suspenso (membership INACTIVE) → REJECTED_UNAUTHORIZED_SENDER", () => {
  const decision = evaluateWeeklyScheduleEmail(candidate(), config, sender({ standings: [standing({ membershipStatus: "INACTIVE" })] }));
  assert(decision.status === "REJECTED_UNAUTHORIZED_SENDER" && decision.rule === "SENDER_MEMBERSHIP_NOT_ACTIVE", `${decision.status}/${decision.rule}`);
});

await check("4b. Área diferente / domínio não corporativo / sem cadastro → rejeitado com regra específica", () => {
  const area = evaluateWeeklyScheduleEmail(candidate(), config, sender({ standings: [standing({ area: "ENGENHARIA" })] }));
  assert(area.rule === "SENDER_AREA_NOT_AUTHORIZED", area.rule);
  const domain = evaluateWeeklyScheduleEmail(candidate({ fromAddress: "alguem@gmail.com" }), config, sender());
  assert(domain.status === "REJECTED_UNAUTHORIZED_SENDER" && domain.rule === "SENDER_DOMAIN_NOT_CORPORATE", domain.rule);
  const unknown = evaluateWeeklyScheduleEmail(candidate(), config, sender({ userId: null, standings: [] }));
  assert(unknown.rule === "SENDER_NOT_REGISTERED", unknown.rule);
});

await check("5. Planejador válido em outro projeto, sem vínculo com este → PENDING_HUMAN_REVIEW", () => {
  const decision = evaluateWeeklyScheduleEmail(candidate(), config, sender({ standings: [standing({ projectId: OTHER_PROJECT })] }));
  assert(decision.status === "PENDING_HUMAN_REVIEW" && decision.rule === "PLANNER_WITHOUT_PROJECT_LINK", `${decision.status}/${decision.rule}`);
  const nobody = evaluateWeeklyScheduleEmail(candidate(), config, sender({ standings: [] }));
  assert(nobody.status === "REJECTED_UNAUTHORIZED_SENDER" && nobody.rule === "SENDER_NOT_PROJECT_MEMBER", "sem qualificação em lugar nenhum → rejeitado");
});

await check("6. Destinatário fora do domínio configurado → REJECTED_RECIPIENT_MISMATCH (perímetro, como a ingestão de e-mail existente)", () => {
  const decision = evaluateWeeklyScheduleEmail(candidate({ toAddresses: ["outro@fornecedor.example"] }), config, sender());
  assert(decision.status === "REJECTED_RECIPIENT_MISMATCH" && decision.rule === "NO_CLIENT_RECIPIENT", `${decision.status}/${decision.rule}`);
  assert(hasClientRecipient({ toAddresses: [], ccAddresses: ["x@cliente-piloto.example"] }, config), "Cc no domínio do cliente conta");
  assert(hasClientRecipient({ toAddresses: ["a@b.example"], ccAddresses: [] }, { ...config, clientRecipientDomains: [], clientRecipientAddresses: ["a@b.example"] }), "endereço explícito conta");
  assert(!hasClientRecipient({ toAddresses: ["a@b.example"], ccAddresses: [] }, { ...config, clientRecipientDomains: [], clientRecipientAddresses: [] }), "sem configuração de cliente nunca passa");
});

await check("7. Sem anexo .mpp → IGNORED_NO_MPP (antes de qualquer juízo sobre o remetente)", () => {
  const decision = evaluateWeeklyScheduleEmail(candidate({ attachments: [{ gmailAttachmentId: "x", fileName: "ata.pdf", mimeType: "application/pdf", sizeBytes: 10 }] }), config, sender({ userId: null, standings: [] }));
  assert(decision.status === "IGNORED_NO_MPP" && decision.rule === "NO_MPP_ATTACHMENT", `${decision.status}/${decision.rule}`);
  const outside = evaluateWeeklyScheduleEmail(candidate({ sentAt: "2025-12-31T10:00:00Z" }), config, sender());
  assert(outside.status === "IGNORED_OUTSIDE_WINDOW", "fora da janela é ignorado");
});

await check("9. Dois .mpp ambíguos → PENDING_HUMAN_REVIEW; padrão de nome do projeto desambigua", () => {
  const two = candidate({ attachments: [mpp("a", "Cronograma_v1.mpp"), mpp("b", "Cronograma_v2.mpp")] });
  const decision = evaluateWeeklyScheduleEmail(two, config, sender());
  assert(decision.status === "PENDING_HUMAN_REVIEW" && decision.rule === "AMBIGUOUS_MPP_ATTACHMENTS", `${decision.status}/${decision.rule}`);
  assert(decision.mppCandidates.length === 2, "evidência lista os dois .mpp");
  const selection = selectMppAttachment(two.attachments, { attachmentNamePattern: "_v2\\.mpp$" });
  assert(selection.kind === "SELECTED" && selection.attachment.gmailAttachmentId === "b" && selection.how === "NAME_PATTERN");
  const resolved = evaluateWeeklyScheduleEmail(two, { ...config, attachmentNamePattern: "_v2\\.mpp$" }, sender());
  assert(resolved.status === "AUTHORIZED_AUTO" && resolved.selectedAttachment.gmailAttachmentId === "b");
});

// ==================================================================
// Orquestrador — casos 8 e 10 + idempotência + falha
// ==================================================================
await check("10. Nova versão → document_version AWAITING_PROCESSING, intake AUTHORIZED_AUTO, auditoria com SHA-256", async () => {
  const store = createMemoryIngestionStore({ senderResolution: sender() });
  const cfg = { ...config };
  const outcome = await processWeeklyScheduleEmailCandidate(store, cfg, candidate());
  assert(outcome.kind === "RECORDED" && outcome.status === "AUTHORIZED_AUTO", JSON.stringify(outcome));
  const version = store.state.versions.find((row) => row.id === outcome.documentVersionId);
  assert(version && version.processingStatus === "AWAITING_PROCESSING", "versão na fila do worker MPXJ");
  assert(version.versionIndex === 1 && store.state.documents[0].kind === "CRONOGRAMA_REVISAO", "documento alvo CRONOGRAMA_REVISAO criado");
  assert(cfg.targetDocumentId === "doc-1", "config passa a apontar para o documento alvo");
  const intake = store.state.intakes[0];
  assert(intake.status === "AUTHORIZED_AUTO" && intake.documentVersionId === version.id && intake.selectedSha256Hash === "a".repeat(64));
  assert(intake.toAddresses.length === 1 && intake.subject && intake.gmailThreadId === "thr-1" && intake.weekStart === "2026-09-14", "evidências obrigatórias gravadas");
  assert(intake.senderTier === "FIRST_TIER", "escalão da Matriz gravado como evidência");
  assert(intake.workWeekStatus === "NOT_IDENTIFIED" && intake.workWeekNumber === null, "assunto sem WNN => semana da obra não identificada (nunca inventada)");
  assert(intake.attachments[0].sha256Hash === "a".repeat(64), "anexo na evidência carrega o SHA-256");
  assert(store.state.audits.some((entry) => entry.action === "WEEKLY_SCHEDULE_VERSION_CREATED" && entry.detail.includes("a".repeat(64))));

  // Segunda versão na semana seguinte com hash diferente → v2 no MESMO documento (nunca sobrescreve).
  store.state.versions.forEach((row) => (row.processingStatus = "PROCESSED"));
  const store2 = { ...store, ingestAttachment: async (p, c, a) => ({ ...(await store.ingestAttachment(p, c, a)), sha256Hash: "b".repeat(64) }) };
  const second = await processWeeklyScheduleEmailCandidate(store2, cfg, candidate({ gmailMessageId: "msg-2", sentAt: "2026-09-23T14:00:00Z" }));
  assert(second.status === "AUTHORIZED_AUTO");
  const v2 = store.state.versions.find((row) => row.id === second.documentVersionId);
  assert(v2.versionIndex === 2 && v2.documentId === "doc-1", "v2 anexada ao mesmo documento");
  assert(store.state.versions.length === 2, "v1 preservada");
});

await check("8. SHA-256 duplicado → RECEIVED_DUPLICATE: nenhuma versão nova, mas o ENVIO fica registrado com toda a evidência", async () => {
  const store = createMemoryIngestionStore({ senderResolution: sender(), existingHashes: ["a".repeat(64)] });
  const before = store.state.versions.length;
  const outcome = await processWeeklyScheduleEmailCandidate(store, { ...config }, candidate());
  assert(outcome.status === "RECEIVED_DUPLICATE" && outcome.rule === "DUPLICATE_SHA256", JSON.stringify(outcome));
  assert(store.state.versions.length === before, "nenhuma document_version criada");
  const intake = store.state.intakes[0];
  assert(intake.duplicateOfDocumentVersionId === "dv-existing-0");
  assert(intake.gmailMessageId === "msg-1" && intake.gmailThreadId === "thr-1" && intake.fromAddress && intake.toAddresses.length === 1 && intake.subject && intake.sentAt, "message_id/thread/remetente/destinatários/assunto/data preservados");
  assert(intake.attachments[0].sha256Hash === "a".repeat(64) && intake.selectedSha256Hash === "a".repeat(64), "evidência do anexo preservada com SHA-256");
  assert(intake.mailboxAddress === "acc@axion.com.br" && intake.direction === "OUTBOUND" && intake.providerLabels[0] === "SENT", "proveniência (caixa, direção, labels) gravada");
  assert(store.state.documents.length === 0, "documento alvo nem foi criado");
  assert(store.state.audits[0].action === "WEEKLY_SCHEDULE_EMAIL_RECEIVED_DUPLICATE");
});

await check("Idempotência: mesma mensagem reprocessada → ALREADY_EVALUATED (nunca reavalia nem duplica)", async () => {
  const store = createMemoryIngestionStore({ senderResolution: sender() });
  const cfg = { ...config };
  await processWeeklyScheduleEmailCandidate(store, cfg, candidate());
  const again = await processWeeklyScheduleEmailCandidate(store, cfg, candidate());
  assert(again.kind === "ALREADY_EVALUATED");
  assert(store.state.intakes.length === 1 && store.state.versions.length === 1);
});

await check("Rejeição preserva evidência completa (remetente, To/Cc, assunto, anexos, regra) sem baixar anexo", async () => {
  const store = createMemoryIngestionStore({ senderResolution: sender({ standings: [standing({ membershipStatus: "INACTIVE" })] }) });
  const outcome = await processWeeklyScheduleEmailCandidate(store, { ...config }, candidate({ ccAddresses: ["copia@cliente-piloto.example"] }));
  assert(outcome.status === "REJECTED_UNAUTHORIZED_SENDER");
  const intake = store.state.intakes[0];
  assert(intake.fromAddress === "planejador@axion.com.br" && intake.ccAddresses[0] === "copia@cliente-piloto.example");
  assert(intake.attachments.length === 1 && intake.decisionRule === "SENDER_MEMBERSHIP_NOT_ACTIVE" && intake.senderUserId === PLANNER);
  assert(store.state.attachmentsIngested.length === 0, "remetente não autorizado: nenhum download");
  assert(store.state.audits[0].action === "WEEKLY_SCHEDULE_EMAIL_REJECTED_UNAUTHORIZED_SENDER");
});

await check("Falha na ingestão → intake FAILED com erro sanitizado (nunca exceção silenciosa)", async () => {
  const store = createMemoryIngestionStore({ senderResolution: sender() });
  store.ingestAttachment = async () => {
    throw new Error("Storage indisponível token=abcdefghijklmnop");
  };
  const outcome = await processWeeklyScheduleEmailCandidate(store, { ...config }, candidate());
  assert(outcome.status === "FAILED" && outcome.rule === "INGESTION_FAILURE");
  const intake = store.state.intakes[0];
  assert(intake.failureError.includes("[redacted]") && !intake.failureError.includes("abcdefghijklmnop"), intake.failureError);
});

// ==================================================================
// Semana / prazo / alerta de ausência — caso 11
// ==================================================================
await check("Semana e prazo no fuso do projeto (segunda-feira; sexta 18:00 America/Sao_Paulo = 21:00Z)", () => {
  assert(resolveWeekStart("2026-09-16T14:00:00Z", "America/Sao_Paulo") === "2026-09-14");
  // 2026-09-14 00:30Z ainda é domingo 13/09 21:30 em São Paulo → semana anterior.
  assert(resolveWeekStart("2026-09-14T00:30:00Z", "America/Sao_Paulo") === "2026-09-07");
  const deadline = resolveWeeklyDeadline("2026-09-14", { deadlineWeekday: 5, deadlineTime: "18:00", timezone: "America/Sao_Paulo" });
  assert(deadline.toISOString() === "2026-09-18T21:00:00.000Z", deadline.toISOString());
  const state = resolveCurrentWeekDeadline(new Date("2026-09-18T20:59:00Z"), { deadlineWeekday: 5, deadlineTime: "18:00", timezone: "America/Sao_Paulo" });
  assert(state.weekStart === "2026-09-14" && state.isPastDeadline === false);
});

await check("11. Ausência semanal → alerta ÚNICO e idempotente; não alerta antes do prazo nem quando recebido", async () => {
  const alerts = [];
  const audits = [];
  const received = new Set();
  const store = {
    async hasReceivedScheduleForWeek(projectId, weekStart) {
      return received.has(`${projectId}:${weekStart}`);
    },
    async insertAlert(record) {
      const key = `${record.projectId}:${record.weekStart}:${record.kind}`;
      if (alerts.some((row) => row.key === key)) return { created: false, id: null };
      alerts.push({ key, ...record });
      return { created: true, id: `alert-${alerts.length}` };
    },
    async writeAudit(entry) {
      audits.push(entry);
    },
  };
  const beforeDeadline = await createWeeklyAbsenceAlert(store, config, new Date("2026-09-18T20:00:00Z"));
  assert(beforeDeadline.result === "NOT_DUE" && alerts.length === 0);

  const first = await createWeeklyAbsenceAlert(store, config, new Date("2026-09-18T21:05:00Z"));
  assert(first.result === "CREATED" && alerts.length === 1 && alerts[0].weekStart === "2026-09-14");
  assert(alerts[0].recipientUserIds[0] === config.alertRecipientUserIds[0], "destinatários internos vêm da configuração");

  const second = await createWeeklyAbsenceAlert(store, config, new Date("2026-09-19T09:00:00Z"));
  assert(second.result === "ALREADY_ALERTED" && alerts.length === 1, "segunda rodada não duplica");
  assert(audits.length === 1, "auditoria só na criação");

  received.add(`${PROJECT}:2026-09-21`);
  const nextWeek = await createWeeklyAbsenceAlert(store, config, new Date("2026-09-25T22:00:00Z"));
  assert(nextWeek.result === "RECEIVED" && alerts.length === 1);
  // RECEIVED_DUPLICATE conta como recebido (contrato do store real).
  const storeSource = readSource("apps/web/lib/schedule/weekly-ingestion/supabase-store.ts");
  assert(/RECEIVED_STATUSES[^;]*"RECEIVED_DUPLICATE"/.test(storeSource), "supabase-store considera RECEIVED_DUPLICATE como recebimento semanal");

  const disabled = await createWeeklyAbsenceAlert(store, { ...config, enabled: false }, new Date("2026-09-25T22:00:00Z"));
  assert(disabled.result === "DISABLED");
});

// ==================================================================
// Comparação + classificação — caso 12 e dimensões
// ==================================================================
function activity(id, overrides = {}) {
  return {
    id,
    externalTaskId: null,
    uniqueId: id,
    wbs: null,
    outlineLevel: 1,
    parentTaskId: null,
    name: `Atividade ${id}`,
    baselineStart: "2026-01-01",
    baselineEnd: "2026-03-01",
    plannedStart: "2026-01-01",
    plannedEnd: "2026-03-01",
    durationValue: 10,
    durationUnit: "d",
    totalFloatValue: 5,
    totalFloatUnit: "d",
    percentComplete: 50,
    isMilestone: false,
    isSummaryTask: false,
    isCritical: false,
    calendarName: null,
    status: "NO_PRAZO",
    ...overrides,
  };
}

const reference = {
  scheduleVersionId: "sv-ref",
  statusDate: "2026-09-10",
  activities: [
    activity("1"),
    activity("2", { plannedEnd: "2026-04-01", isCritical: true, totalFloatValue: 0 }),
    activity("M1", { isMilestone: true, plannedEnd: "2026-05-01", baselineEnd: "2026-05-01", durationValue: 0 }),
    activity("3", { plannedEnd: "2026-02-01", percentComplete: 100 }),
  ],
  relations: [{ predecessorTaskId: "1", predecessorUniqueId: "1", predecessorName: "", successorTaskId: "2", successorUniqueId: "2", successorName: "", relationType: "FS", lagValue: 0, lagUnit: "d" }],
};
const current = {
  scheduleVersionId: "sv-cur",
  statusDate: "2026-09-17",
  activities: [
    activity("1", { durationValue: 15, isCritical: true, totalFloatValue: -2 }),
    activity("2", { plannedEnd: "2026-04-15", isCritical: true, totalFloatValue: 0 }),
    activity("M1", { isMilestone: true, plannedEnd: "2026-05-11", baselineEnd: "2026-05-01", durationValue: 0 }),
    activity("4", { plannedEnd: "2026-02-15", percentComplete: 20 }),
  ],
  relations: [
    { predecessorTaskId: "1", predecessorUniqueId: "1", predecessorName: "", successorTaskId: "2", successorUniqueId: "2", successorName: "", relationType: "SS", lagValue: 0, lagUnit: "d" },
  ],
};

let metrics;
await check("Comparação: data final, marcos, caminho crítico, folga, vencidas, add/rem, duração, relações, avanço, tendência", () => {
  metrics = compareScheduleSnapshots(current, reference, { asOf: "2026-09-18T00:00:00Z" });
  assert(metrics.finalDate.slipDays === 10, `slip ${metrics.finalDate.slipDays}`); // 05-01 → 05-11
  assert(metrics.milestones.slippedCount === 1 && metrics.milestones.maxSlipDays === 10);
  assert(metrics.criticalPath.enteredCount === 1 && metrics.criticalPath.entered[0] === "Atividade 1");
  assert(metrics.totalFloat.currentMinDays === -2 && metrics.totalFloat.deltaDays === -2);
});

await check("Comparação: contagens detalhadas coerentes", () => {
  // Folhas vencidas na versão atual (status_date 2026-09-17, não concluídas):
  // 1 (03-01), 2 (04-15), M1 (05-11, marco não concluído), 4 (02-15) → 4.
  assert(metrics.overdue.currentCount === 4, `vencidas ${metrics.overdue.currentCount}: ${metrics.overdue.current.join(", ")}`);
  assert(metrics.matching.addedCount === 1 && metrics.matching.removedCount === 1, "4 adicionada, 3 removida");
  assert(metrics.durations.changedCount === 1 && metrics.durations.maxChangePercent === 50);
  assert(metrics.relations.changedCount === 2, "FS removida + SS adicionada");
  assert(metrics.delay.trend === "AGGRAVATION" && metrics.delay.trendDays === 10);
  assert(metrics.progress.currentPercent !== null && metrics.progress.deltaPercent < 0);
});

await check("12. Sem limites configurados → REVIEW_REQUIRED (nunca LOW por ausência de configuração)", () => {
  const assessment = classifyScheduleRisk(metrics, []);
  assert(assessment.classification === "REVIEW_REQUIRED", assessment.classification);
  assert(assessment.partialSeverity === null);
  const zero = compareScheduleSnapshots(reference, reference, { asOf: "2026-01-01T00:00:00Z" });
  assert(classifyScheduleRisk(zero, []).classification === "REVIEW_REQUIRED", "mesmo sem variação alguma, sem limites => REVIEW_REQUIRED");
});

await check("Limites parciais: dimensão adversa sem limite → REVIEW_REQUIRED com severidade parcial; todas cobertas → severidade máxima", () => {
  const onlyFinal = [{ dimension: "FINAL_DATE_SLIP_DAYS", medium: 3, high: 7, critical: 15 }];
  const partial = classifyScheduleRisk(metrics, onlyFinal);
  assert(partial.classification === "REVIEW_REQUIRED" && partial.partialSeverity === "HIGH", `${partial.classification}/${partial.partialSeverity}`);

  const all = [
    { dimension: "FINAL_DATE_SLIP_DAYS", medium: 3, high: 7, critical: 15 },
    { dimension: "CONTRACT_MILESTONE_SLIP_DAYS", medium: 5, high: 10, critical: 20 },
    { dimension: "CRITICAL_PATH_CHANGED_COUNT", medium: 1, high: 3, critical: 6 },
    { dimension: "MIN_TOTAL_FLOAT_DAYS", medium: 5, high: 2, critical: 0 },
    { dimension: "OVERDUE_ACTIVITIES_COUNT", medium: 2, high: 5, critical: 10 },
    { dimension: "ADDED_REMOVED_ACTIVITIES_COUNT", medium: 5, high: 10, critical: 20 },
    { dimension: "DURATION_CHANGE_PERCENT", medium: 20, high: 40, critical: 80 },
    { dimension: "RELATION_CHANGES_COUNT", medium: 5, high: 10, critical: 20 },
    { dimension: "PHYSICAL_PROGRESS_SHORTFALL_PERCENT", medium: 5, high: 10, critical: 20 },
    { dimension: "DELAY_AGGRAVATION_DAYS", medium: 3, high: 7, critical: 15 },
  ];
  const full = classifyScheduleRisk(metrics, all);
  assert(full.classification === "CRITICAL", `${full.classification} — ${full.reasons.join(" | ")}`); // folga -2 <= 0 => CRITICAL
  assert(full.dimensions.every((dimension) => dimension.value === null || dimension.configured));

  // Referência comparada consigo mesma: sem variação, mas a folga mínima 0
  // (atividade 2) bate no limiar CRITICAL invertido de MIN_TOTAL_FLOAT_DAYS.
  const selfCompare = classifyScheduleRisk(compareScheduleSnapshots(reference, reference, { asOf: "2026-01-01T00:00:00Z" }), all);
  assert(selfCompare.classification === "CRITICAL", `${selfCompare.classification} — ${selfCompare.reasons.join(" | ")}`);

  // Cronograma realmente tranquilo (folga positiva, nada vencido, sem variação) com todos os limites => LOW.
  const calmSnapshot = {
    scheduleVersionId: "sv-calm",
    statusDate: "2026-01-01",
    activities: [activity("1", { plannedEnd: "2026-06-01", totalFloatValue: 10 }), activity("2", { plannedEnd: "2026-07-01", totalFloatValue: 8 })],
    relations: [],
  };
  const calm = classifyScheduleRisk(compareScheduleSnapshots(calmSnapshot, calmSnapshot, { asOf: "2026-01-01T00:00:00Z" }), all);
  assert(calm.classification === "LOW", `${calm.classification} — ${calm.reasons.join(" | ")}`);
});

// ==================================================================
// Gatilho idempotente de comparação (store em memória)
// ==================================================================
await check("Gatilho pós-EXTRACTED: espera PENDING, computa PREVIOUS_WEEKLY/OFFICIAL_BASELINE uma única vez, baseline ausente => REVIEW_REQUIRED", async () => {
  const comparisons = new Map();
  const prepared = new Set();
  const extraction = { "dv-1": { id: "sv-1", extractionStatus: "PENDING", statusDate: null } };
  const snapshots = { "sv-1": current, "sv-0": reference };
  const store = {
    async listIntakesAwaitingComparison() {
      return [{ intakeId: "i-1", projectId: PROJECT, documentVersionId: "dv-1", weekStart: "2026-09-14", sentAt: "2026-09-16T14:00:00Z" }].filter((row) => !prepared.has(row.intakeId));
    },
    async findScheduleVersionForDocumentVersion(dv) {
      return extraction[dv] ?? null;
    },
    async getDocumentVersionProcessingStatus() {
      return "PROCESSING";
    },
    async findPreviousWeeklyScheduleVersionId() {
      return "sv-0";
    },
    async getBaselineScheduleVersionId() {
      return null;
    },
    async findComparison(cur, type) {
      const hit = comparisons.get(`${cur}:${type}`);
      return hit ? { id: `${cur}:${type}`, status: hit.status } : null;
    },
    async upsertComparison(record) {
      comparisons.set(`${record.currentScheduleVersionId}:${record.comparisonType}`, record);
    },
    async loadSnapshot(id) {
      return snapshots[id];
    },
    async loadThresholds() {
      return [];
    },
    async markIntakeComparisonsPrepared(id) {
      prepared.add(id);
    },
    async writeAudit() {},
  };

  const waiting = await prepareScheduleComparisons(store, { now: new Date("2026-09-18T00:00:00Z") });
  assert(waiting.waitingExtraction === 1 && comparisons.size === 0, "PENDING: nada computado");

  extraction["dv-1"].extractionStatus = "EXTRACTED";
  const done = await prepareScheduleComparisons(store, { now: new Date("2026-09-18T00:00:00Z") });
  assert(done.prepared === 1 && comparisons.size === 2, `prepared ${done.prepared}, rows ${comparisons.size}`);
  const previous = comparisons.get("sv-1:PREVIOUS_WEEKLY");
  assert(previous.status === "COMPUTED" && previous.referenceScheduleVersionId === "sv-0" && previous.riskClassification === "REVIEW_REQUIRED");
  assert(previous.metrics.finalDate.slipDays === 10, "métricas persistidas");
  const baseline = comparisons.get("sv-1:OFFICIAL_BASELINE");
  assert(baseline.status === "COMPUTED" && baseline.referenceScheduleVersionId === null && baseline.riskClassification === "REVIEW_REQUIRED");

  const again = await prepareScheduleComparisons(store, { now: new Date("2026-09-19T00:00:00Z") });
  assert(again.examined === 0 && comparisons.size === 2, "idempotente: nada reprocessado");
});

// ==================================================================
// Migration — leitura estática
// ==================================================================
await check("Migration: 9 tabelas com RLS, unicidades de idempotência, sem valores WEG/pessoa hardcoded, sem segunda fonte de escalão", () => {
  const sql = readSource("supabase/migrations/20260920120000_weekly_schedule_email_ingestion_foundation.sql");
  for (const table of [
    "project_weekly_schedule_ingestion_configs",
    "project_schedule_risk_thresholds",
    "project_schedule_baselines",
    "weekly_schedule_email_intakes",
    "schedule_version_comparisons",
    "weekly_report_workbooks",
    "weekly_report_sheets",
    "weekly_schedule_ingestion_alerts",
    "email_document_review_events",
  ]) {
    assert(sql.includes(`create table public.${table}`), `tabela ${table}`);
    assert(sql.includes(`alter table public.${table} enable row level security`), `RLS ${table}`);
    assert(new RegExp(`on public\\.${table} for select\\s+using \\(\\s*public\\.is_project_member\\(project_id\\)`).test(sql), `select policy ${table}`);
  }
  assert(sql.includes("unique (project_id, gmail_message_id)"), "idempotência da mensagem");
  assert(sql.includes("unique (current_schedule_version_id, comparison_type)"), "idempotência da comparação");
  assert(sql.includes("unique (project_id, week_start, kind)"), "idempotência do alerta");
  assert(sql.includes("unique (email_attachment_id)"), "uma leitura da planilha do relatório por anexo");
  assert(!/weg\.net|ricardo/i.test(sql), "nenhum valor WEG/pessoa na migration");
  assert(!sql.includes("project_weekly_schedule_authorized_senders"), "nenhuma segunda fonte de escalão (tabela de remetentes removida)");
  assert(!/authorized_levels|sender_level|authorized_level/.test(sql), "nenhum campo manual de nível/escalão");
  assert(sql.includes("authorized_tiers"), "config só habilita/bloqueia escalões");
  assert(!/on public\.weekly_schedule_email_intakes for (update|insert)/.test(sql), "intakes: nenhuma policy de UPDATE/INSERT para authenticated (revisão só via RPC)");
  assert(sql.includes("create or replace function public.review_weekly_schedule_intake"), "RPC de revisão humana");
  assert(sql.includes("create or replace function public.set_project_schedule_baseline"), "RPC de baseline");
  assert(sql.includes("unique index project_schedule_baselines_one_active_idx"), "uma baseline ativa por projeto");
  assert(sql.includes("'RECEIVED_DUPLICATE'"), "status RECEIVED_DUPLICATE");
  assert(sql.includes("actor_type='SYSTEM'") || sql.includes("'SYSTEM'"), "auditoria SYSTEM documentada");
});

await check("Código de produção sem remetente/domínio de cliente hardcoded", () => {
  const files = [
    "apps/web/lib/schedule/weekly-ingestion/types.ts",
    "apps/web/lib/schedule/weekly-ingestion/evaluate-weekly-schedule-email.ts",
    "apps/web/lib/schedule/weekly-ingestion/ingest-weekly-schedule-email.ts",
    "apps/web/lib/schedule/weekly-ingestion/supabase-store.ts",
    "apps/web/lib/schedule/weekly-ingestion/prepare-schedule-comparisons.ts",
    "apps/web/lib/schedule/weekly-ingestion/create-absence-alerts.ts",
    "scripts/weekly-schedule-email-ingest.mjs",
  ];
  for (const file of files) {
    const source = readSource(file);
    assert(!/weg\.net|ricardo|martins/i.test(source), `${file} contém valor WEG/pessoa`);
  }
});

console.log("");
console.log(`Resultado: ${passed} OK, ${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
