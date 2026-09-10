export type CreatePrecontractWorkspaceState = {
  error: string | null;
  projectId: string | null;
  projectName: string | null;
};

export const initialCreatePrecontractWorkspaceState: CreatePrecontractWorkspaceState = {
  error: null,
  projectId: null,
  projectName: null,
};
