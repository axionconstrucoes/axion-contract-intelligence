"use client";

// "Adicionar usuário" — visível apenas para Administradores do
// projeto (page.tsx já garante isso). Se o e-mail @axion.com.br ainda
// não tiver profile (nunca fez o primeiro login Google), a RPC não
// retorna erro técnico: o server action devolve notOnboarded=true e
// esta tela mostra a orientação operacional pedida (pré-cadastro fica
// para uma etapa futura — ver módulo Usuários & Permissões).

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { CorporateArea, ProjectPermission } from "@axion/types";
import { corporateAreaLabels, permissionLabels } from "@/lib/labels";
import { addProjectMemberAction } from "./actions";
import { initialAddProjectMemberState } from "./actions-state";

const ROLE_OPTIONS: ProjectPermission[] = ["ADMINISTRADOR", "GESTOR", "COLABORADOR", "LEITURA"];
const AREA_OPTIONS = Object.keys(corporateAreaLabels) as CorporateArea[];

export function AddMemberForm({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(addProjectMemberAction, initialAddProjectMemberState);

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        Adicionar usuário
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Adicionar usuário ao projeto</CardTitle>
      </CardHeader>
      <CardContent>
        {state.success ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">Usuário adicionado ao projeto.</p>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Fechar
            </Button>
          </div>
        ) : (
          <form action={formAction} className="flex flex-col gap-3">
            <input type="hidden" name="projectId" value={projectId} />

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="email">
                E-mail corporativo
              </label>
              <Input id="email" name="email" type="email" placeholder="nome@axion.com.br" required />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="permission">
                  Perfil
                </label>
                <Select id="permission" name="permission" defaultValue="COLABORADOR" required>
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>
                      {permissionLabels[role]}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="area">
                  Área
                </label>
                <Select id="area" name="area" defaultValue="">
                  <option value="">Não informada</option>
                  {AREA_OPTIONS.map((area) => (
                    <option key={area} value={area}>
                      {corporateAreaLabels[area]}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {state.notOnboarded && (
              <p className="text-sm text-muted-foreground">
                Este colaborador ainda não acessou o ACC. Solicite que faça o primeiro acesso com sua conta Google
                AXION e tente novamente.
              </p>
            )}
            {state.error && <p className="text-sm text-destructive">{state.error}</p>}

            <div className="flex gap-2">
              <Button type="submit" disabled={pending}>
                {pending ? "Adicionando…" : "Adicionar"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
