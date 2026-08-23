// Card do E-mail Corporativo (seção 14 do requisito) — mostra Google
// Workspace, caixas AXION de ingestão, domínio(s) cliente e
// participantes específicos separadamente (nunca mistura mailbox com
// participante). Status real derivado da configuração + conta
// vinculada — nunca da contagem de mensagens novas (ver
// resolve-integration-display-status.ts). Server component (só
// leitura) — edição real acontece nos painéis abaixo, já existentes.

import { IntegrationStatusBadge } from "@/components/shared/badges";
import { FeatureInfo } from "@/components/shared/feature-info";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { resolveIntegrationVisualIdentity } from "./integration-visual-identity";
import { resolveEmailIntegrationDisplayStatus } from "@/lib/ui/resolve-integration-display-status";
import { formatDateTime } from "@/lib/labels";
import type { EmailAccount, ProjectEmailIngestionConfig } from "@/lib/email/inbound/ingestion-controls/types";
import type { SourceDefinition } from "@axion/types";

export function EmailIntegrationCard({
  source,
  config,
  accounts,
}: {
  source: SourceDefinition;
  config: ProjectEmailIngestionConfig | null;
  accounts: EmailAccount[];
}) {
  const identity = resolveIntegrationVisualIdentity("EMAIL");
  const Icon = identity.icon;

  const linkedAccount = accounts.find((account) => account.id === config?.emailAccountId) ?? null;
  const clientDomains = config?.domains.filter((domain) => domain.domainRole !== "AXION") ?? [];

  const status = resolveEmailIntegrationDisplayStatus({
    configEnabled: config?.enabled ?? null,
    hasEmailAccount: Boolean(config?.emailAccountId),
    hasClientDomain: clientDomains.length > 0,
    accountStatus: linkedAccount?.status ?? null,
  });

  return (
    <Card className={identity.cardClassName}>
      <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
        <div className="flex items-center gap-2">
          <Icon className={`size-4 shrink-0 ${identity.iconClassName}`} aria-hidden="true" />
          <CardTitle>{source.label}</CardTitle>
        </div>
        <IntegrationStatusBadge status={status} />
      </CardHeader>

      <CardContent className="flex flex-col gap-2 pt-0 text-sm text-muted-foreground">
        <p>{source.description}</p>

        <div className="mt-1 flex flex-col gap-1 rounded-md border bg-background/60 p-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            Origem da fonte
            <FeatureInfo helpId="integration-origin" />
          </p>
          <dl className="grid gap-1 text-xs">
            <div>
              <dt className="text-muted-foreground">Sistema:</dt>
              <dd className="text-foreground">Google Workspace</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Caixas AXION de ingestão:</dt>
              <dd className="text-foreground">
                {config && config.mailboxes.length > 0 ? config.mailboxes.map((mailbox) => mailbox.mailboxAddress).join(", ") : "Nenhuma configurada"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Domínio(s) cliente:</dt>
              <dd className="text-foreground">{clientDomains.length > 0 ? clientDomains.map((domain) => domain.domain).join(", ") : "Nenhum configurado"}</dd>
            </div>
            {config && config.participants.length > 0 ? (
              <div>
                <dt className="text-muted-foreground">Participantes específicos:</dt>
                <dd className="text-foreground">{config.participants.map((participant) => participant.emailAddress).join(", ")}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-muted-foreground">Última sincronização:</dt>
              <dd className="text-foreground">{config?.lastSyncAt ? formatDateTime(config.lastSyncAt) : "Ainda sem sincronização"}</dd>
            </div>
          </dl>
        </div>
      </CardContent>
    </Card>
  );
}
