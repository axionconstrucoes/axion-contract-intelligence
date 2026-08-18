import type { Email } from "@axion/types";
import { DEV_PROJECT_ID } from "./constants";

export const emails: Email[] = [
  { id: "em-arena-01", projectId: DEV_PROJECT_ID, from: "roberto.nunes@itaguai.rj.gov.br", to: "ana.souza@axion.com.br", subject: "Notificação de Atraso Contratual", date: "2025-06-25T08:30:00-03:00", snippet: "Notificamos formalmente o atraso identificado no cronograma e solicitamos plano de recuperação em até 5 dias úteis." },
  { id: "em-arena-02", projectId: DEV_PROJECT_ID, from: "roberto.nunes@itaguai.rj.gov.br", to: "fernanda.ribeiro@axion.com.br", subject: "Aplicação de Multa Contratual", date: "2025-12-15T16:00:00-03:00", snippet: "Em referência à notificação anterior, comunicamos a aplicação da multa prevista na cláusula 15.3 do contrato." },
  { id: "em-ind-01", projectId: "prj-industrial", from: "patricia.gomes@vetraria.com.br", to: "joao.alves@axion.com.br", subject: "Não Conformidade — Ensaio de Solda", date: "2025-10-17T08:30:00-03:00", snippet: "O ensaio de solda da estrutura metálica apresentou não conformidade. Solicitamos plano de ação corretiva em 5 dias úteis." },
  { id: "em-ind-02", projectId: "prj-industrial", from: "patricia.gomes@vetraria.com.br", to: "ana.souza@axion.com.br", subject: "Ampliação Área de Estocagem — Solicitação de Proposta", date: "2026-06-26T10:00:00-03:00", snippet: "Solicitamos proposta comercial para ampliação da área de estocagem, item fora do escopo original do contrato." },
  { id: "em-arena-03", projectId: DEV_PROJECT_ID, from: "ana.souza@axion.com.br", to: "roberto.nunes@itaguai.rj.gov.br", subject: "RE: Notificação de Atraso Contratual", date: "2025-07-02T11:00:00-03:00", snippet: "Em resposta, informamos que o atraso decorre de evento climático excepcional registrado em Diário de Obra, conforme cláusula 12.1." },
];
