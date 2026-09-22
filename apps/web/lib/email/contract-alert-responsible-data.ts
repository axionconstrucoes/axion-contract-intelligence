import "server-only";

import { createSupabaseServerClient } from "@axion/db/server";

// "Responsável pelos alertas contratuais" — configuração EXPLÍCITA por
// projeto (contract_alert_responsibles, 1 linha por projeto). Única
// fonte de recipient_user_id para o lote semanal automático — ver
// run-weekly-contract-alert-batches.ts (que usa o client admin, não
// este loader, mas o MESMO cálculo de "ainda é membro ACTIVE?").
//
// isCurrentlyActive é SEMPRE recalculado a partir de project_memberships
// no momento da leitura — nunca assumido a partir do cadastro. Um
// responsável configurado pode ter sido suspenso/removido depois; a
// interface (e o job semanal) precisam saber disso para nunca enviar a
// alguém inativo nem silenciosamente escolher outra pessoa.
export interface ContractAlertResponsible {
  projectId: string;
  responsibleUserId: string;
  responsibleName: string;
  responsibleEmail: string;
  isCurrentlyActive: boolean;
  updatedAt: string;
}

export async function getContractAlertResponsible(projectId: string): Promise<ContractAlertResponsible | null> {
  const supabase = await createSupabaseServerClient();

  const { data: row, error } = await supabase
    .from("contract_alert_responsibles")
    .select("project_id,responsible_user_id,updated_at")
    .eq("project_id", projectId)
    .maybeSingle();

  if (error || !row) return null;

  const [{ data: profile }, { data: membership }] = await Promise.all([
    supabase.from("profiles").select("name,email").eq("id", row.responsible_user_id).maybeSingle(),
    supabase
      .from("project_memberships")
      .select("status")
      .eq("project_id", projectId)
      .eq("user_id", row.responsible_user_id)
      .maybeSingle(),
  ]);

  if (!profile) return null;

  return {
    projectId,
    responsibleUserId: row.responsible_user_id as string,
    responsibleName: profile.name as string,
    responsibleEmail: profile.email as string,
    isCurrentlyActive: (membership?.status as string | undefined) === "ACTIVE",
    updatedAt: row.updated_at as string,
  };
}
