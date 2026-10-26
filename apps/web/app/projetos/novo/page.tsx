import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@axion/db/server";
import { InstitutionalBackground } from "@/components/brand/institutional-background";
import { CreateProjectForm } from "@/components/projects/create-project-form";

export const metadata: Metadata = { title: "Novo projeto · ACC" };

export default async function NovoProjetoPage() {
  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/");

  const { data: memberships, error } = await supabase
    .from("project_memberships")
    .select("permission, status")
    .eq("user_id", authData.user.id)
    .eq("permission", "ADMINISTRADOR")
    .eq("status", "ACTIVE")
    .limit(1);

  if (error || !memberships?.length) redirect("/projetos");

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden p-6">
      <InstitutionalBackground />
      <div className="relative w-full max-w-3xl">
        <CreateProjectForm />
      </div>
    </main>
  );
}
