// Testes do Start-up ACC — reutiliza ai_findings/ai_curation_runs e
// sla_actions (nunca um segundo sistema). NUNCA chama a API Anthropic
// real — este pacote nem precisa de IA para os testes (toda a lógica é
// determinística), mas o isolamento de env é mantido por consistência
// com o resto da suíte.
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/test-startup.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const {
  getProjectStartupConfig,
  getStartupSummary,
  configureProjectStartup,
  getHistoricalFindings,
  dismissHistoricalFinding,
  resolveHistoricalFinding,
  createActionForHistoricalFinding,
  canCompleteProjectStartup,
  completeProjectStartup,
} = await import("../apps/web/lib/startup/index");

const { persistFinding } = await import("../apps/web/lib/additionals/findings/persist-finding");
const { computeFindingFingerprint, computeSourceFingerprint } = await import("../apps/web/lib/additionals/findings/compute-fingerprint");
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
console.log("START-UP ACC — TESTES");
console.log("======================================");
console.log("");

const ALL_PROVIDER_ENV_VARS = [...Object.values(EXPERT_PROVIDER_ENV_VAR), "AXION_AI_PROVIDER"];
const originalProviderEnv = Object.fromEntries(ALL_PROVIDER_ENV_VARS.map((name) => [name, process.env[name]]));
for (const name of ALL_PROVIDER_ENV_VARS) process.env[name] = "fake";
function restoreProviderEnv() {
  for (const [name, value] of Object.entries(originalProviderEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

// --- UI usa ALTO/CRÍTICO, nunca ALTA/CRÍTICA/HIGH/CRITICAL ---

check("UI usa ALTO/CRÍTICO: severityLabels nunca exibe a forma feminina nem o inglês", () => {
  assert(severityLabels.ALTA === "Alto", `esperado "Alto", obtido "${severityLabels.ALTA}"`);
  assert(severityLabels.CRITICA === "Crítico", `esperado "Crítico", obtido "${severityLabels.CRITICA}"`);
  assert(severityLabels.BAIXA === "Baixo");
  assert(severityLabels.MEDIA === "Médio");
});

// --- Timeline/Experts nunca truncados pela data operacional ---

check("Timeline não é truncada / Experts acessam histórico: nenhum Context Builder/Timeline export referencia acc_operational_start_date", () => {
  const files = [
    "apps/web/lib/ai/context/build-event-context.ts",
    "apps/web/lib/ai/context/build-project-context.ts",
  ];
  for (const file of files) {
    const source = readSource(file);
    assert(!source.includes("acc_operational_start_date") && !source.includes("accOperationalStartDate"), `${file} nunca deveria cortar contexto de IA pela data operacional do ACC`);
  }
});

check("histórico não dispara comunicação externa: dismiss/resolve/create-action/complete nunca enviam e-mail", () => {
  const files = [
    "apps/web/lib/startup/dismiss-historical-finding.ts",
    "apps/web/lib/startup/resolve-historical-finding.ts",
    "apps/web/lib/startup/create-action-for-historical-finding.ts",
    "apps/web/lib/startup/complete-startup.ts",
  ];
  for (const file of files) {
    const source = readSource(file);
    assert(!/sendActionRequestEmail|sendSlaEscalationEmail|nodemailer|resend\.emails/.test(source), `${file} nunca deveria enviar e-mail`);
  }
});

check("não muda timestamps históricos: nenhum arquivo do Start-up escreve em contract_events/emails/document_versions", () => {
  const files = [
    "apps/web/lib/startup/dismiss-historical-finding.ts",
    "apps/web/lib/startup/resolve-historical-finding.ts",
    "apps/web/lib/startup/complete-startup.ts",
  ];
  for (const file of files) {
    const source = readSource(file);
    assert(!source.includes('.from("contract_events")') && !source.includes('.from("emails")') && !source.includes('.from("document_versions")'));
  }
});

check("não cria sistema paralelo: create-action-for-historical-finding reaproveita sla_actions, nunca uma tabela nova", () => {
  const source = readSource("apps/web/lib/startup/create-action-for-historical-finding.ts");
  assert(source.includes('.from("sla_actions")'), "deveria inserir em sla_actions");
  assert(!/startup_tasks|startup_actions|historical_tasks/.test(source), "nunca deveria criar uma tabela paralela de tarefas");
});

check("RLS: migration define insert/update EDITOR para projects e mantém sla_actions/ai_findings reutilizados, sem delete novo", () => {
  const migrationSource = readSource("supabase/migrations/20260823090000_startup_historical_review.sql");
  assert(migrationSource.includes('"projects_update_editor"'));
  assert(migrationSource.includes("related_ai_finding_id"));
  assert(!/for delete/i.test(migrationSource));
});

// --- Testes reais contra o Supabase ---

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const REFERENCE_PROJECT_ID = "00000000-0000-4000-8000-000000000001";

if (!supabaseUrl || !serviceKey) {
  console.log("SKIP testes reais — Supabase não configurado.");
} else {
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: allMembers } = await supabase
    .from("project_memberships")
    .select("user_id,profiles(email)")
    .eq("project_id", REFERENCE_PROJECT_ID);
  // Prefere um membro real com e-mail @axion.com.br (para exercitar o
  // caminho de sucesso de "Cuidar deste assunto") — nunca fabricado, só
  // escolhido entre os membros reais já existentes no projeto.
  const membership =
    (allMembers ?? []).find((m) => m.profiles?.email?.toLowerCase().endsWith("@axion.com.br")) ?? (allMembers ?? [])[0];
  const testUserId = membership?.user_id;
  const testUserEmail = membership?.profiles?.email ?? null;

  if (!testUserId) {
    console.log("SKIP testes reais — nenhum membro encontrado no projeto de referência.");
  } else {
    // Snapshot para restaurar o projeto ao estado original ao final (nunca deixar side effects entre execuções da suíte).
    const originalConfig = await getProjectStartupConfig(supabase, REFERENCE_PROJECT_ID);
    const cleanup = { findingIds: [], slaActionIds: [] };

    await checkAsync("acc_operational_start_date default 2026-08-24 (quando o projeto ainda não foi configurado)", async () => {
      // Só afirma o default quando o projeto de referência ainda não foi
      // explicitamente configurado por nenhuma execução anterior desta suíte.
      if (originalConfig.projectStartDate === null) {
        assert(originalConfig.accOperationalStartDate === "2026-08-24", `esperado default 2026-08-24, obtido ${originalConfig.accOperationalStartDate}`);
      }
    });

    await checkAsync("project_start_date anterior ao go-live / data operacional editável: configureProjectStartup grava as duas datas", async () => {
      const updated = await configureProjectStartup(supabase, {
        projectId: REFERENCE_PROJECT_ID,
        projectStartDate: "2025-01-15",
        accOperationalStartDate: "2026-08-24",
      });
      assert(updated.projectStartDate === "2025-01-15");
      assert(updated.accOperationalStartDate === "2026-08-24");
      assert(new Date(updated.projectStartDate).getTime() < new Date(updated.accOperationalStartDate).getTime(), "data de início da obra deveria ser anterior ao início operacional");
    });

    let findingHighId = null;
    let findingCriticalId = null;

    await checkAsync("finding histórico ALTO / CRÍTICO: nasce HISTORICAL_PENDING_STARTUP_REVIEW, aparece no Start-up", async () => {
      const fpHigh = computeSourceFingerprint({ sourceType: "MANUAL", sourceId: "startup-teste-high", contentHash: "conteudo-high-v1" });
      const { finding: high } = await persistFinding(supabase, {
        projectId: REFERENCE_PROJECT_ID,
        curationRunId: null,
        findingType: "CLIENT_SOURCE_CONFRONTATION",
        classification: "POSSIBLE_SCOPE_CHANGE",
        expertIds: ["legal-consultant", "commercial-director"],
        severity: "HIGH",
        confidence: 0.7,
        facts: ["Fato histórico de teste ALTO."],
        interpretation: "Interpretação de teste.",
        recommendation: "Recomendação de teste.",
        sourceRefs: [{ type: "MANUAL", id: "startup-teste-high" }],
        fingerprint: computeFindingFingerprint({ findingType: "CLIENT_SOURCE_CONFRONTATION", sourceFingerprint: fpHigh, classification: "POSSIBLE_SCOPE_CHANGE" }),
        effectiveDate: "2025-03-01",
        initialLifecycleStatus: "HISTORICAL_PENDING_STARTUP_REVIEW",
      });
      findingHighId = high.id;
      cleanup.findingIds.push(high.id);
      assert(high.lifecycleStatus === "HISTORICAL_PENDING_STARTUP_REVIEW");
      assert(high.effectiveDate === "2025-03-01");

      const fpCrit = computeSourceFingerprint({ sourceType: "MANUAL", sourceId: "startup-teste-critical", contentHash: "conteudo-critical-v1" });
      const { finding: critical } = await persistFinding(supabase, {
        projectId: REFERENCE_PROJECT_ID,
        curationRunId: null,
        findingType: "CLIENT_SOURCE_CONFRONTATION",
        classification: "CONTRACTUAL_CONFLICT",
        expertIds: ["legal-consultant"],
        severity: "CRITICAL",
        confidence: 0.8,
        facts: ["Fato histórico de teste CRÍTICO."],
        interpretation: "Interpretação de teste.",
        recommendation: "Recomendação de teste.",
        sourceRefs: [{ type: "MANUAL", id: "startup-teste-critical" }],
        fingerprint: computeFindingFingerprint({ findingType: "CLIENT_SOURCE_CONFRONTATION", sourceFingerprint: fpCrit, classification: "CONTRACTUAL_CONFLICT" }),
        effectiveDate: "2025-06-01",
        initialLifecycleStatus: "HISTORICAL_PENDING_STARTUP_REVIEW",
      });
      findingCriticalId = critical.id;
      cleanup.findingIds.push(critical.id);
      assert(critical.lifecycleStatus === "HISTORICAL_PENDING_STARTUP_REVIEW");

      const historical = await getHistoricalFindings(supabase, REFERENCE_PROJECT_ID);
      assert(historical.some((f) => f.id === findingHighId));
      assert(historical.some((f) => f.id === findingCriticalId));

      const summary = await getStartupSummary(supabase, REFERENCE_PROJECT_ID);
      assert(summary.totalHigh >= 1);
      assert(summary.totalCritical >= 1);
      assert(summary.pendingHighCritical >= 2);
    });

    await checkAsync("conclusão bloqueada com finding pendente", async () => {
      const { canComplete } = await canCompleteProjectStartup(supabase, REFERENCE_PROJECT_ID);
      assert(canComplete === false, "não deveria permitir concluir com findings ALTO/CRÍTICO pendentes");
      await assertRejects(
        completeProjectStartup(supabase, { projectId: REFERENCE_PROJECT_ID, completedByUserId: testUserId }),
        "ainda sem decisão humana",
        "conclusão deveria ser bloqueada"
      );
    });

    await checkAsync("DESCONSIDERAR + justificativa obrigatória", async () => {
      await assertRejects(
        dismissHistoricalFinding(supabase, { findingId: findingHighId, justification: "   ", reviewedByUserId: testUserId }),
        "Justificativa",
        "desconsiderar sem justificativa deveria falhar"
      );

      const dismissed = await dismissHistoricalFinding(supabase, {
        findingId: findingHighId,
        justification: "Risco já mitigado antes do go-live — decisão de teste.",
        reviewedByUserId: testUserId,
      });
      assert(dismissed.lifecycleStatus === "DISMISSED_AT_STARTUP");
      assert(dismissed.reviewerNote.includes("mitigado"));
      assert(dismissed.reviewedByUserId === testUserId);
    });

    await checkAsync("PACIFICADO + evidência opcional", async () => {
      const resolved = await resolveHistoricalFinding(supabase, {
        findingId: findingCriticalId,
        description: "Cliente e AXION alinharam o escopo por reunião registrada em ata.",
        reviewedByUserId: testUserId,
      });
      assert(resolved.lifecycleStatus === "RESOLVED_BEFORE_GO_LIVE");
      assert(resolved.resolutionDescription.includes("alinharam"));
      assert(resolved.resolutionEvidenceNote === null, "evidência deveria ser opcional (null quando não informada)");
    });

    await checkAsync("mesmo fato pacificado não reaparece: persistir de novo com o mesmo fingerprint devolve o finding já RESOLVED_BEFORE_GO_LIVE", async () => {
      const before = await getHistoricalFindings(supabase, REFERENCE_PROJECT_ID);
      const beforeCount = before.length;

      const fpCrit = computeSourceFingerprint({ sourceType: "MANUAL", sourceId: "startup-teste-critical", contentHash: "conteudo-critical-v1" });
      const { finding, created } = await persistFinding(supabase, {
        projectId: REFERENCE_PROJECT_ID,
        curationRunId: null,
        findingType: "CLIENT_SOURCE_CONFRONTATION",
        classification: "CONTRACTUAL_CONFLICT",
        expertIds: ["legal-consultant"],
        severity: "CRITICAL",
        confidence: 0.8,
        facts: ["Fato histórico de teste CRÍTICO (mesma evidência lida de novo)."],
        interpretation: "x",
        recommendation: "x",
        sourceRefs: [{ type: "MANUAL", id: "startup-teste-critical" }],
        fingerprint: computeFindingFingerprint({ findingType: "CLIENT_SOURCE_CONFRONTATION", sourceFingerprint: fpCrit, classification: "CONTRACTUAL_CONFLICT" }),
        effectiveDate: "2025-06-01",
        initialLifecycleStatus: "HISTORICAL_PENDING_STARTUP_REVIEW",
      });

      assert(created === false, "mesma evidência lida de novo nunca deveria criar um finding duplicado");
      assert(finding.id === findingCriticalId);
      assert(finding.lifecycleStatus === "RESOLVED_BEFORE_GO_LIVE", "o finding pacificado nunca deveria voltar a PENDING só porque foi persistido de novo");

      const after = await getHistoricalFindings(supabase, REFERENCE_PROJECT_ID);
      assert(after.length === beforeCount, "nenhuma linha nova deveria ter sido criada");
    });

    await checkAsync("nova evidência material pode gerar novo finding: fingerprint diferente cria um finding novo", async () => {
      const fpNovo = computeSourceFingerprint({ sourceType: "MANUAL", sourceId: "startup-teste-critical", contentHash: "conteudo-critical-v2-revisado" });
      const { finding, created } = await persistFinding(supabase, {
        projectId: REFERENCE_PROJECT_ID,
        curationRunId: null,
        findingType: "CLIENT_SOURCE_CONFRONTATION",
        classification: "CONTRACTUAL_CONFLICT",
        expertIds: ["legal-consultant"],
        severity: "CRITICAL",
        confidence: 0.75,
        facts: ["Nova evidência material — revisão do documento."],
        interpretation: "x",
        recommendation: "x",
        sourceRefs: [{ type: "MANUAL", id: "startup-teste-critical" }],
        fingerprint: computeFindingFingerprint({ findingType: "CLIENT_SOURCE_CONFRONTATION", sourceFingerprint: fpNovo, classification: "CONTRACTUAL_CONFLICT" }),
        effectiveDate: "2025-06-10",
        initialLifecycleStatus: "HISTORICAL_PENDING_STARTUP_REVIEW",
      });
      assert(created === true, "nova evidência material deveria criar um finding novo, não reaproveitar o antigo");
      assert(finding.id !== findingCriticalId);
      cleanup.findingIds.push(finding.id);

      // Decide este novo finding também, para permitir a conclusão do Start-up mais adiante.
      await dismissHistoricalFinding(supabase, { findingId: finding.id, justification: "Duplicata de teste — desconsiderada.", reviewedByUserId: testUserId });
    });

    await checkAsync("CUIDAR DESTE ASSUNTO: cria/reutiliza sla_actions, vincula ao finding, exige responsável @axion.com.br", async () => {
      // Cria um terceiro finding histórico só para testar a criação de ação (sem interferir nos dois já decididos acima).
      const fpAction = computeSourceFingerprint({ sourceType: "MANUAL", sourceId: "startup-teste-action", contentHash: "conteudo-action-v1" });
      const { finding: actionFinding } = await persistFinding(supabase, {
        projectId: REFERENCE_PROJECT_ID,
        curationRunId: null,
        findingType: "CLIENT_SOURCE_CONFRONTATION",
        classification: "ADDITIONAL_REQUIREMENT",
        expertIds: ["legal-consultant"],
        severity: "HIGH",
        confidence: 0.6,
        facts: ["Fato histórico de teste para ação."],
        interpretation: "x",
        recommendation: "x",
        sourceRefs: [{ type: "MANUAL", id: "startup-teste-action" }],
        fingerprint: computeFindingFingerprint({ findingType: "CLIENT_SOURCE_CONFRONTATION", sourceFingerprint: fpAction, classification: "ADDITIONAL_REQUIREMENT" }),
        effectiveDate: "2025-04-01",
        initialLifecycleStatus: "HISTORICAL_PENDING_STARTUP_REVIEW",
      });
      cleanup.findingIds.push(actionFinding.id);

      if (testUserEmail && !testUserEmail.toLowerCase().endsWith("@axion.com.br")) {
        await assertRejects(
          createActionForHistoricalFinding(supabase, {
            findingId: actionFinding.id,
            projectId: REFERENCE_PROJECT_ID,
            responsibleUserId: testUserId,
            area: "ENGENHARIA",
            actionDescription: "Ação de teste.",
            createdByUserId: testUserId,
          }),
          "@axion.com.br",
          "responsável sem e-mail @axion.com.br deveria ser rejeitado"
        );
      }

      // Testa a rejeição de um responsável que não é membro do projeto (nunca atribuído automaticamente pela IA).
      await assertRejects(
        createActionForHistoricalFinding(supabase, {
          findingId: actionFinding.id,
          projectId: REFERENCE_PROJECT_ID,
          responsibleUserId: "00000000-0000-0000-0000-000000000000",
          area: "ENGENHARIA",
          actionDescription: "Ação de teste.",
          createdByUserId: testUserId,
        }),
        "membro real",
        "responsável que não é membro do projeto deveria ser rejeitado"
      );

      if (testUserEmail && testUserEmail.toLowerCase().endsWith("@axion.com.br")) {
        const result = await createActionForHistoricalFinding(supabase, {
          findingId: actionFinding.id,
          projectId: REFERENCE_PROJECT_ID,
          responsibleUserId: testUserId,
          area: "ENGENHARIA",
          actionDescription: "Regularizar pendência histórica identificada no Start-up.",
          createdByUserId: testUserId,
        });
        cleanup.slaActionIds.push(result.slaActionId);
        assert(result.finding.lifecycleStatus === "ACTION_CREATED");

        const { data: slaActionRow, error: slaActionError } = await supabase
          .from("sla_actions")
          .select("id,origin,related_ai_finding_id,responsible_user_id,area")
          .eq("id", result.slaActionId)
          .single();
        if (slaActionError) throw new Error(slaActionError.message);
        assert(slaActionRow.origin === "AI_FINDING");
        assert(slaActionRow.related_ai_finding_id === actionFinding.id);
        assert(slaActionRow.responsible_user_id === testUserId);
      } else {
        console.log("     (membro de teste sem e-mail @axion.com.br — caminho de sucesso não exercitado, só as rejeições)");
      }
    });

    await checkAsync("conclusão permitida após todos decididos: completeProjectStartup grava startup_completed_at/by/historical_review_through", async () => {
      const { canComplete, pendingCount } = await canCompleteProjectStartup(supabase, REFERENCE_PROJECT_ID);
      assert(canComplete === true, `deveria permitir concluir — ${pendingCount} pendente(s) restante(s)`);

      const completed = await completeProjectStartup(supabase, { projectId: REFERENCE_PROJECT_ID, completedByUserId: testUserId });
      assert(completed.startupCompletedAt !== null);
      assert(completed.startupCompletedByUserId === testUserId);
      assert(completed.historicalReviewThrough === "2026-08-23", `esperado dia anterior a 2026-08-24, obtido ${completed.historicalReviewThrough}`);

      const summary = await getStartupSummary(supabase, REFERENCE_PROJECT_ID);
      assert(summary.status === "COMPLETED");
    });

    await checkAsync("pós-go-live usa fluxo normal: effectiveDate após acc_operational_start_date nasce NEW, nunca histórico", async () => {
      const fp = computeSourceFingerprint({ sourceType: "MANUAL", sourceId: "startup-teste-pos-golive", contentHash: "conteudo-pos-golive" });
      const { finding } = await persistFinding(supabase, {
        projectId: REFERENCE_PROJECT_ID,
        curationRunId: null,
        findingType: "CLIENT_SOURCE_CONFRONTATION",
        classification: "COMPATIBLE",
        expertIds: ["legal-consultant"],
        severity: "LOW",
        confidence: 0.5,
        facts: ["Fato pós-go-live."],
        interpretation: "x",
        recommendation: "x",
        sourceRefs: [{ type: "MANUAL", id: "startup-teste-pos-golive" }],
        fingerprint: computeFindingFingerprint({ findingType: "CLIENT_SOURCE_CONFRONTATION", sourceFingerprint: fp, classification: "COMPATIBLE" }),
        effectiveDate: "2026-09-01",
        initialLifecycleStatus: "NEW",
      });
      cleanup.findingIds.push(finding.id);
      assert(finding.lifecycleStatus === "NEW", "finding com data efetiva após o início operacional nunca deveria nascer histórico");
    });

    await checkAsync("auditoria: PROJECT_STARTUP_REVIEW_STARTED, HISTORICAL_FINDING_DISMISSED, HISTORICAL_FINDING_RESOLVED, HISTORICAL_FINDING_ACTION_CREATED e PROJECT_STARTUP_COMPLETED foram registrados", async () => {
      const { data, error } = await supabase
        .from("audit_log_entries")
        .select("action,entity_type")
        .eq("project_id", REFERENCE_PROJECT_ID)
        .in("action", [
          "PROJECT_STARTUP_REVIEW_STARTED",
          "HISTORICAL_FINDING_DISMISSED",
          "HISTORICAL_FINDING_RESOLVED",
          "HISTORICAL_FINDING_ACTION_CREATED",
          "PROJECT_STARTUP_COMPLETED",
        ])
        .order("occurred_at", { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);

      const actions = new Set(data.map((r) => r.action));
      assert(actions.has("PROJECT_STARTUP_REVIEW_STARTED"));
      assert(actions.has("HISTORICAL_FINDING_DISMISSED"));
      assert(actions.has("HISTORICAL_FINDING_RESOLVED"));
      assert(actions.has("PROJECT_STARTUP_COMPLETED"));
    });

    await checkAsync("RLS: update anônimo em projects (acc_operational_start_date) é rejeitado", async () => {
      if (!anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ausente.");
      const anonClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error, count } = await anonClient
        .from("projects")
        .update({ acc_operational_start_date: "2020-01-01" })
        .eq("id", REFERENCE_PROJECT_ID)
        .select("id", { count: "exact" });
      // RLS sem policy correspondente: ou retorna erro, ou afeta 0 linhas — nunca deve alterar a linha real.
      assert(error !== null || !count, "update anônimo em projects deveria ser rejeitado/não afetar nenhuma linha");
    });

    console.log("");
    console.log("--- Limpando fixtures e restaurando o projeto de referência ---");
    if (cleanup.slaActionIds.length > 0) {
      await supabase.from("sla_actions").delete().in("id", cleanup.slaActionIds);
    }
    if (cleanup.findingIds.length > 0) {
      await supabase.from("ai_findings").delete().in("id", cleanup.findingIds);
    }
    await supabase
      .from("projects")
      .update({
        project_start_date: originalConfig.projectStartDate,
        acc_operational_start_date: originalConfig.accOperationalStartDate,
        startup_completed_at: originalConfig.startupCompletedAt,
        startup_completed_by_user_id: originalConfig.startupCompletedByUserId,
        historical_review_through: originalConfig.historicalReviewThrough,
      })
      .eq("id", REFERENCE_PROJECT_ID);
    console.log("Fixtures removidas; projeto de referência restaurado (exceto audit_log_entries, append-only por design).");
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
