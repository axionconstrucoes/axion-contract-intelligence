import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlertSeverity } from "@axion/types";

import { openFollowupsForSentBatch } from "./followup-service";

// Acompanhamento do e-mail INDIVIDUAL MANUAL: para o alerta oferecer as mesmas três ações do lote
// (RESOLVIDO / EM ANDAMENTO / ENVIADO P/) com confirmação explícita e lembretes recorrentes, o
// envio registra um lote de UM item (contract_alert_batches) — a mesma estrutura e as mesmas
// páginas de confirmação do lote — e abre o acompanhamento depois do aceite do provedor.
//
// Se não houver destinatário que seja membro ATIVO da obra (ou o registro falhar), devolve null e
// o e-mail segue como antes, com os botões por token existentes (nenhuma funcionalidade se perde).

export interface ManualAlertBatch {
  batchId: string;
  recipientUserId: string;
}

export async function registerManualAlertBatch(
  admin: SupabaseClient,
  input: { projectId: string; eventId: string; recipientEmail: string; severity: AlertSeverity; title: string }
): Promise<ManualAlertBatch | null> {
  try {
    const email = input.recipientEmail.trim().toLowerCase();
    const { data: profile } = await admin.from("profiles").select("id").ilike("email", email).maybeSingle();
    if (!profile?.id) return null;

    const { data: membership } = await admin
      .from("project_memberships")
      .select("user_id")
      .eq("project_id", input.projectId)
      .eq("user_id", profile.id)
      .eq("status", "ACTIVE")
      .maybeSingle();
    if (!membership) return null;

    const { data: batch, error: batchError } = await admin
      .from("contract_alert_batches")
      .insert({
        project_id: input.projectId,
        recipient_user_id: profile.id,
        intended_recipient_email: email,
        correlation_id: crypto.randomUUID(),
      })
      .select("id")
      .single();
    if (batchError || !batch?.id) return null;

    const { error: itemError } = await admin.from("contract_alert_batch_items").insert({
      batch_id: batch.id,
      event_id: input.eventId,
      position: 1,
      severity: input.severity,
      title_snapshot: input.title,
    });
    if (itemError) {
      await admin.from("contract_alert_batches").update({ status: "FAILED", failure_reason: "Falha ao registrar o item do alerta." }).eq("id", batch.id);
      return null;
    }
    return { batchId: batch.id as string, recipientUserId: profile.id as string };
  } catch {
    return null;
  }
}

/** Provedor ACEITOU a mensagem: marca SENT e abre o acompanhamento (idempotente). Nunca lança. */
export async function finalizeManualAlertBatch(
  admin: SupabaseClient,
  input: {
    batch: ManualAlertBatch;
    projectId: string;
    eventId: string;
    severity: AlertSeverity;
    effectiveRecipientEmail: string;
    providerMessageId: string;
    sentAt: string;
  }
): Promise<void> {
  try {
    await admin
      .from("contract_alert_batches")
      .update({
        status: "SENT",
        effective_recipient_email: input.effectiveRecipientEmail,
        provider_message_id: input.providerMessageId,
        sent_at: input.sentAt,
        failure_reason: null,
      })
      .eq("id", input.batch.batchId)
      .in("status", ["PENDING", "FAILED"]);

    await openFollowupsForSentBatch(admin, {
      projectId: input.projectId,
      recipientUserId: input.batch.recipientUserId,
      items: [{ eventId: input.eventId, severity: input.severity }],
      sentAt: input.sentAt,
    });
  } catch {
    // complementar: o e-mail já foi aceito pelo provedor.
  }
}

export async function failManualAlertBatch(admin: SupabaseClient, batchId: string): Promise<void> {
  try {
    await admin
      .from("contract_alert_batches")
      .update({ status: "FAILED", failure_reason: "Falha no envio do alerta individual." })
      .eq("id", batchId)
      .neq("status", "RESPONDED");
  } catch {
    // complementar
  }
}
