import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getProjects } from "@/lib/data";
import { formatDate } from "@/lib/labels";

export default function ProjetosPage() {
  const projects = getProjects();

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 p-8">
      <div>
        <h1 className="text-lg font-semibold">Selecione um projeto</h1>
        <p className="text-sm text-muted-foreground">Obras e projetos Axion com inteligência contratual ativa.</p>
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
                Contrato {project.contractNumber} · Início {formatDate(project.startDate)} · Prazo baseline {formatDate(project.baselineEndDate)}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
