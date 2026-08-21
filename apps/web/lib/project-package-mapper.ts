import type { ProjectPackage, ProjectStatus } from "@axion/types";

export type ProjectPackageRow = {
  id: string;
  project_id: string;
  code: string;
  title: string;
  description: string | null;
  package_type: string;
  status: ProjectStatus;
  created_at: string;
};

export function mapProjectPackageRow(row: ProjectPackageRow): ProjectPackage {
  return {
    id: row.id,
    projectId: row.project_id,
    code: row.code,
    title: row.title,
    description: row.description,
    packageType: row.package_type,
    status: row.status,
    createdAt: row.created_at,
  };
}
