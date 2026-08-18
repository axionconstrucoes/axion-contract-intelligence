import type { Project, ProjectStatus } from "@axion/types";

export type ProjectRow = {
  id: string;
  code: string;
  name: string;
  client: string;
  status: ProjectStatus;
  location: string;
  contract_number: string | null;
  start_date: string;
  baseline_end_date: string;
};

export function mapProjectRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    client: row.client,
    status: row.status,
    location: row.location,
    contractNumber: row.contract_number,
    startDate: row.start_date,
    baselineEndDate: row.baseline_end_date,
  };
}
