"use client";

// Formulários de AÇÃO HUMANA do registro documental por e-mail: revisão
// de intake (aprovar/rejeitar/semana/anexo/projeto/classificação/
// reprocessar), confirmação de classificação, baseline oficial e
// validação de Curva S. Cada um chama uma Server Action que aciona a
// RPC SECURITY DEFINER correspondente — justificativa sempre
// obrigatória; valor anterior/novo e usuário ficam no evento de revisão.

import { useActionState } from "react";
import {
  confirmEmailClassificationAction,
  reviewWeeklyScheduleIntakeAction,
  setScheduleBaselineAction,
  mapWeeklyReportSheetAction,
  validateWeeklyReportCurveValuesAction,
} from "@/app/[projectId]/documentos/emails/actions";
import { initialEmailRegistryActionState } from "@/app/[projectId]/documentos/emails/actions-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EMAIL_CLASSIFICATION_LABELS } from "@/lib/email/registry/email-document-registry-shared";

const MIN_JUSTIFICATION = 10;

function Feedback({ state }: { state: { error: string | null; success: boolean; message: string | null } }) {
  if (state.error) return <p className="text-xs text-destructive" role="alert">{state.error}</p>;
  if (state.success) return <p className="text-xs text-emerald-700" role="status">{state.message ?? "Registrado."}</p>;
  return null;
}

export function IntakeReviewForm({
  projectId,
  emailId,
  intakeId,
  intakeStatus,
  attachments,
  otherProjects,
}: {
  projectId: string;
  emailId: string;
  intakeId: string;
  intakeStatus: string;
  attachments: Array<{ id: string; fileName: string }>;
  otherProjects: Array<{ id: string; label: string }>;
}) {
  const [state, formAction, pending] = useActionState(reviewWeeklyScheduleIntakeAction, initialEmailRegistryActionState);
  const canDecide = intakeStatus === "PENDING_HUMAN_REVIEW" || intakeStatus === "FAILED" || intakeStatus === "APPROVED_HUMAN_REVIEW";

  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-md border p-3 text-xs" aria-label="Revisão humana do envio semanal">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="emailId" value={emailId} />
      <input type="hidden" name="intakeId" value={intakeId} />

      <label className="flex flex-col gap-1 font-medium">
        Ação
        <Select name="action" defaultValue={canDecide ? "APPROVE" : "SET_WORK_WEEK"} required aria-label="Ação de revisão">
          {canDecide ? <option value="APPROVE">Aprovar (promover o .mpp a nova versão)</option> : null}
          {canDecide ? <option value="REJECT">Rejeitar</option> : null}
          <option value="SET_WORK_WEEK">Identificar semana da obra (WNN)</option>
          <option value="SELECT_ATTACHMENT">Escolher o anexo principal (.mpp)</option>
          <option value="LINK_PROJECT">Vincular ao projeto correto</option>
          <option value="SET_CLASSIFICATION">Corrigir classificação do e-mail</option>
          {canDecide ? <option value="REPROCESS">Reprocessar (idempotente)</option> : null}
        </Select>
      </label>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          Semana da obra (para “Identificar semana”)
          <Input name="workWeekNumber" inputMode="numeric" placeholder="37" aria-label="Número da semana da obra" />
        </label>
        <label className="flex flex-col gap-1">
          Anexo principal (para “Escolher o anexo”)
          <Select name="emailAttachmentId" defaultValue="" aria-label="Anexo principal">
            <option value="">—</option>
            {attachments.map((attachment) => (
              <option key={attachment.id} value={attachment.id}>
                {attachment.fileName}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          Projeto de destino (para “Vincular ao projeto”)
          <Select name="targetProjectId" defaultValue="" aria-label="Projeto de destino">
            <option value="">—</option>
            {otherProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          Classificação (para “Corrigir classificação”)
          <Select name="classification" defaultValue="" aria-label="Classificação">
            <option value="">—</option>
            {Object.entries(EMAIL_CLASSIFICATION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <label className="flex flex-col gap-1 font-medium">
        Justificativa (obrigatória, mínimo {MIN_JUSTIFICATION} caracteres)
        <Textarea name="justification" rows={2} required minLength={MIN_JUSTIFICATION} placeholder="Ex.: Remetente confirmado com o gestor do projeto." />
      </label>

      <Feedback state={state} />
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Registrando…" : "Registrar decisão"}
        </Button>
      </div>
    </form>
  );
}

export function ClassificationConfirmForm({
  projectId,
  emailId,
  emailAttachmentId,
  current,
  options,
}: {
  projectId: string;
  emailId: string;
  emailAttachmentId: string | null;
  current: string | null;
  options: Array<{ value: string; label: string }>;
}) {
  const [state, formAction, pending] = useActionState(confirmEmailClassificationAction, initialEmailRegistryActionState);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2 text-xs" aria-label={emailAttachmentId ? "Confirmar classificação do anexo" : "Confirmar classificação do e-mail"}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="emailId" value={emailId} />
      {emailAttachmentId ? <input type="hidden" name="emailAttachmentId" value={emailAttachmentId} /> : null}
      <label className="flex flex-col gap-1">
        Classificação
        <Select name="classification" defaultValue={current ?? "UNCLASSIFIED"} aria-label="Classificação">
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex min-w-[220px] flex-1 flex-col gap-1">
        Justificativa
        <Input name="justification" required minLength={MIN_JUSTIFICATION} placeholder="Por que esta classificação?" />
      </label>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Salvando…" : "Confirmar"}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function BaselineSelectorForm({
  projectId,
  emailId,
  versions,
  activeScheduleVersionId,
}: {
  projectId: string;
  emailId: string | null;
  versions: Array<{ id: string; label: string }>;
  activeScheduleVersionId: string | null;
}) {
  const [state, formAction, pending] = useActionState(setScheduleBaselineAction, initialEmailRegistryActionState);
  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-md border p-3 text-xs" aria-label="Definir baseline oficial">
      <input type="hidden" name="projectId" value={projectId} />
      {emailId ? <input type="hidden" name="emailId" value={emailId} /> : null}
      <label className="flex flex-col gap-1 font-medium">
        Versão extraída que passa a ser a baseline oficial
        <Select name="scheduleVersionId" defaultValue={activeScheduleVersionId ?? ""} required aria-label="Versão de cronograma">
          <option value="" disabled>
            Selecione…
          </option>
          {versions.map((version) => (
            <option key={version.id} value={version.id}>
              {version.label}
              {version.id === activeScheduleVersionId ? " (ativa)" : ""}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1 font-medium">
        Justificativa (obrigatória)
        <Textarea name="justification" rows={2} required minLength={MIN_JUSTIFICATION} placeholder="Ex.: Baseline aprovada em reunião de kick-off de 12/09." />
      </label>
      <p className="text-muted-foreground">
        Somente ADMINISTRADOR do projeto. A baseline anterior nunca é excluída: fica no histórico com data, usuário e justificativa.
      </p>
      <Feedback state={state} />
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Definindo…" : activeScheduleVersionId ? "Substituir baseline" : "Definir baseline"}
        </Button>
      </div>
    </form>
  );
}

export function SheetMappingForm({
  projectId,
  emailId,
  sheetId,
  category,
  sheetNames,
  current,
}: {
  projectId: string;
  emailId: string;
  sheetId: string;
  category: string;
  sheetNames: string[];
  current: string | null;
}) {
  const [state, formAction, pending] = useActionState(mapWeeklyReportSheetAction, initialEmailRegistryActionState);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2 rounded-md border p-2 text-xs" aria-label={`Mapear aba ${category}`}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="emailId" value={emailId} />
      <input type="hidden" name="sheetId" value={sheetId} />
      <label className="flex flex-col gap-1">
        Aba do arquivo que corresponde a {category}
        <Select name="sheetName" defaultValue={current ?? ""} required aria-label="Aba do arquivo">
          <option value="" disabled>
            Selecione…
          </option>
          {sheetNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex min-w-[220px] flex-1 flex-col gap-1">
        Justificativa
        <Input name="justification" required minLength={MIN_JUSTIFICATION} placeholder="Por que esta aba corresponde à categoria?" />
      </label>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Mapeando…" : "Mapear aba"}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function CurveValuesValidationForm({
  projectId,
  emailId,
  sheetId,
  defaults,
}: {
  projectId: string;
  emailId: string;
  sheetId: string;
  defaults: { cutoffDate: string | null; planned: number | null; actual: number | null; forecast: number | null };
}) {
  const [state, formAction, pending] = useActionState(validateWeeklyReportCurveValuesAction, initialEmailRegistryActionState);
  return (
    <form action={formAction} className="grid gap-2 rounded-md border p-3 text-xs sm:grid-cols-5" aria-label="Validar valores da Curva S manualmente">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="emailId" value={emailId} />
      <input type="hidden" name="sheetId" value={sheetId} />
      <label className="flex flex-col gap-1">
        Data de corte
        <Input type="date" name="cutoffDate" defaultValue={defaults.cutoffDate ?? ""} required />
      </label>
      <label className="flex flex-col gap-1">
        Planejado acumulado (%)
        <Input name="plannedCumulative" inputMode="decimal" defaultValue={defaults.planned ?? ""} required />
      </label>
      <label className="flex flex-col gap-1">
        Realizado acumulado (%)
        <Input name="actualCumulative" inputMode="decimal" defaultValue={defaults.actual ?? ""} required />
      </label>
      <label className="flex flex-col gap-1">
        Projetado (%)
        <Input name="forecastCumulative" inputMode="decimal" defaultValue={defaults.forecast ?? ""} />
      </label>
      <label className="flex flex-col gap-1 sm:col-span-5">
        Justificativa (aba, células e valores lidos)
        <Input name="justification" required minLength={MIN_JUSTIFICATION} placeholder="Ex.: aba Curva S, células C12:D12." />
      </label>
      <div className="flex items-center gap-2 sm:col-span-5">
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Validando…" : "Validar valores"}
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}
