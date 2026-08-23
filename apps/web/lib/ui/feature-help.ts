// Fonte única de conteúdo da ajuda contextual ⓘ do ACC — nunca
// espalhar texto explicativo hardcoded por páginas/componentes. Todo
// consumo deve passar por FeatureInfo (components/shared/feature-info.tsx),
// referenciando um destes `id`s como `helpId`.
//
// Puro, sem I/O, sem JSX — deliberadamente sem "server-only" para ser
// testável tanto pelo bundler do Next.js quanto por um script Node
// standalone (mesmo padrão de apps/web/lib/ai/expert-definitions/).

export interface FeatureHelpDefinition {
  id: string;
  title: string;
  shortDescription: string;
  description: string;
  uses?: string[];
  result?: string;
  humanReview?: string;
}

const DEFINITIONS: FeatureHelpDefinition[] = [
  // ---------- Seção 7 — navegação principal (sidebar) ----------
  {
    id: "dashboard",
    title: "Dashboard",
    shortDescription: "Visão executiva do contrato e dos principais riscos.",
    description:
      "Consolida a situação atual do projeto, alertas, riscos, pendências, ações e análises dos Experts IA. É a visão rápida para identificar o que necessita atenção.",
  },
  {
    id: "timeline",
    title: "Timeline",
    shortDescription: "Histórico cronológico contratual e jurídico do projeto.",
    description:
      "Organiza acontecimentos relevantes desde o início real da obra, incluindo documentos, e-mails, eventos, aprovações e evidências. O Timeline preserva o histórico anterior ao início operacional do ACC.",
  },
  {
    id: "event-ledger",
    title: "Event Ledger",
    shortDescription: "Registro estruturado dos eventos relevantes do contrato.",
    description:
      "Mantém os acontecimentos relevantes identificados no projeto, com origem, evidência, impacto, classificação e rastreabilidade.",
  },
  {
    id: "solicitacoes",
    title: "Solicitações",
    shortDescription: "Pedidos de informação, documentação ou providências.",
    description:
      "Permite registrar e acompanhar solicitações direcionadas às áreas e responsáveis da AXION relacionadas ao contrato ou à obra.",
  },
  {
    id: "acoes-escalonamentos",
    title: "Ações e Escalonamentos",
    shortDescription: "Providências, responsáveis, prazos e SLA.",
    description:
      "Acompanha ações criadas a partir de riscos, findings, solicitações e decisões humanas, incluindo responsável, prazo, SLA e eventual escalonamento.",
  },
  {
    id: "analise-contratual",
    title: "Análise Contratual",
    shortDescription: "Visão geral das condições e riscos do contrato.",
    description:
      "Analisa contrato e documentos associados em nível macro, destacando obrigações, condições comerciais, prazos, responsabilidades e riscos.",
  },
  {
    id: "analise-clausulas",
    title: "Análise de Cláusulas",
    shortDescription: "Análise detalhada cláusula por cláusula.",
    description:
      "Permite examinar cláusulas individualmente e relacioná-las com eventos, documentos, e-mails e evidências da execução da obra.",
  },
  {
    id: "documentos",
    title: "Documentos",
    shortDescription: "Repositório documental e de evidências do projeto.",
    description:
      "Organiza contratos, aditivos, propostas, cronogramas, projetos, notificações e demais documentos, preservando origem, versão, processamento e rastreabilidade.",
  },
  {
    id: "adicionais",
    title: "Adicionais",
    shortDescription: "Controle das propostas e possíveis serviços adicionais.",
    description:
      "Acompanha possíveis adicionais desde a solicitação do cliente até orçamento, proposta, negociação, contratação, documentação, execução e impacto de prazo.",
    uses: [
      "O que o cliente solicitou",
      "O que o cliente forneceu",
      "O que a AXION orçou",
      "O que a AXION propôs",
      "O que o cliente aprovou",
      "O contrato-base",
      "O cronograma",
    ],
    result: "O ACC pode confrontar essas fontes entre si para identificar compatibilidade, exigência adicional ou conflito.",
    humanReview: "A IA analisa e recomenda. A contratação é sempre decisão humana.",
  },
  {
    id: "esg-ssma",
    title: "ESG/SSMA",
    shortDescription: "Obrigações ESG e SSMA com impacto contratual.",
    description:
      "Monitora requisitos ambientais, sociais, de segurança e saúde com consequência contratual, documental ou econômica.",
  },
  {
    id: "experts-ia",
    title: "Experts IA",
    shortDescription: "Especialistas Claude responsáveis pela curadoria do projeto.",
    description:
      "Centraliza os agentes especialistas do ACC. Eles analisam informações, detectam divergências, identificam riscos e produzem recomendações.",
    humanReview: "A IA analisa e recomenda. Decisões vinculantes permanecem humanas.",
  },
  {
    id: "startup-acc",
    title: "Start-up ACC",
    shortDescription: "Validação dos riscos históricos antes da operação normal.",
    description:
      "Analisa o histórico desde o início real da obra e apresenta os riscos Alto e Crítico anteriores ao início operacional do ACC.",
    uses: ["Desconsiderar", "Já tratado / pacificado", "Cuidar deste assunto"],
    result: "Isso evita novos alertas sobre fatos históricos já resolvidos.",
  },
  {
    id: "integracoes",
    title: "Integrações",
    shortDescription: "Conexões do ACC com fontes externas.",
    description: "Mostra e gerencia fontes externas utilizadas pelo projeto, como Gmail, Google Drive e demais integrações disponíveis.",
  },
  {
    id: "usuarios",
    title: "Usuários",
    shortDescription: "Controle de acesso e permissões do projeto.",
    description:
      "Gerencia os usuários autorizados, suas áreas, funções e permissões. Participar de um e-mail ou comunicação não concede acesso ao ACC.",
  },
  {
    id: "auditoria",
    title: "Auditoria",
    shortDescription: "Histórico rastreável das ações realizadas no ACC.",
    description:
      "Registra quem realizou ações relevantes, quando ocorreram e quais informações foram afetadas, preservando governança e rastreabilidade.",
  },

  // ---------- Seção 8 — Experts individuais ----------
  {
    id: "expert-ceo",
    title: "CEO IA",
    shortDescription: "Consolida as demais análises e prioriza decisões executivas.",
    description: "Consolida as análises dos demais especialistas, identifica exposição acumulada e ajuda a priorizar decisões executivas.",
    humanReview: "A IA analisa e recomenda. Decisões vinculantes permanecem humanas.",
  },
  {
    id: "expert-commercial-director",
    title: "Diretor Comercial IA",
    shortDescription: "Analisa propostas, valores e condições comerciais.",
    description: "Analisa propostas, valores, negociação, condições comerciais, aprovações e exposição econômica.",
    humanReview: "A IA analisa e recomenda. Decisões vinculantes permanecem humanas.",
  },
  {
    id: "expert-legal-consultant",
    title: "Consultor Jurídico IA",
    shortDescription: "Analisa obrigações contratuais e consequências jurídicas.",
    description: "Analisa obrigações contratuais, formalização, conflitos, precedência documental, notificações e consequências jurídicas.",
    humanReview: "A IA analisa e recomenda. Decisões vinculantes permanecem humanas.",
  },
  {
    id: "expert-planning-director",
    title: "Diretor de Planejamento IA",
    shortDescription: "Analisa atrasos, antecipações e impactos de prazo.",
    description: "Analisa atrasos, antecipações e impactos de prazo com consequência comercial, econômica ou contratual.",
    humanReview: "A IA analisa e recomenda. Decisões vinculantes permanecem humanas.",
  },
  {
    id: "expert-esg-director",
    title: "Diretor de ESG IA",
    shortDescription: "Analisa obrigações ESG e SSMA com impacto contratual.",
    description: "Analisa obrigações ESG e SSMA com impacto contratual, econômico ou documental.",
    humanReview: "A IA analisa e recomenda. Decisões vinculantes permanecem humanas.",
  },

  // ---------- Seção 9 — Start-up (ajuda interna) ----------
  {
    id: "startup-project-start-date",
    title: "Data de início da obra",
    shortDescription: "Define o início histórico da obra — não o início do ACC.",
    description: "Define o início histórico da obra e NÃO o início do ACC.",
  },
  {
    id: "startup-acc-operational-start-date",
    title: "Data de início operacional ACC",
    shortDescription: "Define quando começa o acompanhamento prospectivo.",
    description: "Define quando começa o acompanhamento prospectivo; não corta Timeline nem histórico.",
  },
  {
    id: "startup-dismiss",
    title: "Desconsiderar",
    shortDescription: "Encerra o finding no Start-up, com justificativa.",
    description: "Encerra este finding no Start-up mediante justificativa, sem apagar o fato histórico.",
  },
  {
    id: "startup-resolve",
    title: "Já tratado / pacificado",
    shortDescription: "A situação existiu, mas já foi resolvida.",
    description: "Indica que a situação existiu, mas foi resolvida antes da entrada operacional do ACC.",
  },
  {
    id: "startup-create-action",
    title: "Cuidar deste assunto",
    shortDescription: "Transforma o finding histórico em ação ativa.",
    description: "Transforma o finding histórico em ação ativa, com responsável AXION, prazo e acompanhamento por SLA.",
  },
  {
    id: "startup-complete",
    title: "Concluir Start-up",
    shortDescription: "Finaliza a validação histórica.",
    description: "Finaliza a validação histórica quando todos os riscos Alto e Crítico tiverem recebido uma decisão humana.",
  },

  // ---------- Seção 10 — Adicionais (ajuda interna) ----------
  {
    id: "adicionais-nova-proposta",
    title: "Nova proposta de adicional",
    shortDescription: "Cadastra ou vincula uma possível proposta.",
    description: "Cadastra ou vincula uma possível proposta adicional ao projeto.",
  },
  {
    id: "adicionais-marcar-contratado",
    title: "Marcar como Contratado",
    shortDescription: "Registra uma contratação já decidida por uma pessoa.",
    description: "Registra uma contratação já decidida por uma pessoa. A IA não pode executar esta ação.",
  },
  {
    id: "adicionais-formalizacao",
    title: "Formalização",
    shortDescription: "Como a aprovação foi documentada.",
    description: "Indica como a aprovação do adicional foi documentada: e-mail, PO, aditivo, ordem de serviço ou outro meio.",
  },
  {
    id: "adicionais-status-prazo",
    title: "Status de prazo",
    shortDescription: "Independente da contratação comercial.",
    description: "É independente da contratação comercial. Um adicional contratado não significa automaticamente que extensão de prazo foi aprovada.",
  },
  {
    id: "adicionais-documentacao",
    title: "Documentação",
    shortDescription: "Documentos existentes e pendências de comprovação.",
    description: "Mostra os documentos existentes e o que ainda falta para comprovar e acompanhar a contratação.",
  },

  // ---------- Seção 11 — Risco ----------
  {
    id: "risco-baixo",
    title: "Baixo",
    shortDescription: "Impacto limitado; acompanhamento de rotina.",
    description: "Impacto limitado; acompanhamento de rotina.",
  },
  {
    id: "risco-medio",
    title: "Médio",
    shortDescription: "Exige atenção e acompanhamento.",
    description: "Exige atenção e acompanhamento.",
  },
  {
    id: "risco-alto",
    title: "Alto",
    shortDescription: "Pode gerar impacto contratual, econômico ou operacional relevante.",
    description: "Pode gerar impacto contratual, econômico ou operacional relevante.",
  },
  {
    id: "risco-critico",
    title: "Crítico",
    shortDescription: "Pode gerar consequência grave e exige atenção prioritária.",
    description: "Pode gerar consequência grave e exige atenção prioritária.",
  },

  // ---------- Seção 12 — abas internas: Ações e Escalonamentos ----------
  {
    id: "acoes-tab-abertas",
    title: "Ações abertas",
    shortDescription: "Ações e escalonamentos ainda em andamento.",
    description:
      "Lista as ações com prazo de SLA em curso, com responsável, prazo e escalonamento (quando acionado).",
    humanReview: "A execução e o encerramento da ação são sempre decisão humana.",
  },
  {
    id: "acoes-tab-gerencial",
    title: "Visão gerencial",
    shortDescription: "Panorama consolidado das ações por área e responsável.",
    description:
      "Consolida as ações abertas e concluídas por área, responsável e status de SLA, para leitura gerencial rápida.",
  },
  {
    id: "acoes-tab-historico",
    title: "Histórico",
    shortDescription: "Ações já concluídas ou canceladas.",
    description:
      "Mantém o registro das ações finalizadas (concluídas ou canceladas), preservando a rastreabilidade do que já foi tratado.",
  },
  {
    id: "acoes-tab-nova",
    title: "Nova ação",
    shortDescription: "Cria manualmente uma ação com prazo de SLA.",
    description: "Permite registrar manualmente uma nova ação vinculada a este projeto, com área, responsável e prazo de SLA.",
    humanReview: "A criação manual de uma ação é sempre decisão humana. Findings de IA também podem gerar ações automaticamente.",
  },
  {
    id: "sla-config-timezone",
    title: "Timezone e horário útil",
    shortDescription: "Base de cálculo dos prazos de SLA deste projeto.",
    description:
      "Define o fuso horário e o horário comercial usados para calcular os prazos de SLA deste projeto, sobrescrevendo o default do sistema.",
  },
  {
    id: "sla-config-matriz-prazos",
    title: "Prazos por nível de risco",
    shortDescription: "Prazos de SLA para cada nível de risco.",
    description:
      "Configura, por nível de risco (Baixo/Médio/Alto/Crítico), o prazo interno de SLA aplicável neste projeto, sobrescrevendo os defaults padrão.",
  },
  {
    id: "sla-config-responsaveis",
    title: "Responsáveis por área e escalão",
    shortDescription: "Quem recebe a ação e o escalonamento em cada área.",
    description:
      "Define, por área, quem é o responsável direto e quem recebe o escalonamento (1º escalão, 2º escalão e diretoria) quando o SLA não é cumprido.",
  },

  // ---------- Seção 12 — abas internas: ESG/SSMA ----------
  {
    id: "esg-tab-pendencias",
    title: "Minhas pendências",
    shortDescription: "Obrigações ESG/SSMA aguardando comprovação.",
    description:
      "Lista as obrigações ESG/SSMA pendentes, vencidas ou parcialmente cumpridas que ainda precisam de comprovação.",
  },
  {
    id: "esg-tab-gerencial",
    title: "Visão gerencial ESG",
    shortDescription: "Panorama de status e risco por obrigação.",
    description: "Consolida o status mais recente e o nível de risco de cada obrigação ESG/SSMA do projeto.",
  },
  {
    id: "esg-tab-checklist",
    title: "Checklist do projeto",
    shortDescription: "Todas as obrigações ESG/SSMA cadastradas e seu histórico.",
    description:
      "Mostra cada obrigação com cláusula/fonte de origem, comprovações registradas, evidências anexadas e revisão. Permite cadastrar novas obrigações, registrar comprovação e revisar submissões, conforme a permissão do usuário.",
    humanReview: "O cadastro, a comprovação e a revisão são sempre realizados por uma pessoa.",
  },
  {
    id: "esg-tab-consultar",
    title: "Diretor de ESG IA",
    shortDescription: "Consulta ao especialista de ESG/SSMA.",
    description: "Permite perguntar ao Diretor de ESG IA sobre obrigações, riscos e pendências deste projeto.",
    humanReview: "A IA responde com base nos dados do projeto; a decisão final permanece humana.",
  },

  // ---------- Seção 12 — abas internas: Documentos ----------
  {
    id: "documentos-tab-documentos",
    title: "Documentos",
    shortDescription: "Arquivos do projeto e suas versões.",
    description:
      "Lista contratos, aditivos, propostas e demais documentos do projeto, com suas versões, status de processamento e origem. Permite enviar novos documentos e novas versões.",
  },
  {
    id: "documentos-tab-clausulas",
    title: "Cláusulas",
    shortDescription: "Cláusulas contratuais cadastradas.",
    description: "Lista as cláusulas contratuais já aprovadas e cadastradas para este projeto.",
  },
  {
    id: "documentos-tab-cronograma",
    title: "Cronograma",
    shortDescription: "Atividades do cronograma e seus prazos.",
    description: "Mostra as atividades do cronograma do projeto, comparando as datas baseline com as datas atuais.",
  },

  // ---------- Seção 12 — abas internas: Adicionais ----------
  {
    id: "adicionais-tab-propostas",
    title: "Propostas",
    shortDescription: "Todas as propostas de adicionais do projeto.",
    description: "Lista as propostas de adicionais já cadastradas, com status, título e data.",
  },

  // ---------- Anexos de E-mail (aba de Documentos) ----------
  {
    id: "documentos-tab-anexos-email",
    title: "Anexos de E-mail",
    shortDescription: "Arquivos recebidos como anexos dos e-mails do projeto.",
    description:
      "Mostra os arquivos encontrados nos e-mails do projeto e identifica quais foram processados pelo ACC e quais efetivamente participaram das análises dos Experts IA. Cada arquivo preserva vínculo com o e-mail original e com eventuais findings ou documentos do ACC.",
  },
  {
    id: "anexos-considerado",
    title: "Considerado pelo ACC",
    shortDescription: "O conteúdo foi efetivamente usado numa análise do ACC.",
    description: "Indica que o conteúdo deste arquivo foi efetivamente utilizado como fonte em uma análise ou finding do ACC.",
  },
  {
    id: "anexos-incorporado",
    title: "Incorporado aos Documentos",
    shortDescription: "O arquivo também virou um documento formal do projeto.",
    description: "Indica que o arquivo também foi classificado e incorporado ao repositório documental formal do projeto.",
  },

  // ---------- Ingestão Controlada de E-mails (Integrações) ----------
  {
    id: "gmail-add-account",
    title: "Adicionar conta AXION",
    shortDescription: "Registra uma conta @axion.com.br autorizada.",
    description:
      "Registra uma conta de e-mail @axion.com.br como conta AXION autorizada a ser monitorada pelo ACC. Somente contas @axion.com.br podem ser registradas — nunca contas pessoais ou de outro domínio.",
    humanReview: "Registrar a conta é sempre uma decisão humana (ADMIN); nenhuma senha ou token é solicitado nesta tela.",
  },
  {
    id: "gmail-account-connected",
    title: "Conta conectada",
    shortDescription: "Conta autorizada e pronta para ser usada em projetos.",
    description:
      "Indica que esta conta AXION está registrada e autorizada. O ACC nunca armazena a senha nem exibe tokens de acesso — a credencial de acesso ao Gmail é administrada separadamente, fora da interface.",
  },
  {
    id: "gmail-client-domain",
    title: "Domínio do cliente",
    shortDescription: "Domínio de e-mail usado para reconhecer mensagens do cliente.",
    description:
      "Define o domínio de e-mail do cliente deste projeto. Junto com os participantes cadastrados, delimita quais mensagens são consideradas relacionadas ao projeto — conectar uma conta nunca significa importar a caixa inteira.",
  },
  {
    id: "gmail-participants",
    title: "Participantes",
    shortDescription: "Pessoas específicas cujas mensagens são consideradas.",
    description:
      "Endereços específicos autorizados a serem considerados na ingestão deste projeto, além do domínio do cliente — útil para consultores externos ou contatos individuais.",
  },
  {
    id: "gmail-ingestion-period",
    title: "Período de ingestão",
    shortDescription: "Janela temporal considerada na sincronização.",
    description:
      "Define desde quando o ACC procura mensagens relacionadas a este projeto: desde o início da obra, a partir de agora, ou um período personalizado. A data final histórica nunca ultrapassa o momento atual.",
  },
  {
    id: "gmail-include-attachments",
    title: "Incluir anexos",
    shortDescription: "Também ingerir os arquivos anexados às mensagens.",
    description:
      "Quando ativado, os anexos das mensagens elegíveis também são ingeridos e aparecem em Documentos → Anexos de E-mail, com a mesma proveniência e diferenciação processado/considerado.",
  },
  {
    id: "gmail-incremental-sync",
    title: "Sincronização incremental",
    shortDescription: "Depois da carga inicial, só o que é novo é buscado.",
    description:
      "Após a primeira sincronização, as próximas execuções buscam apenas mensagens novas — nunca reimportam a caixa inteira, e a mesma mensagem nunca é duplicada.",
  },
  {
    id: "gmail-sync-progress",
    title: "Progresso da sincronização",
    shortDescription: "Percentual real, calculado a partir de unidades já processadas.",
    description:
      "Mostra o andamento real da sincronização — nunca uma estimativa baseada em tempo decorrido. Enquanto o total de mensagens ainda não é conhecido, o estado mostrado é \"Preparando...\".",
  },

  // ---------- Seção 13 — campos complexos adicionais ----------
  {
    id: "finding",
    title: "Finding",
    shortDescription: "Achado produzido pela curadoria de IA.",
    description:
      "Um finding é um achado estruturado produzido pela curadoria de IA (fatos, interpretação, risco e recomendação), sempre rastreável até sua fonte original.",
    humanReview: "Todo finding exige revisão humana — a IA nunca decide sozinha.",
  },
  {
    id: "sla",
    title: "SLA",
    shortDescription: "Prazo interno de resposta/conclusão de uma ação.",
    description:
      "O SLA define os prazos internos para assumir, responder e concluir uma ação, com escalonamento automático quando o prazo não é cumprido.",
  },
];

export const ACC_FEATURE_HELP: Record<string, FeatureHelpDefinition> = Object.fromEntries(
  DEFINITIONS.map((definition) => [definition.id, definition])
);

export function getFeatureHelp(helpId: string): FeatureHelpDefinition | null {
  return ACC_FEATURE_HELP[helpId] ?? null;
}
