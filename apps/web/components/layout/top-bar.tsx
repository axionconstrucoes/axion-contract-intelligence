import { Avatar } from "@/components/ui/avatar";
import { LogoutButton } from "@/components/auth/logout-button";
import { getProjects } from "@/lib/data";
import { ProjectSwitcher } from "./project-switcher";

export async function TopBar({ projectId }: { projectId: string }) {
  const projects = await getProjects();
  const currentProject = projects.find((p) => p.id === projectId);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-white px-4 text-foreground shadow-sm">
      <div className="flex items-center gap-4">
        <span className="whitespace-nowrap text-base font-bold tracking-wide text-brand-header">AXION CONTROLE DE CONTRATOS</span>
        <span className="hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
        <ProjectSwitcher projects={projects} currentProjectId={projectId} />
        {currentProject?.code && <span className="text-xs text-muted-foreground">{currentProject.code}</span>}
      </div>
      <div className="flex items-center gap-3">
        {currentProject?.contractNumber && (
          <span className="text-xs text-muted-foreground">Contrato {currentProject.contractNumber}</span>
        )}
        <Avatar>AS</Avatar>
        <LogoutButton />
      </div>
    </header>
  );
}
