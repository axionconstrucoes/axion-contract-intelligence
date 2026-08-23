"use client";

// Configuração por projeto (seção 5 do requisito de ingestão Gmail):
// CONTA AXION, DOMÍNIO DO CLIENTE, PARTICIPANTES RELEVANTES, PERÍODO,
// INCLUIR ANEXOS. Nunca interpreta "conta conectada" como "importar a
// caixa inteira" — o perímetro real é sempre domínio + participantes +
// período, salvos explicitamente aqui.
//
// Identificação visual de pré-preenchido: cada campo é comparado contra
// `savedSnapshot` (o que está persistido). Igual ao salvo → verde
// (PREFILLED_FIELD_CLASSNAME); diferente (usuário editou) → branco
// padrão. Depois de salvar com sucesso, savedSnapshot é atualizado para
// o valor atual, então os campos voltam a ficar verdes. Verde aqui
// NUNCA significa "validado" — só "já preenchido/salvo".

import { useActionState, useState } from "react";
import { FeatureInfo } from "@/components/shared/feature-info";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { saveEmailIngestionConfigAction } from "@/app/[projectId]/integracoes/actions";
import { initialSaveEmailIngestionConfigState } from "@/app/[projectId]/integracoes/actions-state";
import { isFieldPrefilled, resolvePrefilledFieldProps } from "@/lib/ui/prefilled-field-style";
import { ADD_BUTTON_CLASSNAME } from "@/lib/ui/add-button-style";
import { isEmailIngestionConfigDirty } from "@/lib/email/inbound/ingestion-controls/compute-config-dirty";
import { classifyParticipantType, type ParticipantType } from "@/lib/email/inbound/ingestion-controls/classify-participant-type";
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
  participantType: ParticipantType;
}

const PARTICIPANT_TYPE_LABELS: Record<ParticipantType, string> = {
  AXION: "AXION",
  CLIENTE: "Cliente",
  TERCEIRO: "Terceiro",
};

interface ConfigSnapshot {
  emailAccountId: string;
  windowMode: EmailIngestionWindowMode;
  customStartAt: string;
  customEndAt: string;
  includeAttachments: boolean;
  domains: DomainRow[];
  participants: ParticipantRow[];
}

function snapshotFromConfig(config: ProjectEmailIngestionConfig | null): ConfigSnapshot {
  return {
    emailAccountId: config?.emailAccountId ?? "",
    windowMode: config?.windowMode ?? "FROM_PROJECT_START",
    customStartAt: config?.customStartAt?.slice(0, 10) ?? "",
    customEndAt: config?.customEndAt?.slice(0, 10) ?? "",
    includeAttachments: config?.includeAttachments ?? true,
    domains: config?.domains.filter((d) => d.domainRole !== "AXION").map((d) => ({ domain: d.domain, domainRole: d.domainRole as "CLIENT" | "OTHER_AUTHORIZED", enabled: d.enabled })) ?? [],
    participants: config?.participants.map((p) => ({ emailAddress: p.emailAddress, roleNote: p.roleNote ?? "", enabled: p.enabled, participantType: p.participantType })) ?? [],
  };
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

  const initialSnapshot = snapshotFromConfig(config);
  // hasSavedConfig distingue "não há nada salvo ainda" (projeto novo,
  // campo deve ficar branco mesmo que o valor atual coincida com um
  // default de UI) de "existe configuração persistida" — nunca inferir
  // "pré-preenchido" só porque o valor bate com um default local.
  const [hasSavedConfig, setHasSavedConfig] = useState(config !== null);
  const [savedSnapshot, setSavedSnapshot] = useState<ConfigSnapshot>(initialSnapshot);

  const [emailAccountId, setEmailAccountId] = useState(initialSnapshot.emailAccountId || accounts[0]?.id || "");
  const [windowMode, setWindowMode] = useState<EmailIngestionWindowMode>(initialSnapshot.windowMode);
  const [customStartAt, setCustomStartAt] = useState(initialSnapshot.customStartAt);
  const [customEndAt, setCustomEndAt] = useState(initialSnapshot.customEndAt);
  const [includeAttachments, setIncludeAttachments] = useState(initialSnapshot.includeAttachments);
  const [domains, setDomains] = useState<DomainRow[]>(initialSnapshot.domains);
  const [participants, setParticipants] = useState<ParticipantRow[]>(initialSnapshot.participants);

  // Salvamento confirmado: o valor atual passa a ser a configuração
  // persistida — os campos voltam a ficar verdes (seção "EDIÇÃO PELO
  // USUÁRIO" do requisito). Ajuste de estado durante a renderização
  // (padrão recomendado pelo React para reagir a uma mudança sem usar
  // useEffect — nunca causa um efeito colateral externo, só sincroniza
  // dois estados internos do próprio componente).
  const [handledActionState, setHandledActionState] = useState(state);
  if (state !== handledActionState) {
    setHandledActionState(state);
    if (state.success) {
      setHasSavedConfig(true);
      setSavedSnapshot({ emailAccountId, windowMode, customStartAt, customEndAt, includeAttachments, domains, participants });
    }
  }

  const accountPrefilled = resolvePrefilledFieldProps(hasSavedConfig && isFieldPrefilled(emailAccountId, savedSnapshot.emailAccountId));
  const windowModePrefilled = resolvePrefilledFieldProps(hasSavedConfig && isFieldPrefilled(windowMode, savedSnapshot.windowMode));
  const startAtPrefilled = resolvePrefilledFieldProps(hasSavedConfig && isFieldPrefilled(customStartAt, savedSnapshot.customStartAt));
  const endAtPrefilled = resolvePrefilledFieldProps(hasSavedConfig && isFieldPrefilled(customEndAt, savedSnapshot.customEndAt));
  const includeAttachmentsPrefilled = hasSavedConfig && includeAttachments === savedSnapshot.includeAttachments;

  // Botão [Salvar configuração]: oculto quando não há nenhuma alteração
  // pendente em relação ao que já está salvo — permanecer visível
  // indefinidamente daria a impressão de uma ação pendente que não
  // existe. Falha de salvamento nunca atualiza savedSnapshot (ver
  // handledActionState acima), então o botão continua visível
  // automaticamente sem lógica extra.
  const isDirty = isEmailIngestionConfigDirty(
    { emailAccountId, windowMode, customStartAt, customEndAt, includeAttachments, domains, participants },
    savedSnapshot,
    hasSavedConfig
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="clientDomains" value={JSON.stringify(domains)} />
      <input type="hidden" name="participants" value={JSON.stringify(participants)} />

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="inline-block size-2.5 rounded-sm border border-green-400 bg-green-50 dark:border-green-700 dark:bg-green-950/30" aria-hidden="true" />
        Campos em verde já possuem informações salvas.
        <FeatureInfo helpId="gmail-prefilled-fields" />
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          <span className="flex items-center gap-1.5">
            Conta AXION
            <FeatureInfo helpId="gmail-account-connected" />
          </span>
          <Select
            name="emailAccountId"
            required
            value={emailAccountId}
            onChange={(event) => setEmailAccountId(event.target.value)}
            className={accountPrefilled.className}
            title={accountPrefilled.title}
          >
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
          <Select
            name="windowMode"
            required
            value={windowMode}
            onChange={(event) => setWindowMode(event.target.value as EmailIngestionWindowMode)}
            className={windowModePrefilled.className}
            title={windowModePrefilled.title}
          >
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
              className={startAtPrefilled.className}
              title={startAtPrefilled.title}
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
              className={endAtPrefilled.className}
              title={endAtPrefilled.title}
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
          addLabel="+ Adicionar domínio"
          isRowPrefilled={(row) =>
            row.domain !== "" && savedSnapshot.domains.some((s) => s.domain === row.domain && s.domainRole === row.domainRole && s.enabled === row.enabled)
          }
          renderRow={(row, update, prefilled) => (
            <Input
              placeholder="cliente.com.br"
              value={row.domain}
              onChange={(event) => update({ ...row, domain: event.target.value.toLowerCase() })}
              className={resolvePrefilledFieldProps(prefilled).className}
              title={resolvePrefilledFieldProps(prefilled).title}
            />
          )}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          B) Participantes monitorados
          <FeatureInfo helpId="gmail-participant-monitored" />
        </span>
        <p className="text-xs text-muted-foreground">
          Endereços específicos considerados na ingestão — não precisam de profile, membership nem login no ACC, e nunca ganham acesso ao
          sistema.
        </p>
        <ListEditor
          rows={participants}
          onChange={setParticipants}
          newRow={{ emailAddress: "", roleNote: "", enabled: true, participantType: "TERCEIRO" }}
          addLabel="+ Adicionar participante"
          isRowPrefilled={(row) =>
            row.emailAddress !== "" &&
            savedSnapshot.participants.some(
              (s) =>
                s.emailAddress === row.emailAddress &&
                s.roleNote === row.roleNote &&
                s.enabled === row.enabled &&
                s.participantType === row.participantType
            )
          }
          renderRow={(row, update, prefilled) => (
            <>
              <Input
                placeholder="contato@cliente.com.br"
                value={row.emailAddress}
                onChange={(event) => {
                  const emailAddress = event.target.value.toLowerCase();
                  const clientDomainList = domains.filter((d) => d.domainRole === "CLIENT").map((d) => d.domain);
                  update({ ...row, emailAddress, participantType: classifyParticipantType(emailAddress, "axion.com.br", clientDomainList) });
                }}
                className={`flex-1 ${resolvePrefilledFieldProps(prefilled).className}`}
                title={resolvePrefilledFieldProps(prefilled).title}
              />
              <Select
                value={row.participantType}
                onChange={(event) => update({ ...row, participantType: event.target.value as ParticipantType })}
                className={`w-32 shrink-0 ${resolvePrefilledFieldProps(prefilled).className}`}
                title="Classificação sugerida automaticamente pelo domínio — corrigível."
              >
                {(Object.keys(PARTICIPANT_TYPE_LABELS) as ParticipantType[]).map((type) => (
                  <option key={type} value={type}>
                    {PARTICIPANT_TYPE_LABELS[type]}
                  </option>
                ))}
              </Select>
              <Input
                placeholder="observação (opcional)"
                value={row.roleNote}
                onChange={(event) => update({ ...row, roleNote: event.target.value })}
                className={`flex-1 ${resolvePrefilledFieldProps(prefilled).className}`}
                title={resolvePrefilledFieldProps(prefilled).title}
              />
            </>
          )}
        />
      </div>

      <label
        className={`flex w-fit items-center gap-2 rounded-md border p-2 text-sm font-medium ${includeAttachmentsPrefilled ? "border-green-400 bg-green-50 dark:border-green-700 dark:bg-green-950/30" : "border-transparent"}`}
        title={includeAttachmentsPrefilled ? "Valor carregado do sistema (já salvo)." : undefined}
      >
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

      {isDirty ? (
        <div>
          <Button type="submit" size="sm" disabled={pending || !emailAccountId}>
            {pending ? "Salvando…" : "Salvar configuração"}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Configuração salva</p>
      )}
    </form>
  );
}

function ListEditor<T extends { enabled: boolean }>({
  rows,
  onChange,
  newRow,
  renderRow,
  isRowPrefilled,
  addLabel,
}: {
  rows: T[];
  onChange: (rows: T[]) => void;
  newRow: T;
  renderRow: (row: T, update: (row: T) => void, prefilled: boolean) => React.ReactNode;
  isRowPrefilled: (row: T) => boolean;
  addLabel: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          {renderRow(row, (updated) => onChange(rows.map((r, i) => (i === index ? updated : r))), isRowPrefilled(row))}
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange(rows.filter((_, i) => i !== index))}>
            Remover
          </Button>
        </div>
      ))}
      <div>
        <Button type="button" size="sm" variant="outline" className={ADD_BUTTON_CLASSNAME} onClick={() => onChange([...rows, newRow])}>
          {addLabel}
        </Button>
      </div>
    </div>
  );
}
