"use client";

import { useActionState } from "react";
import { BrainCircuit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  runPrecontractCurationAction,
  type PrecontractCurationState,
} from "@/lib/ai/precontract-curation-action";

const INITIAL_STATE: PrecontractCurationState = { result: null, error: null };

function List({ items }: { items: string[] }) {
  return items.length ? (
    <ul className="list-disc space-y-1 pl-5 text-sm">{items.map((item, index) => <li key={index}>{item}</li>)}</ul>
  ) : <p className="text-sm text-muted-foreground">Nenhum item identificado.</p>;
}

export function PrecontractCurationPanel({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState(runPrecontractCurationAction, INITIAL_STATE);
  const curation = state.result?.executiveCuration;

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><BrainCircuit className="size-5" />Análise integrada para negociação</CardTitle>
        <p className="text-sm text-muted-foreground">
          Consulta Jurídico, Comercial, Engenharia/Planejamento e ESG/SSMA; o CEO IA consolida as posições. Revisão humana obrigatória.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form action={action} className="space-y-3">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="block text-sm font-medium">
            Cláusula, dúvida ou ponto de negociação
            <Textarea
              name="question"
              required
              rows={4}
              title="Descreva a cláusula e o objetivo da negociação. Os especialistas usarão também os documentos deste espaço."
              placeholder="Ex.: Avaliar riscos e alternativas para negociar a cláusula de multas por atraso."
            />
          </label>
          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          <Button type="submit" disabled={pending}>{pending ? "Consultando todos os especialistas…" : "Consultar todos os especialistas"}</Button>
        </form>

        {state.result && curation ? (
          <div className="space-y-4 rounded-md border p-4">
            <div><h3 className="font-semibold">Síntese do CEO IA</h3><p className="text-sm">{curation.situacao}</p></div>
            <div><h3 className="text-sm font-semibold">Especialistas consultados</h3><p className="text-sm text-muted-foreground">{state.result.expertResults.map((item) => item.response.expertName).join(" · ")}</p></div>
            <div><h3 className="text-sm font-semibold">Riscos</h3><List items={curation.riscos} /></div>
            <div><h3 className="text-sm font-semibold">Alternativas de negociação</h3><List items={curation.alternativas} /></div>
            <div><h3 className="text-sm font-semibold">Recomendação</h3><p className="text-sm">{curation.recomendacao}</p></div>
            <div><h3 className="text-sm font-semibold">Decisões humanas necessárias</h3><List items={curation.decisoesHumanasNecessarias} /></div>
            <p className="text-xs font-medium text-muted-foreground">Nenhuma recomendação é enviada ou aceita automaticamente.</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
