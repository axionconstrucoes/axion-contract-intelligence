import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@axion/db/server";

export const dynamic = "force-dynamic";

function decodeJwtPayload(token: string | undefined) {
  if (!token) return null;

  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId")?.trim() ?? "";

  if (!projectId) {
    return NextResponse.json({ ok: false, error: "missing_project_id" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const [userResult, sessionResult] = await Promise.all([
    supabase.auth.getUser(),
    supabase.auth.getSession(),
  ]);

  const user = userResult.data.user;
  const session = sessionResult.data.session;
  const claims = decodeJwtPayload(session?.access_token);

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

  const safeClaims = {
    sub: typeof claims?.sub === "string" ? claims.sub : null,
    role: typeof claims?.role === "string" ? claims.role : null,
    aud: typeof claims?.aud === "string" || Array.isArray(claims?.aud) ? claims.aud : null,
    iss: typeof claims?.iss === "string" ? claims.iss : null,
  };

  console.info("[diag:getProjectMemberInvitations]", {
    projectId,
    authenticated,
    userId: user?.id ?? null,
    supabaseHost,
    membershipCount,
    invitationCount,
    claims: safeClaims,
    authErrorCode: userResult.error?.code ?? null,
    sessionErrorCode: sessionResult.error?.code ?? null,
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
        claims: safeClaims,
        authErrorCode: userResult.error?.code ?? null,
        sessionErrorCode: sessionResult.error?.code ?? null,
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
    claims: safeClaims,
    authErrorCode: userResult.error?.code ?? null,
    sessionErrorCode: sessionResult.error?.code ?? null,
  });
}
