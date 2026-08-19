import type {
  ActionRequest,
  ActionRequestAssignee,
  ActionRequestResponse,
  ActionRequestResponseChannel,
  ActionRequestStatus,
} from "@axion/types";

export type ActionRequestRow = {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: ActionRequestStatus;
  requested_at: string;
  due_at: string | null;
  closed_at: string | null;
  created_by_type: "SYSTEM" | "USER" | "LEGACY";
  created_by_user_id: string | null;
  created_by_label: string | null;
  created_at: string;
};

export function mapActionRequestRow(row: ActionRequestRow): ActionRequest {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status,
    requestedAt: row.requested_at,
    dueAt: row.due_at,
    closedAt: row.closed_at,
    createdByType: row.created_by_type,
    createdByUserId: row.created_by_user_id,
    createdByLabel: row.created_by_label,
    createdAt: row.created_at,
  };
}

export type ActionRequestAssigneeRow = {
  action_request_id: string;
  project_id: string;
  user_id: string;
  created_at: string;
};

export function mapActionRequestAssigneeRow(row: ActionRequestAssigneeRow): ActionRequestAssignee {
  return {
    actionRequestId: row.action_request_id,
    projectId: row.project_id,
    userId: row.user_id,
    createdAt: row.created_at,
  };
}

export type ActionRequestResponseRow = {
  id: string;
  action_request_id: string;
  project_id: string;
  channel: ActionRequestResponseChannel;
  responder_user_id: string | null;
  email_id: string | null;
  content: string | null;
  responded_at: string;
  created_at: string;
};

export function mapActionRequestResponseRow(row: ActionRequestResponseRow): ActionRequestResponse {
  return {
    id: row.id,
    actionRequestId: row.action_request_id,
    projectId: row.project_id,
    channel: row.channel,
    responderUserId: row.responder_user_id,
    emailId: row.email_id,
    content: row.content,
    respondedAt: row.responded_at,
    createdAt: row.created_at,
  };
}
