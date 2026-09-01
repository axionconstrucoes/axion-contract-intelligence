// "Anexos do Contrato" — tipos compartilhados entre a camada de dados
// (get-contract-attachments.ts, server) e os componentes client
// (contract-attachments-panel.tsx, use-contract-attachments.ts).
//
// Reaproveita document_version_files (migration 20260825010713) com
// file_role = 'ANEXO_CONTRATUAL' — nenhuma tabela nova.

export const CONTRACT_ATTACHMENT_FILE_ROLE = "ANEXO_CONTRATUAL" as const;

export type ContractAttachment = {
  id: string;
  documentVersionId: string;
  originalFileName: string;
  mimeType: string;
  fileSizeBytes: number;
  description: string | null;
  uploadedAt: string;
  uploadedByUserId: string | null;
  uploadedByUserName: string | null;
  storageBucket: string;
  storagePath: string;
};
