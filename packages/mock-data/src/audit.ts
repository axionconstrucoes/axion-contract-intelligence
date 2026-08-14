import type { AuditLogEntry } from "@axion/types";

export const auditLog: AuditLogEntry[] = [
  { id: "aud-01", projectId: "prj-arena", timestamp: "2025-06-25T08:36:00-03:00", actor: "sistema", action: "Evento criado no Event Ledger", entityType: "ContractEvent", entityId: "evt-arena-01", detail: "Ingestão automática via fonte EMAIL." },
  { id: "aud-02", projectId: "prj-arena", timestamp: "2025-06-25T09:10:00-03:00", actor: "usr-fernanda", action: "Status do evento atualizado para EM_ANALISE", entityType: "ContractEvent", entityId: "evt-arena-01", detail: "Revisão iniciada pela coordenação de contratos." },
  { id: "aud-03", projectId: "prj-arena", timestamp: "2025-12-15T16:10:00-03:00", actor: "usr-ana", action: "Alerta reconhecido", entityType: "Alert", entityId: "alt-arena-02", detail: "Alerta de multa contratual marcado como em tratamento." },
  { id: "aud-04", projectId: "prj-industrial", timestamp: "2025-07-25T10:40:00-03:00", actor: "usr-fernanda", action: "Referência cruzada adicionada", entityType: "ContractEvent", entityId: "evt-ind-01", detail: "Vinculação com cláusula 11.1 do contrato." },
  { id: "aud-05", projectId: "prj-industrial", timestamp: "2026-08-13T22:05:00-03:00", actor: "sistema", action: "Sincronização de integração concluída", entityType: "Integration", entityId: "CONSTRUMANAGER", detail: "Sincronização periódica sem erros." },
  { id: "aud-06", projectId: "prj-arena", timestamp: "2026-08-10T09:00:00-03:00", actor: "usr-ana", action: "Permissão de projeto concedida", entityType: "ProjectMembership", entityId: "usr-roberto", detail: "Acesso VIEWER concedido ao fiscal do cliente." },
];
