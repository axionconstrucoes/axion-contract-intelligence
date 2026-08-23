// Status real das integrações (seção 7 do requisito) — reaproveita o
// mesmo enum já existente (IntegrationStatus: CONECTADO/PENDENTE/
// ATENCAO/ERRO, exibido em PT-BR como Ativo/Pendente/Atenção/Erro via
// integrationStatusLabels) em vez de inventar um vocabulário paralelo.
// "0 novas mensagens" NUNCA significa PENDENTE: o e-mail corporativo
// mostra ATIVO (CONECTADO) sempre que a configuração está completa e a
// conta está operacional, independentemente de quantas mensagens novas
// a última sincronização encontrou.

import type { IntegrationStatus, SourceDefinition, SourceType } from "@axion/types";

/** Fontes genéricas (Construmanager, Drive, Diário, Cronograma, Relatórios, Contrato, Recebidos, RFI/RFP, ERP, Orçamento, ESG/SSMA): usa o status já armazenado, sem reinterpretação. */
export function resolveGenericIntegrationDisplayStatus(rawStatus: IntegrationStatus): IntegrationStatus {
  return rawStatus;
}

/**
 * E-mail corporativo: status real derivado da configuração de
 * ingestão + conta AXION vinculada — NUNCA da contagem de mensagens
 * novas da última sincronização.
 */
export function resolveEmailIntegrationDisplayStatus(input: {
  configEnabled: boolean | null;
  hasEmailAccount: boolean;
  hasClientDomain: boolean;
  accountStatus: "NOT_CONNECTED" | "CONNECTED" | "SYNCING" | "AUTH_EXPIRED" | "ERROR" | null;
}): IntegrationStatus {
  if (input.accountStatus === "ERROR") return "ERRO";
  if (input.accountStatus === "AUTH_EXPIRED") return "ATENCAO";

  const configComplete = Boolean(input.configEnabled) && input.hasEmailAccount && input.hasClientDomain;
  if (!configComplete) return "PENDENTE";

  if (input.accountStatus === "CONNECTED" || input.accountStatus === "SYNCING") return "CONECTADO";

  return "PENDENTE";
}

export interface IntegrationStatusEntry {
  sourceType: SourceType;
  label: string;
  status: IntegrationStatus;
}

/**
 * Resolve o status real de TODAS as fontes de um projeto (as 12
 * definidas em sourceDefinitions) — E-mail via
 * resolveEmailIntegrationDisplayStatus (nunca a contagem de mensagens),
 * as demais via resolveGenericIntegrationDisplayStatus. Nunca inventa
 * uma fonte que não está em `sources`.
 */
export function resolveAllIntegrationStatuses(
  sources: SourceDefinition[],
  configs: { sourceType: SourceType; status: IntegrationStatus }[],
  emailStatus: IntegrationStatus
): IntegrationStatusEntry[] {
  return sources.map((source) => {
    if (source.type === "EMAIL") {
      return { sourceType: source.type, label: source.label, status: emailStatus };
    }
    const config = configs.find((c) => c.sourceType === source.type);
    return {
      sourceType: source.type,
      label: source.label,
      status: config ? resolveGenericIntegrationDisplayStatus(config.status) : "PENDENTE",
    };
  });
}

export interface IntegrationStatusGroup {
  status: IntegrationStatus;
  count: number;
  labels: string[];
}

const STATUS_ORDER: IntegrationStatus[] = ["CONECTADO", "PENDENTE", "ATENCAO", "ERRO"];

/**
 * Agrupa por status — total de cada um + a lista de nomes (seção usada
 * no hover do resumo do Dashboard). Sempre inclui os 4 status, mesmo
 * com contagem 0, para uma leitura "de relance" consistente.
 */
export function summarizeIntegrationStatuses(entries: IntegrationStatusEntry[]): IntegrationStatusGroup[] {
  return STATUS_ORDER.map((status) => {
    const matching = entries.filter((entry) => entry.status === status);
    return { status, count: matching.length, labels: matching.map((entry) => entry.label) };
  });
}
