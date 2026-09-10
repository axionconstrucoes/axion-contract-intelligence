import type { Metadata } from "next";
import Link from "next/link";
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
  const contractedProjects = projects.filter((project) => project.workspaceType === "OBRA");

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden p-6">
      <InstitutionalBackground />

      {/* Painel translúcido: mesmo motivo do Card em /login — o fundo
          institucional fica só atrás do conteúdo, nunca sob o texto
          diretamente, para preservar contraste. */}
      <div className="relative flex w-full max-w-5xl flex-col gap-6 rounded-lg border border-border bg-card p-8 shadow-xl">
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
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="flex flex-col gap-3">
            {contractedProjects.map((project) => (
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
          <Link href="/juridico" className="h-fit" title="Criar ou abrir uma análise de minuta antes da contratação da obra.">
            <Card className="border-primary/30 transition-colors hover:bg-accent/50">
              <CardHeader><CardTitle className="flex items-center gap-2"><Scale className="size-5" />Jurídico</CardTitle></CardHeader>
              <CardContent className="text-sm text-muted-foreground">Análise prévia de minutas para apoiar a negociação contratual, com consulta integrada aos especialistas do CEO IA.</CardContent>
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
}
