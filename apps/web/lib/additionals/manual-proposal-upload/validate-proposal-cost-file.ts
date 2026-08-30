// Puro, sem I/O. Bloco 7 (rodada "produção") — "UPLOAD MANUAL" de
// planilha de custo para Propostas de Adicionais (Drive desabilitado
// no go-live). Validação de extensão/MIME no SERVIDOR — nunca confia
// só no que o navegador diz ter selecionado (o mesmo princípio de
// document-upload-form.tsx, aqui reescrito para o par
// extensão+MIME específico de planilha, não o allowlist genérico de
// documentos).

const ALLOWED_EXTENSIONS = new Set(["xlsx", "xls"]);

const ALLOWED_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls
]);

export interface ProposalCostFileValidationResult {
  valid: boolean;
  error: string | null;
}

export function validateProposalCostFile(fileName: string, mimeType: string): ProposalCostFileValidationResult {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return { valid: false, error: "Extensão não permitida — envie um arquivo .xlsx ou .xls (planilha de custo)." };
  }

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return { valid: false, error: `Tipo de arquivo não permitido (${mimeType || "desconhecido"}) — envie uma planilha Excel real.` };
  }

  return { valid: true, error: null };
}
