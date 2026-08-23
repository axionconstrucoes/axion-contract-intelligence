"use client";

// Card de integração (seções 8-22 do requisito): cor identifica a
// FONTE (nunca o estado), badge identifica o ESTADO. "Origem da fonte"
// sempre mostra só o que um humano de fato preencheu — nunca inventa
// informação; campo vazio => "Origem ainda não definida".

import { useState } from "react";
import { IntegrationStatusBadge } from "@/components/shared/badges";
import { FeatureInfo } from "@/components/shared/feature-info";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { resolveIntegrationVisualIdentity } from "./integration-visual-identity";
import { IntegrationOriginForm } from "./integration-origin-form";
import { resolveGenericIntegrationDisplayStatus } from "@/lib/ui/resolve-integration-display-status";
import { driveTypeLabels, formatDateTime } from "@/lib/labels";
import { normalizeLegacyMojibake } from "@/lib/normalize-legacy-mojibake";
import type { IntegrationConfig, SourceDefinition } from "@axion/types";

export function IntegrationCard({
  projectId,
  source,
  config,
  canManage,
}: {
  projectId: string;
  source: SourceDefinition;
  config: IntegrationConfig | undefined;
  canManage: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const identity = resolveIntegrationVisualIdentity(source.type);
  const Icon = identity.icon;
  const status = config ? resolveGenericIntegrationDisplayStatus(config.status) : "PENDENTE";

  const origin = config
    ? [
        { label: source.type === "ESG_SSMA" ? null : "Sistema", value: config.externalSystemReference },
        { label: source.type === "ESG_SSMA" ? null : "Projeto/Obra", value: config.externalProjectReference },
        { label: source.type === "ESG_SSMA" ? "Técnico de Segurança" : "Conta", value: config.accountReference },
        { label: "Tipo", value: config.driveType ? driveTypeLabels[config.driveType] : null },
        { label: source.type === "ESG_SSMA" ? null : "Pasta/Local", value: config.folderReference },
        { label: source.type === "ESG_SSMA" ? null : "Arquivo", value: config.fileReference },
        { label: source.type === "ESG_SSMA" ? "Responsável/Gerente ESG" : "Responsável", value: config.responsibleReference },
      ].filter((field): field is { label: string; value: string } => Boolean(field.label) && Boolean(field.value))
    : [];

  return (
    <Card className={identity.cardClassName}>
      <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
        <div className="flex items-center gap-2">
          <Icon className={`size-4 shrink-0 ${identity.iconClassName}`} aria-hidden="true" />
          <CardTitle className="flex items-center gap-1.5">
            {source.label}
            {source.type === "ESG_SSMA" ? <FeatureInfo helpId="esg-ssma-source" /> : null}
          </CardTitle>
        </div>
        <IntegrationStatusBadge status={status} />
      </CardHeader>

      <CardContent className="flex flex-col gap-2 pt-0 text-sm text-muted-foreground">
        <p>{source.description}</p>

        {config ? (
          <p className="text-xs">
            {normalizeLegacyMojibake(config.detail) || "Integração configurada."}
            {config.lastSyncAt ? <> · Última sincronização: {formatDateTime(config.lastSyncAt)}</> : null}
          </p>
        ) : (
          <p className="text-xs">Integração ainda não configurada para este projeto.</p>
        )}

        <div className="mt-1 flex flex-col gap-1 rounded-md border bg-background/60 p-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            Origem da fonte
            <FeatureInfo helpId="integration-origin" />
          </p>
          {origin.length > 0 ? (
            <dl className="grid gap-1 text-xs sm:grid-cols-2">
              {origin.map((field) => (
                <div key={field.label}>
                  <dt className="text-muted-foreground">{field.label}:</dt>
                  <dd className="text-foreground">{field.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-xs italic">Origem ainda não definida</p>
          )}
        </div>

        {canManage ? (
          editing ? (
            <IntegrationOriginForm projectId={projectId} sourceType={source.type} config={config} onCancel={() => setEditing(false)} />
          ) : (
            <div>
              <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
                Editar origem
              </Button>
            </div>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
