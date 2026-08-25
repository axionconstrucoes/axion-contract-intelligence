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
}

export const NAV_ITEMS: NavItem[] = [
  { href: "startup", label: "Start-up ACC", icon: "Rocket", helpId: "startup-acc" },
  { href: "dashboard", label: "Dashboard", icon: "LayoutDashboard", helpId: "dashboard" },
  { href: "timeline", label: "Timeline", icon: "History", helpId: "timeline" },
  { href: "ledger", label: "Event Ledger", icon: "BookText", helpId: "event-ledger" },
  { href: "action-requests", label: "Solicitações", icon: "ListChecks", helpId: "solicitacoes" },
  { href: "acoes", label: "Ações e Escalonamentos", icon: "TimerReset", helpId: "acoes-escalonamentos" },
  { href: "adicionais", label: "Propostas de Adicionais", icon: "PackagePlus", helpId: "adicionais" },
  { href: "revisao-contratual", label: "Análise Contratual", icon: "BookText", helpId: "analise-contratual" },
  { href: "revisao-clausulas", label: "Análise de Cláusulas", icon: "BookText", helpId: "analise-clausulas" },
  { href: "recebidos-cliente", label: "Recebidos do cliente", icon: "FileStack", helpId: "recebidos-cliente" },
  { href: "documentos", label: "Contrato e aditivos", icon: "FileStack", helpId: "documentos" },
  { href: "usuarios", label: "Usuários", icon: "Users", helpId: "usuarios" },
  { href: "esg", label: "ESG/SSMA", icon: "Leaf", helpId: "esg-ssma" },
  { href: "experts-ia", label: "Experts IA", icon: "Bot", helpId: "experts-ia" },
  { href: "integracoes", label: "Integrações", icon: "Plug", helpId: "integracoes" },
  { href: "auditoria", label: "Auditoria", icon: "AlertTriangle", helpId: "auditoria" },
];
