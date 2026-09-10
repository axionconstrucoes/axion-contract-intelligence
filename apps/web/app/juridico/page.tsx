import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Scale } from "lucide-react";
import { InstitutionalBackground } from "@/components/brand/institutional-background";
import { PrecontractWorkspaceCreateForm } from "@/components/legal/precontract-workspace-create-form";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getProjects } from "@/lib/data";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Jurídico pré-contratual" };

export default async function JuridicoPage() {
  const projects = await getProjects();
  const workspaces = projects.filter((project) => project.workspaceType === "PRE_CONTRATUAL");

  return (
    <div className="relative min-h-dvh overflow-hidden p-6">
      <InstitutionalBackground />
      <div className="relative mx-auto flex w-full max-w-5xl flex-col gap-6 rounded-lg border bg-card p-8 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <div><h1 className="flex items-center gap-2 text-xl font-semibold"><Scale className="size-5" />Jurídico — análise prévia</h1><p className="text-sm text-muted-foreground">Negociação de minutas antes da contratação.</p></div>
          <Link href="/projetos" className={cn(buttonVariants({ variant: "outline" }))}><ArrowLeft className="size-4" />Voltar</Link>
        </div>

        <Card>
          <CardHeader><CardTitle>Nova análise pré-contratual</CardTitle></CardHeader>
          <CardContent>
            <PrecontractWorkspaceCreateForm />
          </CardContent>
        </Card>

        <div className="grid gap-3 md:grid-cols-2">
          {workspaces.map((workspace) => (
            <Link key={workspace.id} href={`/${workspace.id}/juridico`}>
              <Card className="h-full transition-colors hover:bg-accent/50"><CardHeader><CardTitle>{workspace.name}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">Cliente: {workspace.client}<br />Abrir documentos e análise integrada</CardContent></Card>
            </Link>
          ))}
          {workspaces.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma análise pré-contratual criada.</p> : null}
        </div>
      </div>
    </div>
  );
}
