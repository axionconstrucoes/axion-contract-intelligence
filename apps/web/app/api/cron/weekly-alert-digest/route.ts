import { runWeeklyAlertDigests } from "@/lib/email/run-weekly-alert-digests";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const result = await runWeeklyAlertDigests();
    return Response.json(result, { status: result.failed > 0 ? 207 : 200 });
  } catch {
    return Response.json({ error: "Falha ao processar o resumo semanal." }, { status: 500 });
  }
}
