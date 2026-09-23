import { isCronRequestAuthorized } from "@/lib/cron/cron-request-auth";
import { runContractAlertBatches } from "@/lib/email/run-contract-alert-batches";
import { runWeeklyAlertDigests } from "@/lib/email/run-weekly-alert-digests";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  // Bearer CRON_SECRET só no header (tempo constante; sem segredo => 401).
  if (!isCronRequestAuthorized(request, process.env.CRON_SECRET)) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const [weeklyDigest, contractBatches] = await Promise.all([
      runWeeklyAlertDigests(),
      runContractAlertBatches(),
    ]);
    const failed = weeklyDigest.failed + contractBatches.groupsFailed;
    return Response.json({ weeklyDigest, contractBatches }, { status: failed > 0 ? 207 : 200 });
  } catch {
    return Response.json({ error: "Falha ao processar o resumo semanal." }, { status: 500 });
  }
}
