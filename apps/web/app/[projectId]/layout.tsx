import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { getProject } from "@/lib/data";

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

  return (
    <div className="flex h-dvh">
      <AppSidebar projectId={projectId} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar projectId={projectId} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
