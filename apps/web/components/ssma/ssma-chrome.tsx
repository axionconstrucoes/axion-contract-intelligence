"use client";

import Image from "next/image";
import { ArrowLeft, CloudUpload, History, Home, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

export type SsmaTab = "home" | "registros" | "sync" | "perfil";

export function SsmaHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <header className="relative flex min-h-24 items-center bg-[#7f1d1d] px-4 text-white shadow-sm">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="absolute left-2 top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/15"
          aria-label="Voltar"
        >
          <ArrowLeft className="size-6" />
        </button>
      ) : null}
      <Image
        src="/branding/acc-logo.png"
        alt="ACC"
        width={1254}
        height={1254}
        priority
        className={cn("absolute top-1/2 size-16 -translate-y-1/2 object-cover", onBack ? "left-14" : "left-4")}
      />
      <h1 className="mx-auto max-w-[58%] text-center text-lg font-black uppercase leading-tight sm:text-xl">{title}</h1>
    </header>
  );
}

const TABS: Array<{ tab: SsmaTab; label: string; Icon: typeof Home }> = [
  { tab: "home", label: "Início", Icon: Home },
  { tab: "registros", label: "Registros", Icon: History },
  { tab: "sync", label: "Sincronização", Icon: CloudUpload },
  { tab: "perfil", label: "Perfil", Icon: UserRound },
];

export function SsmaBottomNav({ active, onChange, pendingCount = 0 }: { active: SsmaTab; onChange: (tab: SsmaTab) => void; pendingCount?: number }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-slate-300 bg-white px-2 py-2 text-[11px] font-semibold text-slate-600" aria-label="Navegação do app de campo">
      {TABS.map(({ tab, label, Icon }) => (
        <button
          key={tab}
          type="button"
          onClick={() => onChange(tab)}
          aria-current={active === tab ? "page" : undefined}
          className={cn("relative flex min-h-12 flex-col items-center gap-1", active === tab && "text-[#7f1d1d]")}
        >
          <Icon className="size-5" />
          {label}
          {tab === "sync" && pendingCount > 0 ? (
            <span className="absolute right-[22%] top-0 flex min-w-4 items-center justify-center rounded-full bg-[#7f1d1d] px-1 text-[10px] font-black text-white">{pendingCount}</span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}
