import type { PendingContractAlertBatchItem } from "@/lib/email-actions/contract-alert-batch-types";

export interface SubmitContractAlertBatchState {
  success: boolean;
  error: string | null;
  pendingItems: PendingContractAlertBatchItem[];
}

export const initialSubmitContractAlertBatchState: SubmitContractAlertBatchState = {
  success: false,
  error: null,
  pendingItems: [],
};
