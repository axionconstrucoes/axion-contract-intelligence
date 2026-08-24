import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LogoutButton } from "@/components/auth/logout-button";
import { getProjects } from "@/lib/data";
import { formatDate } from "@/lib/labels";

export const metadata: Metadata = { title: "Projetos" };

export default async function ProjetosPage() {
  const projects = await getProjects();

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-8 p-8">
      <div className="flex items-start justify-between gap-4 border-b border-border pb-6">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- PNG estático em public/, sem otimização de imagem necessária */}
          <img src="/branding/acc-logo.png" alt="ACC" className="h-10 w-auto rounded-md" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Selecione um projeto</h1>
            <p className="text-sm text-muted-foreground">Obras e projetos Axion com inteligência contratual ativa.</p>
          </div>
        </div>
        <LogoutButton />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {projects.map((project) => (
          <Link key={project.id} href={`/${project.id}/dashboard`}>
            <Card className="h-full transition-all hover:-translate-y-0.5 hover:border-brand-accent/40 hover:shadow-[var(--shadow-md)]">
              <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="text-base">{project.name}</CardTitle>
                  <p className="pt-1 text-sm text-muted-foreground">
                    {project.client} · {project.location}
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0">{project.status}</Badge>
              </CardHeader>
              <CardContent className="pt-0 text-xs text-muted-foreground">
                {project.contractNumber && <>Contrato {project.contractNumber} · </>}
                Início {formatDate(project.startDate)} · Prazo baseline {formatDate(project.baselineEndDate)}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-4 border-t border-border pt-4 text-xs text-muted-foreground">
        <span>Identidade visual ACC:</span>
        <a href="/branding/acc-logo.png" download className="underline decoration-dotted hover:text-foreground">
          Baixar logotipo (PNG)
        </a>
        <a href="/branding/acc-icon.svg" download className="underline decoration-dotted hover:text-foreground">
          Baixar ícone técnico (SVG)
        </a>
      </div>
    </div>
  );
}
