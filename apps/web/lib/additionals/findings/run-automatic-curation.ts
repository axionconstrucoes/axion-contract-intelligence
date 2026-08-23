// Orquestrador da curadoria automática (seção 10 do requisito):
// SOURCE_INGESTED_OR_UPDATED → classify → fingerprint → detectar mudança
// → routeExperts → specialist curation → grounding (já embutido nas
// funções de query reutilizadas) → persist finding → alerta interno →
// human review. Sempre chamado sob demanda pela aplicação (nenhum
// scheduler/cron) — o "automático" está em nunca depender de pergunta
// manual do usuário, não em rodar sozinho em background.
//
// Segurança da ingestão (seção 11): a fonte (aqui, um
// additional_proposal_drive_sources) já foi persistida ANTES desta
// função ser chamada — se a IA falhar aqui, a fonte permanece
// disponível normalmente, só o ai_curation_runs fica FAILED_PENDING_RETRY.

import type { SupabaseClient } from "@supabase/supabase-js";
import { runExecutiveCuration } from "../../ai/experts/ceo/consolidate";
import { answerCommercialDirectorQuery } from "../../ai/experts/commercial-director/query";
import { answerPlanningDirectorQuery } from "../../ai/experts/planning-director/query";
import type { OfficialExpertId } from "../../ai/expert-definitions/types";
import type { AiProvider, AiProviderExpertPosition } from "../../ai/providers/types";
import type { ExpertId, ExpertSeverity } from "../../ai/types";
import { runClientSourceConfrontation } from "../confrontation/run-client-source-confrontation";
import { computeFindingFingerprint, computeSourceFingerprint } from "./compute-fingerprint";
import { completeCurationRun, failCurationRun, findCompletedCurationRun, startCurationRun } from "./curation-run";
import { persistFinding } from "./persist-finding";
import { routeExpertsForConfrontation } from "./route-confrontation-experts";
import type { AiCurationRunStatus, AiFinding, AiFindingSourceRef } from "./types";

export interface RunAutomaticCurationInput {
  projectId: string;
  proposalId: string;
  driveSourceId: string;
  sourceLabel: string;
  sourceSummary: string;
  /** Hash real do conteúdo quando já disponível (ex.: sha256 do arquivo processado); cai para hash do resumo quando ausente. */
  contentHash?: string;
  hasCostOrScheduleImpact?: boolean;
  createdByUserId?: string;
  /** Só para testes — injeta o provider do confronto Jurídico sem depender de resolução por env var. */
  confrontationProvider?: AiProvider;
}

export interface RunAutomaticCurationResult {
  status: "SKIPPED_UNCHANGED" | "COMPLETED" | "FAILED_PENDING_RETRY";
  finding: AiFinding | null;
  findingCreated: boolean;
  runStatus: AiCurationRunStatus;
  routedExpertIds: ExpertId[];
}

function toPosition(expertId: OfficialExpertId, expertName: string, severity: ExpertSeverity, interpretacao: string, riscos: string[], recomendacoes: string[], informacoesFaltantes: string[]): AiProviderExpertPosition {
  return { expertId, expertName, severity, interpretacao, riscos, recomendacoes, informacoesFaltantes };
}

export async function runAutomaticCurationForClientSource(
  supabase: SupabaseClient,
  input: RunAutomaticCurationInput
): Promise<RunAutomaticCurationResult> {
  const contentHash = input.contentHash ?? input.sourceSummary;
  const sourceFingerprint = computeSourceFingerprint({
    sourceType: "ADDITIONAL_PROPOSAL_DRIVE_SOURCE",
    sourceId: input.driveSourceId,
    contentHash,
  });

  // Seção 12 — conteúdo não mudou desde a última execução COMPLETED: nunca reexecuta.
  const existingRun = await findCompletedCurationRun(supabase, {
    sourceType: "ADDITIONAL_PROPOSAL_DRIVE_SOURCE",
    sourceId: input.driveSourceId,
    sourceFingerprint,
  });
  if (existingRun) {
    return { status: "SKIPPED_UNCHANGED", finding: null, findingCreated: false, runStatus: "COMPLETED", routedExpertIds: existingRun.routedExpertIds };
  }

  const run = await startCurationRun(supabase, {
    projectId: input.projectId,
    sourceType: "ADDITIONAL_PROPOSAL_DRIVE_SOURCE",
    sourceId: input.driveSourceId,
    sourceFingerprint,
    triggerType: "AUTOMATIC",
    createdByUserId: input.createdByUserId,
  });

  try {
    const { confrontation } = await runClientSourceConfrontation(
      supabase,
      { projectId: input.projectId, sourceLabel: input.sourceLabel, sourceSummary: input.sourceSummary },
      input.confrontationProvider
    );

    const routing = routeExpertsForConfrontation({
      classification: confrontation.confrontation.classification,
      hasCostOrScheduleImpact: input.hasCostOrScheduleImpact,
    });

    const positions: AiProviderExpertPosition[] = [
      toPosition(
        "legal-consultant",
        confrontation.expertName,
        confrontation.severity,
        confrontation.finding.interpretation,
        confrontation.possibleImpacts,
        confrontation.recommendedActions,
        confrontation.uncertainties
      ),
    ];

    const routedExpertIds: OfficialExpertId[] = ["legal-consultant"];
    const question = `Confronto de fonte do cliente (${input.sourceLabel}): classificação ${confrontation.confrontation.classification}. ${confrontation.executiveSummary}`;

    for (const expertId of routing.additionalExpertIds) {
      if (expertId === "commercial-director") {
        const result = await answerCommercialDirectorQuery(supabase, { scope: "PROJECT", projectId: input.projectId, question });
        positions.push(toPosition(expertId, result.response.expertName, result.response.severity, result.response.interpretacao, result.response.riscos, result.response.recomendacoes, result.response.informacoesFaltantes));
        routedExpertIds.push(expertId);
      } else if (expertId === "planning-director") {
        const result = await answerPlanningDirectorQuery(supabase, { scope: "PROJECT", projectId: input.projectId, question });
        positions.push(toPosition(expertId, result.response.expertName, result.response.severity, result.response.interpretacao, result.response.riscos, result.response.recomendacoes, result.response.informacoesFaltantes));
        routedExpertIds.push(expertId);
      }
    }

    const highestSeverity = positions.reduce<ExpertSeverity>((highest, p) => {
      const rank: Record<ExpertSeverity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
      return rank[p.severity] > rank[highest] ? p.severity : highest;
    }, "LOW");

    const isMaterial = routing.ceoMaterial || highestSeverity === "HIGH" || highestSeverity === "CRITICAL";

    let interpretation = confrontation.finding.interpretation;
    let recommendation = confrontation.recommendedActions[0] ?? confrontation.executiveSummary;

    if (isMaterial) {
      const { curation } = await runExecutiveCuration(question, positions);
      routedExpertIds.push("ceo");
      interpretation = curation.situacao;
      recommendation = curation.recomendacao;
    }

    const sourceRefs: AiFindingSourceRef[] = [{ type: "ADDITIONAL_PROPOSAL_DRIVE_SOURCE", id: input.driveSourceId }];
    const conflictingSourceRefs: AiFindingSourceRef[] = confrontation.contractualBasis
      .filter((basis) => basis.clauseId)
      .map((basis) => ({ type: "CLAUSE", id: basis.clauseId as string }));

    const fingerprint = computeFindingFingerprint({
      findingType: "CLIENT_SOURCE_CONFRONTATION",
      sourceFingerprint,
      classification: confrontation.confrontation.classification,
    });

    const { finding, created } = await persistFinding(supabase, {
      projectId: input.projectId,
      curationRunId: run.id,
      findingType: "CLIENT_SOURCE_CONFRONTATION",
      classification: confrontation.confrontation.classification,
      expertIds: routedExpertIds,
      severity: highestSeverity,
      confidence: confrontation.confidence,
      facts: confrontation.finding.facts,
      interpretation,
      recommendation,
      grounding: confrontation.grounding ?? null,
      sourceRefs,
      conflictingSourceRefs,
      fingerprint,
      createdByUserId: input.createdByUserId,
    });

    await completeCurationRun(supabase, run.id, routedExpertIds);

    return { status: "COMPLETED", finding, findingCreated: created, runStatus: "COMPLETED", routedExpertIds };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failCurationRun(supabase, run.id, message);
    return { status: "FAILED_PENDING_RETRY", finding: null, findingCreated: false, runStatus: "FAILED_PENDING_RETRY", routedExpertIds: [] };
  }
}
