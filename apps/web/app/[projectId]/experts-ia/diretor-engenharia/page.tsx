import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { ExpertQueryPanel } from "@/components/ai/expert-query-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { askEngineeringDirectorAction } from "@/lib/ai/engineering-query-action";
import { initialAskCommercialDirectorState } from "@/lib/ai/expert-query-state";

export const metadata: Metadata = { title: "Diretor de Planejamento IA" };

export default async function DiretorEngenhariaPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Diretor de Planejamento IA"
        description="Especialista em cronogramas e planejamento de obras. Analisa prazo, caminho crítico, desvios, relações entre atividades e impactos contratuais com base no MPP estruturado, sempre com revisão humana."
      />

      <Card>
        <CardHeader>
          <CardTitle>Consultas recomendadas</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
          <p>• Qual é a data final prevista da obra e quais atividades estão no caminho crítico?</p>
          <p>• Quais atividades têm menor folga e maior risco de atraso?</p>
          <p>• Quais relações entre atividades podem comprometer o prazo final?</p>
          <p>• O cronograma carregado indica risco de impacto contratual relevante?</p>
        </CardContent>
      </Card>

      <ExpertQueryPanel
        projectId={projectId}
        scope="PROJECT"
        title="Pergunte ao Diretor de Planejamento IA"
        action={askEngineeringDirectorAction}
        initialState={initialAskCommercialDirectorState}
      />
    </div>
  );
}
