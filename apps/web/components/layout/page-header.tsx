"use client";

// Cabeçalho padrão obrigatório de todas as telas internas do ACC:
// "AXION CONTROLE DE CONTRATOS — <Nome da aba>" — "AXION CONTROLE DE
// CONTRATOS" sempre preto/negrito, o nome da aba sempre vermelho-escuro
// institucional/negrito. Reutilizado por todas as páginas internas —
// nunca um <h1> avulso reimplementado por página.
//
// O título também mostra a ajuda contextual ⓘ (FeatureInfo) do item de
// navegação correspondente — resolvida automaticamente pela rota atual
// contra NAV_ITEMS (lib/ui/nav-items.ts), nunca precisando que cada
// page.tsx passe um helpId manualmente (evita 15 edições e o risco de
// desalinhar título vs. helpId com o tempo).

import { usePathname } from "next/navigation";
import { FeatureInfo } from "@/components/shared/feature-info";
import { NAV_ITEMS } from "@/lib/ui/nav-items";

export function PageHeader({ title, description }: { title: string; description: string }) {
  const pathname = usePathname();
  const navItem = NAV_ITEMS.find((item) => pathname?.includes(`/${item.href}`));

  return (
    <div className="flex flex-col gap-1 border-b border-border pb-5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">AXION Controle de Contratos</span>
      {/* text-brand-sidebar (não um vermelho hardcoded) — mesma variável
          de cor da sidebar, garante que título de página e sidebar
          nunca divirjam (pedido explícito do usuário). */}
      <h1 className="flex items-center gap-1.5 text-2xl font-semibold tracking-tight text-brand-sidebar">
        {title}
        {navItem ? <FeatureInfo helpId={navItem.helpId} iconClassName="text-brand-sidebar/50 hover:text-brand-sidebar" /> : null}
      </h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
