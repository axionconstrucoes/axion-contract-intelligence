// Testes do Dashboard Visual (ACC — NOVO PACOTE: DASHBOARD VISUAL).
// Lógica pura testada de verdade (sem I/O); UI/branding verificados por
// checagem estrutural do código-fonte (este repo não tem
// jsdom/testing-library — mesmo padrão de todo o resto da suíte).
// NUNCA chama a API Anthropic.
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/test-dashboard-visual.mjs

import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const { resolveActiveFindingsSummary, resolveGeneralSituation, isFindingActive } = await import(
  "../apps/web/lib/dashboard-visual/resolve-active-findings-summary"
);
const { resolveTimeRange, isWithinTimeRange } = await import("../apps/web/lib/dashboard-visual/resolve-time-range");
const { computeAdditionalProposalsSummary } = await import("../apps/web/lib/dashboard-visual/compute-additional-proposals-summary");
const { selectFormalizedAditivos, computeAditivosContratuaisSummary, buildContractValueTable } = await import(
  "../apps/web/lib/dashboard-visual/compute-contract-value"
);
const { computeDeadlineSummary } = await import("../apps/web/lib/dashboard-visual/compute-deadline-summary");
const { computeEsgSummary } = await import("../apps/web/lib/dashboard-visual/compute-esg-summary");
const { computeSlaActionsSummary } = await import("../apps/web/lib/dashboard-visual/compute-sla-summary");
const { resolveEmailProcessingSets } = await import("../apps/web/lib/dashboard-visual/resolve-email-processing-sets");
const { computeEmailSummary } = await import("../apps/web/lib/dashboard-visual/compute-email-summary");
const { computeEmailMailboxVolumeRows, computeGenericSourceVolumeRows } = await import(
  "../apps/web/lib/dashboard-visual/compute-source-volume-rows"
);
const { ACC_FEATURE_HELP } = await import("../apps/web/lib/ui/feature-help");
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

function assert(condition, message) {
  if (!condition) throw new Error(message ?? "assertion failed");
}

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
console.log("DASHBOARD VISUAL — TESTES");
console.log("======================================");

// ---------------- fixtures ----------------

function makeFinding(overrides = {}) {
  return {
    id: "finding-1",
    projectId: "project-1",
    curationRunId: null,
    findingType: "DESVIO",
    classification: null,
    expertIds: ["commercial-director"],
    severity: "MEDIUM",
    confidence: 0.8,
    facts: [],
    interpretation: "Interpretação de teste",
    recommendation: "Recomendação de teste",
    grounding: null,
    sourceRefs: [],
    conflictingSourceRefs: [],
    requiresHumanReview: true,
    lifecycleStatus: "NEW",
    supersededByFindingId: null,
    fingerprint: "fp-1",
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

function makeProposal(overrides = {}) {
  return {
    id: "proposal-1",
    projectId: "project-1",
    proposalNumber: "AD-01",
    title: "Adicional de teste",
    description: "",
    sourceType: "MANUAL",
    driveUrl: null,
    driveFileId: null,
    proposalDate: null,
    proposedValue: null,
    note: null,
    status: "POSSIBLE_ADDITIONAL",
    scopeApprovalStatus: "NOT_EVALUATED",
    commercialApprovalStatus: "NOT_EVALUATED",
    scheduleExtensionStatus: "NOT_EVALUATED",
    executionStatus: "NOT_STARTED",
    contractedAt: null,
    contractedValue: null,
    formalizationType: null,
    approvalEvidenceNote: null,
    executionStarted: null,
    contractedNote: null,
    documentalState: null,
    reservationConflictingClause: null,
    reservationRisk: null,
    reservationRecommendation: null,
    createdByType: "USER",
    createdByUserId: null,
    createdByLabel: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeObligation(overrides = {}) {
  return {
    id: "obligation-1",
    projectId: "project-1",
    title: "Obrigação de teste",
    category: "DDS",
    description: null,
    sourceDocumentVersionId: null,
    sourceDocumentTitle: null,
    clauseId: null,
    clauseNumber: null,
    sourceReference: null,
    responsibleUserId: null,
    responsibleName: null,
    responsibleLabel: null,
    periodicity: "MENSAL",
    requiredEvidenceDescription: null,
    penaltyDescription: null,
    active: true,
    createdByUserId: "user-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeSubmission(overrides = {}) {
  return {
    id: "submission-1",
    projectId: "project-1",
    obligationId: "obligation-1",
    referenceDate: "2026-08-01",
    referencePeriodLabel: null,
    dueDate: null,
    filledByUserId: "user-1",
    filledByName: null,
    status: "PENDENTE",
    description: null,
    observation: null,
    justification: null,
    riskLevel: "LOW",
    ddsDetails: null,
    reviewedByUserId: null,
    reviewedByName: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeSlaAction(overrides = {}) {
  return {
    id: "action-1",
    projectId: "project-1",
    origin: "MANUAL",
    originExpertId: null,
    title: "Ação de teste",
    description: "",
    riskLevel: "MEDIUM",
    area: "ENGENHARIA",
    responsibleUserId: null,
    responsibleName: null,
    status: "PENDING",
    currentEscalationLevel: "RESPONSAVEL",
    contractualDeadline: null,
    assumeDueAt: "2026-08-21T00:00:00.000Z",
    respondDueAt: null,
    completeDueAt: null,
    acknowledgedAt: null,
    acknowledgedByUserId: null,
    completedAt: null,
    completedByUserId: null,
    completionNote: null,
    relatedEventId: null,
    relatedDocumentVersionId: null,
    relatedEsgObligationSubmissionId: null,
    relatedActionRequestId: null,
    createdByType: "SYSTEM",
    createdByUserId: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------- Alertas: ativos por severidade (nunca inclui resolvidos/dispensados/superados) ----------------

check("alertas: findings NEW/PENDING_HUMAN_REVIEW/ACKNOWLEDGED contam como ativos", () => {
  assert(isFindingActive(makeFinding({ lifecycleStatus: "NEW" })));
  assert(isFindingActive(makeFinding({ lifecycleStatus: "PENDING_HUMAN_REVIEW" })));
  assert(isFindingActive(makeFinding({ lifecycleStatus: "ACKNOWLEDGED" })));
});

check("alertas: RESOLVED/REJECTED/SUPERSEDED/DISMISSED_AT_STARTUP/RESOLVED_BEFORE_GO_LIVE nunca contam como ativos", () => {
  for (const status of ["RESOLVED", "REJECTED", "SUPERSEDED", "DISMISSED_AT_STARTUP", "RESOLVED_BEFORE_GO_LIVE"]) {
    assert(!isFindingActive(makeFinding({ lifecycleStatus: status })), `${status} não deveria ser ativo`);
  }
});

check("alertas: contagem por severidade Baixo/Médio/Alto/Crítico + total ativos", () => {
  const findings = [
    makeFinding({ id: "1", severity: "LOW", lifecycleStatus: "NEW" }),
    makeFinding({ id: "2", severity: "MEDIUM", lifecycleStatus: "NEW" }),
    makeFinding({ id: "3", severity: "HIGH", lifecycleStatus: "NEW" }),
    makeFinding({ id: "4", severity: "CRITICAL", lifecycleStatus: "NEW" }),
    makeFinding({ id: "5", severity: "CRITICAL", lifecycleStatus: "RESOLVED" }),
  ];
  const summary = resolveActiveFindingsSummary(findings);
  assert(summary.countsBySeverity.BAIXA === 1);
  assert(summary.countsBySeverity.MEDIA === 1);
  assert(summary.countsBySeverity.ALTA === 1);
  assert(summary.countsBySeverity.CRITICA === 1, "o CRITICAL resolvido não deve ser contado");
  assert(summary.totalActive === 4);
});

// ---------------- Situação geral: maior risco ativo, determinístico ----------------

check("situação geral: maior risco ativo é usado (nunca IA)", () => {
  const findings = [
    makeFinding({ id: "1", severity: "LOW", lifecycleStatus: "NEW" }),
    makeFinding({ id: "2", severity: "HIGH", lifecycleStatus: "NEW" }),
  ];
  assert(resolveGeneralSituation(findings) === "ALTA");
});

check("situação geral: risco CRITICAL resolvido não eleva a situação geral", () => {
  const findings = [makeFinding({ severity: "CRITICAL", lifecycleStatus: "RESOLVED" }), makeFinding({ severity: "LOW", lifecycleStatus: "NEW" })];
  assert(resolveGeneralSituation(findings) === "BAIXA");
});

check("situação geral: sem findings ativos => SEM_RISCO_ATIVO", () => {
  assert(resolveGeneralSituation([makeFinding({ lifecycleStatus: "RESOLVED" })]) === "SEM_RISCO_ATIVO");
  assert(resolveGeneralSituation([]) === "SEM_RISCO_ATIVO");
});

check("resolveGeneralSituation nunca importa nenhum provider/cliente de IA (cálculo determinístico)", () => {
  const source = readSource("apps/web/lib/dashboard-visual/resolve-active-findings-summary.ts");
  assert(!/anthropic|generateAssessment|answerQuery/i.test(source));
});

// ---------------- Filtro temporal ----------------

const NOW = new Date("2026-08-21T12:00:00.000Z");

check("filtro temporal: Hoje cobre só o dia atual (UTC)", () => {
  const range = resolveTimeRange({ range: "HOJE" }, NOW, null);
  assert(isWithinTimeRange("2026-08-21T05:00:00.000Z", range));
  assert(!isWithinTimeRange("2026-08-20T23:00:00.000Z", range));
});

check("filtro temporal: 7 dias e 30 dias calculam a partir de `now` (nunca new Date() interno)", () => {
  const range7 = resolveTimeRange({ range: "7D" }, NOW, null);
  assert(isWithinTimeRange("2026-08-15T00:00:00.000Z", range7));
  assert(!isWithinTimeRange("2026-08-10T00:00:00.000Z", range7));

  const range30 = resolveTimeRange({ range: "30D" }, NOW, null);
  assert(isWithinTimeRange("2026-07-25T00:00:00.000Z", range30));
});

check("filtro temporal: Desde o início usa project_start_date real (nunca inventa uma data)", () => {
  const range = resolveTimeRange({ range: "DESDE_INICIO" }, NOW, "2026-01-10T00:00:00.000Z");
  assert(range.from === new Date("2026-01-10T00:00:00.000Z").toISOString());

  const rangeSemInicio = resolveTimeRange({ range: "DESDE_INICIO" }, NOW, null);
  assert(rangeSemInicio.from === null, "sem project_start_date, from deve ser null (nunca uma data inventada)");
});

check("filtro temporal: Personalizado respeita from/to informados", () => {
  const range = resolveTimeRange({ range: "PERSONALIZADO", from: "2026-08-01", to: "2026-08-10" }, NOW, null);
  assert(isWithinTimeRange("2026-08-05T00:00:00.000Z", range));
  assert(!isWithinTimeRange("2026-08-15T00:00:00.000Z", range));
});

// ---------------- Adicionais ----------------

check("adicionais: contagem por status do pipeline + formalização pendente é subconjunto de contratados", () => {
  const proposals = [
    makeProposal({ id: "1", status: "POSSIBLE_ADDITIONAL" }),
    makeProposal({ id: "2", status: "UNDER_ANALYSIS" }),
    makeProposal({ id: "3", status: "IN_NEGOTIATION" }),
    makeProposal({ id: "4", status: "CONTRACTED", documentalState: "CONTRATADO_DOCUMENTACAO_COMPLETA" }),
    makeProposal({ id: "5", status: "CONTRACTED", documentalState: "CONTRATADO_DOCUMENTACAO_PENDENTE" }),
  ];
  const summary = computeAdditionalProposalsSummary(proposals);
  assert(summary.possible === 1 && summary.underAnalysis === 1 && summary.inNegotiation === 1);
  assert(summary.contracted === 2);
  assert(summary.contractedWithPendingFormalization === 1);
});

// ---------------- Aditivos / Valor contratual ----------------

check("aditivos: só CONTRACTED + formalização ADITIVO_CONTRATUAL entram (possível/em análise/negociação NUNCA entram)", () => {
  const proposals = [
    makeProposal({ id: "1", status: "POSSIBLE_ADDITIONAL", contractedValue: 999999, formalizationType: "ADITIVO_CONTRATUAL", contractedAt: "2026-01-01" }),
    makeProposal({ id: "2", status: "IN_NEGOTIATION", proposedValue: 5000 }),
    makeProposal({ id: "3", status: "CONTRACTED", formalizationType: "EMAIL_APROVACAO", contractedValue: 1000, contractedAt: "2026-02-01" }),
    makeProposal({ id: "4", status: "CONTRACTED", formalizationType: "ADITIVO_CONTRATUAL", contractedValue: 50000, contractedAt: "2026-03-01" }),
  ];
  const aditivos = selectFormalizedAditivos(proposals);
  assert(aditivos.length === 1, `esperado 1 aditivo formalizado, obtido ${aditivos.length}`);
  assert(aditivos[0].proposalId === "4");
});

check("aditivos: redução (valor negativo) e acréscimo somam corretamente no valor líquido", () => {
  const proposals = [
    makeProposal({ id: "1", status: "CONTRACTED", formalizationType: "ADITIVO_CONTRATUAL", contractedValue: 100000, contractedAt: "2026-01-01" }),
    makeProposal({ id: "2", status: "CONTRACTED", formalizationType: "ADITIVO_CONTRATUAL", contractedValue: -20000, contractedAt: "2026-02-01" }),
  ];
  const aditivos = selectFormalizedAditivos(proposals);
  const summary = computeAditivosContratuaisSummary(aditivos);
  assert(summary.quantity === 2);
  assert(summary.netValue === 80000);
  assert(summary.lastAditivo.contractedAt === "2026-02-01");
});

check("valor contratual: tabela nunca inventa o valor do Contrato Base nem o total vigente (base desconhecida)", () => {
  const proposals = [makeProposal({ id: "1", status: "CONTRACTED", formalizationType: "ADITIVO_CONTRATUAL", contractedValue: 30000, contractedAt: "2026-02-01", title: "Aditivo teste" })];
  const aditivos = selectFormalizedAditivos(proposals);
  const table = buildContractValueTable(aditivos, "2026-01-01T00:00:00.000Z");
  assert(table.rows[0].instrument === "Contrato Base");
  assert(table.rows[0].changeValue === null, "Contrato Base nunca deve ter um valor de acréscimo inventado");
  assert(table.rows[1].instrument === "Aditivo 01");
  assert(table.rows[1].changeValue === 30000);
  assert(table.totalAditivosChange === 30000);
});

// ---------------- Prazo ----------------

function makeContractChange(overrides = {}) {
  return {
    id: "cc-1",
    projectId: "project-1",
    code: "CC-01",
    title: "Alteração de teste",
    description: "",
    status: "OPEN",
    identifiedAt: "2026-01-01T00:00:00.000Z",
    createdByType: "USER",
    createdByUserId: null,
    createdByLabel: null,
    clientFormalizationStatus: "NOT_SUBMITTED",
    scheduleImpactStatus: "PENDING_ASSESSMENT",
    technicalAdditionalDays: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

check("prazo: data inicial e prazo original vêm do projeto; vigente/aprovado sempre NÃO DISPONÍVEL (null)", () => {
  const summary = computeDeadlineSummary({ startDate: "2026-01-01", baselineEndDate: "2026-12-31" }, []);
  assert(summary.startDate === "2026-01-01");
  assert(summary.originalEndDate === "2026-12-31");
  assert(summary.currentEndDate === null);
  assert(summary.approvedExtensionDays === null);
});

check("prazo: solicitado soma technicalAdditionalDays só de EXTENSION_REQUIRED não cancelados (nunca solicitado = aprovado)", () => {
  const changes = [
    makeContractChange({ id: "1", scheduleImpactStatus: "EXTENSION_REQUIRED", technicalAdditionalDays: 10 }),
    makeContractChange({ id: "2", scheduleImpactStatus: "EXTENSION_REQUIRED", technicalAdditionalDays: 5, status: "CANCELLED" }),
    makeContractChange({ id: "3", scheduleImpactStatus: "NO_IMPACT", technicalAdditionalDays: 3 }),
  ];
  const summary = computeDeadlineSummary({ startDate: null, baselineEndDate: null }, changes);
  assert(summary.requestedExtensionDays === 10, `esperado 10, obtido ${summary.requestedExtensionDays}`);
  assert(summary.requestedExtensionSourceCount === 1);
  assert(summary.approvedExtensionDays === null, "nunca considerar solicitado como aprovado");
});

// ---------------- ESG ----------------

check("ESG: ocorrências conta só obrigações ativas; abertas exclui CUMPRIDO/NAO_APLICAVEL/DISPENSADO", () => {
  const obligations = [makeObligation({ id: "o1", active: true }), makeObligation({ id: "o2", active: false })];
  const submissions = [makeSubmission({ obligationId: "o1", status: "CUMPRIDO", riskLevel: "LOW" })];
  const summary = computeEsgSummary(obligations, submissions, []);
  assert(summary.occurrences === 1, "obrigação inativa não deve ser contada");
  assert(summary.open === 0);
});

check("ESG: obrigação sem nenhuma comprovação é considerada aberta", () => {
  const summary = computeEsgSummary([makeObligation({ id: "o1" })], [], []);
  assert(summary.open === 1);
});

check("ESG: risco usa riskLevel já persistido na comprovação mais recente (nunca recalculado aqui)", () => {
  const obligations = [makeObligation({ id: "o1" })];
  const submissions = [
    makeSubmission({ id: "s1", obligationId: "o1", referenceDate: "2026-06-01", riskLevel: "LOW" }),
    makeSubmission({ id: "s2", obligationId: "o1", referenceDate: "2026-08-01", riskLevel: "CRITICAL" }),
  ];
  const summary = computeEsgSummary(obligations, submissions, []);
  assert(summary.countsByRisk.CRITICAL === 1, "deve usar a comprovação mais recente (agosto), não a de junho");
  assert(summary.countsByRisk.LOW === 0);
});

check("ESG: evidência pendente só conta quando a obrigação exige evidência e nenhuma foi anexada", () => {
  const obligations = [makeObligation({ id: "o1", requiredEvidenceDescription: "Foto obrigatória" })];
  const submissions = [makeSubmission({ id: "s1", obligationId: "o1" })];
  const withoutEvidence = computeEsgSummary(obligations, submissions, []);
  assert(withoutEvidence.evidencePending === 1);

  const withEvidence = computeEsgSummary(obligations, submissions, [
    { id: "e1", submissionId: "s1", obligationId: "o1", evidenceKind: "FOTO", storageBucket: "b", filePath: "p", originalFileName: "f", mimeType: "image/png", fileSizeBytes: 1, replacesEvidenceId: null, uploadedByUserId: "u", uploadedByName: null, uploadedAt: "2026-08-01T00:00:00.000Z" },
  ]);
  assert(withEvidence.evidencePending === 0);
});

// ---------------- Ações / SLA ----------------

check("SLA: vencidas usa status OVERDUE ou o próximo prazo aplicável já passado", () => {
  const today = new Date("2026-08-21T12:00:00.000Z");
  const actions = [
    makeSlaAction({ id: "1", status: "OVERDUE" }),
    makeSlaAction({ id: "2", status: "PENDING", assumeDueAt: "2026-08-20T00:00:00.000Z" }),
    makeSlaAction({ id: "3", status: "PENDING", assumeDueAt: "2026-08-25T00:00:00.000Z" }),
  ];
  const summary = computeSlaActionsSummary(actions, today);
  assert(summary.overdue === 2, `esperado 2 vencidas, obtido ${summary.overdue}`);
});

check("SLA: vencem hoje usa o mesmo dia UTC do prazo aplicável", () => {
  const today = new Date("2026-08-21T12:00:00.000Z");
  const actions = [makeSlaAction({ id: "1", status: "PENDING", assumeDueAt: "2026-08-21T23:00:00.000Z" })];
  const summary = computeSlaActionsSummary(actions, today);
  assert(summary.dueToday === 1);
});

check("SLA: escalonadas conta status ESCALATED OU nível acima de RESPONSAVEL", () => {
  const actions = [
    makeSlaAction({ id: "1", status: "ESCALATED", currentEscalationLevel: "RESPONSAVEL" }),
    makeSlaAction({ id: "2", status: "PENDING", currentEscalationLevel: "ESCALAO_1" }),
    makeSlaAction({ id: "3", status: "PENDING", currentEscalationLevel: "RESPONSAVEL" }),
  ];
  const summary = computeSlaActionsSummary(actions, new Date("2026-08-21T12:00:00.000Z"));
  assert(summary.escalated === 2);
});

check("SLA: concluídas/canceladas nunca contam como pendentes/vencidas/vencem hoje", () => {
  const actions = [makeSlaAction({ id: "1", status: "COMPLETED", assumeDueAt: "2026-01-01T00:00:00.000Z" })];
  const summary = computeSlaActionsSummary(actions, new Date("2026-08-21T12:00:00.000Z"));
  assert(summary.pending === 0 && summary.overdue === 0 && summary.dueToday === 0);
});

// ---------------- E-mails: processado != considerado, recebidos != enviados ----------------

function makeCurationRun(overrides = {}) {
  return {
    id: "run-1",
    projectId: "project-1",
    sourceType: "EMAIL",
    sourceId: "email-1",
    sourceFingerprint: "fp",
    triggerType: "AUTOMATIC",
    status: "COMPLETED",
    routedExpertIds: [],
    errorMessage: null,
    startedAt: "2026-08-10T00:00:00.000Z",
    completedAt: "2026-08-10T00:05:00.000Z",
    createdByType: "SYSTEM",
    createdByUserId: null,
    createdByLabel: null,
    createdAt: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

check("e-mail: processado pelo ACC (curation run) e considerado (finding) são conjuntos distintos", () => {
  const curationRuns = [makeCurationRun({ sourceId: "email-1" })];
  const findings = [makeFinding({ sourceRefs: [{ type: "EMAIL", id: "email-2" }] })];
  const sets = resolveEmailProcessingSets(curationRuns, findings);
  assert(sets.processedEmailIds.has("email-1"));
  assert(!sets.consideredEmailIds.has("email-1"), "processado não implica considerado");
  assert(sets.consideredEmailIds.has("email-2"));
  assert(!sets.processedEmailIds.has("email-2"), "considerado não implica processado");
});

check("e-mail: curation run de outro source_type (EMAIL_ATTACHMENT) nunca marca o e-mail como processado", () => {
  const sets = resolveEmailProcessingSets([makeCurationRun({ sourceType: "EMAIL_ATTACHMENT", sourceId: "email-1" })], []);
  assert(!sets.processedEmailIds.has("email-1"));
});

check("e-mail: recebidos (INBOUND) e enviados (OUTBOUND) nunca se misturam", () => {
  const rows = [
    { id: "1", mailboxAddress: "obras@axion.com.br", direction: "INBOUND", providerMessageId: null, sentAt: "2026-08-10T00:00:00.000Z" },
    { id: "2", mailboxAddress: "obras@axion.com.br", direction: "OUTBOUND", providerMessageId: null, sentAt: "2026-08-10T00:00:00.000Z" },
  ];
  const range = resolveTimeRange({ range: "30D" }, NOW, null);
  const summary = computeEmailSummary(rows, { processedEmailIds: new Set(), consideredEmailIds: new Set() }, range);
  assert(summary.received === 1 && summary.sent === 1);
});

check("volume por mailbox: só usa contas reais configuradas neste projeto (nunca inventa uma mailbox)", () => {
  const rows = [
    { id: "1", mailboxAddress: "a@axion.com.br", direction: "INBOUND", providerMessageId: "m1", sentAt: "2026-08-10T00:00:00.000Z" },
    { id: "2", mailboxAddress: "nao-configurada@axion.com.br", direction: "INBOUND", providerMessageId: "m2", sentAt: "2026-08-10T00:00:00.000Z" },
  ];
  const range = resolveTimeRange({ range: "30D" }, NOW, null);
  const sets = { processedEmailIds: new Set(), consideredEmailIds: new Set() };
  const { rows: volumeRows } = computeEmailMailboxVolumeRows([{ emailAddress: "a@axion.com.br" }], rows, sets, range, null);
  assert(volumeRows.length === 1);
  assert(volumeRows[0].specificOrigin === "a@axion.com.br");
  assert(volumeRows[0].received === 1, "e-mail de mailbox não configurada não deve entrar na linha");
});

check("volume: dedup por provider_message_id conta a mesma mensagem em duas mailboxes uma única vez no total", () => {
  const rows = [
    { id: "1", mailboxAddress: "a@axion.com.br", direction: "INBOUND", providerMessageId: "shared-msg", sentAt: "2026-08-10T00:00:00.000Z" },
    { id: "2", mailboxAddress: "b@axion.com.br", direction: "INBOUND", providerMessageId: "shared-msg", sentAt: "2026-08-10T00:00:00.000Z" },
  ];
  const range = resolveTimeRange({ range: "30D" }, NOW, null);
  const sets = { processedEmailIds: new Set(), consideredEmailIds: new Set() };
  const { rows: volumeRows, totals } = computeEmailMailboxVolumeRows(
    [{ emailAddress: "a@axion.com.br" }, { emailAddress: "b@axion.com.br" }],
    rows,
    sets,
    range,
    null
  );
  assert(volumeRows[0].received === 1 && volumeRows[1].received === 1, "cada mailbox mostra sua própria contagem (sem dedup na linha)");
  assert(totals.totalReceived === 1, "o total deduplicado deve contar a mensagem compartilhada uma única vez");
});

check("volume: e-mail sem provider_message_id nunca colapsa com outro por engano (chave própria por id)", () => {
  const rows = [
    { id: "1", mailboxAddress: "a@axion.com.br", direction: "INBOUND", providerMessageId: null, sentAt: "2026-08-10T00:00:00.000Z" },
    { id: "2", mailboxAddress: "a@axion.com.br", direction: "INBOUND", providerMessageId: null, sentAt: "2026-08-10T00:00:00.000Z" },
  ];
  const range = resolveTimeRange({ range: "30D" }, NOW, null);
  const sets = { processedEmailIds: new Set(), consideredEmailIds: new Set() };
  const { totals } = computeEmailMailboxVolumeRows([{ emailAddress: "a@axion.com.br" }], rows, sets, range, null);
  assert(totals.totalReceived === 2);
});

check("volume: pendentes = recebidos - processados", () => {
  const rows = [
    { id: "1", mailboxAddress: "a@axion.com.br", direction: "INBOUND", providerMessageId: "m1", sentAt: "2026-08-10T00:00:00.000Z" },
    { id: "2", mailboxAddress: "a@axion.com.br", direction: "INBOUND", providerMessageId: "m2", sentAt: "2026-08-10T00:00:00.000Z" },
  ];
  const range = resolveTimeRange({ range: "30D" }, NOW, null);
  const sets = { processedEmailIds: new Set(["1"]), consideredEmailIds: new Set() };
  const { rows: volumeRows } = computeEmailMailboxVolumeRows([{ emailAddress: "a@axion.com.br" }], rows, sets, range, null);
  assert(volumeRows[0].received === 2 && volumeRows[0].processed === 1 && volumeRows[0].pending === 1);
});

// ---------------- Volume: fonte configurada com 0 real vs NÃO CONFIGURADA vs NÃO DISPONÍVEL ----------------

check("volume genérico: fonte sem nenhum config => NÃO CONFIGURADA em todas as colunas de contagem (nunca 0)", () => {
  const sources = [{ type: "CONSTRUMANAGER", label: "Construmanager", description: "Obra" }];
  const rows = computeGenericSourceVolumeRows(sources, []);
  assert(rows[0].received === "NAO_CONFIGURADA");
  assert(rows[0].specificOrigin === "NÃO CONFIGURADA");
});

check("volume genérico: fonte com origem definida => NÃO DISPONÍVEL nas contagens (configurada, mas sem contador modelado — nunca 0 fabricado)", () => {
  const sources = [{ type: "CONSTRUMANAGER", label: "Construmanager", description: "Obra" }];
  const configs = [{ sourceType: "CONSTRUMANAGER", externalSystemReference: "Construmanager", externalProjectReference: null, lastSyncAt: null }];
  const rows = computeGenericSourceVolumeRows(sources, configs);
  assert(rows[0].received === "NAO_DISPONIVEL", "contagem de itens não é modelada para fontes genéricas — nunca inventar 0");
  assert(rows[0].specificOrigin === "Construmanager");
});

check("volume genérico: nunca inclui EMAIL (tratado separadamente por mailbox)", () => {
  const sources = [
    { type: "EMAIL", label: "E-mail", description: "" },
    { type: "DRIVE", label: "Drive", description: "" },
  ];
  const rows = computeGenericSourceVolumeRows(sources, []);
  assert(rows.length === 1 && rows[0].source === "Drive");
});

// ---------------- Status das integrações reutilizado (nunca recriado) ----------------

check("Dashboard Visual reutiliza IntegrationStatusSummary/resolve-integration-display-status já publicados (nunca recria a lógica)", () => {
  const pageSource = readSource("apps/web/app/[projectId]/dashboard/visual/page.tsx");
  assert(/from "@\/components\/dashboard\/integration-status-summary"/.test(pageSource));
  const orchestratorSource = readSource("apps/web/lib/dashboard-visual/get-dashboard-visual-data.ts");
  assert(/resolveAllIntegrationStatuses/.test(orchestratorSource) && /summarizeIntegrationStatuses/.test(orchestratorSource));
});

// ---------------- Identidade visual: sidebar azul, header vermelho, formas regulares ----------------

check("sidebar: usa o token azul institucional (bg-brand-sidebar), texto branco, sem truncate cortando palavra", () => {
  const source = readSource("apps/web/components/layout/app-sidebar.tsx");
  assert(/bg-brand-sidebar/.test(source));
  assert(/text-brand-sidebar-foreground|text-white/.test(source));
  assert(!/\btruncate\b/.test(source), "labels da sidebar não podem mais usar truncate (nunca cortar palavra)");
  assert(/w-14/.test(source), "sidebar recolhida deve permanecer em ~56px (w-14)");
});

// REDESIGN VISUAL PREMIUM (2026-08-24): header deixou de ser uma barra
// vermelha sólida com texto branco (seção 1 do redesign — evitar
// grandes áreas saturadas de cor); token bg-brand-header continua
// existindo (agora claro/neutro), vermelho institucional reservado a
// acentos.
check("header (TopBar): usa o token institucional bg-brand-header e mostra 'AXION Controle de Contratos' com peso visual (semibold)", () => {
  const source = readSource("apps/web/components/layout/top-bar.tsx");
  assert(/bg-brand-header/.test(source));
  assert(source.includes("AXION") && source.includes("Controle de Contratos"));
  assert(/font-semibold/.test(source));
});

check("tokens de marca (globals.css): azul/vermelho institucionais definidos uma única vez, fixos (não redefinidos em .dark)", () => {
  const source = readSource("apps/web/app/globals.css");
  assert(/--brand-sidebar:/.test(source) && /--brand-header:/.test(source));
  const darkBlockMatch = source.match(/\.dark\s*\{[\s\S]*?\n\}/);
  assert(darkBlockMatch, "bloco .dark não encontrado");
  assert(!/--brand-sidebar:|--brand-header:/.test(darkBlockMatch[0]), "marca institucional deve ser fixa, nunca redefinida no tema escuro");
});

check("conteúdo: sem formas elípticas/orgânicas decorativas nos novos componentes do Dashboard Visual (visual corporativo limpo)", () => {
  const files = [
    "apps/web/app/[projectId]/dashboard/visual/page.tsx",
    "apps/web/components/dashboard-visual/summary-cards.tsx",
    "apps/web/components/dashboard-visual/contract-value-card.tsx",
    "apps/web/components/dashboard-visual/source-volume-table.tsx",
  ];
  for (const file of files) {
    const source = readSource(file);
    assert(!/rounded-full|clip-path|border-radius:\s*50%/.test(source), `${file} não deveria usar formas elípticas decorativas`);
  }
});

// ---------------- Zero dados fictícios / zero Anthropic ao vivo ----------------

check("Avanço físico/financeiro: nunca renderiza um percentual/valor fixo — só NÃO DISPONÍVEL/AGUARDANDO FONTE", () => {
  const source = readSource("apps/web/components/dashboard-visual/summary-cards.tsx");
  assert(!/\d+\s*%/.test(source.match(/function PhysicalProgressCard[\s\S]*?\n\}/)[0]), "avanço físico não pode ter nenhum percentual fixo no código");
});

check("Dashboard Visual (página + orquestração) nunca importa nenhum provider/cliente de IA — zero chamadas ao vivo", () => {
  const files = [
    "apps/web/app/[projectId]/dashboard/visual/page.tsx",
    "apps/web/lib/dashboard-visual/get-dashboard-visual-data.ts",
    "apps/web/components/dashboard-visual/experts-cards.tsx",
  ];
  for (const file of files) {
    const source = readSource(file);
    assert(!/@anthropic-ai|from ["'].*anthropic-provider["']|generateAssessment\(|answerQuery\(|askCommercialDirectorAction/i.test(source), `${file} não deveria acionar nenhum Expert IA ao vivo`);
  }
});

check("feature-help: todos os helpId usados no Dashboard Visual existem no registro central", () => {
  const ids = [
    "dashboard-visual-time-filter",
    "dashboard-visual-emails",
    "dashboard-visual-alerts",
    "dashboard-visual-general-situation",
    "dashboard-visual-physical-progress",
    "dashboard-visual-financial-progress",
    "dashboard-visual-contract-value",
    "dashboard-visual-deadline",
    "dashboard-visual-esg",
    "dashboard-visual-sla",
    "dashboard-visual-source-volume",
    "dashboard-visual-experts",
    "dashboard-visual-ceo",
  ];
  for (const id of ids) assert(ACC_FEATURE_HELP[id] !== undefined, `helpId ausente do registro: ${id}`);
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

restoreProviderEnv();

if (failed > 0) {
  process.exit(1);
}
