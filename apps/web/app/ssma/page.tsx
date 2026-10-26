import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { createSupabaseServerClient } from "@axion/db/server";
import { SsmaHeader } from "@/components/ssma/ssma-chrome";
import { SsmaInstallCard } from "@/components/ssma/ssma-install-card";
import { getProjects } from "@/lib/data";

export const metadata: Metadata = { title: "Obras" };

// Seletor de obras AUTORIZADAS do app de campo: só aparecem obras de que o usuário é membro ativo
// (a consulta já é filtrada por RLS; a checagem de membro abaixo é a segunda barreira).
export default async function SsmaProjectPickerPage() {
  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/login");

  const [projects, { data: memberships }] = await Promise.all([
    getProjects(),
    supabase.from("project_memberships").select("project_id").eq("user_id", authData.user.id).eq("status", "ACTIVE"),
  ]);
  const memberOf = new Set((memberships ?? []).map((row) => row.project_id as string));
  const authorized = projects.filter((project) => project.workspaceType === "OBRA" && memberOf.has(project.id));

  return (
    <div className="min-h-dvh bg-slate-100">
      <SsmaHeader title="SSMA/ESG" />
      <main className="mx-auto max-w-2xl space-y-4 p-4">
        <h2 className="text-base font-black text-slate-900">Selecione a obra</h2>
        {authorized.length === 0 ? (
          <p className="rounded-xl bg-white p-4 text-sm text-slate-700 shadow-sm">Você ainda não participa de nenhuma obra ativa. Peça a um administrador para vincular a sua conta.</p>
        ) : (
          <ul className="space-y-2">
            {authorized.map((project) => (
              <li key={project.id}>
                <Link href={`/ssma/${project.id}`} className="flex min-h-16 items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-[#7f1d1d]">
                  <span className="min-w-0 flex-1">
                    <span className="block font-black text-slate-900">{project.name}</span>
                    <span className="block text-xs text-slate-600">{project.code}{project.client ? ` · ${project.client}` : ""}</span>
                  </span>
                  <ChevronRight className="size-5 shrink-0 text-[#7f1d1d]" />
                </Link>
              </li>
            ))}
          </ul>
        )}
        <SsmaInstallCard />
      </main>
    </div>
  );
}
