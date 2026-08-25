"use client";

// Botão "Adicionar usuário" + alternância para o formulário. Só
// renderizado pelo servidor quando permission === "ADMINISTRADOR" (ver
// page.tsx) — mesmo assim, a escrita real é sempre revalidada no
// servidor pela RPC oficial, nunca confiando só nesta checagem de UI.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AddProjectMemberForm } from "./add-project-member-form";
import { ADD_BUTTON_CLASSNAME } from "@/lib/ui/add-button-style";

export function ManageMembersPanel({ projectId, projectLabel }: { projectId: string; projectLabel: string }) {
  const [adding, setAdding] = useState(false);

  if (adding) {
    return (
      <AddProjectMemberForm
        projectId={projectId}
        projectLabel={projectLabel}
        onCancel={() => setAdding(false)}
        onSuccess={() => setAdding(false)}
      />
    );
  }

  return (
    <Button type="button" size="sm" variant="outline" className={ADD_BUTTON_CLASSNAME} onClick={() => setAdding(true)}>
      + Adicionar usuário
    </Button>
  );
}
