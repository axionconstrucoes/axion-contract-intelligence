"use client";

import { useActionState } from "react";
import { Info, Loader2, Sparkles } from "lucide-react";

import { consultSsmaRecordAction } from "@/app/ssma/consult-actions";
import { ExpertResponseDetails } from "@/components/ai/expert-query-panel";
import { DEFAULT_ALERT_CONSULT_QUESTION, MAX_ALERT_CONSULT_QUESTION_LENGTH } from "@/lib/ai/alert-consult/specialties";
import type { SsmaConsultState } from "@/lib/ssma/field-records/run-record-consult";

const INITIAL: SsmaConsultState = { result: null, error: null };

export function RecordConsult({
  projectId,
  recordId,
  online,
  action = consultSsmaRecordAction,
}: {
  projectId: string;
  recordId: string;
  online: boolean;
  action?: (state: SsmaConsultState, formData: FormData) => Promise<SsmaConsultState>;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  return (
    <section className="flex flex-col gap-2 rounded-xl bg-white p-4 shadow-sm" aria-label="Consultar especialista de SSMA">
      <h3 className="text-sm font-black uppercase text-slate-700">Consultar IA — especialista de SSMA</h3>
      <form action={formAction} className="flex flex-col gap-2">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="recordId" value={recordId} />
        <textarea name="question" rows={3} maxLength={MAX_ALERT_CONSULT_QUESTION_LENGTH} defaultValue={DEFAULT_ALERT_CONSULT_QUESTION} className="w-full rounded-lg border p-2 text-sm" />
        <button type="submit" disabled={pending || !online} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border-2 border-[#7f1d1d] px-4 font-black uppercase text-[#7f1d1d] disabled:opacity-50">
          {pending ? <Loader2 className="size-5 animate-spin" /> : <Sparkles className="size-5" />} Consultar
        </button>
        <p className="flex items-center gap-1 text-xs text-slate-500"><Info className="size-3.5 shrink-0" />A consulta não altera o registro nem a ação corretiva.</p>
        {!online ? <p className="text-xs font-semibold text-amber-700">Sem conexão: a consulta exige internet.</p> : null}
      </form>
      {state.error ? <p role="alert" className="text-sm font-bold text-red-700">{state.error}</p> : null}
      {state.result ? (
        <div className="flex flex-col gap-2" data-testid="ssma-consult-result">
          {!state.result.meta.isRealProvider ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-800">Resposta de TESTE ({state.result.meta.providerLabel}) — nenhuma análise real de IA foi realizada.</p>
          ) : null}
          <ExpertResponseDetails response={state.result.response} showClauseComparison={false} />
          <p className="text-xs text-slate-500">Fonte: o próprio registro ({state.result.recordLabel}) e o contexto da obra. Opções são sugestões para revisão humana; nada foi executado.</p>
        </div>
      ) : null}
    </section>
  );
}
