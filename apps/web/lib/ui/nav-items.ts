// Navegação principal do ACC (sidebar) — dado puro, sem JSX/ícones
// concretos, para ser importável tanto pelo componente de UI
// (components/layout/app-sidebar.tsx, que resolve `icon` para um
// componente Lucide real) quanto por scripts/testes standalone (nunca
// precisam renderizar React para verificar que todo item tem helpId).
//
// Mapeia 1:1 para a navegação REAL já existente — nenhuma rota nova
// nem inventada aqui.

export interface NavItem {
  href: string;
  label: string;
  /** Nome exato de um export de lucide-react — resolvido para o componente real em app-sidebar.tsx. */
  icon: string;
  /** Chave em ACC_FEATURE_HELP (lib/ui/feature-help.ts) — todo item principal deve ter um helpId válido. */
  helpId: string;
  /**
   * Item restrito: só aparece quando o layout (server) confirma o acesso
   * (ex.: "financial" => canViewProjectFinancialDashboard). Esconder o
   * menu nunca é a única barreira — rota, loader, actions e RLS aplicam
   * a mesma regra.
   */
  restrictedTo?: "financial";
}

export const NAV_ITEMS: NavItem[] = [
  { href: "startup", label: "Start-up ACC", icon: "Rocket", helpId: "startup-acc" },
  { href: "dashboard", label: "Dashboard", icon: "LayoutDashboard", helpId: "dashboard" },
  { href: "timeline", label: "Timeline", icon: "History", helpId: "timeline" },
  { href: "ledger", label: "Event Ledger", icon: "BookText", helpId: "event-ledger" },
  // Lotes semanais automáticos de alertas MÉDIO/BAIXO (contract_alert_batches)
  // — CRÍTICO/ALTO continuam no fluxo imediato do próprio Event Ledger,
  // acima. Arquitetura de navegação atual é uma lista plana (sem
  // submenu) — por isso este item é direto, não um filho de "Event
  // Ledger" (ver app-sidebar.tsx).
  { href: "ledger/lote-alertas", label: "Lotes de Alertas", icon: "Mail", helpId: "lotes-de-alertas" },
  { href: "action-requests", label: "Solicitações", icon: "ListChecks", helpId: "solicitacoes" },
  { href: "acoes", label: "Ações e Escalonamentos", icon: "TimerReset", helpId: "acoes-escalonamentos" },
  { href: "juridico", label: "Jurídico", icon: "Scale", helpId: "juridico" },
  // "Análise Contratual" (revisao-contratual) e "Análise de Cláusulas"
  // (revisao-clausulas) saíram da barra lateral: o Expert Jurídico da
  // página inicial é o ponto único para análise de contratos antes da
  // negociação/assinatura e consultas jurídicas sob demanda. Rotas,
  // páginas, APIs, dados, permissões, histórico e ajuda (feature-help)
  // continuam existindo — nada foi apagado, só a entrada de navegação.
  { href: "documentos", label: "Documentos", icon: "FileStack", helpId: "documentos" },
  // Dashboard financeiro alimentado só pela aba FINANCEIRO da planilha do
  // relatório semanal (weekly_report_sheets). Visível apenas para quem
  // passa em evaluateFinancialDashboardAccess (lib/financial/access.ts).
  { href: "financeiro", label: "Financeiro", icon: "Wallet", helpId: "financeiro", restrictedTo: "financial" },
  { href: "esg", label: "ESG/SSMA", icon: "Leaf", helpId: "esg-ssma" },
  { href: "experts-ia", label: "Experts IA", icon: "Bot", helpId: "experts-ia" },
  { href: "integracoes", label: "Integrações", icon: "Plug", helpId: "integracoes" },
  { href: "usuarios", label: "Usuários", icon: "Users", helpId: "usuarios" },
  { href: "auditoria", label: "Auditoria", icon: "AlertTriangle", helpId: "auditoria" },
];
