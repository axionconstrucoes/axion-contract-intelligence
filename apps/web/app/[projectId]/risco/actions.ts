"use server";

import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@axion/db/server";

import { buildRiskFacts, parseRiskReviewForm } from "@/lib/risk-classification/facts-builders";
import { loadRiskSourceContext } from "@/lib/risk-classification/load-risk-source-context";
import { suggestRisk } from "@/lib/risk-classification/suggest-risk";

import type { RiskReviewActionState } from "./actions-state";

// A revisão passa pela função SQL review_risk_classification (sessão do usuário): ela confere
// gestor/gerente/administrador da obra DONA do alerta, justificativa e grau diferente do atual, e
// grava o histórico. A sugestão guardada junto é RECALCULADA aqui no servidor com cláusula,
// evidência e prazo lidos do banco — o navegador só informa o que a pessoa declara.

const fail = (error: string): RiskReviewActionState => ({ error, success: null });
const LEVELS = ["BAIXA", "MEDIA", "ALTA", "CRITICA"];

function today(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10); // dia corrido em America/Sao_Paulo
}

function friendly(message: string | undefined): string {
  return message && message.length < 220 ? message : "Não foi possível registrar a revisão. Tente novamente.";
}

export async function reviewRiskClassificationAction(
  projectId: string,
  sourceType: "CONTRACT_EVENT" | "DELIVERY_ITEM",
  sourceId: string,
  _prev: RiskReviewActionState,
  formData: FormData
): Promise<RiskReviewActionState> {
  const newLevel = String(formData.get("newLevel") ?? "");
  const justification = String(formData.get("justification") ?? "").trim();
  const reference = String(formData.get("reference") ?? "").trim().slice(0, 300);
  if (!LEVELS.includes(newLevel)) return fail("Selecione o grau de risco.");
  if (!justification) return fail("Informe a justificativa da classificação.");

  const supabase = await createSupabaseServerClient();
  const context = await loadRiskSourceContext(supabase, { projectId, sourceType, sourceId, today: today() });
  if (!context) return fail("Alerta não encontrado nesta obra.");

  const declared = parseRiskReviewForm(Object.fromEntries(formData.entries()));
  // Providência: o prazo é o do registro (nunca o que o navegador enviou).
  const form =
    context.sourceType === "DELIVERY_ITEM"
      ? { ...declared, deadlineStatus: context.deadline.status, deadlineDate: context.deadline.date }
      : declared;
  const suggestion = suggestRisk(
    buildRiskFacts({
      form,
      verifiedClause: context.verifiedClause,
      obligationDescription: context.obligationDescription,
      evidence: context.evidence,
      deadlineRef: context.deadline.ref,
    })
  );
  // O prazo da providência é calculado pelo ACC; o formulário só decide quando não há data.
  const snapshot = { ...suggestion, declared: form, deadlineFromRecord: context.sourceType === "DELIVERY_ITEM" ? context.deadline : null };

  const { error } = await supabase.rpc("review_risk_classification", {
    p_source_type: sourceType,
    p_source_id: sourceId,
    p_new_level: newLevel,
    p_justification: justification,
    p_reference: reference || null,
    p_suggestion: snapshot,
  });
  if (error) return fail(friendly(error.message));

  revalidatePath(`/${projectId}/ledger/${sourceId}`);
  revalidatePath(`/${projectId}/ledger`);
  revalidatePath(`/${projectId}/providencias`);
  return { error: null, success: "Classificação de risco registrada no histórico." };
}
