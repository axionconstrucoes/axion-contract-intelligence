import type { IntegrationConfig, SourceDefinition } from "@axion/types";

export const sourceDefinitions: SourceDefinition[] = [
  {
    type: "EMAIL",
    label: "E-mail Corporativo (Google Workspace)",
    description: "E-mails selecionados trocados com o cliente e demais partes interessadas.",
  },
  {
    type: "DIARIO_OBRA",
    label: "Diário de Obra",
    description: "Registros diários de obra, consumidos via API do Diário de Obra.",
  },
  {
    type: "CONSTRUMANAGER",
    label: "Construmanager",
    description: "Projetos técnicos, revisões e logs por data/usuário via API do Construmanager.",
  },
  {
    type: "CONTRATO",
    label: "Contrato e Aditivos",
    description: "Contrato-base, aditivos e demais documentos comerciais.",
  },
  {
    type: "GOOGLE_DRIVE",
    label: "Google Drive do Projeto",
    description: "Arquivos armazenados no Google Drive do projeto.",
  },
  {
    type: "RECEBIDOS_CLIENTE",
    label: "01_RECEBIDOS CLIENTE",
    description: "Pasta e subpastas de documentos recebidos diretamente do cliente.",
  },
  {
    type: "EDITAL_RFI_RFP",
    label: "Edital, RFI, RFP e Clarificações",
    description: "Edital, RFI, RFP, especificações, desenhos, planilhas e clarificações recebidas do cliente.",
  },
  {
    type: "CRONOGRAMA",
    label: "Cronograma",
    description: "Cronograma baseline e revisões subsequentes.",
  },
  {
    type: "RELATORIO_SEMANAL",
    label: "Relatórios Semanais",
    description: "Relatórios semanais de acompanhamento da obra.",
  },
  {
    type: "ERP",
    label: "ERP",
    description: "Sistema ERP corporativo (notas fiscais, lançamentos, contratos de fornecedores).",
  },
  {
    type: "ORCAMENTO",
    label: "Orçamento e Propostas",
    description: "Sistema de orçamento e revisões de proposta comercial.",
  },
];

/** Status mock das integrações — nenhuma credencial real é usada nesta fase. */
export const integrationConfigs: IntegrationConfig[] = [
  { sourceType: "EMAIL", status: "CONECTADO", lastSyncAt: "2026-08-14T07:00:00-03:00", detail: "Sincronização de caixas selecionadas via Google Workspace." },
  { sourceType: "DIARIO_OBRA", status: "CONECTADO", lastSyncAt: "2026-08-14T06:30:00-03:00", detail: "API do Diário de Obra — sincronização diária às 06h30." },
  { sourceType: "CONSTRUMANAGER", status: "CONECTADO", lastSyncAt: "2026-08-13T22:00:00-03:00", detail: "Ingestão de projetos, revisões e logs por usuário." },
  { sourceType: "CONTRATO", status: "CONECTADO", lastSyncAt: "2026-08-10T09:00:00-03:00", detail: "Repositório de contratos e aditivos monitorado manualmente pela equipe jurídica." },
  { sourceType: "GOOGLE_DRIVE", status: "CONECTADO", lastSyncAt: "2026-08-14T05:45:00-03:00", detail: "Monitoramento de pastas de projeto no Google Drive." },
  { sourceType: "RECEBIDOS_CLIENTE", status: "CONECTADO", lastSyncAt: "2026-08-14T05:45:00-03:00", detail: "Monitoramento da pasta 01_RECEBIDOS CLIENTE e subpastas." },
  { sourceType: "EDITAL_RFI_RFP", status: "PENDENTE", lastSyncAt: "2026-08-05T10:00:00-03:00", detail: "Aguardando padronização de nomenclatura de RFIs para ingestão automática." },
  { sourceType: "CRONOGRAMA", status: "CONECTADO", lastSyncAt: "2026-08-12T18:00:00-03:00", detail: "Importação de cronograma baseline e revisões." },
  { sourceType: "RELATORIO_SEMANAL", status: "CONECTADO", lastSyncAt: "2026-08-11T08:00:00-03:00", detail: "Ingestão de relatórios semanais em PDF." },
  { sourceType: "ERP", status: "ERRO", lastSyncAt: "2026-08-09T13:00:00-03:00", detail: "Falha de autenticação com o ERP corporativo — credencial expirada, aguardando renovação de acesso." },
  { sourceType: "ORCAMENTO", status: "PENDENTE", lastSyncAt: null, detail: "Integração com o sistema de orçamento ainda não configurada nesta fase." },
];
