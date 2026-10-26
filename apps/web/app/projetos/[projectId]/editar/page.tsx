import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@axion/db/server";
import { InstitutionalBackground } from "@/components/brand/institutional-background";
import { EditProjectForm } from "@/components/projects/edit-project-form";
import { getProject } from "@/lib/data";
import { editProjectReturnPath, type EditProjectOrigin } from "../../actions-state";

export const metadata: Metadata = { title: "Editar projeto · ACC" };

export default async function EditarProjetoPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ origem?: string }>;
}) {
  const [{ projectId }, { origem }] = await Promise.all([params, searchParams]);
  const origin: EditProjectOrigin = origem === "projeto" ? "projeto" : "selecao";

  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/");

  const project = await getProject(projectId);
  if (!project || project.workspaceType !== "OBRA") notFound();

  const { data: membership } = await supabase
    .from("project_memberships")
    .select("permission, status")
    .eq("project_id", projectId)
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (membership?.status !== "ACTIVE" || membership.permission !== "ADMINISTRADOR") {
    redirect(editProjectReturnPath(projectId, origin));
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden p-6">
      <InstitutionalBackground />
      <div className="relative w-full max-w-3xl">
        <EditProjectForm project={project} origin={origin} />
      </div>
    </main>
  );
}
