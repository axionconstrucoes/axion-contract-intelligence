// Testes do complemento final de "Propostas de Adicionais": subpastas
// Drive semânticas, classificação de fontes, confronto cliente x
// contrato-base, persistência de findings (dedup/incremental), curadoria
// automática e RLS/auditoria. NUNCA chama a API Anthropic real — provider
// fake forçado durante toda a suíte (mesmo princípio de
// test-multi-expert-curation.mjs).
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/test-client-source-confrontation.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const {
  classifyFolderName,
  classifySourceFromFolderCategory,
  isClientProvidedSource,
  discoverProposalDriveSources,
  saveDiscoveredSources,
  getDriveSourcesForProposal,
} = await import("../apps/web/lib/additionals/drive-sources/index");

const { runClientSourceConfrontation, validateClientSourceConfrontation } = await import("../apps/web/lib/additionals/confrontation/index");

const {
  computeFindingFingerprint,
  computeSourceFingerprint,
  persistFinding,
  getFindingsForProject,
  routeExpertsForConfrontation,
  runAutomaticCurationForClientSource,
  findCompletedCurationRun,
} = await import("../apps/web/lib/additionals/findings/index");

const { createAdditionalProposal } = await import("../apps/web/lib/additionals/create-additional-proposal");
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

console.log("");
console.log("======================================");
console.log("CONFRONTO CLIENTE x CONTRATO-BASE + FINDINGS — TESTES");
console.log("======================================");
console.log("");

// --- Isolamento: NUNCA chamar Anthropic real ---
const ALL_PROVIDER_ENV_VARS = [...Object.values(EXPERT_PROVIDER_ENV_VAR), "AXION_AI_PROVIDER"];
const originalProviderEnv = Object.fromEntries(ALL_PROVIDER_ENV_VARS.map((name) => [name, process.env[name]]));
for (const name of ALL_PROVIDER_ENV_VARS) process.env[name] = "fake";
function restoreProviderEnv() {
  for (const [name, value] of Object.entries(originalProviderEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

// --- 1. Subpastas semânticas ---

check("subpastas semânticas: RECEBIDOS CLIENTE reconhecido em várias grafias", () => {
  for (const name of ["01_RECEBIDOS CLIENTE", "RECEBIDOS CLIENTE", "Recebido do Cliente", "recebido cliente"]) {
    assert(classifyFolderName(name) === "RECEBIDOS_CLIENTE", `"${name}" deveria ser RECEBIDOS_CLIENTE`);
  }
});

check("subpastas semânticas: PLANILHA AXION (orçamentária) reconhecida, distinta de PLANILHA CLIENTE", () => {
  for (const name of ["02_PLANILHA ORÇAMENTÁRIA", "Planilha Orçamentária", "ORÇAMENTO", "Planilhas"]) {
    assert(classifyFolderName(name) === "PLANILHA_AXION", `"${name}" deveria ser PLANILHA_AXION`);
  }
  for (const name of ["PLANILHA CLIENTE", "Planilhas Cliente", "Quantitativos Cliente"]) {
    assert(classifyFolderName(name) === "PLANILHA_CLIENTE", `"${name}" deveria ser PLANILHA_CLIENTE`);
  }
});

check("subpastas semânticas: PROPOSTA e CRONOGRAMA reconhecidos", () => {
  assert(classifyFolderName("06_PROPOSTA COMERCIAL") === "PROPOSTA");
  assert(classifyFolderName("Proposta") === "PROPOSTA");
  assert(classifyFolderName("07_CRONOGRAMA") === "CRONOGRAMA");
  assert(classifyFolderName("Cronograma") === "CRONOGRAMA");
});

check("subpastas semânticas: nome não reconhecido devolve null (nunca uma classificação forçada)", () => {
  assert(classifyFolderName("Fotos do canteiro") === null);
  assert(classifyFolderName("") === null);
});

// --- 2. Classificação de fontes ---

check("classificação de fontes: CLIENT_SOURCE/CLIENT_SPREADSHEET/AXION_ESTIMATE/AXION_PROPOSAL/SCHEDULE_SOURCE mapeados corretamente, nunca confundindo cliente com AXION", () => {
  assert(classifySourceFromFolderCategory("RECEBIDOS_CLIENTE") === "CLIENT_SOURCE");
  assert(classifySourceFromFolderCategory("PLANILHA_CLIENTE") === "CLIENT_SPREADSHEET");
  assert(classifySourceFromFolderCategory("PLANILHA_AXION") === "AXION_ESTIMATE");
  assert(classifySourceFromFolderCategory("PROPOSTA") === "AXION_PROPOSAL");
  assert(classifySourceFromFolderCategory("CRONOGRAMA") === "SCHEDULE_SOURCE");
  assert(classifySourceFromFolderCategory(null) === "OTHER_REFERENCE");

  assert(isClientProvidedSource("CLIENT_SOURCE") === true);
  assert(isClientProvidedSource("CLIENT_SPREADSHEET") === true);
  assert(isClientProvidedSource("AXION_ESTIMATE") === false, "estimativa da AXION nunca pode ser tratada como fonte do cliente");
});

// --- 3. Descoberta recursiva — nunca varre o Drive inteiro, conteúdo não processado ---

function makeFakeDriveTree(tree) {
  const calls = [];
  return {
    calls,
    client: {
      async listChildren(folderId) {
        calls.push(folderId);
        return tree[folderId] ?? [];
      },
    },
  };
}

check("descoberta recursiva: nunca consulta pastas fora da raiz vinculada (irmã/pai nunca visitadas)", async () => {
  const tree = {
    root: [
      { id: "recebidos", name: "01_RECEBIDOS CLIENTE", mimeType: "application/vnd.google-apps.folder", isFolder: true, modifiedTime: null, headRevisionId: null },
    ],
    recebidos: [
      { id: "file1", name: "planilha_quantitativos.xlsx", mimeType: "application/vnd.ms-excel", isFolder: false, modifiedTime: "2026-01-01T00:00:00Z", headRevisionId: "rev1" },
    ],
    // "irmã" da raiz — nunca deveria ser visitada por esta descoberta.
    sibling: [{ id: "outro-arquivo", name: "nao_deveria_aparecer.pdf", mimeType: "application/pdf", isFolder: false, modifiedTime: null, headRevisionId: null }],
  };
  const { client, calls } = makeFakeDriveTree(tree);

  const entries = await discoverProposalDriveSources(client, "root");

  assert(!calls.includes("sibling"), "nunca deveria consultar uma pasta fora da raiz vinculada");
  assert(entries.length === 1);
  assert(entries[0].fileName === "planilha_quantitativos.xlsx");
  assert(entries[0].semanticFolderCategory === "RECEBIDOS_CLIENTE");
  assert(entries[0].sourceClassification === "CLIENT_SOURCE");
});

check("descoberta recursiva: categoria mais próxima do arquivo prevalece sobre a herdada de um ancestral mais distante", async () => {
  const tree = {
    root: [{ id: "planilhas", name: "Planilhas", mimeType: "application/vnd.google-apps.folder", isFolder: true, modifiedTime: null, headRevisionId: null }],
    planilhas: [{ id: "cliente", name: "Planilha Cliente", mimeType: "application/vnd.google-apps.folder", isFolder: true, modifiedTime: null, headRevisionId: null }],
    cliente: [{ id: "f1", name: "quantitativos.xlsx", mimeType: "application/vnd.ms-excel", isFolder: false, modifiedTime: null, headRevisionId: null }],
  };
  const { client } = makeFakeDriveTree(tree);
  const entries = await discoverProposalDriveSources(client, "root");
  assert(entries[0].semanticFolderCategory === "PLANILHA_CLIENTE", "categoria mais específica e mais próxima deveria prevalecer sobre PLANILHA_AXION herdada de 'Planilhas'");
  assert(entries[0].sourceClassification === "CLIENT_SPREADSHEET");
});

// --- Testes reais contra o Supabase (service-role) ---

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const REFERENCE_PROJECT_ID = "00000000-0000-4000-8000-000000000001";

if (!supabaseUrl || !serviceKey) {
  console.log("SKIP testes reais — Supabase não configurado.");
} else {
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: membership } = await supabase
    .from("project_memberships")
    .select("user_id")
    .eq("project_id", REFERENCE_PROJECT_ID)
    .limit(1)
    .maybeSingle();
  const testUserId = membership?.user_id;

  if (!testUserId) {
    console.log("SKIP testes reais — nenhum membro encontrado no projeto de referência.");
  } else {
    const cleanup = { proposalIds: [], driveSourceIds: [], findingIds: [], curationRunIds: [], documentIds: [] };

    await checkAsync("conteúdo não processado: fontes descobertas entram sempre como SOURCE_REQUIRES_PROCESSING (nunca finge ter lido)", async () => {
      const proposal = await createAdditionalProposal(supabase, {
        projectId: REFERENCE_PROJECT_ID,
        createdByUserId: testUserId,
        proposalNumber: "AXN CP 995",
        title: "[TESTE ACC] Confronto — Drive",
        sourceType: "DRIVE",
        driveUrl: "https://drive.google.com/drive/folders/teste-confronto",
        driveFileId: "root-teste-confronto",
      });
      cleanup.proposalIds.push(proposal.id);

      const tree = {
        "root-teste-confronto": [
          { id: "recebidos-teste", name: "RECEBIDOS CLIENTE", mimeType: "application/vnd.google-apps.folder", isFolder: true, modifiedTime: null, headRevisionId: null },
        ],
        "recebidos-teste": [
          { id: "arquivo-teste-995", name: "exigencia_cliente.pdf", mimeType: "application/pdf", isFolder: false, modifiedTime: null, headRevisionId: "rev-x" },
        ],
      };
      const { client } = makeFakeDriveTree(tree);
      const entries = await discoverProposalDriveSources(client, proposal.driveFileId);
      const results = await saveDiscoveredSources(supabase, proposal.id, entries, testUserId);
      for (const r of results) cleanup.driveSourceIds.push(r.source.id);

      assert(results[0].source.processingStatus === "SOURCE_REQUIRES_PROCESSING");
      assert(results[0].source.sourceClassification === "CLIENT_SOURCE");

      const again = await saveDiscoveredSources(supabase, proposal.id, entries, testUserId);
      assert(again[0].created === false, "redescobrir o mesmo arquivo nunca deveria duplicar a linha");

      const stored = await getDriveSourcesForProposal(supabase, proposal.id);
      assert(stored.length === 1);
    });

    let confrontationDocumentId = null;
    let confrontationDocumentVersionId = null;

    await checkAsync("cliente x contrato-base: confronto real roda contra cláusulas reais do contrato-base do projeto", async () => {
      const { data: doc, error: docError } = await supabase
        .from("documents")
        .insert({ project_id: REFERENCE_PROJECT_ID, kind: "CONTRATO_BASE", title: "[TESTE ACC] Contrato-base para confronto" })
        .select("id")
        .single();
      if (docError) throw new Error(docError.message);
      confrontationDocumentId = doc.id;
      cleanup.documentIds.push(doc.id);

      const { data: version, error: versionError } = await supabase
        .from("document_versions")
        .insert({ document_id: doc.id, version_label: "v1", version_index: 1, document_date: "2026-01-01", source_type: "CONTRATO", author: "Teste", summary: "Contrato de teste." })
        .select("id")
        .single();
      if (versionError) throw new Error(versionError.message);
      confrontationDocumentVersionId = version.id;

      const { error: clauseError } = await supabase.from("clauses").insert({
        document_version_id: version.id,
        clause_number: "14.2",
        title: "Ordem de precedência",
        text: "Em caso de divergência entre os documentos contratuais, prevalece o Contrato sobre a Proposta, que prevalece sobre os anexos técnicos.",
      });
      if (clauseError) throw new Error(clauseError.message);

      const result = await runClientSourceConfrontation(supabase, {
        projectId: REFERENCE_PROJECT_ID,
        sourceLabel: "Exigência de teste do cliente",
        sourceSummary: "O cliente solicitou revestimento cerâmico especial não mencionado no escopo original.",
      });

      assert(result.confrontation.expertId === "legal-consultant");
      assert(result.confrontation.requiresHumanReview === true);
      assert(typeof result.confrontation.confrontation.classification === "string");
      assert(result.confrontation.confrontation.precedenceFound === false, "o provider fake nunca produz interpretação real — precedenceFound deveria ser sempre false");
      assert(result.confrontation.confrontation.precedenceSummary === null);
    });

    check("ordem de precedência: validateClientSourceConfrontation aceita precedenceFound=true com resumo, rejeita quando resumo ausente/presente incorretamente", () => {
      const base = {
        expertId: "legal-consultant",
        expertName: "Consultor Jurídico IA",
        expertVersion: "v1",
        analysisType: "CLIENT_SOURCE_CONFRONTATION",
        finding: { facts: ["fato"], interpretation: "interpretação" },
        severity: "MEDIUM",
        confidence: 0.6,
        executiveSummary: "resumo",
        contractualBasis: [],
        eventBasis: [],
        evidenceRefs: [],
        possibleImpacts: [],
        recommendedActions: [],
        uncertainties: [],
        requiresHumanReview: true,
      };
      const expected = { expertId: "legal-consultant", expertName: "Consultor Jurídico IA", expertVersion: "v1" };

      const valid = validateClientSourceConfrontation(
        { ...base, confrontation: { classification: "INCORPORATED_CONTRACT_DOCUMENT", precedenceFound: true, precedenceSummary: "Cláusula 14.2 define hierarquia contratual." } },
        expected
      );
      assert(valid.confrontation.precedenceFound === true);

      let threwMissingSummary = false;
      try {
        validateClientSourceConfrontation({ ...base, confrontation: { classification: "COMPATIBLE", precedenceFound: true, precedenceSummary: null } }, expected);
      } catch {
        threwMissingSummary = true;
      }
      assert(threwMissingSummary, "precedenceFound=true sem resumo deveria ser rejeitado");

      let threwSpuriousSummary = false;
      try {
        validateClientSourceConfrontation({ ...base, confrontation: { classification: "COMPATIBLE", precedenceFound: false, precedenceSummary: "nunca deveria existir" } }, expected);
      } catch {
        threwSpuriousSummary = true;
      }
      assert(threwSpuriousSummary, "precedenceFound=false com resumo preenchido deveria ser rejeitado — nunca inventar precedência inexistente");
    });

    check("routing (seção 14): CONTRACTUAL_CONFLICT -> Jurídico + Comercial; POSSIBLE_SCOPE_CHANGE -> Comercial+Planejamento+Jurídico; ADDITIONAL_REQUIREMENT sem impacto -> só Jurídico", () => {
      const conflict = routeExpertsForConfrontation({ classification: "CONTRACTUAL_CONFLICT" });
      assert(JSON.stringify(conflict.additionalExpertIds.sort()) === JSON.stringify(["commercial-director"]));
      assert(conflict.ceoMaterial === true);

      const scopeChange = routeExpertsForConfrontation({ classification: "POSSIBLE_SCOPE_CHANGE" });
      assert(JSON.stringify(scopeChange.additionalExpertIds.sort()) === JSON.stringify(["commercial-director", "planning-director"]));
      assert(scopeChange.ceoMaterial === true);

      const additionalNoImpact = routeExpertsForConfrontation({ classification: "ADDITIONAL_REQUIREMENT", hasCostOrScheduleImpact: false });
      assert(additionalNoImpact.additionalExpertIds.length === 0, "sem custo/prazo conhecido, nunca aciona especialistas adicionais sem motivo");

      const additionalWithImpact = routeExpertsForConfrontation({ classification: "ADDITIONAL_REQUIREMENT", hasCostOrScheduleImpact: true });
      assert(JSON.stringify(additionalWithImpact.additionalExpertIds.sort()) === JSON.stringify(["commercial-director", "planning-director"]));
    });

    // --- Persistência de findings: dedup/incremental ---

    await checkAsync("finding duplicado não é criado: mesmo fingerprint + mesmo tipo não gera duas linhas", async () => {
      const sourceFingerprint = computeSourceFingerprint({ sourceType: "MANUAL", sourceId: "teste-995", contentHash: "conteudo-fixo" });
      const fingerprint = computeFindingFingerprint({ findingType: "CLIENT_SOURCE_CONFRONTATION", sourceFingerprint, classification: "COMPATIBLE" });

      const first = await persistFinding(supabase, {
        projectId: REFERENCE_PROJECT_ID,
        curationRunId: null,
        findingType: "CLIENT_SOURCE_CONFRONTATION",
        classification: "COMPATIBLE",
        expertIds: ["legal-consultant"],
        severity: "LOW",
        confidence: 0.5,
        facts: ["fato de teste"],
        interpretation: "interpretação de teste",
        recommendation: "recomendação de teste",
        sourceRefs: [{ type: "MANUAL", id: "teste-995" }],
        fingerprint,
        createdByUserId: testUserId,
      });
      cleanup.findingIds.push(first.finding.id);
      assert(first.created === true);

      const second = await persistFinding(supabase, {
        projectId: REFERENCE_PROJECT_ID,
        curationRunId: null,
        findingType: "CLIENT_SOURCE_CONFRONTATION",
        classification: "COMPATIBLE",
        expertIds: ["legal-consultant"],
        severity: "LOW",
        confidence: 0.5,
        facts: ["fato de teste"],
        interpretation: "interpretação de teste (segunda tentativa)",
        recommendation: "recomendação de teste",
        sourceRefs: [{ type: "MANUAL", id: "teste-995" }],
        fingerprint,
        createdByUserId: testUserId,
      });
      assert(second.created === false, "mesmo fingerprint não-superseded nunca deveria criar uma segunda linha");
      assert(second.finding.id === first.finding.id);
    });

    check("conteúdo idêntico não recura / nova revisão recura: fingerprints diferem só quando o conteúdo muda", () => {
      const a = computeSourceFingerprint({ sourceType: "ADDITIONAL_PROPOSAL_DRIVE_SOURCE", sourceId: "x", contentHash: "conteudo-v1" });
      const b = computeSourceFingerprint({ sourceType: "ADDITIONAL_PROPOSAL_DRIVE_SOURCE", sourceId: "x", contentHash: "conteudo-v1" });
      const c = computeSourceFingerprint({ sourceType: "ADDITIONAL_PROPOSAL_DRIVE_SOURCE", sourceId: "x", contentHash: "conteudo-v2-revisado" });
      assert(a === b, "mesmo conteúdo deveria produzir o mesmo fingerprint (não recura)");
      assert(a !== c, "conteúdo revisado deveria produzir um fingerprint diferente (recura)");
    });

    // --- Curadoria automática end-to-end ---

    await checkAsync("automatic curation: SOURCE_INGESTED_OR_UPDATED -> classify -> route -> persist finding -> nunca recura no mesmo conteúdo", async () => {
      const proposal = await createAdditionalProposal(supabase, {
        projectId: REFERENCE_PROJECT_ID,
        createdByUserId: testUserId,
        proposalNumber: "AXN CP 994",
        title: "[TESTE ACC] Curadoria automática",
        sourceType: "MANUAL",
      });
      cleanup.proposalIds.push(proposal.id);

      const { data: driveSourceRow, error: driveSourceError } = await supabase
        .from("additional_proposal_drive_sources")
        .insert({
          proposal_id: proposal.id,
          drive_file_id: "drive-file-automatic-994",
          file_name: "exigencia_teste.pdf",
          mime_type: "application/pdf",
          semantic_folder_category: "RECEBIDOS_CLIENTE",
          source_classification: "CLIENT_SOURCE",
          processing_status: "SOURCE_REQUIRES_PROCESSING",
          created_by_type: "USER",
          created_by_user_id: testUserId,
        })
        .select("id")
        .single();
      if (driveSourceError) throw new Error(driveSourceError.message);
      cleanup.driveSourceIds.push(driveSourceRow.id);

      const first = await runAutomaticCurationForClientSource(supabase, {
        projectId: REFERENCE_PROJECT_ID,
        proposalId: proposal.id,
        driveSourceId: driveSourceRow.id,
        sourceLabel: "exigencia_teste.pdf",
        sourceSummary: "O cliente exigiu certificação adicional não prevista.",
        createdByUserId: testUserId,
      });
      assert(first.status === "COMPLETED");
      assert(first.finding !== null);
      assert(first.finding.requiresHumanReview === true);
      cleanup.findingIds.push(first.finding.id);
      cleanup.curationRunIds.push(...(await (async () => {
        const run = await findCompletedCurationRun(supabase, {
          sourceType: "ADDITIONAL_PROPOSAL_DRIVE_SOURCE",
          sourceId: driveSourceRow.id,
          sourceFingerprint: computeSourceFingerprint({ sourceType: "ADDITIONAL_PROPOSAL_DRIVE_SOURCE", sourceId: driveSourceRow.id, contentHash: "O cliente exigiu certificação adicional não prevista." }),
        });
        return run ? [run.id] : [];
      })()));

      const second = await runAutomaticCurationForClientSource(supabase, {
        projectId: REFERENCE_PROJECT_ID,
        proposalId: proposal.id,
        driveSourceId: driveSourceRow.id,
        sourceLabel: "exigencia_teste.pdf",
        sourceSummary: "O cliente exigiu certificação adicional não prevista.",
        createdByUserId: testUserId,
      });
      assert(second.status === "SKIPPED_UNCHANGED", "mesmo conteúdo não deveria disparar nova curadoria (dedup/incremental)");
    });

    await checkAsync("AI failure não perde ingestão: falha da IA marca a execução FAILED_PENDING_RETRY, nunca apaga a fonte já persistida", async () => {
      const proposal = await createAdditionalProposal(supabase, {
        projectId: REFERENCE_PROJECT_ID,
        createdByUserId: testUserId,
        proposalNumber: "AXN CP 993",
        title: "[TESTE ACC] Falha de IA",
        sourceType: "MANUAL",
      });
      cleanup.proposalIds.push(proposal.id);

      const { data: driveSourceRow, error: driveSourceError } = await supabase
        .from("additional_proposal_drive_sources")
        .insert({
          proposal_id: proposal.id,
          drive_file_id: "drive-file-failure-993",
          file_name: "exigencia_falha.pdf",
          mime_type: "application/pdf",
          source_classification: "CLIENT_SOURCE",
          processing_status: "SOURCE_REQUIRES_PROCESSING",
          created_by_type: "USER",
          created_by_user_id: testUserId,
        })
        .select("id")
        .single();
      if (driveSourceError) throw new Error(driveSourceError.message);
      cleanup.driveSourceIds.push(driveSourceRow.id);

      const failingProvider = {
        id: "anthropic",
        generateAssessment: async () => {
          throw new Error("Falha simulada da API Anthropic — nunca deveria apagar a fonte.");
        },
        answerQuery: async () => {
          throw new Error("não usado neste teste");
        },
        consolidateExecutiveCuration: async () => {
          throw new Error("não usado neste teste");
        },
      };

      const result = await runAutomaticCurationForClientSource(supabase, {
        projectId: REFERENCE_PROJECT_ID,
        proposalId: proposal.id,
        driveSourceId: driveSourceRow.id,
        sourceLabel: "exigencia_falha.pdf",
        sourceSummary: "Conteúdo de teste para simular falha de IA.",
        createdByUserId: testUserId,
        confrontationProvider: failingProvider,
      });

      assert(result.status === "FAILED_PENDING_RETRY");
      assert(result.finding === null);

      const { data: sourceStillThere, error: checkError } = await supabase
        .from("additional_proposal_drive_sources")
        .select("id,processing_status")
        .eq("id", driveSourceRow.id)
        .single();
      if (checkError) throw new Error(checkError.message);
      assert(sourceStillThere.processing_status === "SOURCE_REQUIRES_PROCESSING", "a fonte original nunca pode ser alterada/perdida por uma falha de IA");

      const { data: runRow, error: runError } = await supabase
        .from("ai_curation_runs")
        .select("id,status,error_message")
        .eq("source_id", driveSourceRow.id)
        .single();
      if (runError) throw new Error(runError.message);
      assert(runRow.status === "FAILED_PENDING_RETRY");
      assert(runRow.error_message.includes("Falha simulada"));
      cleanup.curationRunIds.push(runRow.id);
    });

    // --- RLS ---

    await checkAsync("RLS: insert anônimo em ai_findings é rejeitado", async () => {
      if (!anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ausente.");
      const anonClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error } = await anonClient.from("ai_findings").insert({
        project_id: REFERENCE_PROJECT_ID,
        finding_type: "CLIENT_SOURCE_CONFRONTATION",
        expert_ids: [],
        severity: "LOW",
        confidence: 0.5,
        interpretation: "x",
        recommendation: "x",
        fingerprint: "nunca-deveria-existir",
      });
      assert(error !== null, "insert anônimo em ai_findings deveria ser rejeitado pela RLS");
    });

    check("RLS: migration define insert/update EDITOR para ai_findings/ai_curation_runs/drive_sources, sem delete em nenhuma", () => {
      const migrationSource = readSource("supabase/migrations/20260823080000_client_source_confrontation_and_findings.sql");
      assert(migrationSource.includes('"ai_findings_insert_editor"'));
      assert(migrationSource.includes('"ai_findings_update_editor"'));
      assert(migrationSource.includes('"ai_curation_runs_insert_editor"'));
      assert(migrationSource.includes('"additional_proposal_drive_sources_insert_editor"'));
      assert(!/for delete/i.test(migrationSource), "nenhuma policy de delete deveria existir — histórico nunca é apagado");
    });

    await checkAsync("auditoria: AI_FINDING_CREATED e AI_FINDING_STATUS_CHANGED foram registrados", async () => {
      const findingId = cleanup.findingIds[0];

      await supabase.from("ai_findings").update({ lifecycle_status: "ACKNOWLEDGED", reviewed_by_user_id: testUserId, reviewed_at: new Date().toISOString() }).eq("id", findingId);

      const { data, error } = await supabase.from("audit_log_entries").select("action").eq("entity_type", "AI_FINDING").eq("entity_id", findingId);
      if (error) throw new Error(error.message);
      const actions = data.map((r) => r.action);
      assert(actions.includes("AI_FINDING_CREATED"));
      assert(actions.includes("AI_FINDING_STATUS_CHANGED"));
    });

    // --- Governança estrutural ---

    check("governança: nenhum arquivo de confronto/curadoria automática escreve em project_additional_proposals nem marca CONTRATADO", () => {
      for (const file of [
        "apps/web/lib/additionals/confrontation/run-client-source-confrontation.ts",
        "apps/web/lib/additionals/findings/run-automatic-curation.ts",
      ]) {
        const source = readSource(file);
        assert(!source.includes('.from("project_additional_proposals")'), `${file} nunca deveria escrever em project_additional_proposals`);
        assert(!source.includes("CONTRACTED"), `${file} nunca deveria marcar CONTRATADO`);
      }
    });

    console.log("");
    console.log("--- Limpando fixtures ---");
    if (cleanup.findingIds.length > 0) await supabase.from("ai_findings").delete().in("id", cleanup.findingIds);
    if (cleanup.curationRunIds.length > 0) await supabase.from("ai_curation_runs").delete().in("id", cleanup.curationRunIds);
    if (cleanup.driveSourceIds.length > 0) await supabase.from("additional_proposal_drive_sources").delete().in("id", cleanup.driveSourceIds);
    if (cleanup.proposalIds.length > 0) {
      await supabase.from("project_additional_proposal_links").delete().in("proposal_id", cleanup.proposalIds);
      await supabase.from("project_additional_proposals").delete().in("id", cleanup.proposalIds);
    }
    if (confrontationDocumentId) {
      await supabase.from("document_versions").delete().eq("document_id", confrontationDocumentId);
      await supabase.from("documents").delete().eq("id", confrontationDocumentId);
    }
    console.log("Fixtures removidas (exceto audit_log_entries, append-only por design).");
  }
}

restoreProviderEnv();

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
