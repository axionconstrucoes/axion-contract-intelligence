import { notFound } from "next/navigation";

import { ActionRequestStatusBadge } from "@/components/shared/badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getActionRequest,
  getActionRequestAssignees,
  getActionRequestResponses,
  getEmail,
  getNotificationEmailDeliveries,
  getNotificationsForActionRequest,
  getUser,
} from "@/lib/data";
import { formatDateTime } from "@/lib/labels";

import { sendActionRequestEmailAction } from "../actions";

type OutboundStatus =
  | { state: "NOT_SENT" }
  | { state: "SENDING" }
  | { state: "SENT"; sentAt: string | null }
  | { state: "FAILED" };

async function resolveOutboundStatus(actionRequestId: string): Promise<OutboundStatus> {
  const notifications = await getNotificationsForActionRequest(actionRequestId);
  const initial = notifications.find((notification) => notification.kind === "INITIAL") ?? null;

  if (!initial) {
    return { state: "NOT_SENT" };
  }

  if (initial.status === "SENT") {
    return { state: "SENT", sentAt: initial.sentAt };
  }

  // PENDING: falha de envio pertence ao delivery, nunca à Notification —
  // por isso o estado real só é conhecido consultando as deliveries.
  const deliveries = await getNotificationEmailDeliveries(initial.id);
  const hasFailedDelivery = deliveries.some((delivery) => delivery.status === "FAILED");

  return hasFailedDelivery ? { state: "FAILED" } : { state: "SENDING" };
}

export default async function ActionRequestDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; actionRequestId: string }>;
}) {
  const { projectId, actionRequestId } = await params;

  const actionRequest = await getActionRequest(actionRequestId);
  if (!actionRequest || actionRequest.projectId !== projectId) {
    notFound();
  }

  const [assignees, responses, outboundStatus] = await Promise.all([
    getActionRequestAssignees(actionRequestId),
    getActionRequestResponses(actionRequestId),
    resolveOutboundStatus(actionRequestId),
  ]);

  const assigneeUsers = await Promise.all(assignees.map((assignee) => getUser(assignee.userId)));

  const responseEmails = await Promise.all(
    responses.map((response) => (response.emailId ? getEmail(response.emailId) : null))
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">{actionRequest.title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{actionRequest.description}</p>
        </div>
        <ActionRequestStatusBadge status={actionRequest.status} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Envio por e-mail</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {outboundStatus.state === "SENT" ? (
                <p className="text-sm">
                  <Badge className="border-transparent bg-severity-baixa/15 text-severity-baixa">Enviada</Badge>{" "}
                  {outboundStatus.sentAt ? `em ${formatDateTime(outboundStatus.sentAt)}` : null}
                </p>
              ) : outboundStatus.state === "FAILED" ? (
                <p className="text-sm">
                  <Badge className="border-transparent bg-severity-critica/15 text-severity-critica">
                    Falha no envio
                  </Badge>{" "}
                  O envio não foi concluído. Nenhuma tentativa automática adicional foi feita.
                </p>
              ) : outboundStatus.state === "SENDING" ? (
                <p className="text-sm text-muted-foreground">Envio em andamento…</p>
              ) : (
                <form action={sendActionRequestEmailAction} className="flex flex-col gap-3">
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="actionRequestId" value={actionRequestId} />

                  <label className="flex flex-col gap-1.5 text-sm font-medium">
                    Destinatário
                    <input
                      type="email"
                      name="recipientEmail"
                      required
                      placeholder="destinatario@exemplo.com"
                      className="h-10 rounded-md border bg-card px-3 text-sm font-normal outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>

                  <label className="flex flex-col gap-1.5 text-sm font-medium">
                    Assunto
                    <input
                      name="subject"
                      required
                      defaultValue={`Solicitação: ${actionRequest.title}`}
                      className="h-10 rounded-md border bg-card px-3 text-sm font-normal outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>

                  <label className="flex flex-col gap-1.5 text-sm font-medium">
                    Mensagem
                    <textarea
                      name="body"
                      required
                      rows={6}
                      defaultValue={actionRequest.description}
                      className="resize-y rounded-md border bg-card p-3 text-sm font-normal outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>

                  <p className="text-xs text-muted-foreground">
                    Revise o destinatário e o conteúdo antes de confirmar — o envio é uma ação explícita e não pode
                    ser desfeito.
                  </p>

                  <button
                    type="submit"
                    className="inline-flex h-10 w-fit items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    Enviar solicitação por e-mail
                  </button>
                </form>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Respostas</CardTitle>
            </CardHeader>
            <CardContent>
              {responses.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma resposta registrada ainda.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {responses.map((response, index) => {
                    const email = responseEmails[index];
                    return (
                      <li key={response.id} className="rounded-md border p-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">
                            {response.channel === "EMAIL" ? "Resposta por e-mail" : "Resposta no app"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatDateTime(response.respondedAt)}
                          </span>
                        </div>
                        {response.channel === "EMAIL" && email ? (
                          <p className="mt-1 text-muted-foreground">{email.subject}</p>
                        ) : null}
                        {response.channel === "APP" && response.content ? (
                          <p className="mt-1 text-muted-foreground">{response.content}</p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Responsáveis</CardTitle>
          </CardHeader>
          <CardContent>
            {assigneeUsers.filter(Boolean).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum responsável atribuído.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {assigneeUsers.map(
                  (user, index) =>
                    user && (
                      <li key={assignees[index].userId}>{user.name}</li>
                    )
                )}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
