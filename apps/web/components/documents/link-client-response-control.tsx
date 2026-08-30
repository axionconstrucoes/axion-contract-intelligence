"use client";

import { useActionState } from "react";
import {
  initialLinkClientResponseState,
  linkClientResponseAction,
} from "@/app/[projectId]/documentos/link-client-response-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

// Formulário MÍNIMO de vínculo manual (Bloco 6 — MVP controlado). Sem
// busca de e-mails ainda (fora do escopo desta rodada) — o e-mail é
// identificado pelo UUID já existente em public.emails (ex.: copiado
// da tela de e-mails do projeto). A automação completa por Message-ID/
// thread/hash fica para depois do go-live (ver
// resolve-document-version-link-candidate.ts, já pronta e testada,
// pendente de um caller real de ingestão automática).
export function LinkClientResponseControl({
  projectId,
  documentVersionId,
}: {
  projectId: string;
  documentVersionId: string;
}) {
  const [state, formAction, pending] = useActionState(linkClientResponseAction, initialLinkClientResponseState);

  return (
    <details className="mt-1.5 rounded-md border p-2">
      <summary className="cursor-pointer text-xs font-medium">Vincular resposta do cliente</summary>
      <form action={formAction} className="mt-2 flex flex-col gap-1.5">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="documentVersionId" value={documentVersionId} />

        <label className="flex flex-col gap-1 text-xs">
          ID do e-mail (public.emails.id)
          <Input name="emailId" required placeholder="UUID do e-mail já registrado" />
        </label>

        <label className="flex flex-col gap-1 text-xs">
          Relação
          <Select name="relationType" required defaultValue="RESPONDE">
            <option value="RESPONDE">Responde</option>
            <option value="DISCORDA">Discorda</option>
            <option value="CORRIGE">Corrige</option>
            <option value="RESSALVA">Ressalva</option>
            <option value="COMPLEMENTA">Complementa</option>
          </Select>
        </label>

        <label className="flex flex-col gap-1 text-xs">
          Trecho relevante (opcional)
          <Textarea name="excerpt" rows={2} />
        </label>

        {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
        {state.success ? <p className="text-xs text-emerald-600">Vínculo registrado.</p> : null}

        <Button type="submit" size="sm" disabled={pending} className="self-start">
          {pending ? "Vinculando…" : "Vincular"}
        </Button>
      </form>
    </details>
  );
}
