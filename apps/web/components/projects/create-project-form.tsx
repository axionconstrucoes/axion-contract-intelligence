"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArrowLeft, FolderPlus } from "lucide-react";
import { createProjectAction } from "@/app/projetos/actions";
import { initialCreateProjectState } from "@/app/projetos/actions-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function CreateProjectForm() {
  const [state, formAction, pending] = useActionState(createProjectAction, initialCreateProjectState);

  return (
    <Card className="border-black/10 bg-white/95 shadow-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-slate-950">
          <FolderPlus aria-hidden="true" className="size-5 text-[#7f1d1d]" />
          Novo projeto
        </CardTitle>
        <CardDescription>
          Cadastre a identificação usada no ACC e as datas de referência da obra. Ao concluir, o ACC abrirá a tela Start-up.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">
              Nome do projeto no ACC
              <Input name="name" maxLength={160} placeholder="Ex.: NEWPORT — Galpão G100 Goiânia" required />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">
              No. sistema UNO (nosso ERP)
              <Input name="code" maxLength={40} placeholder="Ex.: 0079" required />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Cliente
              <Input name="client" maxLength={120} placeholder="Nome do cliente" required />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Localização
              <Input name="location" maxLength={160} placeholder="Cidade / UF" required />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Data de início da obra
              <Input name="startDate" type="date" required />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Data de término da baseline
              <Input name="baselineEndDate" type="date" required />
            </label>
          </div>

          {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link href="/projetos" className={buttonVariants({ variant: "outline" })}>
              <ArrowLeft aria-hidden="true" />
              Voltar
            </Link>
            <Button type="submit" disabled={pending} className="bg-[#7f1d1d] text-white hover:bg-[#681717]">
              {pending ? "Criando projeto…" : "Criar projeto"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
