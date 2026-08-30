// Orquestra a resolução de uma proposta a partir da pasta ORÇAMENTOS —
// nunca confia em nada vindo do navegador: recebe só `folderId` (o
// identificador canônico) e um `client` injetado (real ou fixture
// determinística — nunca o Drive real nesta etapa), e resolve TUDO de
// novo a partir daí (número, nome completo/escopo, planilha de custo
// mais recente, preço/estimativa). Server-only por natureza (chamado só
// de Server Actions) — mas mantido puro de I/O de framework (só usa o
// `client` injetado) para poder ser testado com a fixture sem next/
// supabase.

import { findPlanilhaOrcamentariaFolder } from "./find-planilha-orcamentaria-folder";
import { isSingleFechamentoWorkbook, parseFechamentoCellValue } from "./extract-fechamento-estimate";
import { parseProposalNumberFromFolderName } from "./parse-proposal-folder-name";
import { selectMostRecentCustoFile } from "./select-most-recent-custo-file";
import type { ProposalDriveLookupClient, ResolvedAdditionalProposalFromDrive } from "./types";

export async function resolveAdditionalProposalFromDrive(
  client: ProposalDriveLookupClient,
  folderId: string,
  folderName: string
): Promise<ResolvedAdditionalProposalFromDrive> {
  const warnings: string[] = [];
  const proposalNumber = parseProposalNumberFromFolderName(folderName);

  const base = { proposalNumber, folderName, folderId };

  const subfolders = await client.listSubfolders(folderId);
  const planilhaFolder = findPlanilhaOrcamentariaFolder(subfolders);

  if (!planilhaFolder) {
    warnings.push('Subpasta "02_PLANILHA ORÇAMENTÁRIA" não encontrada dentro desta proposta.');
    return { ...base, costFileName: null, costFileId: null, salePrice: null, priceSource: "NOT_RESOLVED", isEstimate: false, warnings };
  }

  const files = await client.listFiles(planilhaFolder.id);
  const custoFile = selectMostRecentCustoFile(files);

  if (!custoFile) {
    warnings.push('Nenhum arquivo com "custo" no nome foi encontrado em "02_PLANILHA ORÇAMENTÁRIA".');
    return { ...base, costFileName: null, costFileId: null, salePrice: null, priceSource: "NOT_RESOLVED", isEstimate: false, warnings };
  }

  const sheetNames = await client.listSpreadsheetSheetNames(custoFile.id);

  if (!isSingleFechamentoWorkbook(sheetNames)) {
    warnings.push(
      sheetNames.length === 0
        ? `A planilha "${custoFile.name}" não tem nenhuma aba legível.`
        : `A planilha "${custoFile.name}" tem ${sheetNames.length} aba(s) (${sheetNames.join(", ")}) — nenhuma lógica canônica de preço de venda foi encontrada no projeto para esse caso; nenhum valor foi inventado.`
    );
    return { ...base, costFileName: custoFile.name, costFileId: custoFile.id, salePrice: null, priceSource: "NOT_RESOLVED", isEstimate: false, warnings };
  }

  const rawValue = await client.readSpreadsheetCell(custoFile.id, sheetNames[0], "B12");
  const salePrice = parseFechamentoCellValue(rawValue);

  if (salePrice === null) {
    warnings.push('Célula B12 da aba "FECHAMENTO" não contém um valor numérico reconhecível.');
    return { ...base, costFileName: custoFile.name, costFileId: custoFile.id, salePrice: null, priceSource: "NOT_RESOLVED", isEstimate: false, warnings };
  }

  return {
    ...base,
    costFileName: custoFile.name,
    costFileId: custoFile.id,
    salePrice,
    priceSource: "FECHAMENTO_B12_ESTIMATE",
    isEstimate: true,
    warnings,
  };
}
