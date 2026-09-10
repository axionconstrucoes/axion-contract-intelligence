"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { submitBudgetResponseAction, submitVersionImpactReviewAction, type VersionImpactReviewState } from "@/app/[projectId]/integracoes/version-impact-actions";

const initialState: VersionImpactReviewState = { success: false, error: null };

export function ConstrumanagerVersionImpactForm({
  projectId,
  transitionId,
  budgetUsers,
}: {
  projectId: string;
  transitionId: string;
  budgetUsers: Array<{ id: string; name: string }>;
}) {
  const [state, action, pending] = useActionState(submitVersionImpactReviewAction, initialState);
  const [sendToBudget, setSendToBudget] = useState(false);

  return (
    <form action={action} className="mt-2 grid gap-2 rounded-md border border-amber-300 bg-white p-3 text-xs text-black">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="transitionId" value={transitionId} />
      <p className="font-bold">Análise obrigatória de impacto</p>
      <label className="grid gap-1">Impacto no prazo
        <select name="scheduleImpact" required defaultValue="" className="rounded border p-2">
          <option value="" disabled>Selecione</option><option value="SIM">Sim</option><option value="NAO">Não</option><option value="INCONCLUSIVO">Ainda inconclusivo</option>
        </select>
      </label>
      <label className="grid gap-1">Impacto no preço
        <select name="priceImpact" required defaultValue="" className="rounded border p-2">
          <option value="" disabled>Selecione</option><option value="SIM">Sim</option><option value="NAO">Não</option><option value="INCONCLUSIVO">Ainda inconclusivo</option>
        </select>
      </label>
      <label className="grid gap-1">Resposta do Planejamento
        <textarea name="planningResponse" required minLength={10} maxLength={4000} rows={3} className="rounded border p-2" placeholder="Registre a análise e a ação recomendada." />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" name="sendToBudget" checked={sendToBudget} onChange={(event) => setSendToBudget(event.target.checked)} />
        Encaminhar ao orçamentista
      </label>
      {sendToBudget ? (
        <label className="grid gap-1">Orçamentista responsável
          <select name="budgetUserId" required defaultValue="" className="rounded border p-2">
            <option value="" disabled>Selecione</option>
            {budgetUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
          </select>
        </label>
      ) : null}
      <p className="text-neutral-600">A análise será registrada e informada à gerência do projeto e à diretoria comercial, mesmo sem impacto.</p>
      {state.error ? <p className="font-medium text-red-700">{state.error}</p> : null}
      {state.success ? <p className="font-medium text-green-700">Análise registrada.</p> : null}
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Registrando…" : "Registrar análise completa"}</Button>
    </form>
  );
}

export function ConstrumanagerBudgetResponseForm({ projectId, reviewId }: { projectId: string; reviewId: string }) {
  const [state, action, pending] = useActionState(submitBudgetResponseAction, initialState);
  return (
    <form action={action} className="mt-2 grid gap-2 rounded border border-blue-300 bg-white p-2 text-black">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="reviewId" value={reviewId} />
      <label className="grid gap-1 font-medium">Resposta do orçamentista designado
        <textarea name="budgetResponse" required minLength={10} maxLength={4000} rows={3} className="rounded border p-2 font-normal" placeholder="Registre a avaliação de preço e as providências." />
      </label>
      {state.error ? <p className="text-red-700">{state.error}</p> : null}
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Registrando…" : "Registrar resposta do Orçamento"}</Button>
    </form>
  );
}
