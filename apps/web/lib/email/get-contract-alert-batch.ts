import "server-only";

import { createSupabaseServerClient } from "@axion/db/server";
import type { AlertSeverity } from "@axion/types";

import type { ContractAlertBatchItemAction } from "../email-actions/contract-alert-batch-types";

export interface ContractAlertBatchViewItem {
  id: string;
  eventId: string;
  position: number;
  severity: AlertSeverity;
  title: string;
  action: ContractAlertBatchItemAction | null;
  assignedUserId: string | null;
  answeredAt: string | null;
}

export interface ContractAlertBatchView {
  id: string;
  projectId: string;
  projectName: string;
  recipientUserId: string;
  recipientName: string;
  status: "PENDING" | "SENT" | "RESPONDED" | "FAILED";
  respondedAt: string | null;
  items: ContractAlertBatchViewItem[];
}

// Mesmo padrão de get-weekly-alert-digest.ts: leitura via client normal
// (RLS real da sessão) — a policy de select do lote (20260921120000)
// já garante que só o destinatário ou um ADMIN do projeto conseguem ver
// alguma coisa aqui.
export async function getContractAlertBatch(projectId: string, batchId: string): Promise<ContractAlertBatchView | null> {
  const supabase = await createSupabaseServerClient();
  const { data: batch, error } = await supabase
    .from("contract_alert_batches")
    .select("id,project_id,recipient_user_id,status,responded_at")
    .eq("id", batchId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (error || !batch) return null;

  const [{ data: project }, { data: recipient }, { data: items, error: itemsError }] = await Promise.all([
    supabase.from("projects").select("name").eq("id", projectId).single(),
    supabase.from("profiles").select("name").eq("id", batch.recipient_user_id).single(),
    supabase
      .from("contract_alert_batch_items")
      .select("id,event_id,position,severity,title_snapshot,action,assigned_user_id,answered_at")
      .eq("batch_id", batchId)
      .order("position"),
  ]);

  if (itemsError) return null;

  return {
    id: batch.id,
    projectId: batch.project_id,
    projectName: project?.name ?? "Projeto",
    recipientUserId: batch.recipient_user_id,
    recipientName: recipient?.name ?? "Responsável",
    status: batch.status,
    respondedAt: batch.responded_at,
    items: (items ?? []).map((item) => ({
      id: item.id,
      eventId: item.event_id,
      position: item.position,
      severity: item.severity,
      title: item.title_snapshot,
      action: item.action,
      assignedUserId: item.assigned_user_id,
      answeredAt: item.answered_at,
    })),
  } as ContractAlertBatchView;
}
