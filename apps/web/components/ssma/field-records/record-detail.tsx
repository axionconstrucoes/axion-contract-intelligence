"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@axion/db/browser";
import { Camera, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { computeFileSha256Hex } from "@/lib/documents/multi-upload/sha256";
import { isActionOverdue, type FieldRecordView } from "@/lib/ssma/field-records/field-record-view";
import { uploadActionEvidencePhoto } from "@/lib/ssma/field-records/supabase-transport";
import {
  ACCEPTED_PHOTO_MIME_TYPES,
  ACTION_STATUS_LABELS,
  MAX_PHOTO_SIZE_BYTES,
  RISK_LABELS,
  extractServerErrorCode,
  messageForServerError,
} from "@/lib/ssma/field-records/types";
import { RecordConsult } from "@/components/ssma/field-records/record-consult";
import { cn } from "@/lib/utils";

interface ActionEvent {
  id: string;
  kind: "CRIADA" | "ANDAMENTO" | "CONCLUIDA";
  note: string | null;
  actor_user_id: string;
  created_at: string;
  evidence_photo_id: string | null;
}

const EVENT_LABELS = { CRIADA: "Ação aberta", ANDAMENTO: "Andamento", CONCLUIDA: "Concluída" } as const;
const dateTime = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
const dateOnly = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR");

export function RecordDetail({
  record,
  userId,
  projectId,
  canManage,
  online,
  names,
  onChanged,
}: {
  record: FieldRecordView;
  userId: string;
  projectId: string;
  canManage: boolean;
  online: boolean;
  names: ReadonlyMap<string, string>;
  onChanged: () => void;
}) {
  const [events, setEvents] = useState<ActionEvent[]>([]);
  const [event, setEvent] = useState<"ANDAMENTO" | "CONCLUIDA">("ANDAMENTO");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const action = record.action;
  const today = new Date().toISOString().slice(0, 10);
  const isResponsible = record.responsibleId === userId;
  const canUpdate = action !== null && action.status !== "CONCLUIDA" && (isResponsible || canManage);

  useEffect(() => {
    if (!action || !online) return;
    let cancelled = false;
    const supabase = createSupabaseBrowserClient();
    void supabase
      .from("ssma_corrective_action_events")
      .select("id, kind, note, actor_user_id, created_at, evidence_photo_id")
      .eq("action_id", action.id)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (!cancelled) setEvents((data ?? []) as ActionEvent[]);
      });
    return () => {
      cancelled = true;
    };
  }, [action, online, done]);

  async function submit(submitEvent: React.FormEvent) {
    submitEvent.preventDefault();
    if (!action || busy) return;
    if (!online) {
      setError("Registrar andamento e conclusão exige conexão. Tente novamente quando a internet voltar.");
      return;
    }
    if (file && (!ACCEPTED_PHOTO_MIME_TYPES.includes(file.type) || file.size > MAX_PHOTO_SIZE_BYTES)) {
      setError("A evidência deve ser JPG ou PNG de até 15 MB.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      let evidenceId: string | null = null;
      if (event === "CONCLUIDA" && file) {
        evidenceId = await uploadActionEvidencePhoto(supabase, { userId, projectId, recordId: record.id, file, sha256: await computeFileSha256Hex(file) });
      }
      const { error: rpcError } = await supabase.rpc("ssma_corrective_action_update", {
        p_action_id: action.id,
        p_event: event,
        p_note: note || null,
        p_evidence_photo_id: evidenceId,
      });
      if (rpcError) throw new Error(messageForServerError(extractServerErrorCode(rpcError.message)));
      setNote("");
      setFile(null);
      setDone(event === "CONCLUIDA" ? "Ação concluída e registrada." : "Andamento registrado.");
      onChanged();
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : "Não foi possível registrar. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="mx-auto max-w-2xl space-y-4 p-4 pb-28">
      <section className="space-y-2 rounded-xl bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
          <span className="rounded bg-slate-800 px-2 py-1 text-white">{record.kind === "OCORRENCIA" ? "Ocorrência" : "Inspeção"}</span>
          <span className="rounded bg-slate-200 px-2 py-1 text-slate-800">{record.category}</span>
          <span className="rounded bg-slate-200 px-2 py-1 text-slate-800">Risco {RISK_LABELS[record.risk]}</span>
        </div>
        <p className="whitespace-pre-wrap text-base font-semibold text-slate-900">{record.description}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="font-bold text-slate-600">Local</dt><dd>{record.location}</dd>
          <dt className="font-bold text-slate-600">Fato</dt><dd>{dateTime(record.occurredAt)}</dd>
          <dt className="font-bold text-slate-600">Criado no aparelho</dt><dd>{dateTime(record.clientCreatedAt)}</dd>
          <dt className="font-bold text-slate-600">Recebido pelo ACC</dt><dd>{dateTime(record.receivedAt)}</dd>
          <dt className="font-bold text-slate-600">Registrado por</dt><dd>{record.reportedByName}</dd>
          <dt className="font-bold text-slate-600">Fotos</dt><dd>{record.photoCount}</dd>
        </dl>
      </section>

      {action ? (
        <section className="space-y-3 rounded-xl bg-white p-4 shadow-sm" aria-label="Ação corretiva">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-black uppercase text-slate-900">Ação corretiva</h2>
            <span
              className={cn(
                "rounded px-2 py-1 text-xs font-black",
                action.status === "CONCLUIDA" ? "bg-green-100 text-green-800" : isActionOverdue(action, today) ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-900"
              )}
            >
              {isActionOverdue(action, today) ? "Em atraso" : ACTION_STATUS_LABELS[action.status]}
            </span>
          </div>
          <p className="text-sm text-slate-700">
            Responsável: <strong>{record.responsibleName}</strong> · Prazo: <strong>{dateOnly(action.dueDate)}</strong>
            {action.concludedAt ? <> · Concluída em <strong>{dateTime(action.concludedAt)}</strong></> : null}
          </p>

          <ol className="space-y-2 border-l-2 border-slate-200 pl-3">
            {events.map((item) => (
              <li key={item.id} className="text-sm">
                <p className="font-bold text-slate-900">
                  {EVENT_LABELS[item.kind]} <span className="font-medium text-slate-500">· {dateTime(item.created_at)} · {names.get(item.actor_user_id) ?? "Usuário"}</span>
                </p>
                {item.note ? <p className="whitespace-pre-wrap text-slate-700">{item.note}</p> : null}
                {item.evidence_photo_id ? (
                  <a href={`/api/ssma/records/photos/${item.evidence_photo_id}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-xs font-bold text-[#7f1d1d] underline">
                    Ver foto de evidência
                  </a>
                ) : null}
              </li>
            ))}
            {!online && events.length === 0 ? <li className="text-sm text-slate-500">O histórico é carregado quando há conexão.</li> : null}
          </ol>

          {canUpdate ? (
            <form onSubmit={submit} className="space-y-3 border-t border-slate-200 pt-3">
              <div className="grid grid-cols-2 gap-2">
                {(["ANDAMENTO", "CONCLUIDA"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={event === value}
                    onClick={() => setEvent(value)}
                    className={cn("min-h-11 rounded-lg border-2 px-2 text-xs font-black uppercase", event === value ? "border-[#7f1d1d] bg-[#7f1d1d] text-white" : "border-slate-300 bg-white text-slate-800")}
                  >
                    {value === "ANDAMENTO" ? "Registrar andamento" : "Concluir ação"}
                  </button>
                ))}
              </div>
              <label className="block text-sm font-bold text-slate-900">
                {event === "ANDAMENTO" ? "O que foi feito *" : canManage && !isResponsible ? "Justificativa (se não houver foto)" : "Observação"}
                <textarea value={note} onChange={(item) => setNote(item.target.value)} rows={3} className="mt-1 block w-full rounded-lg border-2 border-slate-300 bg-white px-3 py-2 text-base outline-none focus:border-[#7f1d1d]" />
              </label>
              {event === "CONCLUIDA" ? (
                <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-[#7f1d1d] bg-white px-3 text-sm font-black uppercase text-[#7f1d1d]">
                  <Camera className="size-5" /> {file ? file.name : "Foto de evidência"}
                  <input type="file" accept="image/jpeg,image/png" capture="environment" className="sr-only" onChange={(item) => setFile(item.target.files?.[0] ?? null)} />
                </label>
              ) : null}
              {event === "CONCLUIDA" ? (
                <p className="text-xs font-medium text-slate-600">
                  A conclusão exige foto de evidência{canManage ? " ou justificativa de pelo menos 10 caracteres (gestor)" : ""}. Nada é concluído sem esse registro.
                </p>
              ) : null}
              {error ? <p role="alert" className="text-sm font-bold text-red-700">{error}</p> : null}
              {done ? (
                <p className="flex items-center gap-1 text-sm font-bold text-green-700"><CheckCircle2 className="size-4" /> {done}</p>
              ) : null}
              <button type="submit" disabled={busy || !online} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#7f1d1d] px-4 font-black uppercase text-white disabled:opacity-50">
                {busy ? <Loader2 className="size-5 animate-spin" /> : <Clock className="size-5" />} {event === "ANDAMENTO" ? "Registrar andamento" : "Concluir"}
              </button>
              {!online ? <p className="text-center text-xs font-semibold text-amber-700">Sem conexão: andamento e conclusão só podem ser registrados online.</p> : null}
            </form>
          ) : action.status !== "CONCLUIDA" ? (
            <p className="text-xs font-medium text-slate-500">Somente o responsável ou um gestor da obra atualiza esta ação.</p>
          ) : null}
        </section>
      ) : (
        <p className="rounded-xl bg-white p-4 text-sm text-slate-600 shadow-sm">Este registro não tem ação corretiva.</p>
      )}

      <RecordConsult projectId={projectId} recordId={record.id} online={online} />
    </article>
  );
}
