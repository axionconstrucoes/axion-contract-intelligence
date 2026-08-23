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
  Users,
  type LucideIcon,
} from "lucide-react";
import { getFeatureHelp } from "@/lib/ui/feature-help";
import { NAV_ITEMS } from "@/lib/ui/nav-items";
import { cn } from "@/lib/utils";

// Resolve NavItem.icon (nome de string, ver lib/ui/nav-items.ts) para o
// componente Lucide real — mesmo padrão de components/ai/expert-visual-identity.ts.
const ICONS_BY_NAME: Record<string, LucideIcon> = {
  AlertTriangle,
  Bot,
  BookText,
  FileStack,
  History,
  LayoutDashboard,
  Leaf,
  ListChecks,
  PackagePlus,
  Plug,
  Rocket,
  TimerReset,
  Users,
};

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
        "flex shrink-0 flex-col border-r border-black/10 bg-brand-sidebar text-brand-sidebar-foreground transition-[width] duration-150",
        collapsed ? "w-14" : "w-60"
      )}
    >
      <div
        className={cn(
          "flex h-14 items-center gap-2 border-b border-white/15 px-4",
          collapsed && "justify-center px-0"
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- PNG estático em public/, sem otimização de imagem necessária. Logo ACC aparece SOMENTE aqui na sidebar — nunca duplicado na área de conteúdo/cards. */}
        <img src="/branding/acc-logo.png" alt="ACC" className="size-7 shrink-0 rounded" />
        {!collapsed && (
          <span className="text-xs font-bold uppercase leading-tight tracking-tight text-white">
            AXION Controle de Contratos
          </span>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 p-2">
        {NAV_ITEMS.map((item) => {
          const href = `/${projectId}/${item.href}`;
          const active = pathname?.startsWith(href);
          const Icon = ICONS_BY_NAME[item.icon];
          const help = getFeatureHelp(item.helpId);
          // Ajuda via hover/focus no próprio item (title nativo), nunca um
          // ⓘ separado poluindo a sidebar — mesmo tooltip em qualquer
          // estado (recolhida ou expandida).
          const itemTitle = help ? `${item.label} — ${help.shortDescription}` : item.label;

          return (
            <Link
              key={item.href}
              href={href}
              title={itemTitle}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                collapsed && "justify-center px-0",
                active ? "bg-brand-sidebar-active text-white" : "text-white/75 hover:bg-white/10 hover:text-white"
              )}
            >
              {Icon ? <Icon className="size-4 shrink-0" /> : null}
              {!collapsed ? <span className="leading-tight break-words">{item.label}</span> : null}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/15 p-2">
        <button
          type="button"
          onClick={() => setSidebarCollapsed(!collapsed)}
          aria-label={collapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
          title={collapsed ? "Expandir menu" : "Recolher menu"}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-white/75 transition-colors hover:bg-white/10 hover:text-white",
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
