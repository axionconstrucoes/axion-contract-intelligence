import { isCronRequestAuthorized, RISK_ALERTS_CRON_SECRET_ENV } from "@/lib/cron/cron-request-auth";
import { isWeeklyReportsEnabled } from "@/lib/feature-flags/weekly-reports";
import { runRiskAlertCycle } from "@/lib/risk-alerts/run-risk-alert-cycle";

// Worker horário dos alertas de risco. Disparado pelo workflow GitHub
// horário (.github/workflows/weekly-schedule-email-ingestion.yml, job
// risk-alerts) — o plano Vercel atual admite só 2 crons diários, por isso
// a rota NÃO está em vercel.json. Segredo DEDICADO do piloto:
// Authorization: Bearer ACC_RISK_ALERTS_CRON_SECRET — exclusivamente
// esse (sem fallback para o CRON_SECRET dos crons Vercel); só no header
// (nunca query string); comparação em tempo constante; ausente/vazio/
// incorreto => 401; o header nunca é registrado.
// - ACC_WEEKLY_REPORTS_ENABLED != "true" => 204 sem tocar no banco.
// - ?dryRun=1 => só o plano (nenhuma escrita, nenhum envio), para
//   inspeção manual controlada.
// - ?projectId=<uuid> => restringe a um projeto.
// - Execução concorrente na mesma instância => 409 (o ciclo já é
//   idempotente pela outbox; entre instâncias, o workflow tem
//   concurrency group e as chaves únicas impedem duplicidade).
// A janela do consolidado (quarta 07:00 no timezone do projeto) é decidida
// pelo próprio ciclo a cada hora — o agendamento em UTC nunca fixa o
// horário local.
export const runtime = "nodejs";
export const maxDuration = 300;

let inFlight = false;

export async function GET(request: Request) {
  if (!isCronRequestAuthorized(request, process.env[RISK_ALERTS_CRON_SECRET_ENV])) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }
  if (!isWeeklyReportsEnabled()) {
    return new Response(null, { status: 204 });
  }
  if (inFlight) {
    return Response.json({ error: "Ciclo de alertas já em execução." }, { status: 409 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const projectId = url.searchParams.get("projectId");

  inFlight = true;
  try {
    const result = await runRiskAlertCycle({ dryRun, projectId: projectId && /^[0-9a-f-]{36}$/i.test(projectId) ? projectId : null });
    const failed = result.projects.reduce((sum, project) => sum + project.failed, 0);
    return Response.json(result, { status: failed > 0 ? 207 : 200 });
  } catch {
    // Nunca vaza detalhes (tokens, e-mails) no corpo da resposta.
    return Response.json({ error: "Falha ao processar alertas de risco." }, { status: 500 });
  } finally {
    inFlight = false;
  }
}
