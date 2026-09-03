"use client";

import { useRouter } from "next/navigation";
import type { Project } from "@axion/types";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function ProjectSwitcher({
  projects,
  currentProjectId,
  className,
}: {
  projects: Project[];
  currentProjectId: string;
  className?: string;
}) {
  const router = useRouter();
  const currentProject = projects.find((project) => project.id === currentProjectId);

  return (
    <Select
      value={currentProjectId}
      onChange={(e) => router.push(`/${e.target.value}/dashboard`)}
      // Nome truncado com reticências (ver classe truncate abaixo) —
      // title nativo do <select> funciona como tooltip acessível do
      // valor completo, o mesmo padrão de ajuda-via-title já usado na
      // sidebar (ver app-sidebar.tsx).
      title={currentProject?.name}
      className={cn("min-w-0 truncate border-border bg-transparent font-bold text-foreground", className)}
    >
      {projects.map((project) => (
        <option key={project.id} value={project.id}>
          {project.name}
        </option>
      ))}
    </Select>
  );
}
