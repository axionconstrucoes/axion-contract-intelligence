import { createSupabaseAdminClient } from "@axion/db/admin";
import { createSupabaseServerClient } from "@axion/db/server";
import { getAppBaseUrl } from "@/lib/app-base-url";
import { getCurrentProjectPermission } from "@/lib/contract-review";
import { sendSsmaAccidentAlertEmail } from "@/lib/email/send-ssma-accident-alert-email";

type ProfileRow = { id: string; name: string; email: string };
type MembershipRow = { user_id: string; area: string | null };

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return Response.json({ error: "Sessão expirada." }, { status: 401 });

  let submissionId = "";
  try {
    submissionId = String((await request.json() as { submissionId?: unknown }).submissionId ?? "").trim();
  } catch {
    return Response.json({ error: "Conteúdo inválido." }, { status: 400 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(submissionId)) {
    return Response.json({ error: "Registro inválido." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: submission, error: submissionError } = await admin
    .from("ssma_form_submissions")
    .select("id,project_id,checklist_slug,status,occurred_at,field_values,risk_level")
    .eq("id", submissionId)
    .maybeSingle();
  if (submissionError || !submission || submission.checklist_slug !== "ocorrencia-acidente" || submission.status !== "SUBMITTED") {
    return Response.json({ error: "Ocorrência finalizada não encontrada." }, { status: 404 });
  }

  const projectId = String(submission.project_id);
  if ((await getCurrentProjectPermission(projectId)) === null) {
    return Response.json({ error: "Acesso negado." }, { status: 403 });
  }

  const [{ data: project }, { data: memberships }] = await Promise.all([
    admin.from("projects").select("name,code").eq("id", projectId).single(),
    admin.from("project_memberships").select("user_id,area").eq("project_id", projectId).eq("status", "ACTIVE"),
  ]);
  const fieldValues = submission.field_values as Record<string, unknown>;
  const withLeave = fieldValues.afastamento === "Com afastamento";
  const targetIds = (memberships as MembershipRow[] | null ?? [])
    .filter((membership) => membership.area === "ENGENHARIA" || (withLeave && membership.area === "COMERCIAL"))
    .map((membership) => membership.user_id);
  if (targetIds.length === 0) {
    await admin.from("audit_log_entries").insert({
      project_id: projectId,
      actor_type: "SYSTEM",
      actor_user_id: null,
      actor_label: "ssma-accident-notifier",
      action: "ACCIDENT_NOTIFICATION_TARGET_NOT_CONFIGURED",
      entity_type: "SSMA_FORM_SUBMISSION",
      entity_id: submissionId,
      detail: "Nenhum destinatário ativo de Engenharia/Comercial foi encontrado para a ocorrência.",
    });
    return Response.json({ error: "Destinatários não configurados." }, { status: 409 });
  }

  const { data: profiles } = await admin.from("profiles").select("id,name,email").in("id", [...new Set(targetIds)]);
  const recipients = (profiles as ProfileRow[] | null ?? []).filter((profile) => profile.email);
  let failures = 0;
  for (const recipient of recipients) {
    const normalizedEmail = recipient.email.trim().toLowerCase();
    const { data: delivery } = await admin
      .from("ssma_accident_notification_deliveries")
      .upsert({
        project_id: projectId,
        submission_id: submissionId,
        recipient_email: normalizedEmail,
        recipient_name: recipient.name,
        status: "PENDING",
        last_error: null,
      }, { onConflict: "submission_id,recipient_email", ignoreDuplicates: true })
      .select("id")
      .maybeSingle();
    if (!delivery) continue;
    try {
      const result = await sendSsmaAccidentAlertEmail({
        projectId,
        submissionId,
        projectName: `${project?.code ?? ""} — ${project?.name ?? "Obra"}`.replace(/^ — /, ""),
        recipientEmail: normalizedEmail,
        recipientName: recipient.name,
        severity: submission.risk_level === "CRITICA" ? "CRITICA" : "ALTA",
        employeeName: String(fieldValues.funcionario ?? ""),
        leaveClassification: String(fieldValues.afastamento ?? ""),
        occurredAt: new Date(String(submission.occurred_at)).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
        informedCause: String(fieldValues.causa ?? ""),
        accUrl: `${getAppBaseUrl()}/${projectId}/acoes`,
      });
      await admin.from("ssma_accident_notification_deliveries").update({
        status: "SENT", sent_at: result.sentAt, provider_message_id: result.providerMessageId,
      }).eq("id", delivery.id);
    } catch (error) {
      failures += 1;
      await admin.from("ssma_accident_notification_deliveries").update({
        status: "FAILED", last_error: error instanceof Error ? error.message.slice(0, 500) : "Falha desconhecida",
      }).eq("id", delivery.id);
    }
  }

  await admin.from("audit_log_entries").insert({
    project_id: projectId,
    actor_type: "SYSTEM",
    actor_user_id: null,
    actor_label: "ssma-accident-notifier",
    action: failures === 0 ? "ACCIDENT_NOTIFICATION_SENT" : "ACCIDENT_NOTIFICATION_FAILED",
    entity_type: "SSMA_FORM_SUBMISSION",
    entity_id: submissionId,
    detail: `${recipients.length - failures} comunicação(ões) enviada(s); ${failures} falha(s).`,
  });
  return Response.json({ sent: recipients.length - failures, failures }, { status: failures > 0 ? 502 : 200 });
}
