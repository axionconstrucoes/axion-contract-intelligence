// Identidade cromática por FONTE (seção 21/23 do requisito) — a cor do
// card identifica a fonte, nunca o estado (o badge de status é sempre
// colorido separadamente, ver resolve-integration-display-status.ts).
// Ícones Lucide já existentes no projeto — nenhuma biblioteca nova.

import {
  Building2,
  Calculator,
  CalendarClock,
  ClipboardList,
  Database,
  FileBarChart,
  FileSearch,
  FileSignature,
  FolderOpen,
  Inbox,
  Leaf,
  Mail,
  type LucideIcon,
} from "lucide-react";
import type { SourceType } from "@axion/types";

export interface IntegrationVisualIdentity {
  icon: LucideIcon;
  cardClassName: string;
  iconClassName: string;
}

const IDENTITY_BY_SOURCE_TYPE: Record<SourceType, IntegrationVisualIdentity> = {
  EMAIL: {
    icon: Mail,
    cardClassName: "border-l-4 border-l-red-800 bg-red-50/60 dark:bg-red-950/20 hover:bg-red-50 dark:hover:bg-red-950/30",
    iconClassName: "text-red-800 dark:text-red-400",
  },
  GOOGLE_DRIVE: {
    icon: FolderOpen,
    cardClassName: "border-l-4 border-l-blue-500 bg-blue-50/60 dark:bg-blue-950/20 hover:bg-blue-50 dark:hover:bg-blue-950/30",
    iconClassName: "text-blue-600 dark:text-blue-400",
  },
  CONSTRUMANAGER: {
    icon: Building2,
    cardClassName: "border-l-4 border-l-orange-500 bg-orange-50/60 dark:bg-orange-950/20 hover:bg-orange-50 dark:hover:bg-orange-950/30",
    iconClassName: "text-orange-600 dark:text-orange-400",
  },
  DIARIO_OBRA: {
    icon: ClipboardList,
    cardClassName: "border-l-4 border-l-amber-500 bg-amber-50/60 dark:bg-amber-950/20 hover:bg-amber-50 dark:hover:bg-amber-950/30",
    iconClassName: "text-amber-600 dark:text-amber-400",
  },
  CONTRATO: {
    icon: FileSignature,
    cardClassName: "border-l-4 border-l-violet-500 bg-violet-50/60 dark:bg-violet-950/20 hover:bg-violet-50 dark:hover:bg-violet-950/30",
    iconClassName: "text-violet-600 dark:text-violet-400",
  },
  RECEBIDOS_CLIENTE: {
    icon: Inbox,
    cardClassName: "border-l-4 border-l-cyan-500 bg-cyan-50/60 dark:bg-cyan-950/20 hover:bg-cyan-50 dark:hover:bg-cyan-950/30",
    iconClassName: "text-cyan-600 dark:text-cyan-400",
  },
  EDITAL_RFI_RFP: {
    icon: FileSearch,
    cardClassName: "border-l-4 border-l-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/20 hover:bg-indigo-50 dark:hover:bg-indigo-950/30",
    iconClassName: "text-indigo-600 dark:text-indigo-400",
  },
  CRONOGRAMA: {
    icon: CalendarClock,
    cardClassName: "border-l-4 border-l-sky-600 bg-sky-50/60 dark:bg-sky-950/20 hover:bg-sky-50 dark:hover:bg-sky-950/30",
    iconClassName: "text-sky-700 dark:text-sky-400",
  },
  RELATORIO_SEMANAL: {
    icon: FileBarChart,
    cardClassName: "border-l-4 border-l-teal-500 bg-teal-50/60 dark:bg-teal-950/20 hover:bg-teal-50 dark:hover:bg-teal-950/30",
    iconClassName: "text-teal-600 dark:text-teal-400",
  },
  ERP: {
    icon: Database,
    cardClassName: "border-l-4 border-l-slate-500 bg-slate-50/60 dark:bg-slate-900/40 hover:bg-slate-50 dark:hover:bg-slate-900/60",
    iconClassName: "text-slate-600 dark:text-slate-400",
  },
  ORCAMENTO: {
    icon: Calculator,
    cardClassName: "border-l-4 border-l-yellow-600 bg-yellow-50/60 dark:bg-yellow-950/20 hover:bg-yellow-50 dark:hover:bg-yellow-950/30",
    iconClassName: "text-yellow-700 dark:text-yellow-400",
  },
  ESG_SSMA: {
    icon: Leaf,
    cardClassName: "border-l-4 border-l-green-600 bg-green-50/60 dark:bg-green-950/20 hover:bg-green-50 dark:hover:bg-green-950/30",
    iconClassName: "text-green-700 dark:text-green-400",
  },
};

export function resolveIntegrationVisualIdentity(sourceType: SourceType): IntegrationVisualIdentity {
  return IDENTITY_BY_SOURCE_TYPE[sourceType];
}
