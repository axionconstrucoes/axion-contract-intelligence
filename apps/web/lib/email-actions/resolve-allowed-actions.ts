import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { EMAIL_ALERT_ACTION_TYPES, type EmailAlertActionType } from "./types";

// Ações que só exigem membro ACTIVE (qualquer permissão) — subconjunto
// seguro para oferecer quando a permissão real do destinatário não pode
// ser confirmada (perfil/membership não encontrados). A autoridade final
// continua sendo confirm_email_alert_action no momento do clique — isto
// aqui é só UX (não desenhar um botão inútil), nunca autorização.
const SAFE_DEFAULT_ACTIONS: readonly EmailAlertActionType[] = ["ACKNOWLEDGE", "RESPOND"];

// Só oferece no e-mail os botões que o destinatário pretendido
// plausivelmente pode usar, quando isso é determinável com segurança —
// nunca omite por engano (falha aberta para o conjunto seguro, nunca
// para o conjunto completo, quando a permissão real não pôde ser
// resolvida). Não é o gate de segurança: confirm_email_alert_action
// revalida a permissão de quem CLICA de verdade, sempre.
export async function resolveAllowedEmailActions(
  admin: SupabaseClient,
  projectId: string,
  recipientEmail: string
): Promise<readonly EmailAlertActionType[]> {
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .ilike("email", recipientEmail)
    .maybeSingle();

  if (!profile) {
    return SAFE_DEFAULT_ACTIONS;
  }

  const { data: membership } = await admin
    .from("project_memberships")
    .select("permission,status")
    .eq("project_id", projectId)
    .eq("user_id", profile.id)
    .maybeSingle();

  if (!membership || membership.status !== "ACTIVE") {
    return SAFE_DEFAULT_ACTIONS;
  }

  if (
    membership.permission === "ADMINISTRADOR" ||
    membership.permission === "GESTOR" ||
    membership.permission === "GERENTE"
  ) {
    return EMAIL_ALERT_ACTION_TYPES;
  }

  // COLABORADOR/LEITURA: membro ACTIVE confirmado, mas sem permissão
  // para ASSUMIR RESPONSABILIDADE/DEFINIR PRAZO — nunca oferecidos.
  return SAFE_DEFAULT_ACTIONS;
}
