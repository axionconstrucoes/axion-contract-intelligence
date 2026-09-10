import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@axion/db/admin";
import { getAppBaseUrl } from "@/lib/app-base-url";
import { sendSystemHealthAlertEmail } from "@/lib/email/send-system-health-alert-email";

export const runtime = "nodejs";
export const maxDuration = 300;

const ADMIN_RECIPIENTS = ["reynaldo@axion.com.br", "carla@axion.com.br"];

function sanitize(value: unknown): string {
  return String(value ?? "Falha de integração sem detalhe")
    .replace(/(token|secret|password|authorization)\s*[:=]\s*\S+/gi, "$1=[REMOVIDO]")
    .slice(0, 500);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const { data: integrations, error } = await admin
    .from("project_integrations")
    .select("project_id,source_type,status,last_connection_error,projects!inner(name,code)")
    .or("status.in.(ATENCAO,ERRO),last_connection_error.not.is.null");
  if (error) return Response.json({ error: "Falha ao verificar integrações." }, { status: 500 });

  let created = 0;
  let sent = 0;
  let failed = 0;
  for (const row of integrations ?? []) {
    const summary = sanitize(row.last_connection_error ?? `Integração em estado ${row.status}.`);
    const fingerprint = createHash("sha256")
      .update(`${row.source_type}|${row.status}|${summary.toLocaleLowerCase("pt-BR")}`)
      .digest("hex");
    const { data: incident } = await admin
      .from("acc_system_health_incidents")
      .upsert({
        project_id: row.project_id,
        source_type: row.source_type,
        fingerprint,
        summary,
        last_detected_at: new Date().toISOString(),
      }, { onConflict: "project_id,fingerprint", ignoreDuplicates: true })
      .select("id")
      .maybeSingle();
    if (!incident) continue;
    created += 1;
    const projectRef = Array.isArray(row.projects) ? row.projects[0] : row.projects;
    const projectName = `${projectRef?.code ?? ""} — ${projectRef?.name ?? "Projeto"}`.replace(/^ — /, "");
    let incidentFailures = 0;
    for (const recipientEmail of ADMIN_RECIPIENTS) {
      try {
        await sendSystemHealthAlertEmail({
          recipientEmail,
          projectName,
          sourceType: row.source_type,
          summary,
          auditUrl: `${getAppBaseUrl()}/${row.project_id}/auditoria?tipo=INTEGRACOES`,
        });
        sent += 1;
      } catch {
        failed += 1;
        incidentFailures += 1;
      }
    }
    await admin.from("acc_system_health_incidents").update({
      notified_at: incidentFailures === 0 ? new Date().toISOString() : null,
    }).eq("id", incident.id);
    await admin.from("audit_log_entries").insert({
      project_id: row.project_id,
      actor_type: "SYSTEM",
      actor_user_id: null,
      actor_label: "acc-system-health",
      action: failed === 0 ? "SYSTEM_HEALTH_ALERT_SENT" : "SYSTEM_HEALTH_ALERT_FAILED",
      entity_type: "PROJECT_INTEGRATION",
      entity_id: `${row.project_id}:${row.source_type}`,
      detail: `Falha operacional detectada em ${row.source_type}. ${sent} envio(s); ${failed} falha(s).`,
    });
  }
  return Response.json({ checked: integrations?.length ?? 0, created, sent, failed }, { status: failed > 0 ? 207 : 200 });
}
