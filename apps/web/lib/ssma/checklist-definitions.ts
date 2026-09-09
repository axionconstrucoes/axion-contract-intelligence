export type SsmaChecklistState = "FEITO" | "NA";

export type SsmaFieldDefinition = {
  id: string;
  label: string;
  placeholder?: string;
  type: "text" | "number" | "date" | "datetime-local" | "textarea" | "select";
  options?: readonly string[];
};

export type SsmaChecklistDefinition = {
  number: number;
  slug: string;
  title: string;
  shortTitle: string;
  driveFolder: string;
  independent?: boolean;
  fields: readonly SsmaFieldDefinition[];
  checks: readonly string[];
  photoActions: readonly string[];
};

export const SSMA_CHECKLISTS: readonly SsmaChecklistDefinition[] = [
  {
    number: 1,
    slug: "dda",
    title: "DDA",
    shortTitle: "DDA — Fotos",
    driveFolder: "01 - DIÁLOGO DIÁRIO DE SEGURANÇA - DDA (FOTOS)",
    fields: [
      { id: "tema", label: "Tema do diálogo", type: "text", placeholder: "Informe o tema do diálogo" },
      { id: "participantes", label: "Quantidade de participantes", type: "number", placeholder: "0" },
      { id: "observacoes", label: "Observações", type: "textarea", placeholder: "Observações opcionais" },
    ],
    checks: ["DDA realizado", "Registro dos participantes"],
    photoActions: ["Tirar foto"],
  },
  {
    number: 2,
    slug: "dds",
    title: "DDS",
    shortTitle: "DDS — Fotos",
    driveFolder: "02 - DIÁLOGO SEMANAL DE SEGURANÇA - DDS (FOTOS)",
    fields: [
      { id: "tema", label: "Tema do diálogo semanal", type: "text", placeholder: "Informe o tema do diálogo" },
      { id: "participantes", label: "Quantidade de participantes", type: "number", placeholder: "0" },
      { id: "observacoes", label: "Observações", type: "textarea", placeholder: "Observações opcionais" },
    ],
    checks: ["DDS realizado", "Registro dos participantes"],
    photoActions: ["Tirar foto"],
  },
  {
    number: 3,
    slug: "fotos-diarias",
    title: "Fotos diárias de segurança",
    shortTitle: "Fotos diárias",
    driveFolder: "03 - FOTOS DIÁRIAS DE SEGURANÇA",
    fields: [
      { id: "local", label: "Local da foto", type: "text", placeholder: "Informe o local" },
      {
        id: "categoria",
        label: "Categoria",
        type: "select",
        options: ["Condição segura", "Condição de risco", "EPI", "Sinalização", "Organização"],
      },
      { id: "descricao", label: "Descrição", type: "textarea", placeholder: "Descreva o registro" },
    ],
    checks: ["Condição registrada"],
    photoActions: ["Tirar foto"],
  },
  {
    number: 4,
    slug: "apr",
    title: "APR — Análise preliminar de risco",
    shortTitle: "APR",
    driveFolder: "04 - ANÁLISE PRELIMINAR DE RISCO - APR",
    fields: [
      { id: "atividade", label: "Descrição da atividade", type: "text", placeholder: "Informe a atividade" },
      { id: "local", label: "Local da atividade", type: "text", placeholder: "Informe o local" },
      { id: "empresa", label: "Empresa executora", type: "text", placeholder: "Informe a empresa" },
      { id: "responsavel", label: "Responsável pela atividade", type: "text", placeholder: "Informe o responsável" },
    ],
    checks: ["Trabalho em altura", "Eletricidade", "Movimentação de cargas"],
    photoActions: ["Anexar foto"],
  },
  {
    number: 5,
    slug: "pt",
    title: "Permissão de trabalho — PT",
    shortTitle: "PT",
    driveFolder: "05 - PERMISSÃO DE TRABALHO - PT",
    fields: [
      { id: "numero", label: "Número da PT", type: "text", placeholder: "PT-00000" },
      { id: "atividade", label: "Atividade", type: "text", placeholder: "Informe a atividade" },
      { id: "local", label: "Local", type: "text", placeholder: "Informe o local" },
      { id: "empresa", label: "Empresa executora", type: "text", placeholder: "Informe a empresa" },
      { id: "validade", label: "Validade", type: "datetime-local" },
    ],
    checks: ["Área isolada", "EPI verificado", "Equipamentos inspecionados"],
    photoActions: ["Anexar foto"],
  },
  {
    number: 6,
    slug: "integracao",
    title: "Lista de integração",
    shortTitle: "Lista de integração",
    driveFolder: "06 - LISTA DE INTEGRAÇÃO",
    fields: [
      { id: "empresa", label: "Empresa do trabalhador", type: "text", placeholder: "Informe a empresa" },
      { id: "trabalhador", label: "Nome do trabalhador", type: "text", placeholder: "Informe o nome" },
      { id: "funcao", label: "Função", type: "text", placeholder: "Informe a função" },
      { id: "documento", label: "Documento", type: "text", placeholder: "CPF ou documento" },
      { id: "instrutor", label: "Instrutor", type: "text", placeholder: "Informe o instrutor" },
    ],
    checks: ["Normas de segurança", "Uso de EPI", "Riscos da obra"],
    photoActions: ["Anexar foto da lista", "Capturar assinatura"],
  },
  {
    number: 7,
    slug: "almoxarifado",
    title: "Organização do almoxarifado",
    shortTitle: "Almoxarifado",
    driveFolder: "08 - ORGANIZAÇÃO DO ALMOXARIFADO",
    fields: [
      { id: "area", label: "Área inspecionada", type: "text", placeholder: "Informe a área" },
      { id: "responsavel", label: "Responsável pelo almoxarifado", type: "text", placeholder: "Informe o responsável" },
      { id: "observacoes", label: "Observações", type: "textarea", placeholder: "Observações opcionais" },
    ],
    checks: [
      "Materiais identificados",
      "Empilhamento seguro",
      "Corredores desobstruídos",
      "Produtos químicos segregados",
      "Extintores acessíveis",
    ],
    photoActions: ["Tirar foto"],
  },
  {
    number: 8,
    slug: "riscos-apontados",
    title: "Riscos apontados",
    shortTitle: "Riscos apontados",
    driveFolder: "09 - RISCOS APONTADOS",
    fields: [
      { id: "local", label: "Local do risco", type: "text", placeholder: "Informe o local" },
      { id: "descricao", label: "Descrição do risco", type: "textarea", placeholder: "Descreva o risco" },
      { id: "acao", label: "Ação imediata adotada", type: "textarea", placeholder: "Informe a ação adotada" },
      { id: "responsavel", label: "Responsável pela correção", type: "text", placeholder: "Informe o responsável" },
      { id: "prazo", label: "Prazo", type: "date" },
    ],
    checks: ["Área sinalizada"],
    photoActions: ["Tirar foto"],
  },
  {
    number: 9,
    slug: "limpeza",
    title: "Limpeza da obra",
    shortTitle: "Limpeza da obra",
    driveFolder: "10 - LIMPEZA DA OBRA",
    fields: [
      { id: "area", label: "Área inspecionada", type: "text", placeholder: "Informe a área" },
      { id: "observacoes", label: "Observações", type: "textarea", placeholder: "Observações opcionais" },
    ],
    checks: [
      "Resíduos recolhidos",
      "Rotas desobstruídas",
      "Materiais organizados",
      "Coleta seletiva realizada",
      "Área sem materiais cortantes",
    ],
    photoActions: ["Foto antes", "Foto depois"],
  },
  {
    number: 10,
    slug: "outros",
    title: "Outros registros",
    shortTitle: "Outros",
    driveFolder: "11 - OUTROS",
    fields: [
      { id: "titulo", label: "Título do registro", type: "text", placeholder: "Informe o título" },
      { id: "categoria", label: "Categoria", type: "text", placeholder: "Informe a categoria" },
      { id: "local", label: "Local", type: "text", placeholder: "Informe o local" },
      { id: "descricao", label: "Descrição", type: "textarea", placeholder: "Descreva o registro" },
    ],
    checks: ["Registro conferido"],
    photoActions: ["Tirar foto"],
  },
  {
    number: 11,
    slug: "remessa-bota-fora",
    title: "Remessa para bota-fora",
    shortTitle: "Remessa para bota-fora",
    driveFolder: "07 - REMESSAS PARA BOTA-FORA",
    independent: true,
    fields: [
      { id: "residuo", label: "Tipo de resíduo", type: "text", placeholder: "Informe o resíduo" },
      { id: "quantidade", label: "Quantidade estimada", type: "number", placeholder: "0" },
      { id: "unidade", label: "Unidade", type: "select", options: ["m³", "t", "kg", "caçamba", "viagem"] },
      { id: "transportadora", label: "Transportadora", type: "text", placeholder: "Informe a transportadora" },
      { id: "motorista", label: "Motorista", type: "text", placeholder: "Informe o motorista" },
      { id: "placa", label: "Placa do veículo", type: "text", placeholder: "ABC1D23" },
      { id: "destino", label: "Destino autorizado", type: "text", placeholder: "Informe o destino" },
      { id: "comprovante", label: "Número do MTR ou comprovante", type: "text", placeholder: "Informe o número" },
    ],
    checks: ["Carga conferida", "Destino autorizado"],
    photoActions: ["Foto da carga", "Anexar comprovante"],
  },
] as const;

export const SSMA_RISK_LEVELS = [
  { value: "BAIXA", label: "Baixo", className: "bg-[#166534] text-white" },
  { value: "MEDIA", label: "Médio", className: "bg-[#2563EB] text-white" },
  { value: "ALTA", label: "Alto", className: "bg-[#FFD600] text-black" },
  { value: "CRITICA", label: "Crítico", className: "bg-[#DC2626] text-white" },
] as const;
