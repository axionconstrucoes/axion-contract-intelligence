"use client";

// Ações administrativas por membro (alterar perfil, ativar/desativar,
// remover). Nunca renderizado na própria linha do usuário logado — a
// página (page.tsx) já omite este componente nesse caso, e as RPCs no
// banco bloqueiam a autoalteração de qualquer forma (defesa em
// profundidade, não confiar só na UI).
//
// Confirmação obrigatória (requisito do módulo Usuários & Permissões):
// promover/rebaixar Administrador, desativar, remover. Sem biblioteca
// de modal no design system atual — segue o mesmo padrão já usado em
// Integrações (EmailSyncConfirmationPanel): confirmação inline de
// dois passos, sem overlay.

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { ProjectMembership, ProjectPermission } from "@axion/types";
import { permissionLabels } from "@/lib/labels";
import {
  removeProjectMemberAction,
  setProjectMemberStatusAction,
  updateProjectMemberRoleAction,
} from "./actions";
import {
  initialRemoveProjectMemberState,
  initialSetProjectMemberStatusState,
  initialUpdateProjectMemberRoleState,
} from "./actions-state";

const ROLE_OPTIONS: ProjectPermission[] = ["ADMINISTRADOR", "GERENTE", "COLABORADOR", "LEITURA"];

type PendingConfirm =
  | { type: "role"; nextValue: ProjectPermission }
  | { type: "deactivate" }
  | { type: "remove" };

export function MemberRowActions({
  projectId,
  member,
}: {
  projectId: string;
  member: ProjectMembership & { user: { name: string } };
}) {
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  const [roleState, roleAction, roleActionPending] = useActionState(
    updateProjectMemberRoleAction,
    initialUpdateProjectMemberRoleState
  );
  const [statusState, statusAction, statusActionPending] = useActionState(
    setProjectMemberStatusAction,
    initialSetProjectMemberStatusState
  );
  const [removeState, removeAction, removeActionPending] = useActionState(
    removeProjectMemberAction,
    initialRemoveProjectMemberState
  );

  const pending = roleActionPending || statusActionPending || removeActionPending;

  // O select nunca guarda um valor "otimista" próprio: reflete
  // member.permission (fonte de verdade, atualizada por revalidatePath
  // após a RPC) ou, durante a confirmação pendente, o valor escolhido
  // que ainda está aguardando confirmação. Isso evita divergir do
  // servidor se a RPC recusar a troca (ex.: bloqueio de último
  // Administrador) — sem precisar de efeito para "desfazer" estado.
  const selectValue = pendingConfirm?.type === "role" ? pendingConfirm.nextValue : member.permission;

  function requestRoleChange(nextValue: ProjectPermission) {
    if (nextValue === member.permission) return;

    // Envolver ou sair de ADMINISTRADOR exige confirmação explícita;
    // trocas entre os demais papéis (Gerente/Colaborador/Leitura)
    // aplicam direto.
    if (nextValue === "ADMINISTRADOR" || member.permission === "ADMINISTRADOR") {
      setPendingConfirm({ type: "role", nextValue });
    } else {
      submitRoleChange(nextValue);
    }
  }

  function submitRoleChange(nextValue: ProjectPermission) {
    const formData = new FormData();
    formData.set("projectId", projectId);
    formData.set("userId", member.userId);
    formData.set("newPermission", nextValue);
    roleAction(formData);
    setPendingConfirm(null);
  }

  function submitStatusChange(nextStatus: "ACTIVE" | "INACTIVE") {
    const formData = new FormData();
    formData.set("projectId", projectId);
    formData.set("userId", member.userId);
    formData.set("status", nextStatus);
    statusAction(formData);
    setPendingConfirm(null);
  }

  function submitRemove() {
    const formData = new FormData();
    formData.set("projectId", projectId);
    formData.set("userId", member.userId);
    removeAction(formData);
    setPendingConfirm(null);
  }

  if (pendingConfirm) {
    return (
      <div className="flex flex-col items-end gap-1.5 text-right">
        <p className="max-w-56 text-xs text-muted-foreground">
          {pendingConfirm.type === "role" &&
            `Confirmar alteração de papel de ${member.user.name} para ${permissionLabels[pendingConfirm.nextValue]}?`}
          {pendingConfirm.type === "deactivate" && `Confirmar desativação de ${member.user.name} neste projeto?`}
          {pendingConfirm.type === "remove" && `Confirmar exclusão de ${member.user.name} deste projeto? O histórico e os registros de auditoria serão preservados.`}
        </p>
        <div className="flex gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => setPendingConfirm(null)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={() => {
              if (pendingConfirm.type === "role") submitRoleChange(pendingConfirm.nextValue);
              if (pendingConfirm.type === "deactivate") submitStatusChange("INACTIVE");
              if (pendingConfirm.type === "remove") submitRemove();
            }}
          >
            Confirmar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-1.5">
        <Select
          aria-label="Alterar perfil"
          className="h-8 text-xs"
          value={selectValue}
          disabled={pending}
          onChange={(event) => requestRoleChange(event.target.value as ProjectPermission)}
        >
          {ROLE_OPTIONS.map((role) => (
            <option key={role} value={role}>
              {permissionLabels[role]}
            </option>
          ))}
        </Select>

        {member.status === "ACTIVE" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => setPendingConfirm({ type: "deactivate" })}
          >
            Desativar
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => submitStatusChange("ACTIVE")}
          >
            Reativar
          </Button>
        )}

        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          disabled={pending}
          onClick={() => setPendingConfirm({ type: "remove" })}
        >
          Excluir usuário
        </Button>
      </div>

      {roleState.error && <p className="text-xs text-destructive">{roleState.error}</p>}
      {statusState.error && <p className="text-xs text-destructive">{statusState.error}</p>}
      {removeState.error && <p className="text-xs text-destructive">{removeState.error}</p>}
    </div>
  );
}
