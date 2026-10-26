import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@axion/db/server";
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

  const supabase = await createSupabaseServerClient();

  const [{ data: authData }, canViewFinancial] = await Promise.all([
    supabase.auth.getUser(),
    isWeeklyReportsEnabled()
      ? canViewProjectFinancialDashboard({ projectId })
      : Promise.resolve(false),
  ]);

  let isAdmin = false;

  if (authData.user) {
    const { data: membership } = await supabase
      .from("project_memberships")
      .select("permission,status")
      .eq("project_id", projectId)
      .eq("user_id", authData.user.id)
      .maybeSingle();

    isAdmin =
      membership?.status === "ACTIVE" &&
      membership?.permission === "ADMINISTRADOR";
  }

  const hiddenHrefs = NAV_ITEMS.filter((item) => {
    if (item.restrictedTo === "financial" && !canViewFinancial) return true;
    if (item.restrictedTo === "admin" && !isAdmin) return true;
    return false;
  }).map((item) => item.href);

  return (
    <div className="flex h-full min-h-0 flex-1">
      <AppSidebar projectId={projectId} hiddenHrefs={hiddenHrefs} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar projectId={projectId} canEditProject={isAdmin} />

        <main className="flex-1 overflow-y-auto bg-gray-100 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
