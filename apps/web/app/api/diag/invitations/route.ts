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

  const [invitationsResult, membershipResult, projectResult, rpcResult] = await Promise.all([
    supabase.from("project_member_invitations").select("id", { count: "exact" }).eq("project_id", projectId),
    supabase
      .from("project_memberships")
      .select("user_id", { count: "exact" })
      .eq("project_id", projectId)
      .eq("user_id", user?.id ?? "00000000-0000-0000-0000-000000000000")
      .eq("status", "ACTIVE"),
    supabase.from("projects").select("id", { count: "exact" }).eq("id", projectId),
    supabase.rpc("is_project_member", { p_project_id: projectId }),
  ]);

  const invitationCount = invitationsResult.data?.length ?? 0;
  const membershipCount = membershipResult.data?.length ?? 0;
  const projectCount = projectResult.data?.length ?? 0;
  const isProjectMember = typeof rpcResult.data === "boolean" ? rpcResult.data : null;
  const authenticated = Boolean(user);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

  let explicitBearerProjectCount: number | null = null;
  let explicitBearerStatus: number | null = null;
  if (session?.access_token && supabaseUrl && publishableKey) {
    const direct = await fetch(
      `${supabaseUrl}/rest/v1/projects?id=eq.${encodeURIComponent(projectId)}&select=id`,
      {
        headers: {
          apikey: publishableKey,
          Authorization: `Bearer ${session.access_token}`,
        },
        cache: "no-store",
      }
    );
    explicitBearerStatus = direct.status;
    if (direct.ok) {
      const body = (await direct.json()) as unknown[];
      explicitBearerProjectCount = Array.isArray(body) ? body.length : null;
    }
  }

  let supabaseHost: string | null = null;
  try {
    supabaseHost = supabaseUrl ? new URL(supabaseUrl).host : null;
  } catch {
    supabaseHost = "invalid_url";
  }

  const safeClaims = {
    sub: typeof claims?.sub === "string" ? claims.sub : null,
    role: typeof claims?.role === "string" ? claims.role : null,
    aud: typeof claims?.aud === "string" || Array.isArray(claims?.aud) ? claims.aud : null,
    iss: typeof claims?.iss === "string" ? claims.iss : null,
  };

  const error = invitationsResult.error ?? membershipResult.error ?? projectResult.error ?? rpcResult.error;
  if (error) {
    return NextResponse.json(
      {
        ok: false,
        projectId,
        authenticated,
        userId: user?.id ?? null,
        supabaseHost,
        projectCount,
        membershipCount,
        invitationCount,
        isProjectMember,
        explicitBearerProjectCount,
        explicitBearerStatus,
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
    projectCount,
    membershipCount,
    invitationCount,
    isProjectMember,
    explicitBearerProjectCount,
    explicitBearerStatus,
    claims: safeClaims,
    authErrorCode: userResult.error?.code ?? null,
    sessionErrorCode: sessionResult.error?.code ?? null,
  });
}
