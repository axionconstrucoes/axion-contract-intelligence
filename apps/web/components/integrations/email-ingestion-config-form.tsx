"use client";

// Configuração por projeto (seção 5 do requisito de ingestão Gmail):
// CONTA AXION, DOMÍNIO DO CLIENTE, PARTICIPANTES RELEVANTES, PERÍODO,
// INCLUIR ANEXOS. Nunca interpreta "conta conectada" como "importar a
// caixa inteira" — o perímetro real é sempre domínio + participantes +
// período, salvos explicitamente aqui.

import { useActionState, useState } from "react";
import { FeatureInfo } from "@/components/shared/feature-info";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { saveEmailIngestionConfigAction } from "@/app/[projectId]/integracoes/actions";
import { initialSaveEmailIngestionConfigState } from "@/app/[projectId]/integracoes/actions-state";
import type { EmailAccount, EmailIngestionWindowMode, ProjectEmailIngestionConfig } from "@/lib/email/inbound/ingestion-controls/types";

interface DomainRow {
  domain: string;
  domainRole: "CLIENT" | "OTHER_AUTHORIZED";
  enabled: boolean;
}

interface ParticipantRow {
  emailAddress: string;
  roleNote: string;
  enabled: boolean;
}

export function EmailIngestionConfigForm({
  projectId,
  accounts,
  config,
}: {
  projectId: string;
  accounts: EmailAccount[];
  config: ProjectEmailIngestionConfig | null;
}) {
  const [state, formAction, pending] = useActionState(saveEmailIngestionConfigAction, initialSaveEmailIngestionConfigState);

  const [emailAccountId, setEmailAccountId] = useState(config?.emailAccountId ?? accounts[0]?.id ?? "");
  const [windowMode, setWindowMode] = useState<EmailIngestionWindowMode>(config?.windowMode ?? "FROM_PROJECT_START");
  const [customStartAt, setCustomStartAt] = useState(config?.customStartAt?.slice(0, 10) ?? "");
  const [customEndAt, setCustomEndAt] = useState(config?.customEndAt?.slice(0, 10) ?? "");
  const [includeAttachments, setIncludeAttachments] = useState(config?.includeAttachments ?? true);

  const [domains, setDomains] = useState<DomainRow[]>(
    config?.domains.filter((d) => d.domainRole !== "AXION").map((d) => ({ domain: d.domain, domainRole: d.domainRole as "CLIENT" | "OTHER_AUTHORIZED", enabled: d.enabled })) ?? []
  );
  const [participants, setParticipants] = useState<ParticipantRow[]>(
    config?.participants.map((p) => ({ emailAddress: p.emailAddress, roleNote: p.roleNote ?? "", enabled: p.enabled })) ?? []
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="clientDomains" value={JSON.stringify(domains)} />
      <input type="hidden" name="participants" value={JSON.stringify(participants)} />

      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          <span className="flex items-center gap-1.5">
            Conta AXION
            <FeatureInfo helpId="gmail-account-connected" />
          </span>
          <Select name="emailAccountId" required value={emailAccountId} onChange={(event) => setEmailAccountId(event.target.value)}>
            <option value="" disabled>
              Selecione…
            </option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.emailAddress} ({account.status})
              </option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          <span className="flex items-center gap-1.5">
            Período de ingestão
            <FeatureInfo helpId="gmail-ingestion-period" />
          </span>
          <Select name="windowMode" required value={windowMode} onChange={(event) => setWindowMode(event.target.value as EmailIngestionWindowMode)}>
            <option value="FROM_PROJECT_START">Desde o início do projeto</option>
            <option value="FROM_NOW">A partir de hoje</option>
            <option value="CUSTOM">Período personalizado</option>
          </Select>
        </label>
      </div>

      {windowMode === "CUSTOM" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Data inicial
            <Input
              type="date"
              name="customStartAt"
              required
              value={customStartAt}
              onChange={(event) => setCustomStartAt(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Data final (opcional — nunca ultrapassa hoje)
            <Input
              type="date"
              name="customEndAt"
              max={new Date().toISOString().slice(0, 10)}
              value={customEndAt}
              onChange={(event) => setCustomEndAt(event.target.value)}
            />
          </label>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          Domínio(s) do cliente
          <FeatureInfo helpId="gmail-client-domain" />
        </span>
        <ListEditor
          rows={domains}
          onChange={setDomains}
          newRow={{ domain: "", domainRole: "CLIENT", enabled: true }}
          renderRow={(row, update) => (
            <Input
              placeholder="cliente.com.br"
              value={row.domain}
              onChange={(event) => update({ ...row, domain: event.target.value.toLowerCase() })}
            />
          )}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          Participantes relevantes
          <FeatureInfo helpId="gmail-participants" />
        </span>
        <ListEditor
          rows={participants}
          onChange={setParticipants}
          newRow={{ emailAddress: "", roleNote: "", enabled: true }}
          renderRow={(row, update) => (
            <>
              <Input
                placeholder="contato@cliente.com.br"
                value={row.emailAddress}
                onChange={(event) => update({ ...row, emailAddress: event.target.value.toLowerCase() })}
                className="flex-1"
              />
              <Input placeholder="observação (opcional)" value={row.roleNote} onChange={(event) => update({ ...row, roleNote: event.target.value })} className="flex-1" />
            </>
          )}
        />
      </div>

      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name="includeAttachments"
          checked={includeAttachments}
          onChange={(event) => setIncludeAttachments(event.target.checked)}
        />
        Incluir anexos
        <FeatureInfo helpId="gmail-include-attachments" />
      </label>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.success ? <p className="text-sm">Configuração salva.</p> : null}

      <div>
        <Button type="submit" size="sm" disabled={pending || !emailAccountId}>
          {pending ? "Salvando…" : "Salvar configuração"}
        </Button>
      </div>
    </form>
  );
}

function ListEditor<T extends { enabled: boolean }>({
  rows,
  onChange,
  newRow,
  renderRow,
}: {
  rows: T[];
  onChange: (rows: T[]) => void;
  newRow: T;
  renderRow: (row: T, update: (row: T) => void) => React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          {renderRow(row, (updated) => onChange(rows.map((r, i) => (i === index ? updated : r))))}
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange(rows.filter((_, i) => i !== index))}>
            Remover
          </Button>
        </div>
      ))}
      <div>
        <Button type="button" size="sm" variant="outline" onClick={() => onChange([...rows, newRow])}>
          + Adicionar
        </Button>
      </div>
    </div>
  );
}
