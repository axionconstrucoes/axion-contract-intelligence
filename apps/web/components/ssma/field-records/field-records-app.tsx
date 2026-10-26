"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@axion/db/browser";
import { AlertTriangle, CheckCircle2, CloudOff, CloudUpload, Plus, RefreshCw, Trash2, WifiOff } from "lucide-react";
import { SsmaBottomNav, SsmaHeader, type SsmaTab } from "@/components/ssma/ssma-chrome";
import { NewRecordForm } from "@/components/ssma/field-records/new-record-form";
import { RecordDetail } from "@/components/ssma/field-records/record-detail";
import { SsmaOfflineCapabilities } from "@/components/ssma/ssma-offline-capabilities";
import type { OfflineContext } from "@/lib/ssma/field-records/idb-store";
import { isActionOverdue, mapFieldRecordRow, type FieldRecordRow, type FieldRecordView } from "@/lib/ssma/field-records/field-record-view";
import type { useFieldQueue } from "@/lib/ssma/field-records/use-field-queue";
import { ACTION_STATUS_LABELS, QUEUE_STATUS_LABELS, RISK_LABELS, type QueuedRecord, type QueueStatus } from "@/lib/ssma/field-records/types";
import { cn } from "@/lib/utils";

export type FieldProject = OfflineContext["projects"][number];
export type FieldQueueApi = ReturnType<typeof useFieldQueue>;

const STATUS_STYLES: Record<QueueStatus, string> = {
  SAVED_ON_DEVICE: "bg-slate-200 text-slate-900",
  WAITING_SEND: "bg-amber-100 text-amber-900",
  SYNCED: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
};
const RISK_DOT: Record<string, string> = { BAIXA: "bg-[#166534]", MEDIA: "bg-[#2563EB]", ALTA: "bg-[#FFD600]", CRITICA: "bg-[#DC2626]" };
const dateTime = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

function StatusPill({ status }: { status: QueueStatus }) {
  return <span className={cn("rounded px-2 py-1 text-[11px] font-black", STATUS_STYLES[status])}>{QUEUE_STATUS_LABELS[status]}</span>;
}

export function FieldRecordsApp({
  queue,
  userId,
  userLabel,
  project,
  offlineShell = false,
  initialTab = "registros",
  onHome,
  onSignOut,
  initialServerRecords,
}: {
  /** Fila do aparelho (um único hook por tela, criado pelo componente pai). */
  queue: FieldQueueApi;
  userId: string;
  userLabel: string;
  project: FieldProject;
  /** true quando aberto pela casca offline (dados vêm do aparelho, não do servidor). */
  offlineShell?: boolean;
  initialTab?: SsmaTab;
  onHome?: () => void;
  onSignOut?: () => void;
  /** Registros já conhecidos (ex.: vindos do servidor); a lista é atualizada pela rede em seguida. */
  initialServerRecords?: FieldRecordView[];
}) {
  const [tab, setTab] = useState<SsmaTab>(initialTab);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<FieldRecordView | null>(null);
  const [serverRecords, setServerRecords] = useState<FieldRecordView[]>(initialServerRecords ?? []);
  const [serverError, setServerError] = useState<string | null>(null);
  const [loadingServer, setLoadingServer] = useState(!offlineShell);
  const online = queue.reachable;
  const names = useMemo(() => new Map(project.members.map((member) => [member.userId, member.name])), [project.members]);

  const loadServer = useCallback(async () => {
    if (!navigator.onLine) {
      await Promise.resolve();
      setLoadingServer(false);
      return;
    }
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase
        .from("ssma_field_records")
        .select(
          "id, kind, category, description, location, occurred_at, client_created_at, received_at, risk_level, responsible_user_id, due_date, reported_by_user_id, ssma_corrective_actions(id, status, due_date, concluded_at, responsible_user_id), ssma_field_record_photos(id, purpose)"
        )
        .eq("project_id", project.id)
        .order("occurred_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const views = ((data ?? []) as unknown as FieldRecordRow[]).map((row) => mapFieldRecordRow(row, names));
      setServerRecords(views);
      setServerError(null);
      setSelected((current) => (current ? (views.find((view) => view.id === current.id) ?? current) : null));
    } catch {
      setServerError("Não foi possível carregar os registros do ACC agora.");
    } finally {
      setLoadingServer(false);
    }
  }, [project.id, names]);

  // Recarrega os registros do servidor quando a fila sincroniza algo e ao voltar a conexão.
  const syncedCount = queue.items.filter((item) => item.status === "SYNCED").length;
  useEffect(() => {
    if (offlineShell) return;
    const timer = window.setTimeout(() => void loadServer(), 0);
    return () => window.clearTimeout(timer);
  }, [loadServer, offlineShell, syncedCount, online]);

  const projectItems = queue.items.filter((item) => item.projectId === project.id);
  const serverIds = new Set(serverRecords.map((record) => record.id));
  // O que já está no servidor aparece pela versão do servidor; a fila mostra só o que ainda não está.
  const localOnly = projectItems.filter((item) => !(item.status === "SYNCED" && serverIds.has(item.clientId)));
  const pending = queue.items.filter((item) => item.status !== "SYNCED");

  async function handleSave(draft: Parameters<typeof queue.save>[1], photos: Parameters<typeof queue.save>[2]) {
    await queue.save(project.id, draft, photos);
    setCreating(false);
    setTab("registros");
  }

  const headerTitle = creating ? "Novo registro" : selected ? "Registro" : tab === "sync" ? "Envios" : tab === "perfil" ? "Perfil" : "Registros";
  const onBack = creating ? () => setCreating(false) : selected ? () => setSelected(null) : onHome;

  return (
    <div className="min-h-dvh bg-slate-100 pb-20">
      <SsmaHeader title={headerTitle} onBack={onBack} />

      {!online || offlineShell ? (
        <div role="status" className="flex items-center gap-2 bg-amber-100 px-4 py-2 text-sm font-bold text-amber-900">
          <WifiOff className="size-5 shrink-0" /> {online ? "Modo sem conexão do aparelho." : "Sem conexão — você pode registrar normalmente; o envio acontece quando a internet voltar."}
        </div>
      ) : null}
      {queue.storageError ? <p role="alert" className="bg-red-100 px-4 py-2 text-sm font-bold text-red-800">{queue.storageError}</p> : null}
      {queue.message ? <p role="status" className="bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-800">{queue.message}</p> : null}

      {creating ? (
        <NewRecordForm members={project.members} online={online} onSave={handleSave} onCancel={() => setCreating(false)} />
      ) : selected ? (
        <RecordDetail record={selected} userId={userId} projectId={project.id} canManage={project.canManage} online={online} names={names} onChanged={() => void loadServer()} />
      ) : tab === "sync" ? (
        <SyncView items={queue.items} projectId={project.id} foreignPending={queue.foreignPending} syncing={queue.syncing} online={online} onRetry={() => void queue.runSync(true)} onDiscard={(id) => void queue.discard(id)} onPurge={() => void queue.purgeForeign()} />
      ) : tab === "perfil" ? (
        <ProfileView userLabel={userLabel} projectLabel={project.label} offlineShell={offlineShell} foreignPending={queue.foreignPending} pendingCount={pending.length} onPurge={() => void queue.purgeForeign()} onSignOut={async () => { await queue.forgetContext(); onSignOut?.(); }} />
      ) : (
        <main className="mx-auto max-w-2xl space-y-3 p-4">
          <div className="rounded-xl border-2 border-slate-400 bg-white p-3">
            <p className="text-xs font-semibold text-slate-500">Obra</p>
            <p className="font-black text-slate-900">{project.label}</p>
          </div>
          <button type="button" onClick={() => setCreating(true)} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-[#7f1d1d] px-4 font-black uppercase text-white">
            <Plus className="size-6" /> Novo registro
          </button>

          {localOnly.length > 0 ? (
            <section aria-label="Neste aparelho" className="space-y-2">
              <h2 className="text-xs font-black uppercase text-slate-600">Neste aparelho</h2>
              {localOnly.map((item) => <LocalRow key={item.clientId} item={item} />)}
            </section>
          ) : null}

          <section aria-label="Registros da obra" className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-black uppercase text-slate-600">Registros da obra</h2>
              {!offlineShell ? (
                <button type="button" onClick={() => { setLoadingServer(true); void loadServer(); }} className="flex min-h-11 items-center gap-1 px-2 text-xs font-bold text-[#7f1d1d]" disabled={loadingServer || !online}>
                  <RefreshCw className={cn("size-4", loadingServer && "animate-spin")} /> Atualizar
                </button>
              ) : null}
            </div>
            {offlineShell ? <p className="rounded-lg bg-white p-3 text-sm text-slate-600">Os registros da obra são exibidos quando há conexão.</p> : null}
            {serverError ? <p role="alert" className="text-sm font-bold text-red-700">{serverError}</p> : null}
            {!offlineShell && !loadingServer && !serverError && serverRecords.length === 0 ? <p className="rounded-lg bg-white p-3 text-sm text-slate-600">Nenhum registro enviado ainda.</p> : null}
            {serverRecords.map((record) => <ServerRow key={record.id} record={record} onOpen={() => setSelected(record)} />)}
          </section>
        </main>
      )}

      <SsmaBottomNav
        active={tab}
        pendingCount={pending.length}
        onChange={(next) => {
          if (next === "home") {
            if (onHome) onHome();
            else setTab("registros");
            return;
          }
          setCreating(false);
          setSelected(null);
          setTab(next);
        }}
      />
    </div>
  );
}

function LocalRow({ item }: { item: QueuedRecord }) {
  return (
    <article className="rounded-xl bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm font-black text-slate-900">{item.draft.category} · {item.draft.location}</p>
        <StatusPill status={item.status} />
      </div>
      <p className="mt-1 line-clamp-2 text-sm text-slate-700">{item.draft.description}</p>
      <p className="mt-1 text-xs text-slate-500">
        <span className={cn("mr-1 inline-block size-2 rounded-full", RISK_DOT[item.draft.risk])} />
        Risco {RISK_LABELS[item.draft.risk]} · criado em {dateTime(item.clientCreatedAt)} · {item.photos.length} foto(s)
      </p>
      {item.lastError ? <p role="alert" className="mt-1 text-xs font-bold text-red-700">{item.lastError}</p> : null}
    </article>
  );
}

function ServerRow({ record, onOpen }: { record: FieldRecordView; onOpen: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const overdue = isActionOverdue(record.action, today);
  return (
    <button type="button" onClick={onOpen} className="block w-full rounded-xl bg-white p-3 text-left shadow-sm hover:ring-2 hover:ring-[#7f1d1d]/40">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm font-black text-slate-900">{record.category} · {record.location}</p>
        <span className="flex items-center gap-1 text-[11px] font-black text-green-700"><CheckCircle2 className="size-4" /> {QUEUE_STATUS_LABELS.SYNCED}</span>
      </div>
      <p className="mt-1 line-clamp-2 text-sm text-slate-700">{record.description}</p>
      <p className="mt-1 text-xs text-slate-500">
        <span className={cn("mr-1 inline-block size-2 rounded-full", RISK_DOT[record.risk])} />
        Risco {RISK_LABELS[record.risk]} · {dateTime(record.occurredAt)} · {record.reportedByName}
      </p>
      {record.action ? (
        <p className={cn("mt-1 text-xs font-bold", overdue ? "text-red-700" : record.action.status === "CONCLUIDA" ? "text-green-700" : "text-amber-700")}>
          Ação corretiva: {overdue ? "em atraso" : ACTION_STATUS_LABELS[record.action.status]}
          {record.responsibleName ? ` · ${record.responsibleName}` : ""}
        </p>
      ) : null}
    </button>
  );
}

function SyncView({
  items,
  projectId,
  foreignPending,
  syncing,
  online,
  onRetry,
  onDiscard,
  onPurge,
}: {
  items: QueuedRecord[];
  projectId: string;
  foreignPending: number;
  syncing: boolean;
  online: boolean;
  onRetry: () => void;
  onDiscard: (clientId: string) => void;
  onPurge: () => void;
}) {
  const counts = (status: QueueStatus) => items.filter((item) => item.status === status).length;
  const [confirmPurge, setConfirmPurge] = useState(false);
  return (
    <main className="mx-auto max-w-2xl space-y-3 p-4">
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Resumo da fila">
        {(["SAVED_ON_DEVICE", "WAITING_SEND", "SYNCED", "FAILED"] as const).map((status) => (
          <div key={status} className="rounded-xl bg-white p-3 text-center shadow-sm">
            <p className="text-2xl font-black text-slate-900">{counts(status)}</p>
            <p className="text-[11px] font-bold text-slate-600">{QUEUE_STATUS_LABELS[status]}</p>
          </div>
        ))}
      </section>
      <button type="button" onClick={onRetry} disabled={syncing || !online} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#7f1d1d] px-4 font-black uppercase text-white disabled:opacity-50">
        <CloudUpload className={cn("size-5", syncing && "animate-pulse")} /> {syncing ? "Enviando…" : "Enviar agora / tentar de novo"}
      </button>
      {!online ? <p className="flex items-center gap-2 text-sm font-semibold text-amber-800"><CloudOff className="size-5" /> Sem conexão: os itens seguem salvos no aparelho.</p> : null}
      <SsmaOfflineCapabilities />

      <ul className="space-y-2">
        {items.length === 0 ? <li className="rounded-xl bg-white p-3 text-sm text-slate-600">Nenhum registro neste aparelho.</li> : null}
        {items.map((item) => (
          <li key={item.clientId} className="rounded-xl bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 flex-1 text-sm font-black text-slate-900">{item.draft.category} · {item.draft.location}{item.projectId !== projectId ? " (outra obra)" : ""}</p>
              <StatusPill status={item.status} />
            </div>
            <p className="mt-1 text-xs text-slate-500">Criado em {dateTime(item.clientCreatedAt)} · {item.photos.length} foto(s) · {item.attempts} tentativa(s){item.syncedAt ? ` · enviado em ${dateTime(item.syncedAt)}` : ""}</p>
            {item.lastError ? (
              <p role="alert" className="mt-1 flex items-start gap-1 text-xs font-bold text-red-700"><AlertTriangle className="mt-0.5 size-4 shrink-0" /> {item.lastError}</p>
            ) : null}
            {item.status !== "SYNCED" ? (
              <button type="button" onClick={() => onDiscard(item.clientId)} className="mt-1 flex min-h-11 items-center gap-1 text-xs font-bold text-slate-600 underline">
                <Trash2 className="size-4" /> Descartar este registro do aparelho
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {foreignPending > 0 ? (
        <section className="space-y-2 rounded-xl border-2 border-amber-400 bg-amber-50 p-3" aria-label="Registros de outra conta">
          <p className="text-sm font-bold text-amber-900">
            Há {foreignPending} registro(s) neste aparelho criados por outra conta (conteúdo não exibido). Eles só serão enviados quando essa conta entrar de novo.
          </p>
          {confirmPurge ? (
            <div className="flex gap-2">
              <button type="button" onClick={() => { onPurge(); setConfirmPurge(false); }} className="min-h-11 flex-1 rounded-lg bg-red-700 px-3 text-sm font-black uppercase text-white">Apagar do aparelho</button>
              <button type="button" onClick={() => setConfirmPurge(false)} className="min-h-11 flex-1 rounded-lg border-2 border-slate-300 bg-white px-3 text-sm font-black uppercase text-slate-700">Manter</button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmPurge(true)} className="flex min-h-11 items-center text-left text-xs font-bold text-red-700 underline">Remover os registros de outras contas deste aparelho…</button>
          )}
        </section>
      ) : null}
    </main>
  );
}

function ProfileView({
  userLabel,
  projectLabel,
  offlineShell,
  foreignPending,
  pendingCount,
  onPurge,
  onSignOut,
}: {
  userLabel: string;
  projectLabel: string;
  offlineShell: boolean;
  foreignPending: number;
  pendingCount: number;
  onPurge: () => void;
  onSignOut: () => void | Promise<void>;
}) {
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  return (
    <main className="mx-auto max-w-2xl space-y-3 p-4">
      <section className="rounded-xl bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold text-slate-500">Conta</p>
        <p className="font-black text-slate-900">{userLabel}</p>
        <p className="mt-2 text-xs font-semibold text-slate-500">Obra</p>
        <p className="font-bold text-slate-900">{projectLabel}</p>
      </section>
      <section className="space-y-1 rounded-xl bg-white p-4 text-sm text-slate-700 shadow-sm">
        <p className="font-black uppercase text-slate-900">Neste aparelho</p>
        <p>Registros aguardando envio: <strong>{pendingCount}</strong></p>
        <p>De outras contas: <strong>{foreignPending}</strong></p>
        <p className="text-xs text-slate-500">Os registros são guardados no navegador do aparelho, separados por conta. Sair da conta NÃO apaga registros ainda não enviados.</p>
      </section>
      {foreignPending > 0 ? (
        <button type="button" onClick={onPurge} className="min-h-11 w-full rounded-lg border-2 border-red-700 bg-white px-3 text-sm font-black uppercase text-red-700">
          Remover registros de outras contas
        </button>
      ) : null}
      {!offlineShell ? (
        confirmSignOut ? (
          <div className="space-y-2 rounded-xl border-2 border-amber-400 bg-amber-50 p-3">
            <p className="text-sm font-bold text-amber-900">
              {pendingCount > 0 ? `Há ${pendingCount} registro(s) ainda não enviados. Eles continuam no aparelho e serão enviados quando você entrar de novo com esta conta.` : "Sair e apagar da tela o contexto da obra guardado neste aparelho?"}
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => void onSignOut()} className="min-h-11 flex-1 rounded-lg bg-[#7f1d1d] px-3 text-sm font-black uppercase text-white">Sair</button>
              <button type="button" onClick={() => setConfirmSignOut(false)} className="min-h-11 flex-1 rounded-lg border-2 border-slate-300 bg-white px-3 text-sm font-black uppercase text-slate-700">Cancelar</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmSignOut(true)} className="min-h-12 w-full rounded-lg bg-slate-800 px-3 font-black uppercase text-white">Sair da conta</button>
        )
      ) : (
        <p className="text-xs text-slate-500">Sem conexão: para trocar de conta, abra o app com internet.</p>
      )}
    </main>
  );
}
