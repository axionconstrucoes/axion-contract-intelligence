import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseServerClient } from "@axion/db/server";
import { InstitutionalBackground } from "@/components/brand/institutional-background";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LogoutButton } from "@/components/auth/logout-button";
import { getProjects } from "@/lib/data";
import { formatDate } from "@/lib/labels";
import { Scale } from "lucide-react";

export const metadata: Metadata = { title: "Projetos" };

export default async function ProjetosPage() {
  const projects = await getProjects();
  const contractedProjects = projects.filter(
    (project) => project.workspaceType === "OBRA"
  );

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const adminProjectIds = new Set<string>();

  if (user && contractedProjects.length > 0) {
    const { data: memberships } = await supabase
      .from("project_memberships")
      .select("project_id, permission, status")
      .eq("user_id", user.id)
      .eq("status", "ACTIVE")
      .in(
        "project_id",
        contractedProjects.map((project) => project.id)
      );

    for (const membership of memberships ?? []) {
      if (membership.permission === "ADMINISTRADOR") {
        adminProjectIds.add(membership.project_id);
      }
    }
  }

  function projectDisplayName(projectId: string, name: string) {
    if (adminProjectIds.has(projectId)) return name;
    return name.replace(/^\[DEV\]\s*/i, "");
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden p-6">
      <InstitutionalBackground />

      <div className="relative flex w-full max-w-5xl flex-col gap-6 rounded-2xl border border-black/10 bg-[#F7F4EC] p-8 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/branding/acc-logo.png"
              alt="ACC"
              className="h-12 w-auto"
            />

            <div>
              <h1 className="text-2xl font-semibold text-slate-950">
                Selecione um projeto
              </h1>

              <p className="mt-1 text-base text-slate-600">
                Obras e projetos Axion com inteligência contratual ativa.
              </p>
            </div>
          </div>

          <LogoutButton />
        </div>

        <div className="grid gap-5">
          <div className="flex flex-col gap-4">
            {contractedProjects.map((project) => (
              <Link key={project.id} href={`/${project.id}/dashboard`}>
                <Card className="border-[#041D36] bg-[#062B4F] text-white shadow-md transition-all hover:bg-[#083761] hover:shadow-lg">
                  <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
                    <div>
                      <CardTitle className="text-xl font-semibold text-white">
                        {projectDisplayName(project.id, project.name)}
                      </CardTitle>

                      <p className="pt-2 text-base text-white/85">
                        {project.client} · {project.location}
                      </p>
                    </div>

                    <Badge className="border-0 bg-[#319B3F] px-4 py-1.5 font-semibold text-white hover:bg-[#319B3F]">
                      {project.status}
                    </Badge>
                  </CardHeader>

                  <CardContent className="pt-0 text-sm text-white/80">
                    {project.contractNumber && (
                      <>Contrato {project.contractNumber} · </>
                    )}
                    Início {formatDate(project.startDate)} · Prazo baseline{" "}
                    {formatDate(project.baselineEndDate)}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          <Link
            href="/juridico"
            title="Criar ou abrir uma análise de minuta antes da contratação da obra."
          >
            <Card className="mx-auto w-[96%] border-[#0756A8] bg-[#1267C4] text-white shadow-md transition-all hover:bg-[#0E5AAD] hover:shadow-lg">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-3 text-xl font-semibold text-white">
                  <Scale className="size-6" />
                  Jurídico IA
                </CardTitle>
              </CardHeader>

              <CardContent className="pb-5 pt-0 text-base leading-relaxed text-white/90">
                Análise prévia de minutas para apoiar a negociação contratual,
                com consulta integrada aos especialistas do CEO IA.
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
}
