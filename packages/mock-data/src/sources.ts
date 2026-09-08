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
    type: "ERP",
    label: "ERP",
    description: "Sistema ERP corporativo (notas fiscais, lançamentos, contratos de fornecedores).",
  },
  {
    type: "ESG_SSMA",
    label: "ESG / SSMA",
    description:
      "Única fonte do Google Drive usada pelo ACC: registros, evidências e documentos de segurança, saúde, meio ambiente e obrigações ESG/SSMA do projeto.",
  },
];

const NO_ORIGIN = {
  externalSystemReference: null,
  externalProjectReference: null,
  accountReference: null,
  folderReference: null,
  fileReference: null,
  responsibleReference: null,
  driveType: null,
} as const;

/** Status mock das integrações — nenhuma credencial real é usada nesta fase. */
export const integrationConfigs: IntegrationConfig[] = [
  { sourceType: "EMAIL", status: "CONECTADO", lastSyncAt: "2026-08-14T07:00:00-03:00", detail: "Sincronização de caixas selecionadas via Google Workspace.", ...NO_ORIGIN },
  { sourceType: "DIARIO_OBRA", status: "CONECTADO", lastSyncAt: "2026-08-14T06:30:00-03:00", detail: "API do Diário de Obra — sincronização diária às 06h30.", ...NO_ORIGIN },
  { sourceType: "CONSTRUMANAGER", status: "CONECTADO", lastSyncAt: "2026-08-13T22:00:00-03:00", detail: "Ingestão de projetos, revisões e logs por usuário.", ...NO_ORIGIN },
  { sourceType: "ERP", status: "ERRO", lastSyncAt: "2026-08-09T13:00:00-03:00", detail: "Falha de autenticação com o ERP corporativo — credencial expirada, aguardando renovação de acesso.", ...NO_ORIGIN },
  { sourceType: "ESG_SSMA", status: "PENDENTE", lastSyncAt: null, detail: "Aguardando configuração da pasta SSMA-ESG do projeto no Drive compartilhado.", ...NO_ORIGIN },
];
