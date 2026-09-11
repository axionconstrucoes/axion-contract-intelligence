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
  const { data, error } = await supabase
    .from("project_member_invitations")
    .select("id", { count: "exact" })
    .eq("project_id", projectId);

  const count = data?.length ?? 0;

  console.info("[diag:getProjectMemberInvitations]", {
    projectId,
    count,
    errorCode: error?.code ?? null,
    errorMessage: error?.message?.slice(0, 200) ?? null,
  });

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        projectId,
        count,
        errorCode: error.code ?? null,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, projectId, count });
}
