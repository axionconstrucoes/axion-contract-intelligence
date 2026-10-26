"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Camera, CloudUpload, Save, X } from "lucide-react";
import {
  ACCEPTED_PHOTO_MIME_TYPES,
  FIELD_RECORD_CATEGORIES,
  FIELD_RECORD_KINDS,
  FIELD_RECORD_RISKS,
  MAX_PHOTOS_PER_RECORD,
  MAX_PHOTO_SIZE_BYTES,
  validateFieldRecordDraft,
  type FieldRecordDraft,
  type FieldRecordKind,
  type FieldRecordRisk,
} from "@/lib/ssma/field-records/types";
import type { NewPhotoInput } from "@/lib/ssma/field-records/queue-core";
import { cn } from "@/lib/utils";

const RISK_STYLES: Record<FieldRecordRisk, string> = {
  BAIXA: "bg-[#166534] text-white",
  MEDIA: "bg-[#2563EB] text-white",
  ALTA: "bg-[#FFD600] text-black",
  CRITICA: "bg-[#DC2626] text-white",
};

/** Data/hora local do aparelho no formato do input datetime-local. */
export function localDateTimeValue(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

interface Photo {
  id: string;
  file: File;
  previewUrl: string;
}

const fieldClass = "mt-1 block min-h-12 w-full rounded-lg border-2 border-slate-300 bg-white px-3 py-3 text-base outline-none focus:border-[#7f1d1d]";

export function NewRecordForm({
  members,
  online,
  onSave,
  onCancel,
}: {
  members: Array<{ userId: string; name: string }>;
  online: boolean;
  onSave: (draft: FieldRecordDraft, photos: NewPhotoInput[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<FieldRecordKind>("OCORRENCIA");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [occurredAt, setOccurredAt] = useState(() => localDateTimeValue());
  const [risk, setRisk] = useState<FieldRecordRisk>("BAIXA");
  const [responsible, setResponsible] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef<Photo[]>([]);

  useEffect(
    () => () => {
      for (const photo of photosRef.current) URL.revokeObjectURL(photo.previewUrl);
    },
    []
  );

  function addFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list);
    const problems: string[] = [];
    const accepted: Photo[] = [];
    for (const file of incoming) {
      if (!ACCEPTED_PHOTO_MIME_TYPES.includes(file.type)) problems.push(`Formato não permitido em “${file.name}”. Use JPG ou PNG.`);
      else if (file.size > MAX_PHOTO_SIZE_BYTES) problems.push(`“${file.name}” ultrapassa o limite de 15 MB.`);
      else accepted.push({ id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file) });
    }
    if (photos.length + accepted.length > MAX_PHOTOS_PER_RECORD) {
      for (const photo of accepted) URL.revokeObjectURL(photo.previewUrl);
      setErrors([`Selecione no máximo ${MAX_PHOTOS_PER_RECORD} fotos.`]);
      return;
    }
    const next = [...photos, ...accepted];
    photosRef.current = next;
    setPhotos(next);
    setErrors(problems);
    if (cameraRef.current) cameraRef.current.value = "";
    if (galleryRef.current) galleryRef.current.value = "";
  }

  function removePhoto(id: string) {
    const target = photos.find((photo) => photo.id === id);
    if (target) URL.revokeObjectURL(target.previewUrl);
    const next = photos.filter((photo) => photo.id !== id);
    photosRef.current = next;
    setPhotos(next);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    const occurred = new Date(occurredAt);
    const draft: FieldRecordDraft = {
      kind,
      category,
      description,
      location,
      occurredAt: Number.isNaN(occurred.getTime()) ? "" : occurred.toISOString(),
      risk,
      responsibleUserId: responsible || null,
      dueDate: responsible ? dueDate || null : null,
    };
    const validation = validateFieldRecordDraft(draft);
    if (!validation.ok) {
      setErrors(validation.errors);
      return;
    }
    setSaving(true);
    setErrors([]);
    try {
      await onSave(
        draft,
        photos.map((photo) => ({ name: photo.file.name, mimeType: photo.file.type, blob: photo.file }))
      );
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Não foi possível guardar o registro."]);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-5 bg-white p-4 pb-28 sm:my-4 sm:rounded-xl sm:border sm:p-6">
      <fieldset>
        <legend className="mb-2 text-sm font-bold text-slate-900">Tipo de registro</legend>
        <div className="grid grid-cols-2 gap-2">
          {FIELD_RECORD_KINDS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setKind(option.value)}
              aria-pressed={kind === option.value}
              className={cn("min-h-12 rounded-lg border-2 px-3 text-sm font-black uppercase", kind === option.value ? "border-[#7f1d1d] bg-[#7f1d1d] text-white" : "border-slate-300 bg-white text-slate-800")}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="block text-sm font-bold text-slate-900">
        Categoria *
        <select value={category} onChange={(event) => setCategory(event.target.value)} className={fieldClass} required>
          <option value="" disabled>Selecione</option>
          {FIELD_RECORD_CATEGORIES.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </label>

      <label className="block text-sm font-bold text-slate-900">
        Descrição *
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} maxLength={4000} placeholder="Descreva o que foi observado, sem diagnósticos" className={fieldClass} required />
      </label>

      <label className="block text-sm font-bold text-slate-900">
        Local *
        <input value={location} onChange={(event) => setLocation(event.target.value)} maxLength={200} placeholder="Ex.: Bloco B, pavimento 2" className={fieldClass} required />
      </label>

      <label className="block text-sm font-bold text-slate-900">
        Data e hora do fato *
        <input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} className={fieldClass} required />
        <span className="mt-1 block text-xs font-medium text-slate-500">O horário real do registro no aparelho é guardado junto, mesmo que o envio ocorra depois.</span>
      </label>

      <fieldset>
        <legend className="mb-2 text-sm font-bold text-slate-900">Risco *</legend>
        <div className="grid grid-cols-4 gap-2">
          {FIELD_RECORD_RISKS.map((level) => (
            <button
              key={level.value}
              type="button"
              onClick={() => setRisk(level.value)}
              aria-pressed={risk === level.value}
              className={cn("min-h-11 rounded-md px-1 text-xs font-bold ring-offset-2", RISK_STYLES[level.value], risk === level.value && "ring-2 ring-slate-900")}
            >
              {level.label}
            </button>
          ))}
        </div>
      </fieldset>

      <section className="space-y-3 rounded-lg border-2 border-slate-200 bg-slate-50 p-3">
        <p className="text-sm font-black uppercase text-slate-900">Ação corretiva (opcional)</p>
        <label className="block text-sm font-bold text-slate-900">
          Responsável
          <select value={responsible} onChange={(event) => setResponsible(event.target.value)} className={fieldClass}>
            <option value="">Sem ação corretiva</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>{member.name}</option>
            ))}
          </select>
        </label>
        {responsible ? (
          <label className="block text-sm font-bold text-slate-900">
            Prazo *
            <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className={fieldClass} required />
          </label>
        ) : null}
      </section>

      <section className="space-y-3 rounded-lg border-2 border-slate-300 bg-slate-50 p-3">
        <input ref={cameraRef} type="file" accept="image/jpeg,image/png" capture="environment" onChange={(event) => addFiles(event.target.files)} className="sr-only" aria-label="Tirar foto" />
        <input ref={galleryRef} type="file" multiple accept="image/jpeg,image/png,.jpg,.jpeg,.png" onChange={(event) => addFiles(event.target.files)} className="sr-only" aria-label="Escolher fotos" />
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={() => cameraRef.current?.click()} className="flex min-h-14 items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 font-black uppercase text-white">
            <Camera className="size-6" /> Tirar foto
          </button>
          <button type="button" onClick={() => galleryRef.current?.click()} className="flex min-h-14 items-center justify-center gap-2 rounded-lg border-2 border-[#7f1d1d] bg-white px-4 font-black uppercase text-[#7f1d1d]">
            <CloudUpload className="size-5" /> Da galeria
          </button>
        </div>
        <p className="text-xs font-medium text-slate-600">Fotos são opcionais · JPG ou PNG · até 15 MB · máximo de {MAX_PHOTOS_PER_RECORD}</p>
        {photos.length > 0 ? (
          <div className="grid grid-cols-3 gap-2" aria-live="polite">
            {photos.map((photo) => (
              <div key={photo.id} className="relative aspect-square overflow-hidden rounded-lg border border-slate-300 bg-slate-200">
                <Image src={photo.previewUrl} alt={`Pré-visualização de ${photo.file.name}`} fill unoptimized className="object-cover" />
                <button type="button" onClick={() => removePhoto(photo.id)} className="absolute right-0 top-0 flex size-11 items-center justify-center text-white" aria-label={`Remover ${photo.file.name}`}>
                  <span className="flex size-7 items-center justify-center rounded-full bg-red-700"><X className="size-4" /></span>
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {errors.length > 0 ? (
        <ul role="alert" className="space-y-1 text-sm font-bold text-red-700">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}

      <p className="text-center text-xs font-semibold text-slate-600">
        {online ? "Será enviado agora; se a conexão falhar, fica salvo no aparelho." : "Sem conexão: o registro ficará salvo no aparelho e será enviado quando a internet voltar."}
      </p>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} disabled={saving} className="min-h-14 rounded-lg border-2 border-slate-300 bg-white px-4 font-black uppercase text-slate-700 disabled:opacity-50">
          Cancelar
        </button>
        <button type="submit" disabled={saving} className="flex min-h-14 items-center justify-center gap-2 rounded-lg bg-[#7f1d1d] px-4 font-black uppercase text-white disabled:opacity-50">
          <Save className="size-5" /> {saving ? "Salvando…" : "Salvar registro"}
        </button>
      </div>
    </form>
  );
}
