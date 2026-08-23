// Card de acesso ao Dashboard Visual (seção 3) — card inteiro clicável.
// Usa o ícone real fornecido em public/branding/dashboard-visual.png
// (nunca um ícone Lucide de substituição).

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";

export function DashboardVisualEntryCard({ projectId }: { projectId: string }) {
  return (
    <Link href={`/${projectId}/dashboard/visual`} className="block">
      <Card className="transition-colors hover:border-brand-header/60 hover:bg-accent/40">
        <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- PNG estático em public/, sem otimização de imagem necessária */}
          <img src="/branding/dashboard-visual.png" alt="Dashboard Visual" className="size-10" />
          <span className="text-sm font-bold uppercase tracking-wide">Dashboard Visual</span>
          <span className="text-xs text-muted-foreground">Visão executiva consolidada do contrato, com gráficos e indicadores.</span>
        </CardContent>
      </Card>
    </Link>
  );
}
