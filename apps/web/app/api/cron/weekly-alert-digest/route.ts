import { isCronRequestAuthorized } from "@/lib/cron/cron-request-auth";
import { runWeeklyAlertDigests } from "@/lib/email/run-weekly-alert-digests";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  // Bearer CRON_SECRET só no header (tempo constante; sem segredo => 401).
  if (!isCronRequestAuthorized(request, process.env.CRON_SECRET)) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const result = await runWeeklyAlertDigests();
    return Response.json(result, { status: result.failed > 0 ? 207 : 200 });
  } catch {
    return Response.json({ error: "Falha ao processar o resumo semanal." }, { status: 500 });
  }
}
