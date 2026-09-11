import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@axion/db/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId")?.trim() ?? "";

  if (!projectId) {
    return NextResponse.json({ ok: false, error: "missing_project_id" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  const [invitationsResult, membershipResult] = await Promise.all([
    supabase
      .from("project_member_invitations")
      .select("id", { count: "exact" })
      .eq("project_id", projectId),
    supabase
      .from("project_memberships")
      .select("user_id", { count: "exact" })
      .eq("project_id", projectId)
      .eq("user_id", user?.id ?? "00000000-0000-0000-0000-000000000000")
      .eq("status", "ACTIVE"),
  ]);

  const invitationCount = invitationsResult.data?.length ?? 0;
  const membershipCount = membershipResult.data?.length ?? 0;
  const authenticated = Boolean(user);

  let supabaseHost: string | null = null;
  try {
    const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
    supabaseHost = raw ? new URL(raw).host : null;
  } catch {
    supabaseHost = "invalid_url";
  }

  console.info("[diag:getProjectMemberInvitations]", {
    projectId,
    authenticated,
    userId: user?.id ?? null,
    supabaseHost,
    membershipCount,
    invitationCount,
    authErrorCode: authError?.code ?? null,
    invitationsErrorCode: invitationsResult.error?.code ?? null,
    membershipErrorCode: membershipResult.error?.code ?? null,
  });

  const error = invitationsResult.error ?? membershipResult.error;
  if (error) {
    return NextResponse.json(
      {
        ok: false,
        projectId,
        authenticated,
        userId: user?.id ?? null,
        supabaseHost,
        membershipCount,
        invitationCount,
        authErrorCode: authError?.code ?? null,
        errorCode: error.code ?? null,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    projectId,
    authenticated,
    userId: user?.id ?? null,
    supabaseHost,
    membershipCount,
    invitationCount,
    authErrorCode: authError?.code ?? null,
  });
}
