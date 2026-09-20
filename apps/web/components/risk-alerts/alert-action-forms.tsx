"use client";

// Formulários das ações formais do alerta: [RESOLVIDO] [TOMANDO
// PROVIDÊNCIAS] [ENVIAR P/] [ESPECIALISTA] [OUTRO]. Cada ação é um POST
// (server action) com confirmação; nada muda por GET. Para HIGH/CRITICAL,
// as quatro últimas provocam escalonamento imediato ao próximo nível
// (regra única em alert-state-machine.ts) — informado aqui, decidido lá.

import { useMemo, useState } from "react";
import { useActionState } from "react";

import { applyAlertActionAction } from "@/app/[projectId]/alertas/[caseId]/actions";
import { initialEmailRegistryActionState } from "@/app/[projectId]/documentos/emails/actions-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ForwardCandidate } from "@/lib/risk-alerts/alert-detail-data";
import { ALERT_ACTION_LABELS, type AlertActionType } from "@/lib/risk-alerts/types";

export interface AlertActionFormsProps {
  projectId: string;
  caseId: string;
  riskLevel: string;
  availableActions: AlertActionType[];
  forwardCandidates: ForwardCandidate[];
  expertOptions: Array<{ id: string; label: string; domains: string }>;
  suggestedExpert: string | null;
  requiresJustification: boolean;
  nextLevelLabel: string | null;
  initialAction: AlertActionType | null;
  token: string | null;
}

const ESCALATING: AlertActionType[] = ["TAKING_ACTION", "FORWARD", "EXPERT_CONSULTATION", "OTHER"];

export function AlertActionForms(props: AlertActionFormsProps) {
  const [selected, setSelected] = useState<AlertActionType | null>(props.initialAction && props.availableActions.includes(props.initialAction) ? props.initialAction : null);
  const [state, formAction, pending] = useActionState(applyAlertActionAction, initialEmailRegistryActionState);
  const [search, setSearch] = useState("");
  const immediate = props.riskLevel === "HIGH" || props.riskLevel === "CRITICAL";
  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? props.forwardCandidates.filter((c) => `${c.name} ${c.email} ${c.area ?? ""} ${c.matrixPosition ?? ""}`.toLowerCase().includes(q)) : props.forwardCandidates;
  }, [props.forwardCandidates, search]);

  if (props.availableActions.length === 0) {
    return <p className="text-sm text-muted-foreground" data-testid="alert-actions-none">Alerta resolvido — nenhuma ação adicional.</p>;
  }

  return (
    <div className="flex flex-col gap-3" data-testid="alert-actions">
      <div className="flex flex-wrap gap-2">
        {props.availableActions.map((action) => (
          <Button key={action} type="button" size="sm" variant={selected === action ? "default" : "outline"} onClick={() => setSelected(action)} data-testid={`alert-action-${action}`}>
            [{ALERT_ACTION_LABELS[action]}]
          </Button>
        ))}
      </div>
      {selected ? (
        <form action={formAction} className="flex flex-col gap-2 rounded-md border p-3 text-sm" aria-label={`Ação ${ALERT_ACTION_LABELS[selected]}`}>
          <input type="hidden" name="projectId" value={props.projectId} />
          <input type="hidden" name="caseId" value={props.caseId} />
          <input type="hidden" name="action" value={selected} />
          {props.token && props.initialAction === selected ? <input type="hidden" name="token" value={props.token} /> : null}
          <p className="font-medium">{ALERT_ACTION_LABELS[selected]}</p>
          {immediate && ESCALATING.includes(selected) ? (
            <p className="rounded bg-amber-50 p-2 text-xs text-amber-900" data-testid="alert-action-escalation-notice">
              Risco {props.riskLevel}: esta ação provoca escalonamento imediato ao próximo nível hierárquico ({props.nextLevelLabel}). A ação e o escalonamento são eventos distintos, ambos auditados; o alerta permanece aberto.
            </p>
          ) : null}

          {(selected === "RESOLVED" || selected === "RESOLUTION_CONFIRMED") ? (
            <>
              <label className="flex flex-col gap-1">Conclusão<Textarea name="text" required rows={3} /></label>
              {immediate ? <label className="flex flex-col gap-1">Evidência (obrigatória para ALTO/CRÍTICO)<Input name="evidence" required /></label> : null}
              <label className="flex flex-col gap-1">Justificativa{props.requiresJustification ? " (obrigatória pela Matriz)" : ""}<Textarea name="justification" rows={2} required={props.requiresJustification} /></label>
              <label className="flex items-center gap-2"><input type="checkbox" name="confirmed" required /> Confirmo a resolução (responsável e data ficam registrados).</label>
            </>
          ) : null}
          {selected === "TAKING_ACTION" ? (
            <>
              <label className="flex flex-col gap-1">Providência<Textarea name="text" required rows={3} /></label>
              <label className="flex flex-col gap-1">Previsão<Input type="datetime-local" name="forecastAt" /></label>
            </>
          ) : null}
          {selected === "FORWARD" ? (
            <>
              <label className="flex flex-col gap-1">
                Pesquisar destinatário (nome, e-mail, área, posição na Matriz)
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Digite para filtrar…" />
              </label>
              <label className="flex flex-col gap-1">
                Destinatário
                <Select name="targetUserId" required defaultValue="">
                  <option value="" disabled>Selecione…</option>
                  {candidates.map((c) => (
                    <option key={c.userId} value={c.userId}>
                      {c.name} — {c.email} — {c.area ?? "sem área"} — {c.permission}{c.matrixPosition ? ` — ${c.matrixPosition}` : ""}{c.inPilotAllowlist ? "" : " — fora da allowlist do piloto (recebe só este alerta)"}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex flex-col gap-1">Instrução ao destinatário<Textarea name="text" required rows={2} /></label>
              <label className="flex items-center gap-2"><input type="checkbox" name="confirmed" required /> Confirmo o encaminhamento (um único encaminhamento ativo; prazo para assumir pela Matriz).</label>
            </>
          ) : null}
          {selected === "EXPERT_CONSULTATION" ? (
            <>
              <label className="flex flex-col gap-1">
                Expert
                <Select name="expertId" required defaultValue={props.suggestedExpert ?? ""}>
                  <option value="" disabled>Selecione o Expert…</option>
                  {props.expertOptions.map((e) => (
                    <option key={e.id} value={e.id}>{e.label} — {e.domains}</option>
                  ))}
                </Select>
              </label>
              <label className="flex flex-col gap-1">Pergunta (obrigatória)<Textarea name="question" required rows={3} /></label>
              <p className="text-xs text-muted-foreground">O Expert apenas recomenda: não executa ações nem resolve o alerta; a resposta exige revisão humana e chega na mesma thread.</p>
            </>
          ) : null}
          {selected === "OTHER" ? <label className="flex flex-col gap-1">Descrição (obrigatória)<Textarea name="text" required rows={3} /></label> : null}

          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={pending}>{pending ? "Registrando…" : `Confirmar ${ALERT_ACTION_LABELS[selected]}`}</Button>
            {state.error ? <span className="text-xs text-red-700" role="alert">{state.error}</span> : null}
            {state.success && state.message ? <span className="text-xs text-green-800" role="status">{state.message}</span> : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
