import type {
  ClientFormalizationStatus,
  ContractChange,
  ContractChangeCreatedByType,
  ContractChangeStatus,
  ScheduleImpactStatus,
} from "@axion/types";

export type ContractChangeRow = {
  id: string;
  project_id: string;
  code: string;
  title: string;
  description: string;
  status: ContractChangeStatus;
  identified_at: string;
  created_by_type: ContractChangeCreatedByType;
  created_by_user_id: string | null;
  created_by_label: string | null;
  client_formalization_status: ClientFormalizationStatus;
  schedule_impact_status: ScheduleImpactStatus;
  technical_additional_days: number | null;
  created_at: string;
};

export function mapContractChangeRow(row: ContractChangeRow): ContractChange {
  return {
    id: row.id,
    projectId: row.project_id,
    code: row.code,
    title: row.title,
    description: row.description,
    status: row.status,
    identifiedAt: row.identified_at,
    createdByType: row.created_by_type,
    createdByUserId: row.created_by_user_id,
    createdByLabel: row.created_by_label,
    clientFormalizationStatus: row.client_formalization_status,
    scheduleImpactStatus: row.schedule_impact_status,
    technicalAdditionalDays: row.technical_additional_days,
    createdAt: row.created_at,
  };
}
