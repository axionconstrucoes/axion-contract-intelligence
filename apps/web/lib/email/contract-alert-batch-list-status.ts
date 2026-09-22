// Status de EXIBIÇÃO da listagem de lotes — puro, sem I/O,
// deliberadamente sem "server-only" para ser testável por um script
// Node standalone (mesmo padrão de contract-alert-batch-validation.ts).
// Nunca confundir com contract_alert_batches.status (PENDING/SENT/
// RESPONDED/FAILED, a coluna real) — este é só o rótulo derivado que a
// página /lote-alertas mostra.
//
// NÃO existe um estado "PARCIAL" aqui: a RPC submit_contract_alert_
// batch_response (já aplicada em produção, não alterada por esta
// feature) só aceita submissão atômica de TODOS os itens de uma vez
// (conta exata, nunca um subconjunto) — um lote SENT com "alguns
// respondidos, outros não" nunca é um estado real e persistido no
// banco hoje. Mostrar "PARCIAL" seria exibir um estado inalcançável.
// answeredCount/totalCount continuam disponíveis na linha da listagem
// ("X de Y respondidos") para quem quiser ver o progresso — só o rótulo
// de status nunca inventa uma categoria que os dados não sustentam. Se
// o desenho da RPC mudar no futuro para aceitar submissão parcial, um
// estado PARCIAL real pode ser adicionado aqui então, nunca antes.

export type ContractAlertBatchListStatus = "PENDENTE_ENVIO" | "ABERTO" | "RESPONDIDO" | "FALHOU";

export interface ContractAlertBatchListStatusInput {
  status: "PENDING" | "SENT" | "RESPONDED" | "FAILED";
  answeredCount: number;
  totalCount: number;
}

// RESPONDIDO é sempre a coluna `status` (RESPONDED), nunca derivado da
// contagem — a mesma transação que grava os itens já marca o lote como
// RESPONDED. ABERTO cobre qualquer lote SENT ainda não respondido,
// incluindo o caso hoje inalcançável de uma contagem parcial (ver nota
// acima) — o cálculo é feito a partir dos dados reais, não assumido,
// então continua correto sem exibir um rótulo falso.
export function computeContractAlertBatchListStatus(
  input: ContractAlertBatchListStatusInput
): ContractAlertBatchListStatus {
  if (input.status === "RESPONDED") return "RESPONDIDO";
  if (input.status === "FAILED") return "FALHOU";
  if (input.status === "PENDING") return "PENDENTE_ENVIO";
  return "ABERTO";
}
