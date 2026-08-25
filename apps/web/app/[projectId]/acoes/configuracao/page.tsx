import { notFound } from "next/navigation";

import { SlaAreaResponsiblesForm } from "@/components/sla/sla-area-responsibles-form";
import { SlaMatrixConfigForm } from "@/components/sla/sla-matrix-config-form";
import { SlaProjectSettingsForm } from "@/components/sla/sla-project-settings-form";
import { FeatureInfo } from "@/components/shared/feature-info";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentProjectPermission } from "@/lib/contract-review";
import { getProjectMembers } from "@/lib/data";
import { slaAreaLabels } from "@/lib/labels";
import { resolveBusinessHoursConfig, resolveGenericMatrixRule } from "@/lib/sla/resolve-matrix-rule";
import {
  getSlaAreaResponsibles,
  getSlaMatrixRules,
  getSlaProjectSettings,
} from "@/lib/sla/sla-actions-data";
import type { SlaArea, SlaRiskLevel } from "@/lib/sla/types";

const RISK_LEVELS: SlaRiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const AREAS = Object.keys(slaAreaLabels) as SlaArea[];

// "Matriz de SLA e Escalonamento" (seção 17) — tabela editável por
// projeto. ADMIN apenas (RLS reforça isso de qualquer forma — esta
// checagem é só para não renderizar um formulário que a RLS rejeitaria).
export default async function SlaConfigurationPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const permission = await getCurrentProjectPermission(projectId);
  if (permission !== "ADMINISTRADOR") {
    notFound();
  }

  const [matrixRules, areaResponsibles, members, projectSettings] = await Promise.all([
    getSlaMatrixRules(projectId),
    getSlaAreaResponsibles(projectId),
    getProjectMembers(projectId),
    getSlaProjectSettings(projectId),
  ]);

  const memberOptions = members.map((m) => ({ userId: m.userId, name: m.user.name }));
  const responsiblesByArea = new Map(areaResponsibles.map((r) => [r.area, r]));
  const businessHoursConfig = resolveBusinessHoursConfig(projectSettings);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Matriz de SLA e Escalonamento</h1>
        <p className="text-sm text-muted-foreground">
          Configuração específica deste projeto — sobrescreve os defaults (BAIXO/MÉDIO/ALTO/CRÍTICO) descritos em
          docs/sla-escalation.md.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            Timezone e horário útil
            <FeatureInfo helpId="sla-config-timezone" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SlaProjectSettingsForm
            projectId={projectId}
            timezone={businessHoursConfig.timeZone}
            businessDayStartHour={businessHoursConfig.businessDayStartHour}
            businessDayEndHour={businessHoursConfig.businessDayEndHour}
            isDefault={projectSettings === null}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            Prazos por nível de risco
            <FeatureInfo helpId="sla-config-matriz-prazos" />
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {RISK_LEVELS.map((riskLevel) => (
            <SlaMatrixConfigForm
              key={riskLevel}
              projectId={projectId}
              riskLevel={riskLevel}
              rule={resolveGenericMatrixRule(matrixRules, riskLevel)}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            Responsáveis por área e escalão
            <FeatureInfo helpId="sla-config-responsaveis" />
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {AREAS.map((area) => {
            const current = responsiblesByArea.get(area);
            return (
              <SlaAreaResponsiblesForm
                key={area}
                projectId={projectId}
                area={area}
                responsibleDirectUserId={current?.responsibleDirectUserId ?? null}
                escalation1UserId={current?.escalation1UserId ?? null}
                escalation2UserId={current?.escalation2UserId ?? null}
                boardUserId={current?.boardUserId ?? null}
                members={memberOptions}
              />
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
