import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectEmailIngestionConfig } from "./types";

/**
 * Contagem preliminar (seção 8) — sempre uma contagem REAL de e-mails já
 * conhecidos pelo ACC dentro do período configurado (nunca uma
 * estimativa inventada). Antes da primeira sincronização de um domínio
 * novo, o resultado é honestamente 0 — nunca inflado para parecer uma
 * prévia da caixa do Gmail, que só é visível numa sincronização real.
 */
export async function estimateEligibleEmailCount(
  supabase: SupabaseClient,
  projectId: string,
  config: ProjectEmailIngestionConfig,
  projectStartDate: string | null
): Promise<number> {
  const enabledMailboxes = config.mailboxes.filter((m) => m.enabled).map((m) => m.mailboxAddress);
  if (enabledMailboxes.length === 0) return 0;

  let startAt: string | null = null;
  if (config.windowMode === "CUSTOM") {
    startAt = config.customStartAt;
  } else if (config.windowMode === "FROM_NOW") {
    startAt = config.monitoringStartedAt;
  } else if (config.windowMode === "FROM_PROJECT_START") {
    startAt = projectStartDate;
  }

  let query = supabase.from("emails").select("id", { count: "exact", head: true }).eq("project_id", projectId).in("mailbox_address", enabledMailboxes);

  if (startAt) query = query.gte("sent_at", startAt);
  if (config.windowMode === "CUSTOM" && config.customEndAt) query = query.lte("sent_at", config.customEndAt);

  const { count, error } = await query;
  if (error) throw new Error(`Falha ao estimar e-mails elegíveis: ${error.message}`);
  return count ?? 0;
}
