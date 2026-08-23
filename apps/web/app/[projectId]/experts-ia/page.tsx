import Link from "next/link";
import { CheckCircle2, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ALL_OFFICIAL_EXPERT_DEFINITIONS, type OfficialExpertId } from "@/lib/ai/expert-definitions";
import { buildAiProviderUiMetadata } from "@/lib/ai/provider-ui-metadata";
import { resolveAiProviderNameForExpert } from "@/lib/ai/providers/resolve-provider-for-expert";
import { expertAccentBorderClassName, expertIconClassName, resolveExpertIcon } from "@/components/ai/expert-visual-identity";
import { cn } from "@/lib/utils";

// Hub central dos 5 Experts oficiais do ACC — nunca substitui os
// acessos contextuais já existentes (Diretor Comercial IA no
// Dashboard/Event Ledger, Diretor de ESG IA em ESG/SSMA), só reúne
// todos num único lugar. Nome/missão/status vêm sempre de
// apps/web/lib/ai/expert-definitions/ (fonte de verdade única — ver
// docs/ai/expert-capabilities.md) — nunca duplicados aqui.
const EXPERT_ACCESS_HREF: Partial<Record<OfficialExpertId, (projectId: string) => string>> = {
  "commercial-director": (projectId) => `/${projectId}/dashboard`,
  "esg-director": (projectId) => `/${projectId}/esg`,
};

export default async function ExpertsIaPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Experts IA</h1>
        <p className="text-sm text-muted-foreground">
          Hub central dos Experts oficiais do ACC para este projeto — toda sugestão exige revisão humana. Os
          acessos já existentes (Diretor Comercial IA no Dashboard, Diretor de ESG IA em ESG/SSMA) continuam
          disponíveis normalmente; este hub não os substitui.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ALL_OFFICIAL_EXPERT_DEFINITIONS.map((expert) => {
          const isActive = expert.status === "IMPLEMENTED";
          const href = EXPERT_ACCESS_HREF[expert.expertId]?.(projectId);
          const providerMeta = buildAiProviderUiMetadata(resolveAiProviderNameForExpert(expert.expertId), null);
          const Icon = resolveExpertIcon(expert.visualIdentity);

          return (
            <Card key={expert.expertId} className={cn("flex flex-col", expertAccentBorderClassName(expert.visualIdentity))}>
              <CardHeader className="gap-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Icon className={cn("size-4 shrink-0", expertIconClassName(expert.visualIdentity))} aria-hidden="true" />
                    {expert.expertName}
                  </CardTitle>
                  <Badge variant={isActive ? "default" : "secondary"} className="shrink-0">
                    {isActive ? <CheckCircle2 className="size-3" /> : <Clock className="size-3" />}
                    {isActive ? "Ativo" : "Em implantação"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{expert.mission}</p>
                <Badge variant="outline" className="w-fit text-[10px] font-normal text-muted-foreground">
                  Provider: {providerMeta.providerLabel}
                </Badge>
              </CardHeader>
              <CardContent className="mt-auto">
                {isActive && href ? (
                  <Link href={href} className={cn(buttonVariants({ size: "sm" }))}>
                    Abrir Expert
                  </Link>
                ) : isActive ? (
                  <span className="text-xs font-medium text-muted-foreground">
                    Operacional — consulta disponível via API; interface dedicada ainda não construída nesta fase.
                  </span>
                ) : (
                  <span className="text-xs font-medium text-muted-foreground">
                    Em implantação — ainda não operacional nesta fase.
                  </span>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
