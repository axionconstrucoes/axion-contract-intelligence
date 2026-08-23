// Classificação histórico x novo (Start-up ACC) — extraído de
// run-automatic-curation.ts para ser reutilizável por qualquer futura
// fonte de curadoria (ex.: e-mails ingeridos), sem duplicar a regra.
// Finding com data efetiva anterior a projects.acc_operational_start_date
// nasce HISTORICAL_PENDING_STARTUP_REVIEW — nunca apresentado como
// ocorrência nova, nunca dispara alerta/SLA normal antes da revisão
// humana do Start-up (ver seção 18 do requisito de ingestão Gmail).

import type { SupabaseClient } from "@supabase/supabase-js";

export async function classifyInitialLifecycleStatus(
  supabase: SupabaseClient,
  input: { projectId: string; effectiveDate?: string | null }
): Promise<"NEW" | "HISTORICAL_PENDING_STARTUP_REVIEW"> {
  if (!input.effectiveDate) return "NEW";

  const { data: projectRow } = await supabase
    .from("projects")
    .select("acc_operational_start_date")
    .eq("id", input.projectId)
    .single();

  if (projectRow?.acc_operational_start_date && input.effectiveDate < projectRow.acc_operational_start_date) {
    return "HISTORICAL_PENDING_STARTUP_REVIEW";
  }

  return "NEW";
}
