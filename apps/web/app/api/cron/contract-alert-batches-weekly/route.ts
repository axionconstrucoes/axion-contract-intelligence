import { isCronRequestAuthorized } from "@/lib/cron/cron-request-auth";
import { runWeeklyContractAlertBatches } from "@/lib/email/run-weekly-contract-alert-batches";

// Mesmo padrão de api/cron/weekly-alert-digest/route.ts: Bearer
// CRON_SECRET só no header, tempo constante, 401 sem segredo — mesmo
// mecanismo de agendamento já existente no ACC, nenhum scheduler
// paralelo.
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequestAuthorized(request, process.env.CRON_SECRET)) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const result = await runWeeklyContractAlertBatches();
    return Response.json(result, { status: result.failed > 0 ? 207 : 200 });
  } catch {
    return Response.json({ error: "Falha ao compor o lote semanal de alertas." }, { status: 500 });
  }
}
