import { Avatar } from "@/components/ui/avatar";
import { LogoutButton } from "@/components/auth/logout-button";
import { getProjects } from "@/lib/data";
import { ProjectSwitcher } from "./project-switcher";

export function TopBar({ projectId }: { projectId: string }) {
  const projects = getProjects();
  const currentProject = projects.find((p) => p.id === projectId);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4">
      <ProjectSwitcher projects={projects} currentProjectId={projectId} />
      <div className="flex items-center gap-3">
        {currentProject && (
          <span className="text-xs text-muted-foreground">Contrato {currentProject.contractNumber}</span>
        )}
        <Avatar>AS</Avatar>
        <LogoutButton />
      </div>
    </header>
  );
}
