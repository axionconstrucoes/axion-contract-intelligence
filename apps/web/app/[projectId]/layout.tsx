import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { getProject } from "@/lib/data";
import { isWeeklyReportsEnabled } from "@/lib/feature-flags/weekly-reports";
import { canViewProjectFinancialDashboard } from "@/lib/financial/access-server";
import { NAV_ITEMS } from "@/lib/ui/nav-items";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  // Itens restritos da navegação (hoje: Financeiro) — regra central
  // server-side; a rota /financeiro reaplica a mesma verificação. Com a
  // flag ACC_WEEKLY_REPORTS_ENABLED desligada o item nem é avaliado.
  const canViewFinancial = isWeeklyReportsEnabled() ? await canViewProjectFinancialDashboard({ projectId }) : false;
  const hiddenHrefs = NAV_ITEMS.filter((item) => item.restrictedTo === "financial" && !canViewFinancial).map((item) => item.href);

  return (
    <div className="flex h-full min-h-0 flex-1">
      <AppSidebar projectId={projectId} hiddenHrefs={hiddenHrefs} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar projectId={projectId} />
        {/* Cinza-claro só nos espaços entre cartões das páginas internas
            autenticadas — cartões (bg-card, branco) e cabeçalho (TopBar,
            fora deste <main>) continuam brancos; sidebar continua bordô.
            Nunca aplicado em /login ou /projetos (fundo institucional). */}
        <main className="flex-1 overflow-y-auto bg-gray-100 p-6">{children}</main>
      </div>
    </div>
  );
}
