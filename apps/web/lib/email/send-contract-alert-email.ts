import "server-only";

import { createSupabaseAdminClient } from "@axion/db/admin";
import { createSupabaseServerClient } from "@axion/db/server";

import { failManualAlertBatch, finalizeManualAlertBatch, registerManualAlertBatch } from "@/lib/alerts/manual-alert-tracking";
import { getAppBaseUrl } from "@/lib/app-base-url";
import { buildAiConsultUrl } from "@/lib/alerts/ai-consult-link";
import { getCurrentProjectPermission } from "@/lib/contract-review";

import { appendAccEmailSignature } from "./branding/acc-email-signature";
import { loadAccAlertLogos } from "./branding/load-acc-logo-inline-image";
import { EmailSendError } from "./email-provider";
import { assertNotEmailFixtureData } from "./fixture-safety-guard";
import { getEmailProvider } from "./get-email-provider";
import { resolveEffectiveRecipient } from "./pilot-outbound-guard";
import type { OutboundMode } from "./send-outcome";
import { buildContractAlertEmail, type ContractAlertEmailInput } from "./templates/contract-alert-template";

export class NotAuthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotAuthorizedError";
  }
}

export interface SendContractAlertEmailInput {
  projectId: string;
  eventId: string;
  recipientEmail: string;
  // hasInlineLogo NUNCA vem do caller: é decidido aqui mesmo, a partir do
  // resultado real de loadAccLogoInlineImage() logo abaixo — nunca
  // adivinhado/hardcoded por quem monta o alerta (send-alert-actions.ts).
  alert: Omit<ContractAlertEmailInput, "hasInlineLogo" | "hasInlineInvertedLogo" | "quickActionUrls" | "repeatNotice">;
}

export interface SendContractAlertEmailResult {
  /** Modo de saída decidido pelo guard (só "PRODUCTION" exato libera o destinatário escolhido). */
  outboundMode: OutboundMode;
  /** Destinatário escolhido na tela. */
  intendedRecipientEmail: string;
  /** Destino EFETIVO decidido pelo guard — em piloto, a caixa de teste. */
  effectiveRecipientEmail: string;
  emailId: string;
  provider: string;
  providerMessageId: string;
  providerThreadId: string;
  messageIdHeader: string;
  sentAt: string;
}

/**
 * Envio do e-mail institucional de "Alerta do Contrato" (padrão ACC) — o
 * "SISTEMA ENVIA" final da cadeia IA prepara → humano revisa/edita →
 * humano aprova → sistema envia. Só é chamado depois que um humano
 * autenticado com permissão EDITOR/ADMIN confirmou o envio (nunca
 * automático a partir de um Expert).
 *
 * Autorização via RLS (sessão real do usuário); os writes técnicos
 * (emails/audit_log_entries) usam o admin client, mesmo padrão de
 * action-request-notification-core.ts — nenhuma policy de INSERT existe
 * para essas tabelas sob RLS normal, então não seria possível fazê-lo de
 * outra forma sem duplicar essa exceção em todo lugar.
 */
export async function sendContractAlertEmail(
  input: SendContractAlertEmailInput
): Promise<SendContractAlertEmailResult> {
  const supabase = await createSupabaseServerClient();

  const { data: eventRow, error: eventError } = await supabase
    .from("contract_events")
    .select("id")
    .eq("id", input.eventId)
    .eq("project_id", input.projectId)
    .maybeSingle();

  if (eventError) {
    throw eventError;
  }

  if (!eventRow) {
    throw new NotAuthorizedError(
      `Evento ${input.eventId} não encontrado ou não autorizado para o usuário atual.`
    );
  }

  const permission = await getCurrentProjectPermission(input.projectId);
  if (permission !== "ADMINISTRADOR") {
    throw new NotAuthorizedError(
      "Envio de alerta por e-mail exige permissão ADMINISTRADOR no projeto."
    );
  }

  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) {
    throw new NotAuthorizedError("Sessão expirada. Faça login novamente.");
  }

  // Última barreira contra dado fictício de prévia (ex.: DUX) alcançar
  // o provider real — ver fixture-safety-guard.ts. Lança antes de
  // qualquer I/O de envio/gravação.
  assertNotEmailFixtureData(input.alert.projectName);

  // Carregado ANTES de montar o e-mail: o template usa hasInlineLogo para
  // decidir se o cabeçalho referencia "cid:" (Parte B) — igual à regra já
  // existente para a assinatura, nunca duas fontes de verdade divergentes
  // sobre "o logo está disponível nesta execução?".
  // Só a versão do logo que a caixa deste risco usa: invertido (fundo escuro)
  // para CRÍTICO/ALTO, vinho (oficial) para MÉDIO/BAIXO.
  const darkTone = input.alert.severity === "CRITICA"; // só o vermelho usa logo invertido
  const logos = loadAccAlertLogos({ maroon: !darkTone, inverted: darkTone });
  const hasInlineLogo = logos.availability.maroon || logos.availability.inverted;
  // Acompanhamento do alerta individual: registra um lote de UM item (mesmas páginas de confirmação
  // e mesmo acompanhamento recorrente do lote). Sem acompanhamento válido (destinatário que não é
  // membro ativo da obra ou falha ao registrar), o e-mail segue com os botões por token, como antes.
  const adminForTracking = createSupabaseAdminClient();
  const tracking = await registerManualAlertBatch(adminForTracking, {
    projectId: input.projectId,
    eventId: input.eventId,
    recipientEmail: input.recipientEmail,
    severity: input.alert.severity,
    title: input.alert.title,
  });
  const quickBase = tracking ? `${getAppBaseUrl()}/alertas/acao/${input.projectId}/${tracking.batchId}/${input.eventId}` : null;

  const { subject, html, text } = buildContractAlertEmail({
    ...input.alert,
    hasInlineLogo: logos.availability.maroon,
    hasInlineInvertedLogo: logos.availability.inverted,
    repeatNotice: tracking !== null,
    aiConsultUrl: buildAiConsultUrl({ baseUrl: getAppBaseUrl(), projectId: input.projectId, subject: "evento", id: input.eventId }),
    quickActionUrls: quickBase
      ? {
          RESOLVIDO: `${quickBase}?acao=RESOLVIDO`,
          EM_ANDAMENTO: `${quickBase}?acao=EM_ANDAMENTO`,
          ENVIADO_PARA: `${quickBase}?acao=ENVIADO_PARA`,
        }
      : null,
  });
  // includeLogoImage=false: o cabeçalho do alerta (buildHeaderHtml) já
  // mostra o logo — a assinatura no rodapé repetiria a mesma imagem se
  // não fosse suprimida aqui (único fluxo de e-mail com logo no
  // cabeçalho; SLA/solicitação de ação continuam com o default true).
  const signed = appendAccEmailSignature({ text, html }, hasInlineLogo, false);

  // Mesma fonte única que o provider usa (applyPilotOutboundGuard): decide o destino
  // efetivo ANTES do envio para a tela/auditoria poderem relatar o resultado real. Fail-closed
  // (lança EmailSendError se o piloto estiver mal configurado), igual ao envio.
  const resolvedRecipient = resolveEffectiveRecipient(input.recipientEmail);

  const provider = getEmailProvider();
  const correlationId = crypto.randomUUID();

  let sendResult;
  try {
    sendResult = await provider.send({
      to: input.recipientEmail,
      subject,
      text: signed.text,
      html: signed.html,
      inlineImages: logos.images.length > 0 ? logos.images : undefined,
      correlationId,
    });
  } catch (error) {
    if (tracking) await failManualAlertBatch(adminForTracking, tracking.batchId);
    if (error instanceof EmailSendError) {
      throw error;
    }
    throw new EmailSendError("Falha inesperada ao enviar alerta do contrato.");
  }

  // O provedor ACEITOU a mensagem: marca o lote como SENT e abre o acompanhamento recorrente.
  if (tracking) {
    await finalizeManualAlertBatch(adminForTracking, {
      batch: tracking,
      projectId: input.projectId,
      eventId: input.eventId,
      severity: input.alert.severity,
      effectiveRecipientEmail: resolvedRecipient.effectiveRecipientEmail,
      providerMessageId: sendResult.providerMessageId,
      sentAt: sendResult.sentAt,
    });
  }

  const admin = adminForTracking;

  const { data: emailRow, error: emailInsertError } = await admin
    .from("emails")
    .insert({
      project_id: input.projectId,
      from_address: sendResult.from,
      to_address: input.recipientEmail,
      subject,
      sent_at: sendResult.sentAt,
      snippet: text.slice(0, 280),
    })
    .select("id")
    .single();

  if (emailInsertError) {
    throw emailInsertError;
  }

  const emailId = emailRow.id as string;

  const { error: auditError } = await admin.from("audit_log_entries").insert({
    project_id: input.projectId,
    actor_type: "USER",
    actor_user_id: authData.user.id,
    actor_label: null,
    action: "CONTRACT_ALERT_EMAIL_SENT",
    entity_type: "CONTRACT_EVENT",
    entity_id: input.eventId,
    // Resumo compacto — nunca o corpo integral do alerta no log de auditoria.
    detail:
      resolvedRecipient.mode === "PILOT"
        ? `Alerta de contrato (RISCO ${input.alert.severity}) destinado a ${input.recipientEmail}; MODO PILOTO: entrega efetiva redirecionada para ${resolvedRecipient.effectiveRecipientEmail} (aceite do provedor, entrega não confirmada).`
        : `Alerta de contrato (RISCO ${input.alert.severity}) aceito pelo provedor para ${input.recipientEmail} (entrega não confirmada).`,
  });

  if (auditError) {
    throw auditError;
  }

  return {
    outboundMode: resolvedRecipient.mode,
    intendedRecipientEmail: input.recipientEmail,
    effectiveRecipientEmail: resolvedRecipient.effectiveRecipientEmail,
    emailId,
    provider: sendResult.provider,
    providerMessageId: sendResult.providerMessageId,
    providerThreadId: sendResult.providerThreadId,
    messageIdHeader: sendResult.messageIdHeader,
    sentAt: sendResult.sentAt,
  };
}
