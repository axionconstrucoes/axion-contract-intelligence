import type { ContractClause } from "@axion/types";
import { DEV_PROJECT_ID } from "./constants";

export const clauses: ContractClause[] = [
  { id: "cls-arena-01", projectId: DEV_PROJECT_ID, documentId: "doc-arena-contrato", clauseNumber: "12.1", title: "Prazo de execução e força maior", text: "O prazo de execução poderá ser prorrogado mediante comprovação de eventos de força maior, incluindo condições climáticas excepcionais." },
  { id: "cls-arena-02", projectId: DEV_PROJECT_ID, documentId: "doc-arena-contrato", clauseNumber: "15.3", title: "Multa por atraso injustificado", text: "Atraso injustificado na entrega sujeita a contratada a multa de 0,1% do valor contratual por dia, limitada a 10%." },
  { id: "cls-arena-03", projectId: DEV_PROJECT_ID, documentId: "doc-arena-contrato", clauseNumber: "9.2", title: "Prazo de resposta a RFIs", text: "A contratada tem prazo de 10 dias úteis para responder formalmente a solicitações de informação (RFIs) do contratante." },
  { id: "cls-ind-01", projectId: "prj-industrial", documentId: "doc-ind-contrato", clauseNumber: "7.4", title: "Reajuste por variação cambial", text: "Equipamentos importados com valor unitário acima de US$ 50 mil estão sujeitos a reajuste por variação cambial comprovada." },
  { id: "cls-ind-02", projectId: "prj-industrial", documentId: "doc-ind-contrato", clauseNumber: "11.1", title: "Responsabilidade por condições de solo", text: "Divergências entre as condições reais de solo e o laudo de sondagem anexo ao edital são de responsabilidade do contratante." },
];
