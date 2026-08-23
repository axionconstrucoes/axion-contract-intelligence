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
      className="max-w-xs border-white/40 bg-white/10 font-bold text-yellow-300"
    >
      {projects.map((project) => (
        <option key={project.id} value={project.id}>
          {project.name}
        </option>
      ))}
    </Select>
  );
}
