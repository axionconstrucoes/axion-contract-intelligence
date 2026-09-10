import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { ExpertQueryPanel } from "@/components/ai/expert-query-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { askEngineeringDirectorAction } from "@/lib/ai/engineering-query-action";
import { initialAskCommercialDirectorState } from "@/lib/ai/expert-query-state";

export const metadata: Metadata = { title: "Diretor de Engenharia IA" };

export default async function DiretorEngenhariaPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Diretor de Engenharia IA"
        description="Especialista em construções industriais, centros logísticos e empreendimentos de saúde. Analisa execução, novas versões de projeto, prazo, preço e não conformidades, sempre com revisão humana."
      />

      <Card>
        <CardHeader>
          <CardTitle>Consultas recomendadas</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
          <p>• Esta nova versão gera impacto no cronograma e/ou no preço?</p>
          <p>• Há item novo que deve ser verificado pelo orçamentista?</p>
          <p>• Qual é o risco técnico deste atraso para a execução?</p>
          <p>• Esta não conformidade de compras afeta prazo, qualidade ou custo?</p>
        </CardContent>
      </Card>

      <ExpertQueryPanel
        projectId={projectId}
        scope="PROJECT"
        title="Pergunte ao Diretor de Engenharia IA"
        action={askEngineeringDirectorAction}
        initialState={initialAskCommercialDirectorState}
      />
    </div>
  );
}
