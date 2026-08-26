import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getEmailAlertActionContext } from "@/lib/email-actions/get-context";
import { getEmailAlertTitle } from "@/lib/email-actions/get-alert-title";
import { EMAIL_ALERT_ACTION_LABELS, EMAIL_ALERT_KIND_LABELS } from "@/lib/email-actions/types";
import { formatDate } from "@/lib/labels";
import { ConfirmEmailActionForm } from "./confirm-form";

export const metadata: Metadata = { title: "Ação de e-mail" };

// Rota autenticada (proxy.ts já bloqueia qualquer não-logado antes de
// chegar aqui — nenhuma checagem de sessão repetida nesta página).
// Único caminho de leitura é get_email_alert_action_context (GET —
// nunca muda estado); a confirmação em si só acontece via POST
// (ConfirmEmailActionForm -> Server Action em ./actions.ts).
export default async function EmailActionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const context = await getEmailAlertActionContext(token);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-1 flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- PNG estático em public/, sem otimização de imagem necessária */}
            <img src="/branding/acc-logo.png" alt="ACC" className="h-10 w-auto" />
          </div>
          <CardTitle className="text-base">AXION Controle de Contratos</CardTitle>
          <CardDescription>Ação de e-mail</CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {!context ? (
            <p className="text-sm text-destructive">
              Este link não é válido, expirou, ou você não tem acesso a ele.
            </p>
          ) : context.isConsumed ? (
            <p className="rounded-md border border-border bg-muted p-3 text-sm text-muted-foreground">
              Esta ação já foi confirmada anteriormente.
            </p>
          ) : context.isExpired ? (
            <p className="text-sm text-destructive">
              Este link expirou em {formatDate(context.expiresAt)}. Peça um novo alerta/notificação.
            </p>
          ) : !context.canExecute ? (
            <p className="text-sm text-destructive">
              Sua permissão no projeto não é suficiente para esta ação.
            </p>
          ) : (
            <EmailActionContextPanel token={token} context={context} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

async function EmailActionContextPanel({
  token,
  context,
}: {
  token: string;
  context: NonNullable<Awaited<ReturnType<typeof getEmailAlertActionContext>>>;
}) {
  const alertTitle = await getEmailAlertTitle(context.alertKind, context.alertId);

  return (
    <>
      <div className="flex flex-col gap-1 rounded-md border border-border p-3 text-sm">
        <span className="text-xs font-medium text-muted-foreground">Projeto</span>
        <span>{context.projectName}</span>

        <span className="pt-2 text-xs font-medium text-muted-foreground">
          {EMAIL_ALERT_KIND_LABELS[context.alertKind]}
        </span>
        <span>{alertTitle ?? "—"}</span>

        <span className="pt-2 text-xs font-medium text-muted-foreground">Ação solicitada</span>
        <span className="font-semibold">{EMAIL_ALERT_ACTION_LABELS[context.action]}</span>
      </div>

      <ConfirmEmailActionForm rawToken={token} action={context.action} />
    </>
  );
}
