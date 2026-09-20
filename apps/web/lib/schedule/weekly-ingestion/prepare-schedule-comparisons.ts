// Gatilho IDEMPOTENTE de comparação pós-extração.
//
// Para cada intake AUTHORIZED_AUTO cuja document_version já foi
// processada pelo worker MPXJ (schedule_versions.extraction_status =
// EXTRACTED), garante exatamente DUAS linhas em
// schedule_version_comparisons (UNIQUE (current, type)):
//   - PREVIOUS_WEEKLY  : versão atual x versão semanal extraída anterior;
//   - OFFICIAL_BASELINE: versão atual x baseline oficial configurada.
// Quando a referência não existe (primeira semana; baseline não
// configurada), a linha é gravada como COMPUTED com
// risk_classification = REVIEW_REQUIRED e métricas nulas — nunca
// inventa uma referência. Se o worker falhou (FAILED), registra FAILED
// e libera o intake (comparisons_prepared_at) para não reprocessar em
// loop. Enquanto a extração está PENDING, não faz nada (próxima rodada).

import { classifyScheduleRisk } from "./classify-schedule-risk";
import { compareScheduleSnapshots } from "./compare-schedule-versions";
import type { ComparisonRecord, IntakeAwaitingComparison, ScheduleComparisonStore } from "./store";
import type { ScheduleComparisonType } from "./types";

export interface PrepareComparisonsResult {
  examined: number;
  waitingExtraction: number;
  prepared: number;
  computed: number;
  reviewRequired: number;
  failed: number;
}

async function computeOne(
  store: ScheduleComparisonStore,
  intake: IntakeAwaitingComparison,
  currentId: string,
  referenceId: string | null,
  type: ScheduleComparisonType,
  now: string,
  result: PrepareComparisonsResult
): Promise<void> {
  const existing = await store.findComparison(currentId, type);
  if (existing && existing.status === "COMPUTED") return;

  const base: ComparisonRecord = {
    projectId: intake.projectId,
    currentScheduleVersionId: currentId,
    referenceScheduleVersionId: referenceId,
    comparisonType: type,
    status: "PENDING",
    metrics: null,
    riskClassification: null,
    riskReasons: [],
    missingThresholds: [],
    computedAt: null,
    errorMessage: null,
  };

  if (!referenceId) {
    await store.upsertComparison({
      ...base,
      status: "COMPUTED",
      riskClassification: "REVIEW_REQUIRED",
      riskReasons: [
        type === "PREVIOUS_WEEKLY"
          ? "Não existe versão semanal extraída anterior para comparar."
          : "Baseline oficial não configurada para o projeto (project_weekly_schedule_ingestion_configs.baseline_schedule_version_id).",
      ],
      computedAt: now,
    });
    result.reviewRequired += 1;
    return;
  }

  if (referenceId === currentId) {
    await store.upsertComparison({
      ...base,
      status: "COMPUTED",
      riskClassification: "REVIEW_REQUIRED",
      riskReasons: ["Referência e versão atual são a mesma schedule_version — comparação sem sentido."],
      computedAt: now,
    });
    result.reviewRequired += 1;
    return;
  }

  try {
    const [current, reference, thresholds] = await Promise.all([
      store.loadSnapshot(currentId),
      store.loadSnapshot(referenceId),
      store.loadThresholds(intake.projectId),
    ]);
    const metrics = compareScheduleSnapshots(current, reference, { asOf: now });
    const assessment = classifyScheduleRisk(metrics, thresholds);
    await store.upsertComparison({
      ...base,
      status: "COMPUTED",
      metrics: { ...metrics, dimensions: assessment.dimensions, partialSeverity: assessment.partialSeverity },
      riskClassification: assessment.classification,
      riskReasons: assessment.reasons,
      missingThresholds: assessment.missingThresholds,
      computedAt: now,
    });
    result.computed += 1;
    if (assessment.classification === "REVIEW_REQUIRED") result.reviewRequired += 1;
    await store.writeAudit({
      projectId: intake.projectId,
      action: "SCHEDULE_VERSION_COMPARISON_COMPUTED",
      entityType: "SCHEDULE_VERSION_COMPARISON",
      entityId: `${currentId}:${type}`,
      detail: `Comparação ${type} de ${currentId} com ${referenceId}: ${assessment.classification}.`,
    });
  } catch (error) {
    await store.upsertComparison({
      ...base,
      status: "FAILED",
      errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 2000),
    });
    result.failed += 1;
  }
}

export async function prepareScheduleComparisons(
  store: ScheduleComparisonStore,
  options: { now?: Date; limit?: number } = {}
): Promise<PrepareComparisonsResult> {
  const now = (options.now ?? new Date()).toISOString();
  const result: PrepareComparisonsResult = { examined: 0, waitingExtraction: 0, prepared: 0, computed: 0, reviewRequired: 0, failed: 0 };

  const intakes = await store.listIntakesAwaitingComparison(options.limit ?? 50);
  for (const intake of intakes) {
    result.examined += 1;
    const scheduleVersion = await store.findScheduleVersionForDocumentVersion(intake.documentVersionId);

    if (!scheduleVersion || scheduleVersion.extractionStatus === "PENDING") {
      const processing = await store.getDocumentVersionProcessingStatus(intake.documentVersionId);
      if (processing === "FAILED") {
        await store.writeAudit({
          projectId: intake.projectId,
          action: "SCHEDULE_VERSION_COMPARISON_SKIPPED",
          entityType: "WEEKLY_SCHEDULE_EMAIL_INTAKE",
          entityId: intake.intakeId,
          detail: `Worker MPXJ falhou para document_version ${intake.documentVersionId}; comparações não preparadas.`,
        });
        await store.markIntakeComparisonsPrepared(intake.intakeId);
        result.failed += 1;
        continue;
      }
      result.waitingExtraction += 1;
      continue;
    }

    if (scheduleVersion.extractionStatus === "FAILED") {
      await store.markIntakeComparisonsPrepared(intake.intakeId);
      result.failed += 1;
      continue;
    }

    const [previousId, baselineId] = await Promise.all([
      store.findPreviousWeeklyScheduleVersionId(intake),
      store.getBaselineScheduleVersionId(intake.projectId),
    ]);

    await computeOne(store, intake, scheduleVersion.id, previousId, "PREVIOUS_WEEKLY", now, result);
    await computeOne(store, intake, scheduleVersion.id, baselineId, "OFFICIAL_BASELINE", now, result);
    await store.markIntakeComparisonsPrepared(intake.intakeId);
    result.prepared += 1;
  }

  return result;
}
