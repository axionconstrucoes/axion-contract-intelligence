import { isWeeklyReportsEnabled } from "@/lib/feature-flags/weekly-reports";
import { runRiskAlertCycle } from "@/lib/risk-alerts/run-risk-alert-cycle";

// Worker horário dos alertas de risco (ver vercel.json). Mesmo contrato
// do cron do resumo semanal existente: Bearer CRON_SECRET obrigatório.
// - ACC_WEEKLY_REPORTS_ENABLED != "true" => 204 sem tocar no banco.
// - ?dryRun=1 => só o plano (nenhuma escrita, nenhum envio), para
//   inspeção manual controlada.
// - ?projectId=<uuid> => restringe a um projeto.
// A janela do consolidado (quarta 07:00 no timezone do projeto) é decidida
// pelo próprio ciclo a cada hora — o cron em UTC nunca fixa o horário local.
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Não autorizado." }, { status: 401 });
  }
  if (!isWeeklyReportsEnabled()) {
    return new Response(null, { status: 204 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const projectId = url.searchParams.get("projectId");

  try {
    const result = await runRiskAlertCycle({ dryRun, projectId: projectId && /^[0-9a-f-]{36}$/i.test(projectId) ? projectId : null });
    const failed = result.projects.reduce((sum, project) => sum + project.failed, 0);
    return Response.json(result, { status: failed > 0 ? 207 : 200 });
  } catch {
    // Nunca vaza detalhes (tokens, e-mails) no corpo da resposta.
    return Response.json({ error: "Falha ao processar alertas de risco." }, { status: 500 });
  }
}
