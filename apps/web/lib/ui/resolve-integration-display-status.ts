// Status real das integrações (seção 7 do requisito) — reaproveita o
// mesmo enum já existente (IntegrationStatus: CONECTADO/PENDENTE/
// ATENCAO/ERRO, exibido em PT-BR como Ativo/Pendente/Atenção/Erro via
// integrationStatusLabels) em vez de inventar um vocabulário paralelo.
// "0 novas mensagens" NUNCA significa PENDENTE: o e-mail corporativo
// mostra ATIVO (CONECTADO) sempre que a configuração está completa e a
// conta está operacional, independentemente de quantas mensagens novas
// a última sincronização encontrou.

import type { IntegrationStatus } from "@axion/types";

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
