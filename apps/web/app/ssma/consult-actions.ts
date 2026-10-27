"use server";

import { createSupabaseServerClient } from "@axion/db/server";

import { consultSsmaSpecialistForRecord } from "@/lib/ai/alert-consult/ssma-consult";
import { getCurrentProjectPermission } from "@/lib/contract-review";
import { getFieldRecords } from "@/lib/ssma/field-records/data";
import { runSsmaRecordConsult, type SsmaConsultState } from "@/lib/ssma/field-records/run-record-consult";

// SOMENTE LEITURA: não grava nada e não altera o registro nem a ação corretiva. Login, vínculo ativo
// e isolamento por obra são conferidos no servidor (o registro é lido com a sessão do usuário, RLS).
export async function consultSsmaRecordAction(_previous: SsmaConsultState, formData: FormData): Promise<SsmaConsultState> {
  const projectId = String(formData.get("projectId") ?? "");
  const recordId = String(formData.get("recordId") ?? "");
  const question = String(formData.get("question") ?? "");
  const supabase = await createSupabaseServerClient();
  const outcome = await runSsmaRecordConsult(
    {
      getPermission: getCurrentProjectPermission,
      loadRecord: async (pid, rid) => {
        const { records } = await getFieldRecords(pid, new Map());
        return records.find((record) => record.id === rid) ?? null;
      },
      consult: ({ projectId: pid, recordContext, question: q }) =>
        consultSsmaSpecialistForRecord(supabase, { projectId: pid, recordContext, question: q }),
    },
    { projectId, recordId, question }
  );
  return outcome.ok ? { result: outcome, error: null } : { result: null, error: outcome.error };
}
