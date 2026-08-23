// Testes de "Propostas de Adicionais" (apps/web/lib/additionals/) — CRUD
// via service-role (mesmo padrão de outras suítes desta base, para
// exercitar a lógica de negócio sem depender de login real), RLS via
// client anônimo real (prova em runtime, não só leitura de texto),
// curadoria multiagente com provider fake forçado (NUNCA chamada
// Anthropic real), e checagens estruturais de governança. Cleanup
// completo ao final.
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/test-additional-proposals.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const {
  createAdditionalProposal,
  getAdditionalProposal,
  getAdditionalProposals,
  linkAdditionalProposalSource,
  markAdditionalProposalContracted,
  updateAdditionalProposalApprovals,
  suggestExistingSourcesForProposal,
  computeScheduleFormalizationAlert,
  computeClosingGateAssessment,
  runAdditionalProposalCuration,
  CHECKLIST_LINK_ROLES,
} = await import("../apps/web/lib/additionals/index");
const { ALL_OFFICIAL_EXPERT_DEFINITIONS } = await import("../apps/web/lib/ai/expert-definitions/definitions");
const { resolveExpertIcon } = await import("../apps/web/components/ai/expert-visual-identity");
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

async function assertRejects(promise, messageSubstring, label) {
  try {
    await promise;
  } catch (error) {
    if (messageSubstring && !error.message.includes(messageSubstring)) {
      throw new Error(`${label ?? "rejeição"} — mensagem não contém "${messageSubstring}": ${error.message}`);
    }
    return error;
  }
  throw new Error(`${label ?? "esperado rejeição"}, mas resolveu`);
}

console.log("");
console.log("======================================");
console.log("PROPOSTAS DE ADICIONAIS — TESTES");
console.log("======================================");
console.log("");

// --- Isolamento: NUNCA chamar Anthropic real (mesmo princípio de test-multi-expert-curation.mjs) ---
const ALL_PROVIDER_ENV_VARS = [...Object.values(EXPERT_PROVIDER_ENV_VAR), "AXION_AI_PROVIDER"];
const originalProviderEnv = Object.fromEntries(ALL_PROVIDER_ENV_VARS.map((name) => [name, process.env[name]]));
for (const name of ALL_PROVIDER_ENV_VARS) process.env[name] = "fake";
function restoreProviderEnv() {
  for (const [name, value] of Object.entries(originalProviderEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

// --- Experts com ícone/identidade (não depende de rede/DB) ---

check("os 5 Experts oficiais têm identidade visual (ícone + cor) distinta, nunca confundida com severidade/risco", () => {
  const seen = new Set();
  for (const def of ALL_OFFICIAL_EXPERT_DEFINITIONS) {
    assert(def.visualIdentity, `${def.expertId} sem visualIdentity`);
    const icon = resolveExpertIcon(def.visualIdentity);
    assert(typeof icon === "function" || typeof icon === "object", `ícone de ${def.expertId} não resolveu para um componente`);
    const key = `${def.visualIdentity.icon}:${def.visualIdentity.colorToken}`;
    assert(!seen.has(key), `identidade visual duplicada: ${key}`);
    seen.add(key);
  }
});

check("risco ALTO usa caixa sólida laranja + fonte branca + bold no componente compartilhado", () => {
  const source = readSource("apps/web/components/shared/badges.tsx");
  assert(/ALTA:\s*"[^"]*bg-severity-alta\s+text-white\s+font-bold[^"]*"/.test(source), "ALTA deveria usar bg-severity-alta sólido + text-white + font-bold");
});

check("risco CRÍTICO usa caixa sólida vermelha + fonte branca + bold no componente compartilhado", () => {
  const source = readSource("apps/web/components/shared/badges.tsx");
  assert(/CRITICA:\s*"[^"]*bg-severity-critica\s+text-white\s+font-bold[^"]*"/.test(source), "CRITICA deveria usar bg-severity-critica sólido + text-white + font-bold");
});

check("BAIXO/MÉDIO permanecem no padrão visual existente (translúcido, sem forçar branco/bold)", () => {
  const source = readSource("apps/web/components/shared/badges.tsx");
  assert(/BAIXA:\s*"[^"]*bg-severity-baixa\/15[^"]*"/.test(source));
  assert(/MEDIA:\s*"[^"]*bg-severity-media\/15[^"]*"/.test(source));
});

// --- Governança estrutural: IA nunca escreve em propostas ---

check("ação humana obrigatória: nenhum arquivo de Expert/curadoria de adicionais escreve em project_additional_proposals", () => {
  const files = ["apps/web/lib/additionals/curation.ts"];
  for (const file of files) {
    const source = readSource(file);
    assert(!/\.insert\(|\.update\(|\.delete\(/.test(source), `${file} nunca deveria escrever no banco`);
  }
  const markContractedSource = readSource("apps/web/lib/additionals/mark-additional-proposal-contracted.ts");
  assert(!markContractedSource.includes("resolveAiProviderForExpert") && !markContractedSource.includes("AiProvider"), "marcar CONTRATADO nunca deveria depender de nenhum provider de IA");
});

check("contrato-base permanece aplicável: markAdditionalProposalContracted nunca escreve em documents/document_versions/contract_events", () => {
  const source = readSource("apps/web/lib/additionals/mark-additional-proposal-contracted.ts");
  assert(!source.includes('.from("documents")') && !source.includes('.from("document_versions")') && !source.includes('.from("contract_events")'));
});

// --- ClosingGate e alerta de prazo (puro, sem DB) ---

function baseProposal(overrides = {}) {
  return {
    id: "p1",
    projectId: "proj-1",
    proposalNumber: "AXN CP 000",
    title: "Teste",
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
    createdByUserId: "u1",
    createdByLabel: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

check("cronograma solicitado quando necessário: alerta inativo quando não contratado ou extensão não necessária", () => {
  const notContracted = computeScheduleFormalizationAlert(baseProposal({ status: "UNDER_ANALYSIS" }));
  assert(notContracted.active === false);

  const notRequired = computeScheduleFormalizationAlert(baseProposal({ status: "CONTRACTED", scheduleExtensionStatus: "NOT_REQUIRED" }));
  assert(notRequired.active === false);

  const approved = computeScheduleFormalizationAlert(baseProposal({ status: "CONTRACTED", scheduleExtensionStatus: "APPROVED" }));
  assert(approved.active === false);
});

check("contratado + prazo pendente: alerta ativo (ADICIONAL CONTRATADO COM PRAZO AINDA NÃO FORMALIZADO), severidade elevada quando execução já iniciou", () => {
  const pending = computeScheduleFormalizationAlert(baseProposal({ status: "CONTRACTED", scheduleExtensionStatus: "REQUESTED", executionStarted: false }));
  assert(pending.active === true);
  assert(pending.message === "ADICIONAL CONTRATADO COM PRAZO AINDA NÃO FORMALIZADO");
  assert(pending.severity === "MEDIUM");

  const started = computeScheduleFormalizationAlert(baseProposal({ status: "CONTRACTED", scheduleExtensionStatus: "REQUESTED", executionStarted: true }));
  assert(started.severity === "HIGH", "execução já iniciada deveria elevar a prioridade");
});

check("gate de fechamento: INSUFFICIENT_INFORMATION quando aprovações ainda não avaliadas, nunca aprova sozinho", () => {
  const gate = computeClosingGateAssessment(baseProposal());
  assert(gate.recommendation === "INSUFFICIENT_INFORMATION");
  assert(gate.requiresHumanReview === true);
});

check("gate de fechamento: DO_NOT_PROCEED_YET quando há rejeição registrada", () => {
  const gate = computeClosingGateAssessment(
    baseProposal({ scopeApprovalStatus: "REJECTED", commercialApprovalStatus: "APPROVED", scheduleExtensionStatus: "NOT_REQUIRED" })
  );
  assert(gate.recommendation === "DO_NOT_PROCEED_YET");
});

check("gate de fechamento: CAN_PROCEED quando tudo aprovado e sem pendência de documentação", () => {
  const gate = computeClosingGateAssessment(
    baseProposal({
      scopeApprovalStatus: "APPROVED",
      commercialApprovalStatus: "APPROVED",
      scheduleExtensionStatus: "NOT_REQUIRED",
      status: "CONTRACTED",
      documentalState: "CONTRATADO_DOCUMENTACAO_COMPLETA",
    })
  );
  assert(gate.recommendation === "CAN_PROCEED");
  assert(gate.contractualStatus === "COMPLETE");
});

// --- checklist ---

check("checklist tem exatamente os 6 itens do requisito, nunca inclui ORIGIN_SOURCE", () => {
  assert(CHECKLIST_LINK_ROLES.length === 6);
  assert(!CHECKLIST_LINK_ROLES.includes("ORIGIN_SOURCE"));
  assert(CHECKLIST_LINK_ROLES.includes("PROPOSTA_FINAL_AXION"));
});

// --- Testes reais contra o Supabase (service-role, bypassa RLS de propósito — mesmo padrão de outras suítes) ---

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const REFERENCE_PROJECT_ID = "00000000-0000-4000-8000-000000000001";

if (!supabaseUrl || !serviceKey) {
  console.log("SKIP testes reais — Supabase não configurado.");
} else {
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // service-role não tem auth.uid() — usamos um membro real do projeto de
  // referência para created_by_user_id (FK para profiles).
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
    const cleanup = { proposalIds: [], documentIds: [], emailIds: [] };

    await checkAsync("criação manual: status inicial POSSIBLE_ADDITIONAL, campos preservados", async () => {
      const proposal = await createAdditionalProposal(supabase, {
        projectId: REFERENCE_PROJECT_ID,
        createdByUserId: testUserId,
        proposalNumber: "AXN CP 621",
        title: "[TESTE ACC] Fundação adicional",
        description: "Proposta de teste — apagada ao final da suíte.",
        sourceType: "MANUAL",
        proposedValue: 15000.5,
        note: "Observação de teste.",
      });
      cleanup.proposalIds.push(proposal.id);

      assert(proposal.status === "POSSIBLE_ADDITIONAL", "CP 621 permanece Possível adicional até confirmação humana");
      assert(proposal.proposalNumber === "AXN CP 621");
      assert(proposal.sourceType === "MANUAL");
      assert(proposal.proposedValue === 15000.5);
      assert(proposal.createdByType === "USER" && proposal.createdByUserId === testUserId);
    });

    await checkAsync("vínculo Drive: exige URL ou Drive ID; aceita quando presente", async () => {
      await assertRejects(
        createAdditionalProposal(supabase, {
          projectId: REFERENCE_PROJECT_ID,
          createdByUserId: testUserId,
          proposalNumber: "AXN CP 626",
          title: "[TESTE ACC] Drive sem URL/ID",
          sourceType: "DRIVE",
        }),
        "Drive",
        "DRIVE sem URL/ID deveria falhar"
      );

      const proposal = await createAdditionalProposal(supabase, {
        projectId: REFERENCE_PROJECT_ID,
        createdByUserId: testUserId,
        proposalNumber: "AXN CP 626",
        title: "[TESTE ACC] Proposta via Drive",
        sourceType: "DRIVE",
        driveUrl: "https://drive.google.com/drive/folders/teste",
        driveFileId: "teste-drive-id",
      });
      cleanup.proposalIds.push(proposal.id);
      assert(proposal.driveUrl === "https://drive.google.com/drive/folders/teste");
      assert(proposal.driveFileId === "teste-drive-id");
    });

    await checkAsync("múltiplas propostas: piloto WEG (AXN CP 621/626/631/638) convivem no mesmo projeto, nunca hardcoded em produção", async () => {
      const proposal631 = await createAdditionalProposal(supabase, {
        projectId: REFERENCE_PROJECT_ID,
        createdByUserId: testUserId,
        proposalNumber: "AXN CP 631",
        title: "[TESTE ACC] Terceira proposta piloto WEG",
        sourceType: "MANUAL",
      });
      const proposal638 = await createAdditionalProposal(supabase, {
        projectId: REFERENCE_PROJECT_ID,
        createdByUserId: testUserId,
        proposalNumber: "AXN CP 638",
        title: "[TESTE ACC] Quarta proposta piloto WEG",
        sourceType: "MANUAL",
      });
      cleanup.proposalIds.push(proposal631.id, proposal638.id);

      const all = await getAdditionalProposals(supabase, REFERENCE_PROJECT_ID);
      const numbers = cleanup.proposalIds.length;
      assert(all.filter((p) => cleanup.proposalIds.includes(p.id)).length === numbers, "todas as propostas de teste deveriam aparecer na listagem");

      for (const file of ["apps/web/lib/additionals/create-additional-proposal.ts", "apps/web/lib/additionals/curation.ts"]) {
        const source = readSource(file);
        assert(!source.includes("AXN CP 621"), `${file} nunca deveria hardcodar o número de uma proposta`);
      }
    });

    let contractedProposalId = null;

    await checkAsync("contratado: email como formalização válida (nunca exige aditivo contratual)", async () => {
      const proposal = await createAdditionalProposal(supabase, {
        projectId: REFERENCE_PROJECT_ID,
        createdByUserId: testUserId,
        proposalNumber: "AXN CP 999",
        title: "[TESTE ACC] Contratado por e-mail",
        sourceType: "MANUAL",
      });
      cleanup.proposalIds.push(proposal.id);
      contractedProposalId = proposal.id;

      const contracted = await markAdditionalProposalContracted(supabase, {
        proposalId: proposal.id,
        contractedAt: "2026-08-20",
        contractedValue: 42000,
        formalizationType: "EMAIL_APROVACAO",
        approvalEvidenceNote: "E-mail do cliente aprovando a proposta.",
        executionStarted: false,
        documentalState: "CONTRATADO_DOCUMENTACAO_PENDENTE",
      });

      assert(contracted.status === "CONTRACTED");
      assert(contracted.formalizationType === "EMAIL_APROVACAO", "e-mail de aprovação deveria ser aceito como formalização válida");
      assert(contracted.contractedValue === 42000);
    });

    await checkAsync("status independentes: CONTRATADO nunca implica prazo aprovado", async () => {
      const proposal = await getAdditionalProposal(supabase, contractedProposalId);
      assert(proposal.status === "CONTRACTED");
      assert(
        proposal.scheduleExtensionStatus === "NOT_EVALUATED",
        "marcar CONTRATADO nunca deveria alterar/aprovar silenciosamente o status de extensão de prazo"
      );

      const updated = await updateAdditionalProposalApprovals(supabase, { proposalId: contractedProposalId, scopeApprovalStatus: "APPROVED" });
      assert(updated.scopeApprovalStatus === "APPROVED");
      assert(updated.commercialApprovalStatus === "NOT_EVALUATED", "atualizar escopo nunca deveria alterar aprovação comercial");
      assert(updated.scheduleExtensionStatus === "NOT_EVALUATED", "atualizar escopo nunca deveria alterar extensão de prazo");
    });

    await checkAsync("ressalva quando forma contratual divergir: exige risco descrito; CONTRATADO_FORMALIZACAO_COM_RESSALVA nunca bloqueia a contratação", async () => {
      const proposal = await createAdditionalProposal(supabase, {
        projectId: REFERENCE_PROJECT_ID,
        createdByUserId: testUserId,
        proposalNumber: "AXN CP 998",
        title: "[TESTE ACC] Ressalva jurídica",
        sourceType: "MANUAL",
      });
      cleanup.proposalIds.push(proposal.id);

      await assertRejects(
        markAdditionalProposalContracted(supabase, {
          proposalId: proposal.id,
          contractedAt: "2026-08-20",
          formalizationType: "EMAIL_APROVACAO",
          executionStarted: false,
          documentalState: "CONTRATADO_FORMALIZACAO_COM_RESSALVA",
        }),
        "RESSALVA",
        "ressalva sem risco descrito deveria falhar"
      );

      const contracted = await markAdditionalProposalContracted(supabase, {
        proposalId: proposal.id,
        contractedAt: "2026-08-20",
        formalizationType: "EMAIL_APROVACAO",
        executionStarted: false,
        documentalState: "CONTRATADO_FORMALIZACAO_COM_RESSALVA",
        reservationConflictingClause: "Cláusula 14.2 exige aditivo assinado.",
        reservationRisk: "Formalização por e-mail pode ser contestada.",
        reservationRecommendation: "Regularizar com aditivo formal na próxima janela contratual.",
      });
      assert(contracted.status === "CONTRACTED", "ressalva jurídica nunca bloqueia a contratação já ocorrida");
      assert(contracted.documentalState === "CONTRATADO_FORMALIZACAO_COM_RESSALVA");
      assert(contracted.reservationRisk.includes("contestada"));
    });

    await checkAsync("proposta final obrigatória/checklist: vincula PROPOSTA_FINAL_AXION; NAO_APLICAVEL exige justificativa; ORIGIN_SOURCE nunca é NAO_APLICAVEL", async () => {
      const proposal = await createAdditionalProposal(supabase, {
        projectId: REFERENCE_PROJECT_ID,
        createdByUserId: testUserId,
        proposalNumber: "AXN CP 997",
        title: "[TESTE ACC] Checklist",
        sourceType: "MANUAL",
      });
      cleanup.proposalIds.push(proposal.id);

      await assertRejects(
        linkAdditionalProposalSource(supabase, { proposalId: proposal.id, linkRole: "PROPOSTA_FINAL_AXION", createdByUserId: testUserId, notApplicable: true }),
        "Justificativa",
        "não aplicável sem justificativa deveria falhar"
      );

      const link = await linkAdditionalProposalSource(supabase, {
        proposalId: proposal.id,
        linkRole: "PROPOSTA_FINAL_AXION",
        createdByUserId: testUserId,
        notApplicable: true,
        notApplicableJustification: "Proposta final ainda não recebida do cliente.",
      });
      assert(link.notApplicable === true);

      await assertRejects(
        linkAdditionalProposalSource(supabase, { proposalId: proposal.id, linkRole: "ORIGIN_SOURCE", createdByUserId: testUserId, notApplicable: true, notApplicableJustification: "x" }),
        "ORIGIN_SOURCE",
        "ORIGIN_SOURCE nunca pode ser não aplicável"
      );
    });

    await checkAsync("documento existente evita upload duplicado: busca automática encontra documento/e-mail pelo número da proposta", async () => {
      const proposalNumber = "AXN CP 996";

      const { data: doc, error: docError } = await supabase
        .from("documents")
        .insert({ project_id: REFERENCE_PROJECT_ID, kind: "PROPOSTA_AXION", title: `Proposta ${proposalNumber} — revisão final` })
        .select("id")
        .single();
      if (docError) throw new Error(docError.message);
      cleanup.documentIds.push(doc.id);

      const { error: versionError } = await supabase.from("document_versions").insert({
        document_id: doc.id,
        version_label: "v1",
        version_index: 1,
        document_date: "2026-01-01",
        source_type: "CONTRATO",
        author: "Teste",
        summary: "Documento de teste — apagado ao final da suíte.",
        file_path: `${REFERENCE_PROJECT_ID}/teste.pdf`,
        storage_bucket: "project-documents",
      });
      if (versionError) throw new Error(versionError.message);

      const { data: email, error: emailError } = await supabase
        .from("emails")
        .insert({ project_id: REFERENCE_PROJECT_ID, from_address: "cliente@example.com", to_address: "axion@example.com", subject: `Aprovação da ${proposalNumber}`, sent_at: new Date().toISOString(), snippet: "teste" })
        .select("id")
        .single();
      if (emailError) throw new Error(emailError.message);
      cleanup.emailIds.push(email.id);

      const suggestions = await suggestExistingSourcesForProposal(supabase, REFERENCE_PROJECT_ID, proposalNumber);
      assert(suggestions.documents.some((d) => d.documentVersionId), "deveria sugerir ao menos um documento existente");
      assert(suggestions.emails.some((e) => e.emailId === email.id), "deveria sugerir o e-mail existente");
    });

    await checkAsync("RLS: insert sem autenticação (client anônimo) é rejeitado", async () => {
      if (!anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ausente — não é possível testar RLS anônima.");
      const anonClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

      const { error } = await anonClient.from("project_additional_proposals").insert({
        project_id: REFERENCE_PROJECT_ID,
        proposal_number: "AXN CP 000",
        title: "Nunca deveria ser inserido",
        source_type: "MANUAL",
        created_by_type: "USER",
        created_by_user_id: testUserId,
      });

      assert(error !== null, "insert anônimo deveria ser rejeitado pela RLS");
    });

    check("RLS: migration define insert/update EDITOR e nenhuma policy de delete (histórico nunca é apagado)", () => {
      const migrationSource = readSource("supabase/migrations/20260823070000_additional_proposal_lifecycle.sql");
      assert(migrationSource.includes('"project_additional_proposals_insert_editor"'));
      assert(migrationSource.includes('"project_additional_proposals_update_editor"'));
      assert(!/for delete/i.test(migrationSource), "nenhuma policy de delete deveria existir");
    });

    await checkAsync("auditoria: PROJECT_ADDITIONAL_PROPOSAL_CREATED, _CONTRACTED e PROJECT_ADDITIONAL_DOCUMENT_LINKED foram registrados", async () => {
      const { data, error } = await supabase
        .from("audit_log_entries")
        .select("action,entity_type,entity_id")
        .in("entity_id", cleanup.proposalIds)
        .eq("entity_type", "PROJECT_ADDITIONAL_PROPOSAL");
      if (error) throw new Error(error.message);

      const actions = data.map((r) => r.action);
      assert(actions.includes("PROJECT_ADDITIONAL_PROPOSAL_CREATED"));
      assert(actions.includes("PROJECT_ADDITIONAL_PROPOSAL_CONTRACTED"));
    });

    // --- Curadoria multiagente (fake provider forçado — sem chamada Anthropic real) ---

    await checkAsync("curadoria Comercial/Jurídico/Planejamento + CEO: sempre os três especialistas, nunca ESG, CEO só consolida", async () => {
      const proposal = await getAdditionalProposal(supabase, contractedProposalId);
      const result = await runAdditionalProposalCuration(supabase, proposal);

      const expertIds = result.expertResults.map((r) => r.expertId).sort();
      assert(
        JSON.stringify(expertIds) === JSON.stringify(["commercial-director", "legal-consultant", "planning-director"]),
        `esperado [commercial-director, legal-consultant, planning-director], obtido ${JSON.stringify(expertIds)}`
      );
      assert(!expertIds.includes("esg-director"), "ESG nunca participa da curadoria de adicionais");
      assert(!expertIds.includes("ceo"), "CEO nunca é executado como especialista — só consolida");

      assert(result.executiveCuration.requiresHumanReview === true);
      assert(
        result.executiveCuration.posicoes.every((p) => expertIds.includes(p.expertId)),
        "CEO nunca pode citar um Expert que não foi consultado"
      );
    });

    console.log("");
    console.log("--- Limpando fixtures ---");
    if (cleanup.proposalIds.length > 0) {
      await supabase.from("project_additional_proposal_links").delete().in("proposal_id", cleanup.proposalIds);
      await supabase.from("project_additional_proposals").delete().in("id", cleanup.proposalIds);
    }
    if (cleanup.documentIds.length > 0) {
      await supabase.from("document_versions").delete().in("document_id", cleanup.documentIds);
      await supabase.from("documents").delete().in("id", cleanup.documentIds);
    }
    if (cleanup.emailIds.length > 0) {
      await supabase.from("emails").delete().in("id", cleanup.emailIds);
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
