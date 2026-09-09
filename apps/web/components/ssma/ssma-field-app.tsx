"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { createSupabaseBrowserClient } from "@axion/db/browser";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  CloudUpload,
  FileText,
  History,
  Home,
  Send,
  ShieldAlert,
  Truck,
  UserRound,
  X,
} from "lucide-react";
import {
  SSMA_CHECKLISTS,
  SSMA_RISK_LEVELS,
  type SsmaChecklistDefinition,
  type SsmaChecklistState,
  type SsmaFieldDefinition,
} from "@/lib/ssma/checklist-definitions";
import { computeFileSha256Hex } from "@/lib/documents/multi-upload/sha256";
import { sanitizeFileName } from "@/lib/documents/multi-upload/queue-core";
import { cn } from "@/lib/utils";

type SsmaFieldAppProps = {
  projectId: string;
  projectLabel: string;
  technicianLabel: string;
  initialDateTime: string;
};

type CheckState = Record<string, SsmaChecklistState | undefined>;

type SelectedPhoto = {
  id: string;
  file: File;
  previewUrl: string;
  action: string;
};

const ACCEPTED_PHOTO_TYPES = new Set(["image/jpeg", "image/png"]);
const MAX_PHOTO_SIZE_BYTES = 15 * 1024 * 1024;
const MAX_PHOTOS_PER_FORM = 20;

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toLocaleString("pt-BR", {
    maximumFractionDigits: 1,
  })} MB`;
}

function PhotoUploadPanel({
  actions,
  onPhotosChange,
  disabled,
}: {
  actions: readonly string[];
  onPhotosChange: (photos: SelectedPhoto[]) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedActionRef = useRef(actions[0] ?? "Foto");
  const photosRef = useRef<SelectedPhoto[]>([]);
  const [photos, setPhotos] = useState<SelectedPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      for (const photo of photosRef.current) URL.revokeObjectURL(photo.previewUrl);
    },
    []
  );

  function addPhotos(files: FileList | null) {
    if (!files) return;

    const incoming = Array.from(files);
    const invalidType = incoming.find((file) => !ACCEPTED_PHOTO_TYPES.has(file.type));
    if (invalidType) {
      setError(`Formato não permitido em “${invalidType.name}”. Use JPG ou PNG.`);
      return;
    }

    const oversized = incoming.find((file) => file.size > MAX_PHOTO_SIZE_BYTES);
    if (oversized) {
      setError(`“${oversized.name}” ultrapassa o limite de 15 MB.`);
      return;
    }

    if (photos.length + incoming.length > MAX_PHOTOS_PER_FORM) {
      setError(`Selecione no máximo ${MAX_PHOTOS_PER_FORM} fotos por formulário.`);
      return;
    }

    const existing = new Set(
      photos.map((photo) => `${photo.file.name}|${photo.file.size}|${photo.file.lastModified}`)
    );
    const additions = incoming
      .filter((file) => !existing.has(`${file.name}|${file.size}|${file.lastModified}`))
      .map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        action: selectedActionRef.current,
      }));

    const next = [...photos, ...additions];
    photosRef.current = next;
    setPhotos(next);
    onPhotosChange(next);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function openPhotoPicker(action: string) {
    selectedActionRef.current = action;
    inputRef.current?.click();
  }

  function removePhoto(id: string) {
    const target = photos.find((photo) => photo.id === id);
    if (target) URL.revokeObjectURL(target.previewUrl);
    const next = photos.filter((photo) => photo.id !== id);
    photosRef.current = next;
    setPhotos(next);
    onPhotosChange(next);
    setError(null);
  }

  return (
    <section className="space-y-3 rounded-lg border-2 border-slate-300 bg-slate-50 p-3">
      <input
        ref={inputRef}
        type="file"
        name="photos"
        multiple
        accept="image/jpeg,image/png,.jpg,.jpeg,.png"
        onChange={(event) => addPhotos(event.target.files)}
        className="sr-only"
        aria-label="Selecionar fotos do computador"
      />

      <div className="grid gap-2 sm:grid-cols-2">
        {actions.map((action) => (
          <button
            key={action}
            type="button"
            disabled={disabled}
            onClick={() => openPhotoPicker(action)}
            className="flex min-h-14 items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 font-black uppercase text-white disabled:opacity-50"
          >
            <Camera className="size-6" /> {action}
          </button>
        ))}
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={() => openPhotoPicker(actions[0] ?? "Foto")}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border-2 border-[#7f1d1d] bg-white px-4 text-sm font-black uppercase text-[#7f1d1d] disabled:opacity-50"
      >
        <CloudUpload className="size-5" /> Selecionar fotos do computador
      </button>

      <p className="text-xs font-medium text-slate-600">JPG ou PNG · até 15 MB por foto · máximo de 20 fotos</p>
      {error ? <p role="alert" className="text-sm font-bold text-red-700">{error}</p> : null}

      {photos.length > 0 ? (
        <div className="space-y-2" aria-live="polite">
          <p className="text-sm font-black text-slate-900">
            {photos.length} {photos.length === 1 ? "foto selecionada" : "fotos selecionadas"}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photos.map((photo) => (
              <article key={photo.id} className="relative overflow-hidden rounded-lg border border-slate-300 bg-white">
                <div className="relative aspect-square bg-slate-200">
                  <Image src={photo.previewUrl} alt={`Pré-visualização de ${photo.file.name}`} fill unoptimized className="object-cover" />
                </div>
                <div className="p-2 pr-9">
                  <p className="truncate text-xs font-bold text-slate-900" title={photo.file.name}>{photo.file.name}</p>
                  <p className="truncate text-[11px] font-semibold text-[#7f1d1d]">{photo.action}</p>
                  <p className="text-[11px] text-slate-500">{formatBytes(photo.file.size)}</p>
                </div>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => removePhoto(photo.id)}
                  className="absolute bottom-2 right-2 flex size-8 items-center justify-center rounded-full bg-red-700 text-white"
                  aria-label={`Remover ${photo.file.name}`}
                >
                  <X className="size-4" />
                </button>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SsmaHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <header className="relative flex min-h-24 items-center bg-[#7f1d1d] px-4 text-white shadow-sm">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="absolute left-2 top-1/2 z-10 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/15"
          aria-label="Voltar"
        >
          <ArrowLeft className="size-6" />
        </button>
      ) : null}
      <Image
        src="/branding/acc-logo.png"
        alt="ACC"
        width={1254}
        height={1254}
        priority
        className={cn(
          "absolute top-1/2 size-16 -translate-y-1/2 object-cover",
          onBack ? "left-14" : "left-4"
        )}
      />
      <h1 className="mx-auto max-w-[58%] text-center text-lg font-black uppercase leading-tight sm:text-xl">{title}</h1>
    </header>
  );
}

function SavedContext({ projectLabel, technicianLabel, initialDateTime }: SsmaFieldAppProps) {
  return (
    <section className="space-y-3">
      <label className="block text-sm font-bold text-slate-900">
        Obra / Local de trabalho
        <span className="mt-1 block rounded-lg border-2 border-slate-400 bg-white px-3 py-3 text-base font-semibold text-slate-900">
          {projectLabel}
        </span>
      </label>
      <p className="flex items-center gap-2 text-xs font-semibold text-green-700">
        <CheckCircle2 className="size-5 fill-green-700 text-white" /> Obra salva para os próximos envios
      </p>
      <label className="block text-sm font-bold text-slate-900">
        Técnico responsável
        <span className="mt-1 block rounded-lg border-2 border-slate-300 bg-slate-50 px-3 py-3 text-base font-semibold text-slate-900">
          {technicianLabel}
        </span>
      </label>
      <p className="flex items-center gap-2 text-xs font-semibold text-green-700">
        <CheckCircle2 className="size-5 fill-green-700 text-white" /> Carregado automaticamente do cadastro da obra
      </p>
      <label className="block text-sm font-bold text-slate-900">
        Data e hora
        <input
          name="occurredAt"
          type="datetime-local"
          defaultValue={initialDateTime}
          className="mt-1 block w-full rounded-lg border-2 border-slate-300 bg-white px-3 py-3 text-base font-medium"
        />
      </label>
    </section>
  );
}

function DynamicField({ field }: { field: SsmaFieldDefinition }) {
  const className = "mt-1 block min-h-12 w-full rounded-lg border-2 border-slate-300 bg-white px-3 py-3 text-base outline-none focus:border-[#7f1d1d]";

  if (field.type === "textarea") {
    return <textarea name={field.id} placeholder={field.placeholder} rows={3} className={className} />;
  }

  if (field.type === "select") {
    return (
      <select name={field.id} defaultValue="" className={className}>
        <option value="" disabled>
          Selecione
        </option>
        {field.options?.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  return <input name={field.id} type={field.type} placeholder={field.placeholder} className={className} />;
}

function ChecklistForm({
  definition,
  projectId,
  projectLabel,
  technicianLabel,
  initialDateTime,
  onBack,
  onComplete,
}: SsmaFieldAppProps & {
  definition: SsmaChecklistDefinition;
  onBack: () => void;
  onComplete: (slug: string) => void;
}) {
  const [checks, setChecks] = useState<CheckState>({});
  const [risk, setRisk] = useState<string>("BAIXA");
  const [photos, setPhotos] = useState<SelectedPhoto[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  function mark(check: string, value: SsmaChecklistState) {
    setChecks((current) => ({ ...current, [check]: value }));
  }

  const allChecksAnswered = definition.checks.every((check) => checks[check]);
  const showRisk = definition.slug === "fotos-diarias" || definition.slug === "riscos-apontados" || definition.slug === "outros";

  return (
    <div className="min-h-dvh bg-slate-100">
      <SsmaHeader title={definition.title} onBack={onBack} />
      <form
        className="mx-auto max-w-2xl space-y-5 bg-white p-4 pb-28 sm:my-4 sm:rounded-xl sm:border sm:p-6"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!allChecksAnswered || submitting) return;

          const formData = new FormData(event.currentTarget);
          const occurredAtValue = String(formData.get("occurredAt") ?? "");
          const occurredAt = new Date(occurredAtValue);
          if (!occurredAtValue || Number.isNaN(occurredAt.getTime())) {
            setSubmitError("Informe uma data e hora válidas.");
            return;
          }

          setSubmitting(true);
          setSubmitError(null);
          setUploadProgress(0);

          try {
            const supabase = createSupabaseBrowserClient();
            const fieldValues = Object.fromEntries(
              definition.fields.map((field) => [field.id, String(formData.get(field.id) ?? "").trim()])
            );
            const checklistValues = Object.fromEntries(
              definition.checks.map((check) => [check, checks[check]])
            );

            const { data: submissionData, error: submissionError } = await supabase.rpc(
              "create_ssma_form_submission",
              {
                p_project_id: projectId,
                p_checklist_slug: definition.slug,
                p_checklist_number: definition.number,
                p_checklist_title: definition.title,
                p_drive_folder_name: definition.driveFolder,
                p_occurred_at: occurredAt.toISOString(),
                p_field_values: fieldValues,
                p_checklist_values: checklistValues,
                p_risk_level: showRisk ? risk : null,
              }
            );
            if (submissionError || !submissionData) {
              throw new Error(submissionError?.message ?? "Não foi possível iniciar o envio.");
            }
            const submissionId = String(submissionData);

            for (let index = 0; index < photos.length; index += 1) {
              const photo = photos[index];
              const photoId = crypto.randomUUID();
              const storagePath = `${projectId}/ssma/${submissionId}/${photoId}-${sanitizeFileName(photo.file.name)}`;
              const sha256Hash = await computeFileSha256Hex(photo.file);
              const { error: uploadError } = await supabase.storage
                .from("project-documents")
                .upload(storagePath, photo.file, {
                  upsert: false,
                  contentType: photo.file.type,
                });
              if (uploadError) throw new Error(`Falha ao enviar “${photo.file.name}”.`);

              const { error: registerError } = await supabase.rpc("register_ssma_submission_photo", {
                p_photo_id: photoId,
                p_submission_id: submissionId,
                p_action_label: photo.action,
                p_storage_path: storagePath,
                p_original_file_name: photo.file.name,
                p_mime_type: photo.file.type,
                p_file_size_bytes: photo.file.size,
                p_sha256_hash: sha256Hash,
              });
              if (registerError) {
                await supabase.rpc("discard_unregistered_ssma_photo", {
                  p_submission_id: submissionId,
                  p_storage_path: storagePath,
                });
                throw new Error(`Falha ao registrar “${photo.file.name}”.`);
              }
              setUploadProgress(Math.round(((index + 1) / Math.max(photos.length, 1)) * 100));
            }

            const { error: finalizeError } = await supabase.rpc("finalize_ssma_form_submission", {
              p_submission_id: submissionId,
            });
            if (finalizeError) throw new Error("Os arquivos foram enviados, mas o formulário não pôde ser finalizado.");
            onComplete(definition.slug);
          } catch (error) {
            setSubmitError(error instanceof Error ? error.message : "Não foi possível enviar os dados.");
          } finally {
            setSubmitting(false);
          }
        }}
      >
        {definition.independent ? (
          <p className="rounded-md bg-[#7f1d1d]/10 px-3 py-2 text-center text-sm font-bold text-[#7f1d1d]">
            Tarefa independente — pode ser preenchida a qualquer momento
          </p>
        ) : null}

        <SavedContext projectId={projectId} projectLabel={projectLabel} technicianLabel={technicianLabel} initialDateTime={initialDateTime} />

        <div className="h-px bg-slate-300" />

        <section className="space-y-4">
          {definition.fields.map((field) => (
            <label key={field.id} className="block text-sm font-bold text-slate-900">
              {field.label}
              <DynamicField field={field} />
            </label>
          ))}
        </section>

        {showRisk ? (
          <fieldset>
            <legend className="mb-2 text-sm font-bold text-slate-900">Classificação do risco</legend>
            <div className="grid grid-cols-4 gap-2">
              {SSMA_RISK_LEVELS.map((level) => (
                <button
                  key={level.value}
                  type="button"
                  onClick={() => setRisk(level.value)}
                  className={cn(
                    "min-h-11 rounded-md px-1 text-xs font-bold ring-offset-2",
                    level.className,
                    risk === level.value && "ring-2 ring-slate-900"
                  )}
                >
                  {level.label}
                </button>
              ))}
            </div>
          </fieldset>
        ) : null}

        <fieldset className="overflow-hidden rounded-lg border-2 border-slate-300">
          <legend className="sr-only">Checklist</legend>
          <div className="bg-slate-200 px-3 py-2 text-sm font-black uppercase text-slate-900">Checklist</div>
          {definition.checks.map((check) => (
            <div key={check} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-t border-slate-300 px-3 py-3 first:border-t-0">
              <span className="text-sm font-semibold text-slate-900">{check}</span>
              {(["FEITO", "NA"] as const).map((value) => (
                <label key={value} className="flex min-h-11 cursor-pointer items-center gap-2 px-1 text-sm font-bold">
                  <input
                    type="checkbox"
                    checked={checks[check] === value}
                    onChange={() => mark(check, value)}
                    className="size-6 accent-[#7f1d1d]"
                  />
                  {value === "FEITO" ? "Feito" : "NA"}
                </label>
              ))}
            </div>
          ))}
        </fieldset>

        <PhotoUploadPanel actions={definition.photoActions} onPhotosChange={setPhotos} disabled={submitting} />

        {submitting && photos.length > 0 ? (
          <div className="space-y-1" aria-live="polite">
            <div className="h-2 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full bg-[#7f1d1d] transition-all" style={{ width: `${uploadProgress}%` }} />
            </div>
            <p className="text-center text-sm font-bold text-slate-700">Enviando fotos: {uploadProgress}%</p>
          </div>
        ) : null}

        {submitError ? <p role="alert" className="text-center text-sm font-bold text-red-700">{submitError}</p> : null}

        {!allChecksAnswered ? (
          <p className="text-center text-sm font-semibold text-amber-700">Marque Feito ou NA em todos os itens para enviar.</p>
        ) : null}

        <button
          type="submit"
          disabled={!allChecksAnswered || submitting}
          className="flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-[#7f1d1d] px-4 text-base font-black uppercase text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send className="size-6" /> {submitting ? "Enviando…" : "Enviar dados"}
        </button>

        <p className="text-center text-xs font-medium text-slate-500">
          Tela {definition.number} de 11 · Registro protegido e auditável
        </p>
      </form>
    </div>
  );
}

export function SsmaFieldApp({ projectId, projectLabel, technicianLabel, initialDateTime }: SsmaFieldAppProps) {
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [completed, setCompleted] = useState<Set<string>>(() => new Set());

  const active = useMemo(
    () => SSMA_CHECKLISTS.find((definition) => definition.slug === activeSlug) ?? null,
    [activeSlug]
  );

  if (active) {
    return (
      <ChecklistForm
        definition={active}
        projectId={projectId}
        projectLabel={projectLabel}
        technicianLabel={technicianLabel}
        initialDateTime={initialDateTime}
        onBack={() => setActiveSlug(null)}
        onComplete={(slug) => {
          setCompleted((current) => new Set(current).add(slug));
          setActiveSlug(null);
        }}
      />
    );
  }

  const routine = SSMA_CHECKLISTS.filter((definition) => !definition.independent);
  const independent = SSMA_CHECKLISTS.find((definition) => definition.independent);
  const completedRoutine = routine.filter((definition) => completed.has(definition.slug)).length;

  return (
    <div className="min-h-dvh bg-slate-100 pb-20">
      <SsmaHeader title="SSMA/ESG" />
      <main className="mx-auto max-w-4xl space-y-4 p-4">
        <section className="rounded-xl border-2 border-slate-500 bg-white p-3">
          <p className="text-xs font-semibold text-slate-500">Projeto atual</p>
          <p className="mt-1 font-black text-slate-900">{projectLabel}</p>
        </section>

        <div className="flex items-center justify-between gap-3">
          <p className="text-base font-bold text-slate-900">Olá, {technicianLabel.split(" — ")[0]}</p>
          <span className="flex items-center gap-1 text-xs font-bold text-green-700">
            <CloudUpload className="size-5" /> Sincronizado
          </span>
        </div>

        <section className="rounded-xl bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <ClipboardCheck className="size-9 text-[#7f1d1d]" />
            <div className="flex-1">
              <p className="font-black text-slate-900">Checklist de hoje</p>
              <p className="text-sm text-slate-600">{completedRoutine} de 10 concluídos</p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full bg-[#7f1d1d]" style={{ width: `${completedRoutine * 10}%` }} />
              </div>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {routine.map((definition) => (
            <button
              key={definition.slug}
              type="button"
              onClick={() => setActiveSlug(definition.slug)}
              className="flex min-h-24 items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-[#7f1d1d]"
            >
              {definition.slug === "riscos-apontados" ? (
                <ShieldAlert className="size-7 shrink-0 text-slate-800" />
              ) : (
                <FileText className="size-7 shrink-0 text-slate-800" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block font-black text-slate-900">
                  {String(definition.number).padStart(2, "0")} {definition.shortTitle}
                </span>
                <span className={cn("mt-1 block text-xs font-bold", completed.has(definition.slug) ? "text-green-700" : "text-amber-600")}>
                  {completed.has(definition.slug) ? "Concluído" : "Pendente"}
                </span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-slate-500" />
            </button>
          ))}
        </section>

        {independent ? (
          <button
            type="button"
            onClick={() => setActiveSlug(independent.slug)}
            className="flex min-h-20 w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-[#7f1d1d]"
          >
            <Truck className="size-7 shrink-0 text-[#7f1d1d]" />
            <span className="min-w-0 flex-1">
              <span className="block font-black text-slate-900">11 Remessa para bota-fora</span>
              <span className="block text-xs text-slate-600">Tarefa independente</span>
            </span>
            <span className="text-sm font-bold text-[#7f1d1d]">Registrar remessa</span>
            <ChevronRight className="size-5 shrink-0 text-[#7f1d1d]" />
          </button>
        ) : null}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-slate-300 bg-white px-2 py-2 text-[11px] font-semibold text-slate-600">
        <span className="flex flex-col items-center gap-1 text-[#7f1d1d]"><Home className="size-5" />Início</span>
        <span className="flex flex-col items-center gap-1"><History className="size-5" />Histórico</span>
        <span className="flex flex-col items-center gap-1"><CloudUpload className="size-5" />Sincronização</span>
        <span className="flex flex-col items-center gap-1"><UserRound className="size-5" />Perfil</span>
      </nav>
    </div>
  );
}
