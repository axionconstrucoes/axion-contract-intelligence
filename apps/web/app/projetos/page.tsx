import type { Metadata } from "next";
import Link from "next/link";
import {
  InstitutionalBackground,
  INSTITUTIONAL_BACKGROUND_PNG_PATH,
  INSTITUTIONAL_BACKGROUND_SVG_PATH,
} from "@/components/brand/institutional-background";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LogoutButton } from "@/components/auth/logout-button";
import { getProjects } from "@/lib/data";
import { formatDate } from "@/lib/labels";

export const metadata: Metadata = { title: "Projetos" };

export default async function ProjetosPage() {
  const projects = await getProjects();

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden p-6">
      <InstitutionalBackground />

      {/* Painel translúcido: mesmo motivo do Card em /login — o fundo
          institucional fica só atrás do conteúdo, nunca sob o texto
          diretamente, para preservar contraste. */}
      <div className="relative flex w-full max-w-3xl flex-col gap-6 rounded-lg border border-border bg-card p-8 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- PNG estático em public/, sem otimização de imagem necessária */}
            <img src="/branding/acc-logo.png" alt="ACC" className="h-9 w-auto" />
            <div>
              <h1 className="text-lg font-semibold">Selecione um projeto</h1>
              <p className="text-sm text-muted-foreground">Obras e projetos Axion com inteligência contratual ativa.</p>
            </div>
          </div>
          <LogoutButton />
        </div>
        <div className="flex flex-col gap-3">
          {projects.map((project) => (
            <Link key={project.id} href={`/${project.id}/dashboard`}>
              <Card className="transition-colors hover:bg-accent/50">
                <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
                  <div>
                    <CardTitle>{project.name}</CardTitle>
                    <p className="pt-1 text-sm text-muted-foreground">
                      {project.client} · {project.location}
                    </p>
                  </div>
                  <Badge variant="outline">{project.status}</Badge>
                </CardHeader>
                <CardContent className="pt-0 text-xs text-muted-foreground">
                  {project.contractNumber && <>Contrato {project.contractNumber} · </>}
                  Início {formatDate(project.startDate)} · Prazo baseline {formatDate(project.baselineEndDate)}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-4 border-t border-border pt-4 text-xs text-muted-foreground">
          <span>Identidade visual ACC:</span>
          <a href="/branding/acc-logo.png" download className="underline hover:text-foreground">
            Baixar logotipo (PNG)
          </a>
          <a href="/branding/acc-icon.svg" download className="underline hover:text-foreground">
            Baixar ícone técnico (SVG)
          </a>
          <a href={INSTITUTIONAL_BACKGROUND_SVG_PATH} download className="underline hover:text-foreground">
            Baixar fundo institucional
          </a>
          <a href={INSTITUTIONAL_BACKGROUND_PNG_PATH} download className="underline hover:text-foreground">
            Baixar fundo em PNG
          </a>
        </div>
      </div>
    </div>
  );
}
