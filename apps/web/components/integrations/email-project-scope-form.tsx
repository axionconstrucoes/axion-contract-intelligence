"use client";

import { useActionState } from "react";

import { saveEmailProjectScopeAction } from "@/app/[projectId]/integracoes/actions";
import { initialSaveEmailProjectScopeState } from "@/app/[projectId]/integracoes/actions-state";
import { Button } from "@/components/ui/button";
import type { ProjectEmailIngestionConfig } from "@/lib/email/inbound/ingestion-controls/types";

export function EmailProjectScopeForm({
  projectId,
  config,
}: {
  projectId: string;
  config: ProjectEmailIngestionConfig;
}) {
  const [state, formAction, pending] = useActionState(
    saveEmailProjectScopeAction,
    initialSaveEmailProjectScopeState
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="projectId" value={projectId} />

      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name="requireProjectScopeMatch"
          defaultChecked={config.requireProjectScopeMatch}
        />
        Exigir correspondência com o projeto
      </label>

      <p className="text-xs text-muted-foreground">
        Quando ativo, um e-mail só entra no projeto se houver participante
        de domínio CLIENTE, palavra-chave configurada ou assunto aprovado.
      </p>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Palavras-chave do projeto
        <textarea
          name="scopeKeywords"
          defaultValue={config.scopeKeywords.join("\n")}
          rows={8}
          className="min-h-32 rounded-md border bg-background px-3 py-2 font-mono text-sm"
          placeholder={"weg\nfabrica de fios\nlinhares\nrfq-1015661"}
        />
        <span className="text-xs font-normal text-muted-foreground">
          Uma expressão por linha. A comparação ignora maiúsculas,
          minúsculas e acentos.
        </span>
      </label>

      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Assuntos explicitamente aprovados
        <textarea
          name="scopeExactSubjects"
          defaultValue={config.scopeExactSubjects.join("\n")}
          rows={5}
          className="min-h-24 rounded-md border bg-background px-3 py-2 font-mono text-sm"
          placeholder="ENC: Negociação - Planilha de custos..."
        />
        <span className="text-xs font-normal text-muted-foreground">
          Um assunto por linha. Use somente para exceções aprovadas.
        </span>
      </label>

      {state.error ? (
        <p className="text-sm text-destructive">{state.error}</p>
      ) : null}

      {state.success ? (
        <p className="text-sm text-green-700">
          Regras de escopo salvas.
        </p>
      ) : null}

      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Salvando…" : "Salvar regras de escopo"}
        </Button>
      </div>
    </form>
  );
}
