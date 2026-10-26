"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Pencil } from "lucide-react";
import type { Project } from "@axion/types";
import { updateProjectAction } from "@/app/projetos/actions";
import {
  editProjectReturnPath,
  initialUpdateProjectState,
  type EditProjectOrigin,
} from "@/app/projetos/actions-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function EditProjectForm({ project, origin }: { project: Project; origin: EditProjectOrigin }) {
  const [state, formAction, pending] = useActionState(updateProjectAction, initialUpdateProjectState);

  return (
    <Card className="border-black/10 bg-white/95 shadow-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-slate-950">
          <Pencil aria-hidden="true" className="size-5 text-[#7f1d1d]" />
          Editar projeto
        </CardTitle>
        <CardDescription>
          Altera somente os dados cadastrais. Documentos, eventos, integrações, usuários e o Start-up do projeto são preservados.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-5">
          <input type="hidden" name="projectId" value={project.id} />
          <input type="hidden" name="origin" value={origin} />
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">
              Nome do projeto no ACC
              <Input name="name" maxLength={160} defaultValue={project.name} required />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              No. sistema UNO (nosso ERP)
              <Input name="code" maxLength={40} defaultValue={project.code} required />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Número do contrato (opcional)
              <Input name="contractNumber" maxLength={80} defaultValue={project.contractNumber ?? ""} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Cliente
              <Input name="client" maxLength={120} defaultValue={project.client} required />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Localização
              <Input name="location" maxLength={160} defaultValue={project.location} placeholder="Cidade / UF" required />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Data de início da obra
              <Input name="startDate" type="date" defaultValue={project.startDate} required />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Data de término da baseline
              <Input name="baselineEndDate" type="date" defaultValue={project.baselineEndDate} required />
            </label>
          </div>

          {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href={editProjectReturnPath(project.id, origin)} className={buttonVariants({ variant: "outline" })}>
              Cancelar
            </Link>
            <Button type="submit" disabled={pending} className="bg-[#7f1d1d] text-white hover:bg-[#681717]">
              {pending ? "Salvando…" : "Salvar alterações"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
