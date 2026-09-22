import { isValidContractAlertBatchAction } from "@/lib/email-actions/contract-alert-batch-validation";
import type { ContractAlertBatchResponsePayload } from "@/lib/email-actions/contract-alert-batch-types";
import { respondToContractAlertBatch } from "@/lib/email-actions/respond-to-contract-alert-batch";

export const runtime = "nodejs";

// Endpoint que EFETIVA a resposta final de um lote de alertas de
// contrato (requisito 5: "No endpoint que efetiva a resposta..."). Nunca
// confia só na interface: recarrega o lote/itens/colaboradores do banco
// (respondToContractAlertBatch) e recusa com 422 (resposta incompleta ou
// inválida — ex.: item pendente, ENVIADO P/ sem colaborador válido) ou
// 409 (conflito de estado — lote não encontrado, já respondido, ou
// ainda não enviado) sempre que houver qualquer pendência. Mesmo que
// alguém chame este endpoint diretamente (sem passar pela página),
// nenhuma resposta parcial é aceita.
export async function POST(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Corpo da requisição inválido." }, { status: 422 });
  }

  const rawResponses = (body as { responses?: unknown } | null)?.responses;
  if (!Array.isArray(rawResponses)) {
    return Response.json({ error: "Formato de respostas inválido." }, { status: 422 });
  }

  const responses: ContractAlertBatchResponsePayload[] = [];
  for (const raw of rawResponses) {
    const candidate = raw as Record<string, unknown> | null;
    if (
      !candidate ||
      typeof candidate !== "object" ||
      typeof candidate.eventId !== "string" ||
      !isValidContractAlertBatchAction(candidate.action)
    ) {
      return Response.json({ error: "Existe uma resposta com formato inválido no lote." }, { status: 422 });
    }

    responses.push({
      eventId: candidate.eventId,
      action: candidate.action,
      assignedUserId: typeof candidate.assignedUserId === "string" ? candidate.assignedUserId : null,
    });
  }

  const outcome = await respondToContractAlertBatch({ batchId, responses });

  if (!outcome.ok) {
    return Response.json({ error: outcome.error, pendingItems: outcome.pendingItems ?? [] }, { status: outcome.status });
  }

  return Response.json({ batchId, respondedItems: outcome.respondedItems }, { status: 200 });
}
