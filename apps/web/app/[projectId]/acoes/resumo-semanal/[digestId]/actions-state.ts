export interface SubmitWeeklyDigestState {
  success: boolean;
  error: string | null;
}

export const initialSubmitWeeklyDigestState: SubmitWeeklyDigestState = {
  success: false,
  error: null,
};
