import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseServerClient } from "@axion/db/server";
import { InstitutionalBackground } from "@/components/brand/institutional-background";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LogoutButton } from "@/components/auth/logout-button";
import { getProjects } from "@/lib/data";
import { formatDate } from "@/lib/labels";
import { Pencil, Plus, Scale } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

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

  const canCreateProject = adminProjectIds.size > 0;

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

          <div className="flex items-center gap-2">
            {canCreateProject ? (
              <Link href="/projetos/novo" className={buttonVariants({ className: "gap-2" })}>
                <Plus aria-hidden="true" />
                NOVO PROJETO
              </Link>
            ) : null}
            <LogoutButton />
          </div>
        </div>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(250px,0.42fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            {contractedProjects.length === 0 ? (
              <Card className="border-dashed bg-white/70">
                <CardContent className="p-6 text-sm text-slate-600">
                  Nenhum projeto disponível para sua conta.
                </CardContent>
              </Card>
            ) : null}
            {contractedProjects.map((project) => (
              <div key={project.id} className="relative">
              <Link href={`/${project.id}/dashboard`}>
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

                  <CardContent className={`pt-0 text-sm text-white/80${adminProjectIds.has(project.id) ? " pr-44" : ""}`}>
                    No. sistema UNO: {project.code} ·{" "}
                    {project.contractNumber && (
                      <>Contrato {project.contractNumber} · </>
                    )}
                    Início {formatDate(project.startDate)} · Prazo baseline{" "}
                    {formatDate(project.baselineEndDate)}
                  </CardContent>
                </Card>
              </Link>
              {/* Fora do <Link> do card: âncoras aninhadas são HTML inválido. */}
              {adminProjectIds.has(project.id) ? (
                <Link
                  href={`/projetos/${project.id}/editar?origem=selecao`}
                  className={buttonVariants({
                    variant: "outline",
                    size: "sm",
                    className: "absolute bottom-4 right-4 gap-1.5 border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white",
                  })}
                >
                  <Pencil aria-hidden="true" />
                  Editar projeto
                </Link>
              ) : null}
              </div>
            ))}
          </div>

          <Link
            href="/juridico"
            title="Criar ou abrir uma análise de minuta antes da contratação da obra."
            className="block"
          >
            <Card className="h-full border-[#0756A8] bg-[#1267C4] text-white shadow-md transition-all hover:bg-[#0E5AAD] hover:shadow-lg">
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
