import { isCronRequestAuthorized } from "@/lib/cron/cron-request-auth";
import { runAlertReminders } from "@/lib/alerts/run-alert-reminders";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequestAuthorized(request, process.env.CRON_SECRET)) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const reminders = await runAlertReminders();
    // Resumo sem conteúdo de e-mail: só contagens e códigos curtos de falha.
    return Response.json({ reminders }, { status: reminders.failed > 0 || "error" in reminders.deliveryScan ? 207 : 200 });
  } catch {
    return Response.json({ error: "Falha ao processar os lembretes de alertas." }, { status: 500 });
  }
}
