import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BookOpen, Download, FileText } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getProject } from "@/lib/data";
import { TUTORIAL_FILES } from "@/lib/help/tutorial-files";

export const metadata: Metadata = { title: "Ajuda e tutorial" };

export default async function AjudaPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  const base = `/${projectId}/ajuda/tutorial`;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Ajuda e tutorial" description="Apresentação da suíte e guia de uso do ACC, com imagens das telas e dos e-mails de alerta." />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base font-bold">
            <BookOpen className="size-4" /> Apresentação e tutorial do ACC
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <p>
            Cobre acesso e seleção de obra, documentos e cláusulas, alertas e respostas parciais, CONSULTAR IA, providências e CNO,
            SSMA no celular (instalação e uso sem internet) e permissões. As imagens usam dados fictícios e informam o que foi
            verificado e o que ainda depende de teste real.
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              href={`${base}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 items-center gap-2 rounded-md bg-red-900 px-4 text-sm font-bold text-white hover:bg-red-800"
            >
              <FileText className="size-4" /> {TUTORIAL_FILES.pdf.label}
            </a>
            <a
              href={`${base}/pptx`}
              className="inline-flex min-h-10 items-center gap-2 rounded-md border-2 border-red-900 px-4 text-sm font-bold text-red-900 hover:bg-red-50"
            >
              <Download className="size-4" /> {TUTORIAL_FILES.pptx.label}
            </a>
          </div>
          <p className="text-xs text-muted-foreground">
            Acesso restrito a usuários autenticados com acesso a esta obra. O PowerPoint é editável; o PDF é para consulta.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
