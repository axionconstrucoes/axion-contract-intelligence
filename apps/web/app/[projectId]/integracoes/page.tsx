import { createSupabaseServerClient } from "@axion/db/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IntegrationStatusBadge } from "@/components/shared/badges";
import { EmailAccountsPanel } from "@/components/integrations/email-accounts-panel";
import { EmailIngestionConfigForm } from "@/components/integrations/email-ingestion-config-form";
import { EmailSyncConfirmationPanel } from "@/components/integrations/email-sync-confirmation-panel";
import { EmailSyncPanel } from "@/components/integrations/email-sync-panel";
import { getCurrentProjectPermission } from "@/lib/contract-review";
import { getIntegrationConfigs, getProject, getSourceDefinitions } from "@/lib/data";
import { getEmailAccounts } from "@/lib/email/inbound/ingestion-controls/get-email-accounts";
import { getProjectEmailIngestionConfig } from "@/lib/email/inbound/ingestion-controls/get-project-email-ingestion-config";
import { getLatestEmailSyncRun } from "@/lib/email/inbound/ingestion-controls/get-sync-runs";
import { estimateEligibleEmailCount } from "@/lib/email/inbound/ingestion-controls/estimate-eligible-email-count";
import { getEmailAttachmentRegistryForProject } from "@/lib/email/attachments/registry/get-attachment-registry";
import { formatDateTime } from "@/lib/labels";
import { normalizeLegacyMojibake } from "@/lib/normalize-legacy-mojibake";

export default async function IntegracoesPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const supabase = await createSupabaseServerClient();
  const sources = getSourceDefinitions();

  const [configs, permission, project, projectStartRow, accounts, ingestionConfig, latestRun, attachmentRows] = await Promise.all([
    getIntegrationConfigs(projectId),
    getCurrentProjectPermission(projectId),
    getProject(projectId),
    supabase.from("projects").select("project_start_date").eq("id", projectId).maybeSingle(),
    getEmailAccounts(supabase),
    getProjectEmailIngestionConfig(supabase, projectId),
    getLatestEmailSyncRun(supabase, projectId),
    getEmailAttachmentRegistryForProject(projectId),
  ]);

  const canManage = permission === "ADMIN";
  const projectStartDate = (projectStartRow.data as { project_start_date: string | null } | null)?.project_start_date ?? null;
  const consideredCount = attachmentRows.filter((row) => row.consideredByAcc).length;

  const preliminaryCount = ingestionConfig ? await estimateEligibleEmailCount(supabase, projectId, ingestionConfig, projectStartDate) : 0;
  const clientDomain = ingestionConfig?.domains.find((d) => d.domainRole === "CLIENT")?.domain ?? "";
  const accountEmail = accounts.find((a) => a.id === ingestionConfig?.emailAccountId)?.emailAddress ?? "";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">
          Administração de Integrações
        </h1>

        <p className="text-sm text-muted-foreground">
          Status operacional das fontes configuradas para este projeto.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {sources.map((source) => {
          const config = configs.find(
            (item) => item.sourceType === source.type
          );

          return (
            <Card key={source.type}>
              <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
                <CardTitle>{source.label}</CardTitle>

                {config && (
                  <IntegrationStatusBadge status={config.status} />
                )}
              </CardHeader>

              <CardContent className="flex flex-col gap-1 pt-0 text-sm text-muted-foreground">
                <p>{source.description}</p>

                {config ? (
                  <p className="text-xs">
                    {normalizeLegacyMojibake(config.detail) || "Integração configurada."}

                    {config.lastSyncAt && (
                      <>
                        {" "}
                        · Última sincronização:{" "}
                        {formatDateTime(config.lastSyncAt)}
                      </>
                    )}
                  </p>
                ) : (
                  <p className="text-xs">
                    Integração ainda não configurada para este projeto.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div>
        <h2 className="text-base font-semibold">Gmail / E-mails</h2>
        <p className="text-sm text-muted-foreground">
          Ingestão controlada de e-mails @axion.com.br — conectar uma conta nunca significa importar a caixa inteira.
        </p>
      </div>

      <EmailAccountsPanel projectId={projectId} accounts={accounts} canManage={canManage} />

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Configuração de ingestão deste projeto</CardTitle>
          </CardHeader>
          <CardContent>
            {accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Registre ao menos uma conta AXION acima antes de configurar a ingestão.</p>
            ) : (
              <EmailIngestionConfigForm projectId={projectId} accounts={accounts} config={ingestionConfig} />
            )}
          </CardContent>
        </Card>
      ) : null}

      {canManage && ingestionConfig && accountEmail ? (
        <EmailSyncConfirmationPanel
          projectId={projectId}
          projectName={project?.name ?? "Projeto não disponível"}
          configId={ingestionConfig.id}
          accountEmail={accountEmail}
          windowMode={ingestionConfig.windowMode}
          periodStart={ingestionConfig.windowMode === "CUSTOM" ? ingestionConfig.customStartAt : projectStartDate}
          periodEnd={ingestionConfig.customEndAt}
          clientDomain={clientDomain}
          participantsCount={ingestionConfig.participants.filter((p) => p.enabled).length}
          includeAttachments={ingestionConfig.includeAttachments}
          preliminaryCount={preliminaryCount}
        />
      ) : null}

      <EmailSyncPanel run={latestRun} consideredCount={consideredCount} />
    </div>
  );
}
