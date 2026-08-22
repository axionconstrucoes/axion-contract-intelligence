"use server";

import { createSupabaseServerClient } from "@axion/db/server";

import type { ExportFormatId, TimelineFilterCriteria } from "@/lib/timeline-export/types";

export type RecordTimelineExportInput = {
  exportId: string;
  projectId: string;
  filters: TimelineFilterCriteria;
  eventIds: string[];
  formats: ExportFormatId[];
};

export type RecordTimelineExportResult = { ok: true } | { ok: false; error: string };

// Registra a exportação para auditoria/reprodutibilidade (seções 11 e 13
// do requisito). A autoridade de quem pode inserir é a RLS de
// timeline_exports (qualquer membro do projeto, auto-referenciado via
// exported_by_user_id = auth.uid()) — esta action só encaminha o INSERT e
// nunca usa service_role. O gatilho de auditoria grava um resumo
// compacto em audit_log_entries; NENHUM conteúdo sensível dos eventos é
// registrado aqui, só filtros/contagens/IDs.
export async function recordTimelineExportAction(
  input: RecordTimelineExportInput
): Promise<RecordTimelineExportResult> {
  const supabase = await createSupabaseServerClient();

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return { ok: false, error: "Sessão expirada. Faça login novamente." };
  }

  if (input.eventIds.length === 0) {
    return { ok: false, error: "Nenhum evento no conjunto exportado." };
  }

  if (input.formats.length === 0) {
    return { ok: false, error: "Selecione ao menos um formato de exportação." };
  }

  const { error } = await supabase.from("timeline_exports").insert({
    id: input.exportId,
    project_id: input.projectId,
    exported_by_user_id: authData.user.id,
    filters: input.filters,
    event_ids: input.eventIds,
    item_count: input.eventIds.length,
    formats: input.formats,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
