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

      <details className="rounded-md border">
        <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-sm font-medium">
          Timezone e horário útil
          <FeatureInfo helpId="sla-config-timezone" />
        </summary>
        <div className="border-t px-3 py-3">
          <SlaProjectSettingsForm
            projectId={projectId}
            timezone={businessHoursConfig.timeZone}
            businessDayStartHour={businessHoursConfig.businessDayStartHour}
            businessDayEndHour={businessHoursConfig.businessDayEndHour}
            isDefault={projectSettings === null}
          />
        </div>
      </details>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            Prazos por nível de risco
            <FeatureInfo helpId="sla-config-matriz-prazos" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Tabela SEMÂNTICA real (<table>/<thead>/<tbody>/<th scope>),
              não um CSS Grid disfarçado — cada uma das 4 linhas
              (Baixo/Médio/Alto/Crítico) salva/audita independentemente
              através de um <form> próprio, EXTERNO à tabela (portalado
              para o body, ver sla-matrix-config-form.tsx — um <form>
              nunca pode envolver <tr>/<td> validamente), associado aos
              controles de cada linha só pelo atributo HTML `form`. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead>
                <tr className="border-b text-left">
                  <th scope="col" className="px-2 py-1.5 font-semibold text-muted-foreground">Risco</th>
                  <th scope="col" className="px-1 py-1.5 font-semibold text-muted-foreground">Unidade</th>
                  <th scope="col" className="px-1 py-1.5 font-semibold text-muted-foreground">Assumir</th>
                  <th scope="col" className="px-1 py-1.5 font-semibold text-muted-foreground">Responder</th>
                  <th scope="col" className="px-1 py-1.5 font-semibold text-muted-foreground">Concluir</th>
                  <th scope="col" className="px-1 py-1.5 font-semibold text-muted-foreground">2º escalão</th>
                  <th scope="col" className="px-1 py-1.5 font-semibold text-muted-foreground">Diretoria</th>
                  <th scope="col" className="px-1 py-1.5 font-semibold text-muted-foreground">Opções</th>
                  <th scope="col" className="px-1 py-1.5 font-semibold text-muted-foreground">Ações</th>
                </tr>
              </thead>
              <tbody>
                {RISK_LEVELS.map((riskLevel) => (
                  <SlaMatrixConfigForm
                    key={riskLevel}
                    projectId={projectId}
                    riskLevel={riskLevel}
                    rule={resolveGenericMatrixRule(matrixRules, riskLevel)}
                  />
                ))}
              </tbody>
            </table>
          </div>
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
