"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { ArrowRight, Files } from "lucide-react";

import {
  createPrecontractWorkspaceAction,
} from "@/app/juridico/actions";
import { DocumentMultiUploadPanel } from "@/components/documents/multi-upload/document-multi-upload-panel";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initialCreatePrecontractWorkspaceState } from "@/lib/legal/precontract-workspace-state";
import { cn } from "@/lib/utils";

export function PrecontractWorkspaceCreateForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    createPrecontractWorkspaceAction,
    initialCreatePrecontractWorkspaceState
  );

  useEffect(() => {
    if (state.projectId) router.refresh();
  }, [router, state.projectId]);

  if (state.projectId) {
    return (
      <div className="flex flex-col gap-5">
        <div className="rounded-md border border-emerald-600/40 bg-emerald-50 p-4 text-sm text-emerald-950 dark:bg-emerald-950/20 dark:text-emerald-100">
          <p className="font-medium">Análise “{state.projectName}” criada.</p>
          <p className="mt-1">
            Selecione abaixo a minuta, os anexos e os demais documentos que o especialista deverá analisar.
          </p>
        </div>

        <div className="flex items-center gap-2 text-sm font-medium">
          <Files className="size-4" />
          Carregar documentos para a análise
        </div>

        <DocumentMultiUploadPanel projectId={state.projectId} documents={[]} />

        <Link
          href={`/${state.projectId}/juridico`}
          className={cn(buttonVariants(), "self-end")}
        >
          Abrir análise jurídica
          <ArrowRight className="size-4" />
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
      <Input
        name="name"
        required
        placeholder="Nome da oportunidade ou concorrência"
        title="Identifica a negociação antes de ela se tornar uma obra contratada."
      />
      <Input
        name="client"
        required
        placeholder="Cliente"
        title="Empresa contratante responsável pela minuta em negociação."
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Criando..." : "Criar e anexar documentos"}
      </Button>
      {state.error ? (
        <p className="text-sm text-destructive md:col-span-3">{state.error}</p>
      ) : null}
    </form>
  );
}
