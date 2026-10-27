import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { sourceTypeShortLabels } from "@/lib/labels";
import type { ContractAlertEvidenceItem } from "@/lib/email/templates/contract-alert-template";

import { buildEvidenceItem, formatClauseLabel, summarizeClauseText } from "./alert-source-links";

export interface EventAlertContext {
  eventId: string;
  projectId: string;
  projectName: string;
  /** Cláusula VERIFICADA (vínculo aprovado evento↔cláusula); null = pendente de confirmação. */
  clause: { label: string; text: string | null } | null;
  evidence: ContractAlertEvidenceItem[];
}

/**
 * Contexto de alerta por evento: obra do PRÓPRIO evento, cláusula impactada (só vínculos
 * aprovados) e evidências como links para a origem no ACC. Nada é inventado: sem vínculo/
 * identificador verificável o campo fica vazio e o e-mail mostra "Pendente de confirmação".
 * Leitura com service role (cron); o link de destino exige login e participação na obra.
 */
export async function loadEventAlertContexts(
  admin: SupabaseClient,
  eventIds: readonly string[],
  baseUrl: string
): Promise<Map<string, EventAlertContext>> {
  const result = new Map<string, EventAlertContext>();
  if (eventIds.length === 0) return result;

  const [{ data: events }, { data: crossRefs }, { data: evidence }] = await Promise.all([
    admin.from("contract_events").select("id,project_id").in("id", eventIds as string[]),
    admin.from("event_cross_references").select("event_id,clause_id,created_at").in("event_id", eventIds as string[]).not("clause_id", "is", null).order("created_at", { ascending: true }),
    admin.from("event_evidence").select("id,event_id,source_type,label,locator,document_version_id,email_id").in("event_id", eventIds as string[]).order("created_at", { ascending: true }),
  ]);

  const projectIds = Array.from(new Set((events ?? []).map((e) => e.project_id as string)));
  const clauseIds = Array.from(new Set((crossRefs ?? []).map((c) => c.clause_id as string)));
  const [{ data: projects }, { data: clauses }] = await Promise.all([
    projectIds.length ? admin.from("projects").select("id,name").in("id", projectIds) : Promise.resolve({ data: [] }),
    clauseIds.length ? admin.from("clauses").select("id,clause_number,title,text").in("id", clauseIds) : Promise.resolve({ data: [] }),
  ]);

  const projectName = new Map((projects ?? []).map((p) => [p.id as string, p.name as string]));
  const clauseById = new Map((clauses ?? []).map((c) => [c.id as string, c]));

  for (const event of events ?? []) {
    const eventId = event.id as string;
    const projectId = event.project_id as string;

    const firstClauseRef = (crossRefs ?? []).find((c) => c.event_id === eventId);
    const clauseRow = firstClauseRef ? clauseById.get(firstClauseRef.clause_id as string) : undefined;
    const label = clauseRow ? formatClauseLabel(clauseRow.clause_number as string, clauseRow.title as string) : null;

    const items = (evidence ?? [])
      .filter((row) => row.event_id === eventId)
      .map((row) =>
        buildEvidenceItem({
          baseUrl,
          projectId,
          eventId,
          evidenceId: row.id as string,
          documentVersionId: (row.document_version_id as string | null) ?? null,
          emailId: (row.email_id as string | null) ?? null,
          locator: (row.locator as string | null) ?? null,
          label: row.label as string,
          sourceTypeLabel: sourceTypeShortLabels[row.source_type as keyof typeof sourceTypeShortLabels] ?? String(row.source_type),
        })
      );

    result.set(eventId, {
      eventId,
      projectId,
      projectName: projectName.get(projectId) ?? "Obra",
      clause: label ? { label, text: summarizeClauseText(clauseRow?.text as string | null) } : null,
      evidence: items,
    });
  }
  return result;
}
