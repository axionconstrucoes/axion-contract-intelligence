import "server-only";

import { createSupabaseServerClient } from "@axion/db/server";
import { mapFieldRecordRow, type FieldRecordRow, type FieldRecordView } from "./field-record-view";

/**
 * Registros de campo SSMA da obra (RLS: só membros ativos). Se a migration 20261028130000 ainda não
 * foi aplicada no ambiente (42P01), devolve `available: false` em vez de quebrar a página.
 */
export async function getFieldRecords(
  projectId: string,
  names: ReadonlyMap<string, string>
): Promise<{ available: boolean; records: FieldRecordView[] }> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("ssma_field_records")
    .select(
      "id, kind, category, description, location, occurred_at, client_created_at, received_at, risk_level, responsible_user_id, due_date, reported_by_user_id, ssma_corrective_actions(id, status, due_date, concluded_at, responsible_user_id), ssma_field_record_photos(id, purpose)"
    )
    .eq("project_id", projectId)
    .order("occurred_at", { ascending: false })
    .limit(300);

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return { available: false, records: [] };
    throw new Error(`Falha ao carregar registros SSMA: ${error.message}`);
  }
  return { available: true, records: ((data ?? []) as unknown as FieldRecordRow[]).map((row) => mapFieldRecordRow(row, names)) };
}
