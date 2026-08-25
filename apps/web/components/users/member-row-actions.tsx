"use client";

// Ações por linha da tabela de Usuários & Permissões — só renderizado
// pelo servidor quando permission === "ADMINISTRADOR" (ver page.tsx).
// Cada controle chama exclusivamente uma RPC oficial — nunca UPDATE
// direto em project_memberships/profiles:
//   - status:     set_project_member_status
//   - permissão:  update_project_member_role (bloqueia auto-edição e o
//                 último ADMINISTRADOR ativo — ver
//                 prevent_last_administrator_removal, 20260824090000;
//                 aqui só repassamos o erro da RPC)
//   - cargo:      set_profile_job_title (migration 20260825120000,
//                 AINDA NÃO APLICADA — falha explícita até lá)
// Remoção (remove_project_member) deliberadamente NÃO tem controle
// aqui, para evitar exclusão acidental — a RPC existe e pode ser
// usada diretamente se necessário.

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  setMemberJobTitleAction,
  setMemberStatusAction,
  updateMemberPermissionAction,
} from "@/app/[projectId]/usuarios/actions";
import {
  initialSetMemberJobTitleState,
  initialSetMemberStatusState,
  initialUpdateMemberPermissionState,
} from "@/app/[projectId]/usuarios/actions-state";
import { permissionLabels } from "@/lib/labels";
import type { MembershipStatus, ProjectPermission } from "@axion/types";

const ALL_PERMISSIONS: ProjectPermission[] = ["ADMINISTRADOR", "GESTOR", "COLABORADOR", "LEITURA"];

export function MemberRowActions({
  projectId,
  userId,
  currentStatus,
  currentPermission,
  currentJobTitle,
  isSelf,
}: {
  projectId: string;
  userId: string;
  currentStatus: MembershipStatus;
  currentPermission: ProjectPermission;
  currentJobTitle: string | null;
  isSelf: boolean;
}) {
  const [statusState, statusAction, statusPending] = useActionState(setMemberStatusAction, initialSetMemberStatusState);
  const [permissionState, permissionAction, permissionPending] = useActionState(
    updateMemberPermissionAction,
    initialUpdateMemberPermissionState
  );
  const [jobTitleState, jobTitleAction, jobTitlePending] = useActionState(
    setMemberJobTitleAction,
    initialSetMemberJobTitleState
  );
  const [editingJobTitle, setEditingJobTitle] = useState(false);
  const nextStatus: MembershipStatus = currentStatus === "ACTIVE" ? "INACTIVE" : "ACTIVE";

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-1.5">
        {editingJobTitle ? (
          <form
            action={jobTitleAction}
            className="flex items-center gap-1"
            onSubmit={() => setEditingJobTitle(false)}
          >
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="userId" value={userId} />
            <Input name="jobTitle" defaultValue={currentJobTitle ?? ""} placeholder="Cargo" className="h-7 w-36 text-xs" />
            <Button type="submit" size="sm" variant="ghost" className="h-7 px-2" disabled={jobTitlePending}>
              {jobTitlePending ? "…" : "Salvar"}
            </Button>
          </form>
        ) : (
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditingJobTitle(true)}>
            Editar cargo
          </Button>
        )}
      </div>

      {!isSelf ? (
        <form action={permissionAction} className="flex items-center gap-1">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="userId" value={userId} />
          <Select name="newPermission" defaultValue={currentPermission} className="h-7 text-xs" disabled={permissionPending}>
            {ALL_PERMISSIONS.map((permission) => (
              <option key={permission} value={permission}>
                {permissionLabels[permission]}
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm" variant="ghost" className="h-7 px-2" disabled={permissionPending}>
            {permissionPending ? "…" : "Salvar"}
          </Button>
        </form>
      ) : (
        <span className="text-xs text-muted-foreground">Próprio usuário</span>
      )}

      <form action={statusAction}>
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="status" value={nextStatus} />
        <Button type="submit" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={statusPending}>
          {statusPending ? "…" : currentStatus === "ACTIVE" ? "Desativar" : "Reativar"}
        </Button>
      </form>

      {statusState.error ? <p className="text-xs text-destructive">{statusState.error}</p> : null}
      {permissionState.error ? <p className="text-xs text-destructive">{permissionState.error}</p> : null}
      {jobTitleState.error ? <p className="text-xs text-destructive">{jobTitleState.error}</p> : null}
    </div>
  );
}
