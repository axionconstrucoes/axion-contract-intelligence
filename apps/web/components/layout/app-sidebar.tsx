"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  BookText,
  FileStack,
  History,
  LayoutDashboard,
  Plug,
  Users as UsersIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "timeline", label: "Timeline", icon: History },
  { href: "ledger", label: "Event Ledger", icon: BookText },
  { href: "documentos", label: "Documentos", icon: FileStack },
  { href: "integracoes", label: "Integrações", icon: Plug },
  { href: "usuarios", label: "Usuários", icon: UsersIcon },
  { href: "auditoria", label: "Auditoria", icon: AlertTriangle },
];

export function AppSidebar({ projectId }: { projectId: string }) {
  const pathname = usePathname();

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <span className="text-sm font-semibold tracking-tight">AXION</span>
        <span className="text-xs text-muted-foreground">Contract Intelligence</span>
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
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
