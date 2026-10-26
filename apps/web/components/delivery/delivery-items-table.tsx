import { Badge } from "@/components/ui/badge";
import { reviewRiskClassificationAction } from "@/app/[projectId]/risco/actions";
import { DeliveryItemEditor } from "@/components/delivery/delivery-item-editor";
import { RiskReviewPanel, type RiskReviewHistoryItem } from "@/components/risk/risk-review-panel";
import { deadlineStatusFromDate } from "@/lib/risk-classification/facts-builders";
import {
  DELIVERY_PHASE_LABELS,
  DELIVERY_STATUS_LABELS,
  DEPENDENCY_LABELS,
  computeCnoDeadline,
  deliveryAlertSchedule,
  deliveryFlags,
  type DeliveryFlag,
  type DeliveryItem,
} from "@/lib/delivery/delivery-items";
import { repeatIntervalPhrase } from "@/lib/alerts/repeat-policy";
import { alertRiskLevelLabels } from "@/lib/email/templates/contract-alert-template";
import { cn } from "@/lib/utils";

const FLAG_STYLE: Record<DeliveryFlag, { label: string; className: string }> = {
  SEM_RESPONSAVEL: { label: "Sem responsável", className: "border-amber-300 bg-amber-50 text-amber-900" },
  SEM_PRAZO: { label: "Sem prazo", className: "border-amber-300 bg-amber-50 text-amber-900" },
  PROXIMO_VENCIMENTO: { label: "Próximo do vencimento", className: "border-orange-300 bg-orange-50 text-orange-900" },
  VENCIDO: { label: "Vencido", className: "border-red-400 bg-red-100 text-red-900 font-semibold" },
  CONCLUIDO: { label: "Concluído", className: "border-emerald-300 bg-emerald-50 text-emerald-900" },
  NAO_APLICAVEL: { label: "Não aplicável", className: "border-slate-300 bg-slate-100 text-slate-700" },
  BLOQUEIA_ENTREGA: { label: "Bloqueia a entrega", className: "border-red-300 bg-white text-red-800 font-semibold" },
  APLICABILIDADE_A_CONFIRMAR: { label: "Aplicabilidade a confirmar", className: "border-sky-300 bg-sky-50 text-sky-900" },
  RISCO_A_DEFINIR: { label: "Risco a definir", className: "border-sky-300 bg-sky-50 text-sky-900" },
};

function formatDay(day: string | null): string {
  if (!day) return "A definir";
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
}

function rowTone(flags: DeliveryFlag[]): string {
  if (flags.includes("VENCIDO")) return "bg-red-50/70";
  if (flags.includes("CONCLUIDO")) return "bg-emerald-50/60";
  if (flags.includes("NAO_APLICAVEL")) return "bg-slate-50 text-muted-foreground";
  if (flags.includes("PROXIMO_VENCIMENTO")) return "bg-orange-50/60";
  return "";
}

export function DeliveryItemsTable({
  projectId,
  items,
  members,
  projectEndDay,
  projectStartDay,
  startCandidates,
  today,
  canEdit,
  riskHistoryByItem = {},
}: {
  projectId: string;
  items: DeliveryItem[];
  members: Array<{ userId: string; name: string }>;
  projectEndDay: string | null;
  projectStartDay: string | null;
  /** Datas de início candidatas conhecidas (cadastro x histórico) — divergência bloqueia o cálculo do CNO. */
  startCandidates?: string[];
  today: string;
  canEdit: boolean;
  /** Histórico de classificação de risco por providência (mais recente primeiro). */
  riskHistoryByItem?: Record<string, RiskReviewHistoryItem[]>;
}) {
  const nameById = new Map(members.map((m) => [m.userId, m.name]));
  const cno = items.find((i) => i.checklistKey === "CNO");
  const cnoDeadline = computeCnoDeadline({
    constructionStartDay: projectStartDay,
    startConfirmed: false,
    internalDeadline: cno?.internalDeadline ?? null,
    startCandidates,
  });

  return (
    <div className="flex flex-col gap-3">
      {!projectEndDay ? (
        <p role="note" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Preencha a <strong>data final da obra</strong> para calcular a janela de alertas de 60 dias antes do término. Sem ela, só os prazos
          individuais geram alerta.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Término previsto: <strong>{formatDay(projectEndDay)}</strong> — alertas das providências de entrega começam 60 dias corridos antes
          (ou no prazo individual, se ele vencer antes).
        </p>
      )}

      {cno ? (
        <p className="text-xs text-muted-foreground">
          CNO (providência de início): prazo de referência {formatDay(cnoDeadline.deadline)} — {cnoDeadline.basis}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[1100px] border-collapse text-sm">
          <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Providência</th>
              <th className="px-3 py-2">Fase</th>
              <th className="px-3 py-2">Data limite</th>
              <th className="px-3 py-2">Responsável</th>
              <th className="px-3 py-2">Situação</th>
              <th className="px-3 py-2">Grau de risco</th>
              <th className="px-3 py-2">Evidência / protocolo</th>
              <th className="px-3 py-2">Acompanhamento</th>
              {canEdit ? <th className="px-3 py-2">Ações</th> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const flags = deliveryFlags(item, today);
              const schedule = deliveryAlertSchedule(item, projectEndDay, today);
              return (
                <tr key={item.id} id={`item-${item.id}`} className={cn("border-t align-top", rowTone(flags))}>
                  <td className="px-3 py-2">
                    <p className="font-medium">{item.title}</p>
                    {item.checklistKey === null ? <p className="text-[11px] text-muted-foreground">Providência específica da obra</p> : null}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {flags
                        .filter((f) => f !== "CONCLUIDO" && f !== "NAO_APLICAVEL")
                        .map((f) => (
                          <Badge key={f} variant="outline" className={cn("text-[11px]", FLAG_STYLE[f].className)}>
                            {FLAG_STYLE[f].label}
                          </Badge>
                        ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{DELIVERY_PHASE_LABELS[item.phase]}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {formatDay(item.deadline)}
                    {item.internalDeadline ? <p className="text-[11px] text-muted-foreground">interno: {formatDay(item.internalDeadline)}</p> : null}
                  </td>
                  <td className="px-3 py-2">
                    {item.responsibleUserId ? nameById.get(item.responsibleUserId) ?? "Colaborador" : <span className="text-muted-foreground">A definir</span>}
                    {item.dependencyKind ? (
                      <p className="text-[11px] text-muted-foreground">
                        Depende de {DEPENDENCY_LABELS[item.dependencyKind].toLowerCase()}: {item.dependencyName}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className={cn(FLAG_STYLE[item.status === "CONCLUIDO" ? "CONCLUIDO" : item.status === "NAO_APLICAVEL" ? "NAO_APLICAVEL" : "SEM_PRAZO"].className, item.status !== "CONCLUIDO" && item.status !== "NAO_APLICAVEL" && "border-border bg-transparent text-foreground")}>
                      {DELIVERY_STATUS_LABELS[item.status]}
                    </Badge>
                    {item.status === "NAO_APLICAVEL" && item.justification ? (
                      <p className="mt-1 max-w-[220px] text-[11px] text-muted-foreground">Justificativa: {item.justification}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {item.risk ? `${alertRiskLevelLabels[item.risk]}` : <span className="text-muted-foreground">A definir</span>}
                    {item.risk ? <p className="text-[11px] text-muted-foreground">repete {repeatIntervalPhrase(item.risk)}</p> : null}
                  </td>
                  <td className="px-3 py-2 max-w-[220px] break-words">
                    {item.evidence ?? <span className="text-muted-foreground">A definir</span>}
                    {item.cnoNumber ? <p className="text-[11px] text-muted-foreground">CNO nº {item.cnoNumber}</p> : null}
                  </td>
                  <td className="px-3 py-2 max-w-[240px] text-xs text-muted-foreground">{schedule.message}</td>
                  {canEdit ? (
                    <td className="px-3 py-2 min-w-[120px]">
                      <DeliveryItemEditor
                        projectId={projectId}
                        item={item}
                        members={members}
                        riskPanel={
                          <RiskReviewPanel
                            action={reviewRiskClassificationAction.bind(null, projectId, "DELIVERY_ITEM", item.id)}
                            currentLevel={item.risk}
                            originalLevel={(riskHistoryByItem[item.id] ?? []).at(-1)?.previousLevel ?? null}
                            originalLabel="Classificação inicial"
                            canReview={canEdit}
                            verifiedClause={null}
                            obligationDescription={null}
                            evidence={item.evidence ? [{ kind: "EVIDENCIA", label: item.evidence }] : []}
                            recordDeadline={{ status: deadlineStatusFromDate(item.deadline, today), date: item.deadline }}
                            history={riskHistoryByItem[item.id] ?? []}
                          />
                        }
                      />
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
