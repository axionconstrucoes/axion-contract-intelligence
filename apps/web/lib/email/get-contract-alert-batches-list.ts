import "server-only";

import { createSupabaseServerClient } from "@axion/db/server";

import {
  computeContractAlertBatchListStatus,
  type ContractAlertBatchListStatus,
  type ContractAlertBatchListStatusInput,
} from "./contract-alert-batch-list-status";

export type { ContractAlertBatchListStatus, ContractAlertBatchListStatusInput };
export { computeContractAlertBatchListStatus };

export interface ContractAlertBatchListRow {
  id: string;
  batchKind: "MANUAL" | "WEEKLY_AUTO";
  cutoffDate: string | null;
  recipientName: string;
  totalCount: number;
  lowCount: number;
  mediumCount: number;
  answeredCount: number;
  listStatus: ContractAlertBatchListStatus;
  sentAt: string | null;
  createdAt: string;
}

// Mesmo padrão de leitura de get-contract-alert-batch.ts: client normal
// (RLS real da sessão) — a policy de select já existente (recipient ou
// ADMIN do projeto) é a única barreira de segurança, aqui e na listagem
// (requisito 7: nunca uma segunda regra de acesso paralela).
export async function getContractAlertBatchesList(projectId: string): Promise<ContractAlertBatchListRow[]> {
  const supabase = await createSupabaseServerClient();

  const { data: batches, error } = await supabase
    .from("contract_alert_batches")
    .select("id,recipient_user_id,status,batch_kind,cutoff_date,sent_at,created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error || !batches || batches.length === 0) return [];

  const batchIds = batches.map((b) => b.id);
  const recipientIds = Array.from(new Set(batches.map((b) => b.recipient_user_id)));

  const [{ data: items }, { data: profiles }] = await Promise.all([
    supabase
      .from("contract_alert_batch_items")
      .select("batch_id,severity,answered_at")
      .in("batch_id", batchIds),
    supabase.from("profiles").select("id,name").in("id", recipientIds),
  ]);

  const nameById = new Map((profiles ?? []).map((p) => [p.id as string, p.name as string]));
  const itemsByBatch = new Map<string, Array<{ severity: string; answered_at: string | null }>>();
  for (const item of items ?? []) {
    const bucket = itemsByBatch.get(item.batch_id as string) ?? [];
    bucket.push({ severity: item.severity as string, answered_at: item.answered_at as string | null });
    itemsByBatch.set(item.batch_id as string, bucket);
  }

  return batches.map((batch) => {
    const batchItems = itemsByBatch.get(batch.id as string) ?? [];
    const totalCount = batchItems.length;
    const lowCount = batchItems.filter((i) => i.severity === "BAIXA").length;
    const mediumCount = batchItems.filter((i) => i.severity === "MEDIA").length;
    const answeredCount = batchItems.filter((i) => i.answered_at !== null).length;

    return {
      id: batch.id as string,
      batchKind: batch.batch_kind as "MANUAL" | "WEEKLY_AUTO",
      cutoffDate: batch.cutoff_date as string | null,
      recipientName: nameById.get(batch.recipient_user_id as string) ?? "Responsável",
      totalCount,
      lowCount,
      mediumCount,
      answeredCount,
      listStatus: computeContractAlertBatchListStatus({
        status: batch.status as ContractAlertBatchListStatusInput["status"],
        answeredCount,
        totalCount,
      }),
      sentAt: batch.sent_at as string | null,
      createdAt: batch.created_at as string,
    };
  });
}
