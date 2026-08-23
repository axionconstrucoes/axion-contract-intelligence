"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SeverityBadge } from "@/components/shared/badges";
import { expertIconClassName, resolveExpertIcon } from "@/components/ai/expert-visual-identity";
import {
  createActionForFindingAction,
  dismissFindingAction,
  resolveFindingAction,
} from "@/app/[projectId]/startup/actions";
import {
  initialCreateActionForFindingState,
  initialDismissFindingState,
  initialResolveFindingState,
} from "@/app/[projectId]/startup/actions-state";
import { OFFICIAL_EXPERT_DEFINITIONS } from "@/lib/ai/expert-definitions";
import { confrontationSeverityToAlertSeverity, slaAreaLabels } from "@/lib/labels";
import type { AiFinding } from "@/lib/additionals/findings/types";
import type { SlaArea } from "@/lib/sla/types";

const AREA_OPTIONS = Object.keys(slaAreaLabels) as SlaArea[];

type DecisionMode = null | "dismiss" | "resolve" | "action";

const DECIDED_STATUSES = ["DISMISSED_AT_STARTUP", "RESOLVED_BEFORE_GO_LIVE", "ACTION_CREATED"];

/**
 * Um finding histórico ALTO/CRÍTICO com as três decisões humanas
 * exclusivas (seção 8) — [DESCONSIDERAR] / [JÁ TRATADO/PACIFICADO] /
 * [CUIDAR DESTE ASSUNTO]. Já decidido: mostra o resultado (seção 13),
 * nunca remove o finding da lista (histórico nunca é apagado).
 */
export function HistoricalFindingCard({
  projectId,
  finding,
  memberOptions,
}: {
  projectId: string;
  finding: AiFinding;
  memberOptions: { userId: string; name: string; email: string }[];
}) {
  const [mode, setMode] = useState<DecisionMode>(null);
  const decided = DECIDED_STATUSES.includes(finding.lifecycleStatus);

  return (
    <div className="flex flex-col gap-2 rounded-md border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <SeverityBadge severity={confrontationSeverityToAlertSeverity[finding.severity]} />
          <span className="text-sm font-medium">{finding.findingType}</span>
          {finding.classification ? <span className="text-xs text-muted-foreground">({finding.classification})</span> : null}
        </div>
        <div className="flex items-center gap-2">
          {finding.expertIds.map((expertId) => {
            const definition = OFFICIAL_EXPERT_DEFINITIONS[expertId as keyof typeof OFFICIAL_EXPERT_DEFINITIONS];
            if (!definition) return null;
            const Icon = resolveExpertIcon(definition.visualIdentity);
            return (
              <span key={expertId} title={definition.expertName}>
                <Icon className={expertIconClassName(definition.visualIdentity, "size-3.5")} aria-hidden="true" />
              </span>
            );
          })}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{finding.interpretation}</p>
      <p className="text-xs text-muted-foreground">Recomendação: {finding.recommendation}</p>

      {decided ? (
        <DecisionSummary finding={finding} />
      ) : (
        <>
          {mode === null ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setMode("dismiss")}>
                Desconsiderar
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setMode("resolve")}>
                Já tratado / Pacificado
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setMode("action")}>
                Cuidar deste assunto
              </Button>
            </div>
          ) : null}

          {mode === "dismiss" ? <DismissForm projectId={projectId} findingId={finding.id} onCancel={() => setMode(null)} /> : null}
          {mode === "resolve" ? <ResolveForm projectId={projectId} findingId={finding.id} onCancel={() => setMode(null)} /> : null}
          {mode === "action" ? (
            <CreateActionForm projectId={projectId} findingId={finding.id} memberOptions={memberOptions} onCancel={() => setMode(null)} />
          ) : null}
        </>
      )}
    </div>
  );
}

function DecisionSummary({ finding }: { finding: AiFinding }) {
  if (finding.lifecycleStatus === "DISMISSED_AT_STARTUP") {
    return (
      <p className="text-xs text-muted-foreground">
        <strong>Desconsiderado.</strong> Justificativa: {finding.reviewerNote}
      </p>
    );
  }
  if (finding.lifecycleStatus === "RESOLVED_BEFORE_GO_LIVE") {
    return (
      <p className="text-xs text-muted-foreground">
        <strong>Já tratado / pacificado.</strong> {finding.resolutionDescription}
        {finding.resolutionApproximateDate ? ` (em ${finding.resolutionApproximateDate})` : ""}
      </p>
    );
  }
  return <p className="text-xs text-muted-foreground">Ação de SLA criada para este finding — ver Ações e Escalonamentos.</p>;
}

function DismissForm({ projectId, findingId, onCancel }: { projectId: string; findingId: string; onCancel: () => void }) {
  const [state, formAction, pending] = useActionState(dismissFindingAction, initialDismissFindingState);
  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-md bg-muted/40 p-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="findingId" value={findingId} />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Justificativa
        <Textarea name="justification" rows={2} required />
      </label>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Salvando…" : "Confirmar"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function ResolveForm({ projectId, findingId, onCancel }: { projectId: string; findingId: string; onCancel: () => void }) {
  const [state, formAction, pending] = useActionState(resolveFindingAction, initialResolveFindingState);
  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-md bg-muted/40 p-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="findingId" value={findingId} />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Como foi resolvido
        <Textarea name="description" rows={2} required />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Data aproximada (opcional)
        <Input type="date" name="approximateDate" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Evidência (opcional)
        <Input name="evidenceNote" />
      </label>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Salvando…" : "Confirmar"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function CreateActionForm({
  projectId,
  findingId,
  memberOptions,
  onCancel,
}: {
  projectId: string;
  findingId: string;
  memberOptions: { userId: string; name: string; email: string }[];
  onCancel: () => void;
}) {
  const [state, formAction, pending] = useActionState(createActionForFindingAction, initialCreateActionForFindingState);
  const axionMembers = memberOptions.filter((m) => m.email.toLowerCase().endsWith("@axion.com.br"));

  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-md bg-muted/40 p-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="findingId" value={findingId} />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Responsável (@axion.com.br)
        <Select name="responsibleUserId" required defaultValue="">
          <option value="" disabled>
            Selecione…
          </option>
          {axionMembers.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name} ({m.email})
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Área
        <Select name="area" defaultValue="ENGENHARIA" required>
          {AREA_OPTIONS.map((a) => (
            <option key={a} value={a}>
              {slaAreaLabels[a]}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Descrição da ação
        <Textarea name="actionDescription" rows={2} required />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Prazo (opcional)
        <Input type="datetime-local" name="dueAt" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Observação (opcional)
        <Input name="note" />
      </label>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Criando…" : "Criar ação"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
