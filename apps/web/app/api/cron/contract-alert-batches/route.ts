import { isCronRequestAuthorized } from "@/lib/cron/cron-request-auth";
import { runContractAlertBatches } from "@/lib/email/run-contract-alert-batches";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequestAuthorized(request, process.env.CRON_SECRET)) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const contractBatches = await runContractAlertBatches();

    return Response.json(
      { contractBatches },
      { status: contractBatches.groupsFailed > 0 ? 207 : 200 }
    );
  } catch {
    return Response.json(
      { error: "Falha ao processar os lotes de alertas contratuais." },
      { status: 500 }
    );
  }
}
