import type { Alert } from "@axion/types";

/** Alertas derivados de eventos com aiAssessment ALTA/CRITICA. */
export const alerts: Alert[] = [
  { id: "alt-arena-01", projectId: "prj-arena", eventId: "evt-arena-01", severity: "ALTA", category: "NOTIFICACOES", title: "Notificação formal de atraso recebida do cliente", description: "Prazo de defesa em curso — resposta deve citar evento de força maior já registrado.", createdAt: "2025-06-25T08:35:00-03:00", acknowledged: true },
  { id: "alt-arena-02", projectId: "prj-arena", eventId: "evt-arena-03", severity: "CRITICA", category: "MULTAS", title: "Cobrança formal de multa contratual", description: "Cliente cobra multa por atraso; resposta fundamentada deve ser enviada no prazo contratual.", createdAt: "2025-12-15T16:05:00-03:00", acknowledged: false },
  { id: "alt-arena-03", projectId: "prj-arena", eventId: "evt-arena-04", severity: "ALTA", category: "PRAZO", title: "Paralisação por responsabilidade do cliente", description: "Falta de liberação de área pelo cliente fundamenta extensão de prazo sem ônus à Axion.", createdAt: "2026-01-20T08:50:00-03:00", acknowledged: false },
  { id: "alt-ind-01", projectId: "prj-industrial", eventId: "evt-ind-01", severity: "CRITICA", category: "ALTERACOES_PROJETO", title: "Condição de solo diverge do laudo de edital", description: "Responsabilidade do cliente; fundamenta pleito de custo e prazo adicionais.", createdAt: "2025-07-25T10:35:00-03:00", acknowledged: true },
  { id: "alt-ind-02", projectId: "prj-industrial", eventId: "evt-ind-05", severity: "MEDIA", category: "CLAIMS_CHANGE_ORDERS", title: "Possível change order — ampliação de estocagem", description: "Solicitação do cliente caracteriza change order formal; aditivo recomendado.", createdAt: "2026-06-26T10:05:00-03:00", acknowledged: false },
];
