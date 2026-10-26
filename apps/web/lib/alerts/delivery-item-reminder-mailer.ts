import "server-only";

import { createSupabaseAdminClient } from "@axion/db/admin";

import { getAppBaseUrl } from "../app-base-url";
import { appendAccEmailSignature } from "../email/branding/acc-email-signature";
import { loadAccAlertLogos } from "../email/branding/load-acc-logo-inline-image";
import { getEmailProvider } from "../email/get-email-provider";
import { buildContractAlertEmail } from "../email/templates/contract-alert-template";
import { DELIVERY_PHASE_LABELS, DELIVERY_STATUS_LABELS, DEPENDENCY_LABELS } from "../delivery/delivery-items";
import { DELIVERY_ITEM_COLUMNS, toDeliveryItem, type DeliveryItemRow } from "../delivery/delivery-mappers";
import type { ReminderMailer, ReminderMessage } from "./followup-engine";

class ReminderError extends Error {
  constructor(name: string) {
    super(name);
    this.name = name;
  }
}

function formatDay(day: string | null): string {
  if (!day) return "a definir";
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Alerta/lembrete de PROVIDÊNCIA da obra: e-mail com a mesma caixa colorida por risco e o texto
 * "Repete: …", enviado ao responsável ATUAL. As ações (situação, responsável, evidência) são feitas
 * na tabela de providências — o link abre a própria linha (registro único, sem controles
 * duplicados no e-mail). O guard do piloto vale no provider.
 */
export class DeliveryItemReminderMailer implements ReminderMailer {
  async send(message: ReminderMessage): Promise<void> {
    if (message.followup.sourceType !== "DELIVERY_ITEM") throw new ReminderError("ORIGEM_NAO_SUPORTADA");

    const admin = createSupabaseAdminClient();
    const projectId = message.followup.projectId;

    const [{ data: itemRow }, { data: project }, { data: recipient }] = await Promise.all([
      admin.from("project_delivery_items").select(DELIVERY_ITEM_COLUMNS).eq("id", message.followup.sourceId).eq("project_id", projectId).maybeSingle(),
      admin.from("projects").select("name").eq("id", projectId).maybeSingle(),
      admin.from("profiles").select("name,email").eq("id", message.recipientUserId).maybeSingle(),
    ]);

    if (!itemRow || !project) throw new ReminderError("PROVIDENCIA_AUSENTE");
    if (!recipient?.email) throw new ReminderError("DESTINATARIO_SEM_EMAIL");

    const item = toDeliveryItem(itemRow as unknown as DeliveryItemRow);
    if (item.status === "CONCLUIDO" || item.status === "NAO_APLICAVEL") throw new ReminderError("PROVIDENCIA_ENCERRADA");

    const severity = message.followup.severity;
    const dark = severity === "CRITICA" || severity === "ALTA";
    const logos = loadAccAlertLogos({ maroon: !dark, inverted: dark });
    const eventUrl = `${getAppBaseUrl()}/${projectId}/providencias#item-${item.id}`;
    const actionBase = `${getAppBaseUrl()}/alertas/providencia/${projectId}/${item.id}`;

    const summaryParts = [
      `${DELIVERY_PHASE_LABELS[item.phase]} — situação: ${DELIVERY_STATUS_LABELS[item.status]}.`,
      `Data limite: ${formatDay(item.deadline)}.`,
      item.dependencyKind ? `Depende de ${DEPENDENCY_LABELS[item.dependencyKind].toLowerCase()}: ${item.dependencyName}.` : null,
      item.blocksDelivery ? "Esta providência bloqueia a entrega." : null,
    ].filter(Boolean);

    const built = buildContractAlertEmail({
      recipientName: recipient.name ?? null,
      projectName: project.name as string,
      severity,
      title: item.title,
      summary: summaryParts.join(" "),
      relatedEventTitle: null,
      contractualBasis: null,
      confrontationBlocks: [],
      // Evidência registrada na tabela: o link abre a linha da providência (registro verificável).
      // Sem evidência registrada: o e-mail mostra "Pendente de confirmação".
      keyEvidence: item.evidence ? [{ kind: "OTHER" as const, url: eventUrl, sourceTypeLabel: "Providência", label: item.evidence }] : [],
      potentialImpact: "Entrega da obra",
      recommendedAction: null,
      responsibleName: null,
      dueDate: item.deadline ? formatDay(item.deadline) : null,
      eventUrl,
      // Três ações com confirmação explícita na página do ACC (providência + acompanhamento válidos:
      // este e-mail só é gerado por um acompanhamento aberto, com responsável ativo da obra).
      quickActionUrls: {
        RESOLVIDO: `${actionBase}?acao=RESOLVIDO`,
        EM_ANDAMENTO: `${actionBase}?acao=EM_ANDAMENTO`,
        ENVIADO_PARA: `${actionBase}?acao=ENVIADO_PARA`,
      },
      impactedClause: null,
      actionButtons: [],
      hasInlineLogo: logos.availability.maroon,
      hasInlineInvertedLogo: logos.availability.inverted,
      repeatNotice: true,
    });
    const signed = appendAccEmailSignature({ text: built.text, html: built.html }, logos.images.length > 0, false);

    let sent;
    try {
      sent = await getEmailProvider().send({
        to: recipient.email as string,
        subject: built.subject,
        text: signed.text,
        html: signed.html,
        inlineImages: logos.images.length > 0 ? logos.images : undefined,
        correlationId: message.idempotencyKey,
      });
    } catch {
      throw new ReminderError("ENVIO_FALHOU");
    }

    // Registros auxiliares: o e-mail já foi aceito — falhas aqui não podem fazer o lembrete ser
    // tratado como não enviado.
    try {
      await admin.from("emails").insert({
        project_id: projectId,
        from_address: sent.from,
        to_address: recipient.email,
        subject: built.subject,
        sent_at: sent.sentAt,
        snippet: built.text.slice(0, 280),
      });
      await admin.from("audit_log_entries").insert({
        project_id: projectId,
        actor_type: "SYSTEM",
        actor_user_id: null,
        actor_label: null,
        action: "DELIVERY_ITEM_ALERT_SENT",
        entity_type: "PROJECT_DELIVERY_ITEM",
        entity_id: item.id,
        detail: `Alerta de providência (RISCO ${severity}) aceito pelo provedor; acompanhamento ${message.followup.id}.`,
      });
    } catch {
      // complementar
    }
  }
}
