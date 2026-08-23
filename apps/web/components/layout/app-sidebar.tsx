"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  Bot,
  BookText,
  FileStack,
  History,
  LayoutDashboard,
  Leaf,
  ListChecks,
  PackagePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Rocket,
  TimerReset,
  Users as UsersIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "startup", label: "Start-up ACC", icon: Rocket },
  { href: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "timeline", label: "Timeline", icon: History },
  { href: "ledger", label: "Event Ledger", icon: BookText },
  { href: "action-requests", label: "Solicitações", icon: ListChecks },
  { href: "acoes", label: "Ações e Escalonamentos", icon: TimerReset },
  { href: "adicionais", label: "Propostas de Adicionais", icon: PackagePlus },
  { href: "revisao-contratual", label: "Análise Contratual", icon: BookText },
  { href: "revisao-clausulas", label: "Análise de Cláusulas", icon: BookText },
  { href: "documentos", label: "Documentos", icon: FileStack },
  { href: "esg", label: "ESG/SSMA", icon: Leaf },
  { href: "experts-ia", label: "Experts IA", icon: Bot },
  { href: "integracoes", label: "Integrações", icon: Plug },
  { href: "usuarios", label: "Usuários", icon: UsersIcon },
  { href: "auditoria", label: "Auditoria", icon: AlertTriangle },
];

const SIDEBAR_COLLAPSED_STORAGE_KEY = "acc.sidebar.collapsed";

// Store externo mínimo (useSyncExternalStore) em vez de useState+useEffect
// — é o jeito client-safe e sem hydration mismatch de sincronizar com
// localStorage: o servidor (sem localStorage) sempre "vê" o snapshot
// expandido (getServerSnapshot), e o React reconcilia com o valor real
// assim que hidrata, sem passar por um setState dentro de efeito.
let cachedCollapsed: boolean | null = null;
let listeners: Array<() => void> = [];

function getCollapsedSnapshot(): boolean {
  if (cachedCollapsed === null) {
    cachedCollapsed = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
  }
  return cachedCollapsed;
}

function getServerCollapsedSnapshot(): boolean {
  return false;
}

function subscribeCollapsed(listener: () => void): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function setSidebarCollapsed(next: boolean): void {
  cachedCollapsed = next;
  window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next));
  for (const listener of listeners) listener();
}

export function AppSidebar({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(subscribeCollapsed, getCollapsedSnapshot, getServerCollapsedSnapshot);

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r border-border bg-card transition-[width] duration-150",
        collapsed ? "w-14" : "w-60"
      )}
    >
      <div
        className={cn(
          "flex h-14 items-center gap-2 border-b border-border px-4",
          collapsed && "justify-center px-0"
        )}
      >
        {!collapsed && (
          <>
            <span className="text-sm font-semibold tracking-tight">AXION</span>
            <span className="text-xs text-muted-foreground">ACC</span>
          </>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 p-2">
        {navItems.map((item) => {
          const href = `/${projectId}/${item.href}`;
          const active = pathname?.startsWith(href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={href}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                collapsed && "justify-center px-0",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <Icon className="size-4 shrink-0" />
              {!collapsed && item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-2">
        <button
          type="button"
          onClick={() => setSidebarCollapsed(!collapsed)}
          aria-label={collapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
          title={collapsed ? "Expandir menu" : "Recolher menu"}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
            collapsed && "justify-center px-0"
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4 shrink-0" />
          ) : (
            <PanelLeftClose className="size-4 shrink-0" />
          )}
          {!collapsed && "Recolher"}
        </button>
      </div>
    </aside>
  );
}
