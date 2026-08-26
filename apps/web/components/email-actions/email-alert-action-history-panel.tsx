import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getUser } from "@/lib/data";
import { getEmailAlertActionHistory } from "@/lib/email-actions/get-alert-history";
import { EMAIL_ALERT_ACTION_LABELS, type EmailAlertKind } from "@/lib/email-actions/types";
import { formatDate } from "@/lib/labels";

// Painel do "estado central" (ver relatório da feature de e-mail
// acionável): mostrado só onde a entidade não tem campo/tabela
// operacional nativo para a ação — CONTRACT_EVENT (todas as 4 ações) e
// SLA_ACTION (só RESPOND, que não tem tabela de comentário própria).
// Nunca renderizado para ACTION_REQUEST — lá tudo já aparece via
// assignees/action_request_responses/due_at existentes.
export async function EmailAlertActionHistoryPanel({
  alertKind,
  alertId,
}: {
  alertKind: EmailAlertKind;
  alertId: string;
}) {
  const entries = await getEmailAlertActionHistory(alertKind, alertId);

  if (entries.length === 0) {
    return null;
  }

  const actorNames = await Promise.all(entries.map((entry) => getUser(entry.actorUserId)));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Ações via e-mail</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {entries.map((entry, index) => {
          const actorName = actorNames[index]?.name ?? "Usuário";

          return (
            <div key={entry.id} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">{EMAIL_ALERT_ACTION_LABELS[entry.action]}</span>
                <span className="text-xs text-muted-foreground">
                  {actorName} · {formatDate(entry.occurredAt)}
                </span>
              </div>

              {entry.comment ? <p className="pt-1 text-muted-foreground">{entry.comment}</p> : null}

              {entry.action === "SET_DEADLINE" && entry.newDueAt ? (
                <p className="pt-1 text-xs text-muted-foreground">
                  {entry.previousDueAt ? `${formatDate(entry.previousDueAt)} → ` : ""}
                  {formatDate(entry.newDueAt)}
                </p>
              ) : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
