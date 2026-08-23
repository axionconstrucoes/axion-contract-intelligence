// Cards EXPERTS IA / CEO IA (seção 16) — só análises PERSISTIDAS
// (ai_findings já gravados), nunca dispara uma chamada ao Anthropic ao
// abrir o Dashboard. Reaproveita a mesma identidade visual/severidade
// já usada em Start-up ACC (components/startup/historical-finding-card.tsx).

import { SeverityBadge } from "@/components/shared/badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FeatureInfo } from "@/components/shared/feature-info";
import { resolveExpertIcon, expertIconClassName } from "@/components/ai/expert-visual-identity";
import { OFFICIAL_EXPERT_DEFINITIONS } from "@/lib/ai/expert-definitions";
import { confrontationSeverityToAlertSeverity, findingTypeLabels } from "@/lib/labels";
import type { AiFinding } from "@/lib/additionals/findings/types";

export function ExpertsCard({ findings }: { findings: AiFinding[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          Experts IA
          <FeatureInfo helpId="dashboard-visual-experts" />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {findings.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma análise persistida disponível no momento.</p>
        ) : (
          findings.map((finding) => (
            <div key={finding.id} className="flex flex-col gap-1 rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {finding.expertIds.map((expertId) => {
                    const definition = OFFICIAL_EXPERT_DEFINITIONS[expertId as keyof typeof OFFICIAL_EXPERT_DEFINITIONS];
                    if (!definition) return null;
                    const Icon = resolveExpertIcon(definition.visualIdentity);
                    return (
                      <span key={expertId} className="flex items-center gap-1 text-xs font-medium">
                        <Icon className={expertIconClassName(definition.visualIdentity, "size-3.5")} aria-hidden="true" />
                        {definition.expertName}
                      </span>
                    );
                  })}
                  <span className="text-xs text-muted-foreground">{findingTypeLabels[finding.findingType as keyof typeof findingTypeLabels] ?? finding.findingType}</span>
                </div>
                <SeverityBadge severity={confrontationSeverityToAlertSeverity[finding.severity]} />
              </div>
              <p className="text-sm text-muted-foreground">{finding.interpretation}</p>
              <p className="text-xs text-muted-foreground">
                Fonte: {finding.sourceRefs.length > 0 ? `${finding.sourceRefs.length} evidência(s) vinculada(s)` : "Nenhuma evidência vinculada"}
              </p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export function CeoConsolidationCard({ finding }: { finding: AiFinding | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          CEO IA
          <FeatureInfo helpId="dashboard-visual-ceo" />
        </CardTitle>
      </CardHeader>
      <CardContent>
        {finding ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <SeverityBadge severity={confrontationSeverityToAlertSeverity[finding.severity]} />
            </div>
            <p className="text-sm text-muted-foreground">{finding.interpretation}</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhuma consolidação executiva disponível no momento.</p>
        )}
      </CardContent>
    </Card>
  );
}
