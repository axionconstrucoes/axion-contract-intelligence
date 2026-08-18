import type { ScheduleActivity, ScheduleActivityStatus } from "@axion/types";

export type ScheduleVersionRow = {
  id: string;
  document_version_id: string;
  version_type: string;
  lifecycle_status: string;
  client_formalization_status: string;
  created_at: string;
};

export type ScheduleActivityRow = {
  id: string;
  schedule_version_id: string;
  name: string;
  baseline_start: string;
  baseline_end: string;
  planned_start: string;
  planned_end: string;
  status: ScheduleActivityStatus;
  created_at: string;
};

// Metadados do parent real de uma schedule_activity, resolvidos via
// schedule_activity -> schedule_version -> document_version -> document ->
// project. Nunca derivados de IDs mock — ver getMockScheduleActivity em
// lib/data.ts para o universo mock.
export type ScheduleActivityParent = {
  projectId: string;
};

// Uma schedule_activity sempre deve resolver a um
// schedule_version -> document_version -> document -> project reais; a
// ausência é inconsistência estrutural, nunca preenchida com fallback
// silencioso de projectId.
//
// TEMPORARY COMPATIBILITY MAPPING:
// planned_start/planned_end represent the schedule programming in this
// ScheduleVersion. They map to currentStart/currentEnd only to preserve
// the existing public UI contract. They are NOT actual execution dates.
export function mapScheduleActivityRow(
  row: ScheduleActivityRow,
  parent: ScheduleActivityParent | undefined
): ScheduleActivity {
  if (!parent) {
    throw new Error(
      `Inconsistência estrutural: schedule_activity (id=${row.id}, schedule_version_id=${row.schedule_version_id}) sem schedule_version/document_version/document/project correspondente.`
    );
  }

  return {
    id: row.id,
    projectId: parent.projectId,
    name: row.name,
    baselineStart: row.baseline_start,
    baselineEnd: row.baseline_end,
    currentStart: row.planned_start,
    currentEnd: row.planned_end,
    status: row.status,
  };
}
