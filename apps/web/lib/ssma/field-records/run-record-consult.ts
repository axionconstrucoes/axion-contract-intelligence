// Consulta ao especialista de SSMA no contexto de UM registro de campo. Núcleo PURO (dependências
// injetadas) para ser testado sem rede e sem IA paga. Somente leitura: nada é gravado e a consulta
// nunca altera o registro nem a ação corretiva.

import type { ExpertQueryResponse } from "@/lib/ai/query/types";
import type { AiProviderUiMetadata } from "@/lib/ai/provider-ui-metadata";
import { ACTION_STATUS_LABELS, RISK_LABELS } from "./types";
import type { FieldRecordView } from "./field-record-view";

export type SsmaRecordConsultResult =
  | { ok: true; response: ExpertQueryResponse; meta: AiProviderUiMetadata; question: string; recordLabel: string }
  | { ok: false; error: string };

export interface SsmaConsultState {
  result: Extract<SsmaRecordConsultResult, { ok: true }> | null;
  error: string | null;
}

export interface SsmaRecordConsultDeps {
  /** Permissão do usuário atual na obra (null = sem vínculo ativo). */
  getPermission: (projectId: string) => Promise<string | null>;
  /** Carrega o registro COM o cliente do usuário (RLS): outra obra devolve null. */
  loadRecord: (projectId: string, recordId: string) => Promise<FieldRecordView | null>;
  consult: (input: { projectId: string; recordContext: string; question: string }) => Promise<
    { ok: true; response: ExpertQueryResponse; meta: AiProviderUiMetadata; question: string } | { ok: false; error: string }
  >;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Texto autorizado do registro — só fatos registrados; nada é inferido aqui. */
export function buildSsmaRecordContext(record: FieldRecordView): string {
  const lines = [
    `Registro de campo SSMA (${record.kind === "OCORRENCIA" ? "ocorrência" : "inspeção"}) — registro ${record.id}`,
    `Categoria: ${record.category}`,
    `Descrição: ${record.description}`,
    `Local: ${record.location}`,
    `Data do fato: ${record.occurredAt}`,
    `Risco informado em campo (relato, não classificação contratual): ${RISK_LABELS[record.risk] ?? record.risk}`,
    `Fotos do registro: ${record.photoCount}`,
  ];
  if (record.responsibleName) lines.push(`Responsável pela ação corretiva: ${record.responsibleName}`);
  if (record.action) {
    lines.push(`Ação corretiva: ${ACTION_STATUS_LABELS[record.action.status] ?? record.action.status}; prazo ${record.action.dueDate}`);
    lines.push(`Evidências da ação anexadas: ${record.evidenceCount}`);
    if (record.action.status !== "CONCLUIDA") lines.push("A ação corretiva NÃO está concluída.");
  } else {
    lines.push("Sem ação corretiva registrada.");
  }
  return lines.join("\n");
}

export async function runSsmaRecordConsult(
  deps: SsmaRecordConsultDeps,
  input: { projectId: string; recordId: string; question: string }
): Promise<SsmaRecordConsultResult> {
  if (!UUID.test(input.projectId) || !UUID.test(input.recordId)) return { ok: false, error: "Registro não identificado." };
  const permission = await deps.getPermission(input.projectId);
  if (!permission) return { ok: false, error: "Você não tem vínculo ativo com esta obra." };
  const record = await deps.loadRecord(input.projectId, input.recordId);
  if (!record) return { ok: false, error: "Registro inexistente ou sem acesso." };
  const outcome = await deps.consult({ projectId: input.projectId, recordContext: buildSsmaRecordContext(record), question: input.question });
  if (!outcome.ok) return outcome;
  return { ...outcome, recordLabel: `${record.category} — ${record.location}` };
}
