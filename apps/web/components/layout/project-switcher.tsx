"use client";

import { useRouter } from "next/navigation";
import type { Project } from "@axion/types";
import { Select } from "@/components/ui/select";

export function ProjectSwitcher({ projects, currentProjectId }: { projects: Project[]; currentProjectId: string }) {
  const router = useRouter();

  return (
    <Select
      value={currentProjectId}
      onChange={(e) => router.push(`/${e.target.value}/dashboard`)}
      className="max-w-xs border-border font-semibold text-brand-sidebar"
    >
      {projects.map((project) => (
        <option key={project.id} value={project.id}>
          {project.name}
        </option>
      ))}
    </Select>
  );
}
