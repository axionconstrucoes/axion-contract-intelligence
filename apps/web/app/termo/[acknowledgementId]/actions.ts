"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { createSupabaseServerClient } from "@axion/db/server";

export type PolicyApprovalState = {
  error: string | null;
  success: boolean;
  approvedAt: string | null;
};

export async function markPolicyAcknowledgementViewedAction(
  acknowledgementId: string
): Promise<void> {
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.rpc(
    "mark_policy_acknowledgement_viewed",
    {
      p_acknowledgement_id: acknowledgementId,
    }
  );

  if (error) {
    console.error(
      "Falha ao registrar visualização do Termo:",
      error.message
    );
  }
}

function extractClientIp(
  forwardedFor: string | null,
  realIp: string | null
): string | null {
  let value =
    forwardedFor?.split(",")[0]?.trim() ||
    realIp?.trim() ||
    null;

  if (!value) return null;

  if (value.startsWith("[") && value.includes("]")) {
    value = value.slice(1, value.indexOf("]"));
  }

  if (
    value.includes(".") &&
    (value.match(/:/g)?.length ?? 0) === 1
  ) {
    value = value.split(":")[0];
  }

  return value || null;
}

export async function approvePolicyAcknowledgementAction(
  _prevState: PolicyApprovalState,
  formData: FormData
): Promise<PolicyApprovalState> {
  try {
    const acknowledgementId =
      String(
        formData.get("acknowledgementId") ?? ""
      ).trim();

    const accepted =
      formData.get("accepted") === "on";

    if (!acknowledgementId) {
      throw new Error("Identificação do Termo ausente.");
    }

    if (!accepted) {
      return {
        error:
          "É necessário confirmar que o Termo foi lido integralmente.",
        success: false,
        approvedAt: null,
      };
    }

    const supabase =
      await createSupabaseServerClient();

    const requestHeaders = await headers();

    const clientIp = extractClientIp(
      requestHeaders.get("x-forwarded-for"),
      requestHeaders.get("x-real-ip")
    );

    const userAgent =
      requestHeaders.get("user-agent");

    const {
      data: approvedAt,
      error,
    } = await supabase.rpc(
      "approve_policy_acknowledgement",
      {
        p_acknowledgement_id:
          acknowledgementId,
        p_approval_ip: clientIp,
        p_user_agent: userAgent,
      }
    );

    if (error) {
      throw new Error(error.message);
    }

    revalidatePath(
      `/termo/${acknowledgementId}`
    );

    return {
      error: null,
      success: true,
      approvedAt:
        typeof approvedAt === "string"
          ? approvedAt
          : new Date().toISOString(),
    };

  } catch (error) {

    return {
      error:
        error instanceof Error
          ? error.message
          : "Falha ao registrar a aprovação.",
      success: false,
      approvedAt: null,
    };
  }
}