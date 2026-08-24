"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
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

// Agrupamento puramente visual da navegação (seção 8 do redesign) —
// mapeia hrefs já existentes em NAV_ITEMS a um rótulo de grupo; não
// altera NAV_ITEMS (lib/ui/nav-items.ts) nem as rotas, só a
// apresentação. Todo item não listado aqui cai em "Outros" (rede de
// segurança caso um item novo seja adicionado sem atualizar este mapa).
const NAV_GROUPS: Array<{ label: string; hrefs: string[] }> = [
  { label: "Visão geral", hrefs: ["startup", "dashboard", "timeline", "ledger"] },
  { label: "Gestão", hrefs: ["action-requests", "acoes", "adicionais"] },
  { label: "Contratual", hrefs: ["revisao-contratual", "revisao-clausulas", "documentos"] },
  { label: "Inteligência", hrefs: ["esg", "experts-ia"] },
  { label: "Administração", hrefs: ["integracoes", "usuarios", "auditoria"] },
];

// Tooltip de navegação (label + o que o item faz) — via portal em
// document.body posicionado por getBoundingClientRect, nunca preso ao
// container com scroll (nav tem overflow-y-auto; um tooltip
// absolutamente posicionado como filho seria cortado horizontalmente).
// Funciona recolhida (só ícone) e expandida, mouse e teclado
// (onFocus/onBlur), sem depender do title nativo do navegador.
function NavTooltip({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  function show() {
    setRect(anchorRef.current?.getBoundingClientRect() ?? null);
  }
  function hide() {
    setRect(null);
  }

  return (
    <div ref={anchorRef} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} className="contents">
      {children}
      {rect && typeof document !== "undefined"
        ? createPortal(
            <div
              role="tooltip"
              // Alinhado ao topo do item (nunca centralizado no eixo Y) e
              // sempre com folga mínima do topo da viewport — itens perto
              // do topo da lista não podem gerar um tooltip cortado.
              style={{ position: "fixed", top: Math.max(8, rect.top - 2), left: rect.right + 8 }}
              className="pointer-events-none z-50 w-56 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-[var(--shadow-md)]"
            >
              <p className="font-semibold text-popover-foreground">{label}</p>
              {description ? <p className="mt-0.5 text-muted-foreground">{description}</p> : null}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

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
        "relative flex shrink-0 flex-col border-r border-black/20 bg-brand-sidebar text-brand-sidebar-foreground transition-[width] duration-150",
        collapsed ? "w-14" : "w-60"
      )}
    >
      {/* Alça de recolher/expandir flutuante na borda — nunca no rodapé
          (em dev, o indicador do Next.js Dev Tools fica fixo no canto
          inferior esquerdo da tela e cobre qualquer controle ali;
          também é o padrão mais descobrível de apps premium — Linear/
          Notion). Funciona nos dois estados (recolhida/expandida). */}
      <button
        type="button"
        onClick={() => setSidebarCollapsed(!collapsed)}
        aria-label={collapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
        title={collapsed ? "Expandir menu" : "Recolher menu"}
        className="absolute -right-3 top-16 z-20 flex size-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-[var(--shadow-sm)] transition-colors hover:border-brand-sidebar/50 hover:text-foreground"
      >
        {collapsed ? <PanelLeftOpen className="size-3.5 shrink-0" /> : <PanelLeftClose className="size-3.5 shrink-0" />}
      </button>
      <div
        className={cn(
          "flex h-14 items-center gap-2 border-b border-white/10 px-4",
          collapsed && "justify-center px-0"
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- PNG estático em public/, sem otimização de imagem necessária. Logo ACC aparece SOMENTE aqui na sidebar — nunca duplicado na área de conteúdo/cards. Tamanho +20% sobre o anterior (size-7 = 28px) a pedido do usuário. */}
        <img src="/branding/acc-logo.png" alt="ACC" className="size-[33.6px] shrink-0 rounded-md" />
        {!collapsed && (
          <span className="text-xs font-bold uppercase leading-tight tracking-tight text-white">
            AXION Controle de Contratos
          </span>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto p-2 pt-3">
        {NAV_GROUPS.map((group) => {
          const items = group.hrefs
            .map((href) => NAV_ITEMS.find((item) => item.href === href))
            .filter((item): item is (typeof NAV_ITEMS)[number] => Boolean(item));
          if (items.length === 0) return null;

          return (
            <div key={group.label} className="flex flex-col gap-0.5">
              {!collapsed && (
                <span className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-white/40">{group.label}</span>
              )}
              {items.map((item) => {
                const href = `/${projectId}/${item.href}`;
                const active = pathname?.startsWith(href);
                const Icon = ICONS_BY_NAME[item.icon];
                const help = getFeatureHelp(item.helpId);

                return (
                  <NavTooltip key={item.href} label={item.label} description={help?.shortDescription}>
                    <Link
                      href={href}
                      className={cn(
                        "relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                        collapsed && "justify-center px-0",
                        active ? "bg-brand-sidebar-active text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
                      )}
                    >
                      {active && <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-white/90" aria-hidden="true" />}
                      {Icon ? <Icon className="size-4 shrink-0" /> : null}
                      {!collapsed ? <span className="leading-tight break-words">{item.label}</span> : null}
                    </Link>
                  </NavTooltip>
                );
              })}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
