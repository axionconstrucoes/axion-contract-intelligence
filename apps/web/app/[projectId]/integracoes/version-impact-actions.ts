"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@axion/db/server";
import { createSupabaseAdminClient } from "@axion/db/admin";
import { sendVersionImpactReviewEmail } from "@/lib/email/send-version-impact-review-email";

export type VersionImpactReviewState = { success: boolean; error: string | null };

export async function submitVersionImpactReviewAction(
  _previous: VersionImpactReviewState,
  formData: FormData
): Promise<VersionImpactReviewState> {
  const projectId = String(formData.get("projectId") ?? "").trim();
  const transitionId = String(formData.get("transitionId") ?? "").trim();
  const scheduleImpact = String(formData.get("scheduleImpact") ?? "").trim();
  const priceImpact = String(formData.get("priceImpact") ?? "").trim();
  const planningResponse = String(formData.get("planningResponse") ?? "").trim();
  const sendToBudget = formData.get("sendToBudget") === "on";
  const budgetUserId = String(formData.get("budgetUserId") ?? "").trim() || null;

  if (!projectId || !transitionId || !scheduleImpact || !priceImpact || planningResponse.length < 10) {
    return { success: false, error: "Responda todos os itens antes de enviar a análise." };
  }
  if (sendToBudget && !budgetUserId) {
    return { success: false, error: "Selecione o orçamentista responsável." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { success: false, error: "Sessão expirada. Entre novamente." };

  const { data: reviewId, error } = await supabase.rpc("submit_construmanager_version_impact_review", {
    p_project_id: projectId,
    p_transition_id: transitionId,
    p_schedule_impact: scheduleImpact,
    p_price_impact: priceImpact,
    p_planning_response: planningResponse,
    p_send_to_budget: sendToBudget,
    p_budget_user_id: sendToBudget ? budgetUserId : null,
  });

  if (error) {
    const message = error.message.includes("duplicate key")
      ? "Esta versão já possui uma análise registrada."
      : "Não foi possível registrar a análise. Confira seu perfil de Planejamento.";
    return { success: false, error: message };
  }

  const admin = createSupabaseAdminClient();
  const [{ data: project }, { data: transition }, { data: memberships }] = await Promise.all([
    admin.from("projects").select("name").eq("id", projectId).single(),
    admin.from("construmanager_version_transitions").select("document_name,previous_revision,new_revision").eq("id", transitionId).single(),
    admin.from("project_memberships").select("user_id,permission,area,profiles(name,email,title)").eq("project_id", projectId).eq("status", "ACTIVE"),
  ]);
  const recipients = (memberships ?? []).flatMap((membership) => {
    const rawProfile = membership.profiles as unknown as { name: string; email: string; title: string | null } | Array<{ name: string; email: string; title: string | null }> | null;
    const profile = Array.isArray(rawProfile) ? rawProfile[0] : rawProfile;
    const title = profile?.title ?? "";
    const mustReceive = membership.permission === "GERENTE" ||
      membership.area === "DIRETORIA" ||
      (membership.area === "COMERCIAL" && /diretor/i.test(title)) ||
      (sendToBudget && membership.user_id === budgetUserId);
    return mustReceive && profile?.email ? [{ ...profile, email: profile.email.toLowerCase() }] : [];
  });

  const uniqueRecipients = [...new Map(recipients.map((recipient) => [recipient.email, recipient])).values()];
  const accBaseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://acc.axion.com.br").replace(/\/$/, "");
  for (const recipient of uniqueRecipients) {
    const { data: delivery } = await admin.from("construmanager_version_review_deliveries").upsert({
      review_id: reviewId,
      project_id: projectId,
      recipient_email: recipient.email,
      status: "PENDING",
    }, { onConflict: "review_id,recipient_email", ignoreDuplicates: true }).select("id").maybeSingle();
    if (!delivery) continue;
    try {
      const sent = await sendVersionImpactReviewEmail({
        recipientEmail: recipient.email,
        recipientName: recipient.name,
        projectName: project?.name ?? "Projeto",
        documentName: transition?.document_name ?? "Documento sem nome",
        previousRevision: transition?.previous_revision ?? null,
        newRevision: transition?.new_revision ?? "—",
        scheduleImpact,
        priceImpact,
        response: planningResponse,
        sentToBudget: sendToBudget,
        accUrl: `${accBaseUrl}/${projectId}/integracoes`,
      });
      await admin.from("construmanager_version_review_deliveries").update({ status: "SENT", provider_message_id: sent.providerMessageId, sent_at: sent.sentAt }).eq("id", delivery.id);
    } catch (sendError) {
      await admin.from("construmanager_version_review_deliveries").update({ status: "FAILED", last_error: sendError instanceof Error ? sendError.message.slice(0, 500) : "Falha no envio" }).eq("id", delivery.id);
    }
  }

  revalidatePath(`/${projectId}/integracoes`);
  return { success: true, error: null };
}

export async function submitBudgetResponseAction(
  _previous: VersionImpactReviewState,
  formData: FormData
): Promise<VersionImpactReviewState> {
  const projectId = String(formData.get("projectId") ?? "").trim();
  const reviewId = String(formData.get("reviewId") ?? "").trim();
  const response = String(formData.get("budgetResponse") ?? "").trim();
  if (!projectId || !reviewId || response.length < 10) {
    return { success: false, error: "Registre uma resposta completa antes de enviar." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("submit_construmanager_budget_response", {
    p_project_id: projectId,
    p_review_id: reviewId,
    p_response: response,
  });
  if (error) return { success: false, error: "Somente o orçamentista designado pode concluir esta análise." };
  revalidatePath(`/${projectId}/integracoes`);
  return { success: true, error: null };
}
