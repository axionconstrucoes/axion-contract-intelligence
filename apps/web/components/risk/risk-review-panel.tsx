"use client";

import { useActionState, useMemo, useState } from "react";

import { initialRiskReviewActionState, type RiskReviewActionState } from "@/app/[projectId]/risco/actions-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { repeatIntervalPhrase } from "@/lib/alerts/repeat-policy";
import { buildRiskFacts, parseRiskReviewForm } from "@/lib/risk-classification/facts-builders";
import {
  RISK_CRITERIA,
  RISK_LEVEL_LABEL,
  suggestRisk,
  type BasisKind,
  type DeadlineStatus,
  type SourceRef,
} from "@/lib/risk-classification/suggest-risk";
import type { AlertSeverity } from "@axion/types";

export interface RiskReviewHistoryItem {
  id: string;
  previousLevel: AlertSeverity | null;
  newLevel: AlertSeverity;
  suggestedLevel: AlertSeverity | null;
  justification: string;
  reference: string | null;
  origin: "REVISAO_HUMANA" | "ALTERACAO_DIRETA_PROVIDENCIA";
  reviewerName: string | null;
  createdAt: string;
}

interface DeclaredState {
  nature: string;
  deadlineStatus: string;
  deadlineDate: string;
  imminence: string;
  mitigationTime: string;
  consequenceDescription: string;
  consequenceInVerifiedClause: boolean;
}

const LEVELS: AlertSeverity[] = ["CRITICA", "ALTA", "MEDIA", "BAIXA"];
const BASIS_LABEL: Record<BasisKind, string> = { FATO: "Fato", INFERENCIA: "Inferência", RECOMENDACAO: "Recomendação" };
const BASIS_STYLE: Record<BasisKind, string> = {
  FATO: "border-emerald-300 bg-emerald-50 text-emerald-900",
  INFERENCIA: "border-sky-300 bg-sky-50 text-sky-900",
  RECOMENDACAO: "border-amber-300 bg-amber-50 text-amber-900",
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export function RiskReviewPanel({
  action,
  currentLevel,
  originalLevel,
  originalLabel,
  canReview,
  verifiedClause,
  obligationDescription,
  evidence,
  recordDeadline,
  history,
  initialDeclared,
}: {
  /** Server Action já vinculada (projeto, origem e id). */
  action: (prev: RiskReviewActionState, formData: FormData) => Promise<RiskReviewActionState>;
  currentLevel: AlertSeverity | null;
  originalLevel: AlertSeverity | null;
  /** "Classificação da IA" (eventos) ou "Classificação inicial" (providências). */
  originalLabel: string;
  canReview: boolean;
  verifiedClause: SourceRef | null;
  obligationDescription: string | null;
  evidence: SourceRef[];
  /** Prazo do próprio registro (providências); null = informado pela pessoa. */
  recordDeadline: { status: DeadlineStatus; date: string | null } | null;
  history: RiskReviewHistoryItem[];
  /** Só para testes/capturas: declarações pré-preenchidas. */
  initialDeclared?: Partial<DeclaredState>;
}) {
  const [state, formAction, pending] = useActionState(action, initialRiskReviewActionState);
  const [declared, setDeclared] = useState<DeclaredState>({
    nature: "DESCONHECIDA",
    deadlineStatus: recordDeadline?.status ?? "DESCONHECIDO",
    deadlineDate: recordDeadline?.date ?? "",
    imminence: "DESCONHECIDA",
    mitigationTime: "DESCONHECIDA",
    consequenceDescription: "",
    consequenceInVerifiedClause: false,
    ...initialDeclared,
  });
  const set = (key: keyof DeclaredState, value: string | boolean) => setDeclared((d) => ({ ...d, [key]: value }));

  const suggestion = useMemo(
    () =>
      suggestRisk(
        buildRiskFacts({
          form: parseRiskReviewForm({ ...declared }),
          verifiedClause,
          obligationDescription,
          evidence,
        })
      ),
    [declared, verifiedClause, obligationDescription, evidence]
  );
  const [newLevel, setNewLevel] = useState<string>("");
  const chosen = newLevel || suggestion.level || "";

  return (
    <div className="grid gap-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold">Grau de risco atual:</p>
        <span className="rounded border px-2 py-0.5 font-medium">
          {currentLevel ? `${RISK_LEVEL_LABEL[currentLevel]} — repete ${repeatIntervalPhrase(currentLevel)}` : "A definir"}
        </span>
        {originalLevel && originalLevel !== currentLevel ? (
          <span className="text-muted-foreground">
            ({originalLabel}: {RISK_LEVEL_LABEL[originalLevel]} — preservada)
          </span>
        ) : null}
      </div>

      <details className="rounded border bg-muted/30 p-2">
        <summary className="cursor-pointer font-medium">Critérios de classificação</summary>
        <ul className="mt-1 grid gap-1">
          {LEVELS.map((l) => (
            <li key={l}>
              <strong>{RISK_LEVEL_LABEL[l]}:</strong> {RISK_CRITERIA[l]}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-muted-foreground">
          Não há um número de dias que separe os níveis: iminência e tempo para mitigação são informados por quem revisa.
        </p>
      </details>

      {canReview ? (
        <form action={formAction} className="grid gap-2 rounded border p-2">
          <p className="font-semibold">Revisar classificação (gestor, gerente ou administrador)</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1">
              Natureza do risco
              <Select name="nature" value={declared.nature} onChange={(e) => set("nature", e.target.value)}>
                <option value="DESCONHECIDA">A confirmar</option>
                <option value="DESCUMPRIMENTO_CONTRATUAL">Possível descumprimento contratual</option>
                <option value="PROCESSUAL">Processual (acompanhamento/organização)</option>
              </Select>
            </label>
            {recordDeadline ? (
              <p className="self-end text-muted-foreground">
                Prazo da providência: {recordDeadline.date ?? "sem prazo cadastrado"}
                {recordDeadline.status === "VENCIDO" ? " (vencido)" : ""}.
              </p>
            ) : (
              <label className="grid gap-1">
                Prazo contratual aplicável
                <Select name="deadlineStatus" value={declared.deadlineStatus} onChange={(e) => set("deadlineStatus", e.target.value)}>
                  <option value="DESCONHECIDO">A confirmar</option>
                  <option value="VENCIDO">Já vencido</option>
                  <option value="A_VENCER">Ainda não venceu</option>
                  <option value="SEM_PRAZO">Sem prazo contratual</option>
                </Select>
              </label>
            )}
            <label className="grid gap-1">
              O descumprimento é iminente?
              <Select name="imminence" value={declared.imminence} onChange={(e) => set("imminence", e.target.value)}>
                <option value="DESCONHECIDA">A confirmar</option>
                <option value="SIM">Sim</option>
                <option value="NAO">Não</option>
              </Select>
            </label>
            <label className="grid gap-1">
              Ainda há tempo para mitigação?
              <Select name="mitigationTime" value={declared.mitigationTime} onChange={(e) => set("mitigationTime", e.target.value)}>
                <option value="DESCONHECIDA">A confirmar</option>
                <option value="SIM">Sim, há tempo</option>
                <option value="NAO">Não há tempo</option>
              </Select>
            </label>
          </div>
          <label className="grid gap-1">
            Consequência/penalidade contratual prevista (opcional)
            <Input name="consequenceDescription" value={declared.consequenceDescription} onChange={(e) => set("consequenceDescription", e.target.value)} maxLength={600} />
          </label>
          {verifiedClause ? (
            <label className="flex items-center gap-2">
              <input type="checkbox" name="consequenceInVerifiedClause" checked={declared.consequenceInVerifiedClause} onChange={(e) => set("consequenceInVerifiedClause", e.target.checked)} />
              Confirmo que esta consequência está prevista em {verifiedClause.label}
            </label>
          ) : (
            <p className="text-muted-foreground">Sem cláusula verificada vinculada: uma penalidade não pode ser tratada como prevista em contrato.</p>
          )}

          <div className="grid gap-1 rounded border bg-muted/30 p-2" aria-live="polite">
            <p className="font-semibold">
              Sugestão:{" "}
              {suggestion.level
                ? `${RISK_LEVEL_LABEL[suggestion.level]} (incerteza ${suggestion.uncertainty.toLowerCase()})`
                : suggestion.possibleLevels.length > 1
                  ? `indeterminada — entre ${suggestion.possibleLevels.map((l) => RISK_LEVEL_LABEL[l]).join(" e ")}`
                  : "indeterminada — dados insuficientes"}
            </p>
            <ul className="grid gap-1">
              {suggestion.basis.map((b, i) => (
                <li key={i} className={`rounded border px-2 py-1 ${BASIS_STYLE[b.kind]}`}>
                  <strong>{BASIS_LABEL[b.kind]}:</strong> {b.text}
                  {b.refs.map((r) => (
                    <span key={`${r.kind}-${r.label}`}>
                      {" "}
                      {r.url ? (
                        <a href={r.url} className="underline" target="_blank" rel="noreferrer">
                          [{r.label}]
                        </a>
                      ) : (
                        <span>[{r.label}]</span>
                      )}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground">A sugestão não altera o alerta; é apoio à decisão e exige revisão humana.</p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1">
              Grau de risco a registrar
              <Select name="newLevel" value={chosen} onChange={(e) => setNewLevel(e.target.value)} required>
                <option value="" disabled>
                  Selecione
                </option>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {RISK_LEVEL_LABEL[l]} (repete {repeatIntervalPhrase(l)})
                  </option>
                ))}
              </Select>
            </label>
            <label className="grid gap-1">
              Referência verificável (opcional)
              <Input name="reference" maxLength={300} placeholder="Cláusula, documento ou protocolo" />
            </label>
          </div>
          <label className="grid gap-1">
            Justificativa (obrigatória)
            <Textarea name="justification" rows={3} required />
          </label>
          {state.error ? <p className="text-destructive">{state.error}</p> : null}
          {state.success ? <p className="text-emerald-700">{state.success}</p> : null}
          <Button type="submit" size="sm" disabled={pending} className="self-start">
            {pending ? "Registrando…" : "Registrar classificação"}
          </Button>
        </form>
      ) : (
        <p className="text-muted-foreground">Apenas gestor, gerente ou administrador da obra revisa o grau de risco.</p>
      )}

      <div>
        <p className="font-semibold">Histórico de classificação</p>
        {history.length === 0 ? (
          <p className="text-muted-foreground">Nenhuma revisão registrada — vale a classificação original.</p>
        ) : (
          <ol className="mt-1 grid gap-1">
            {history.map((h) => (
              <li key={h.id} className="rounded border px-2 py-1">
                <span className="font-medium">
                  {h.previousLevel ? RISK_LEVEL_LABEL[h.previousLevel] : "A definir"} → {RISK_LEVEL_LABEL[h.newLevel]}
                </span>{" "}
                · {h.reviewerName ?? "Usuário"} · {formatWhen(h.createdAt)}
                {h.suggestedLevel ? ` · sugestão do sistema: ${RISK_LEVEL_LABEL[h.suggestedLevel]}` : ""}
                <p>{h.justification}</p>
                {h.reference ? <p className="text-muted-foreground">Referência: {h.reference}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
