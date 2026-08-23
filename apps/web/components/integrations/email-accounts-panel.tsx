"use client";

// Registro organizacional de contas @axion.com.br (seção 3/4 do
// requisito de ingestão Gmail). "Conectada" aqui significa "registrada
// como conta AXION autorizada" — a credencial OAuth real continua
// sendo o procedimento manual já existente (docs/email-branding.md),
// nunca solicitada ou exibida nesta tela.

import { useActionState, useState } from "react";
import { EmailAccountStatusBadge } from "@/components/shared/badges";
import { FeatureInfo } from "@/components/shared/feature-info";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { disconnectEmailAccountAction, registerEmailAccountAction } from "@/app/[projectId]/integracoes/actions";
import { initialDisconnectEmailAccountState, initialRegisterEmailAccountState } from "@/app/[projectId]/integracoes/actions-state";
import { formatDateTime } from "@/lib/labels";
import type { EmailAccount } from "@/lib/email/inbound/ingestion-controls/types";

export function EmailAccountsPanel({ projectId, accounts, canManage }: { projectId: string; accounts: EmailAccount[]; canManage: boolean }) {
  const [adding, setAdding] = useState(false);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-1.5">
          Contas de e-mail AXION
          <FeatureInfo helpId="gmail-account-connected" />
        </CardTitle>
        {canManage && !adding ? (
          <span className="flex items-center gap-1.5">
            <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
              Adicionar conta de e-mail AXION
            </Button>
            <FeatureInfo helpId="gmail-add-account" />
          </span>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {adding ? <RegisterAccountForm projectId={projectId} onCancel={() => setAdding(false)} /> : null}

        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma conta AXION registrada ainda.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {accounts.map((account) => (
              <AccountRow key={account.id} projectId={projectId} account={account} canManage={canManage} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RegisterAccountForm({ projectId, onCancel }: { projectId: string; onCancel: () => void }) {
  const [state, formAction, pending] = useActionState(registerEmailAccountAction, initialRegisterEmailAccountState);

  if (state.success) {
    return <p className="rounded-md bg-muted/40 p-3 text-sm">Conta registrada com sucesso.</p>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border p-3">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Endereço @axion.com.br
          <Input name="emailAddress" type="email" required placeholder="nome@axion.com.br" pattern=".+@axion\.com\.br" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Nome de exibição (opcional)
          <Input name="displayName" />
        </label>
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Registrando…" : "Registrar conta"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function AccountRow({ projectId, account, canManage }: { projectId: string; account: EmailAccount; canManage: boolean }) {
  const [state, formAction, pending] = useActionState(disconnectEmailAccountAction, initialDisconnectEmailAccountState);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
      <div>
        <p className="text-sm font-medium">{account.displayName ?? account.emailAddress}</p>
        <p className="text-xs text-muted-foreground">{account.emailAddress}</p>
        <p className="text-xs text-muted-foreground">
          {account.lastSyncAt ? `Última sincronização: ${formatDateTime(account.lastSyncAt)}` : "Ainda sem sincronização"}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <EmailAccountStatusBadge status={account.status} />
        {canManage && account.status !== "NOT_CONNECTED" ? (
          <form action={formAction}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="accountId" value={account.id} />
            <Button type="submit" size="sm" variant="ghost" disabled={pending}>
              {pending ? "…" : "Desconectar"}
            </Button>
          </form>
        ) : null}
      </div>
      {state.error ? <p className="w-full text-xs text-destructive">{state.error}</p> : null}
    </div>
  );
}
