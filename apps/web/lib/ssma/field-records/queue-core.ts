// Fila offline dos registros de campo SSMA. Módulo PURO e testável: nenhuma dependência de
// IndexedDB, rede ou React — o armazenamento (QueueStore) e o transporte (SyncTransport) são
// injetados. Em produção: idb-store.ts + supabase-transport.ts. Nos testes: memória + transporte falso.
//
// Garantias:
//  - cada registro/foto nasce com UUID gerado no aparelho; reenviar nunca duplica (o servidor é
//    idempotente por id) e o progresso por passo é persistido, então uma queda no meio retoma;
//  - isolamento: a fila só lista/envia itens do usuário informado, e o envio só ocorre se a sessão
//    ATUAL for desse usuário (troca de conta no mesmo aparelho não envia nada pela conta errada);
//  - horário e autoria reais da criação são guardados no item e enviados como estão;
//  - falha de rede NÃO é falha de envio: o item continua "Salvo no aparelho".

import {
  ACCEPTED_PHOTO_MIME_TYPES,
  MAX_PHOTOS_PER_RECORD,
  MAX_PHOTO_SIZE_BYTES,
  PERMANENT_ERROR_CODES,
  messageForServerError,
  validateFieldRecordDraft,
  type FieldRecordDraft,
  type PhotoPurpose,
  type QueuedPhoto,
  type QueuedRecord,
} from "./types";

export interface QueueStore {
  put(item: QueuedRecord): Promise<void>;
  get(clientId: string): Promise<QueuedRecord | null>;
  list(): Promise<QueuedRecord[]>;
  delete(clientId: string): Promise<void>;
  putBlob(key: string, blob: Blob): Promise<void>;
  getBlob(key: string): Promise<Blob | null>;
  deleteBlob(key: string): Promise<void>;
}

/** Erro de transporte: NETWORK = sem conexão (não é falha); SERVER = recusa do servidor com código. */
export class TransportError extends Error {
  readonly kind: "NETWORK" | "SERVER";
  readonly code: string | null;

  constructor(kind: "NETWORK" | "SERVER", message: string, code: string | null = null) {
    super(message);
    this.name = "TransportError";
    this.kind = kind;
    this.code = code;
  }
}

export interface SyncTransport {
  /** Usuário da sessão atual do servidor (null sem sessão). Lança TransportError NETWORK se offline. */
  currentUserId(): Promise<string | null>;
  submitRecord(item: QueuedRecord): Promise<void>;
  /** Idempotente: arquivo já existente no caminho conta como sucesso. */
  uploadPhoto(item: QueuedRecord, photo: QueuedPhoto, blob: Blob): Promise<void>;
  registerPhoto(item: QueuedRecord, photo: QueuedPhoto): Promise<void>;
}

export interface QueueDeps {
  store: QueueStore;
  transport: SyncTransport;
  now?: () => Date;
  newId?: () => string;
  hashBlob: (blob: Blob) => Promise<string>;
  /** Exclusão mútua entre abas (Web Locks no navegador). Padrão: só nesta instância. */
  withLock?: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
}

export interface NewPhotoInput {
  name: string;
  mimeType: string;
  blob: Blob;
  purpose?: PhotoPurpose;
}

export type SyncReport =
  | { outcome: "BLOCKED_USER_MISMATCH" | "BLOCKED_NO_SESSION" | "OFFLINE" | "BUSY"; synced: 0; failed: 0; remaining: number }
  | { outcome: "DONE"; synced: number; failed: number; remaining: number };

const blobKey = (clientId: string, photoId: string) => `${clientId}:${photoId}`;

export function createFieldQueue(deps: QueueDeps) {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const withLock = deps.withLock ?? (async <T,>(_name: string, fn: () => Promise<T>) => fn());
  let running = false;

  async function save(input: {
    userId: string;
    projectId: string;
    draft: FieldRecordDraft;
    photos: NewPhotoInput[];
  }): Promise<QueuedRecord> {
    const validation = validateFieldRecordDraft(input.draft, now());
    if (!validation.ok) throw new Error(validation.errors.join(" "));
    if (input.photos.length > MAX_PHOTOS_PER_RECORD) throw new Error(`Selecione no máximo ${MAX_PHOTOS_PER_RECORD} fotos.`);
    for (const photo of input.photos) {
      if (!ACCEPTED_PHOTO_MIME_TYPES.includes(photo.mimeType)) throw new Error(`Formato não permitido em “${photo.name}”. Use JPG ou PNG.`);
      if (photo.blob.size > MAX_PHOTO_SIZE_BYTES) throw new Error(`“${photo.name}” ultrapassa o limite de 15 MB.`);
      if (photo.blob.size === 0) throw new Error(`“${photo.name}” está vazia.`);
    }

    const clientId = newId();
    const photos: QueuedPhoto[] = [];
    const seen = new Set<string>();
    // Blobs primeiro, item por último: um item só existe se todos os seus arquivos foram gravados.
    try {
      for (const input_photo of input.photos) {
        const sha256 = await deps.hashBlob(input_photo.blob);
        if (seen.has(sha256)) continue; // mesma foto duas vezes no mesmo registro
        seen.add(sha256);
        const id = newId();
        await deps.store.putBlob(blobKey(clientId, id), input_photo.blob);
        photos.push({
          id,
          name: input_photo.name,
          mimeType: input_photo.mimeType,
          size: input_photo.blob.size,
          sha256,
          purpose: input_photo.purpose ?? "REGISTRO",
          uploaded: false,
          registered: false,
        });
      }
      const item: QueuedRecord = {
        clientId,
        userId: input.userId,
        projectId: input.projectId,
        draft: { ...input.draft },
        clientCreatedAt: now().toISOString(),
        photos,
        recordSubmitted: false,
        status: "SAVED_ON_DEVICE",
        attempts: 0,
        lastError: null,
        permanentError: false,
        lastAttemptAt: null,
        syncedAt: null,
      };
      await deps.store.put(item);
      return item;
    } catch (error) {
      for (const photo of photos) await deps.store.deleteBlob(blobKey(clientId, photo.id)).catch(() => undefined);
      throw new Error(
        error instanceof Error && /quota/i.test(error.message)
          ? "Sem espaço no aparelho para guardar este registro e suas fotos."
          : "Não foi possível guardar o registro no aparelho."
      );
    }
  }

  async function listForUser(userId: string, projectId?: string): Promise<QueuedRecord[]> {
    const all = await deps.store.list();
    return all
      .filter((item) => item.userId === userId && (!projectId || item.projectId === projectId))
      .sort((a, b) => b.clientCreatedAt.localeCompare(a.clientCreatedAt));
  }

  /** Itens ainda não sincronizados que pertencem a OUTRA conta (só a contagem — nunca o conteúdo). */
  async function foreignPendingCount(userId: string): Promise<number> {
    return (await deps.store.list()).filter((item) => item.userId !== userId && item.status !== "SYNCED").length;
  }

  /** Itens interrompidos no meio de um envio (aba fechada) voltam a "Salvo no aparelho". */
  async function recoverInterrupted(userId: string): Promise<number> {
    let count = 0;
    for (const item of await listForUser(userId)) {
      if (item.status === "WAITING_SEND") {
        await deps.store.put({ ...item, status: "SAVED_ON_DEVICE" });
        count += 1;
      }
    }
    return count;
  }

  async function persist(item: QueuedRecord): Promise<void> {
    await deps.store.put(item);
  }

  async function syncOne(original: QueuedRecord): Promise<"SYNCED" | "FAILED" | "OFFLINE"> {
    let item: QueuedRecord = {
      ...original,
      status: "WAITING_SEND",
      attempts: original.attempts + 1,
      lastAttemptAt: now().toISOString(),
      lastError: null,
      permanentError: false,
    };
    await persist(item);

    try {
      if (!item.recordSubmitted) {
        await deps.transport.submitRecord(item);
        item = { ...item, recordSubmitted: true };
        await persist(item);
      }
      for (const photo of item.photos) {
        if (!photo.uploaded) {
          const blob = await deps.store.getBlob(blobKey(item.clientId, photo.id));
          if (!blob) throw new TransportError("SERVER", "Arquivo da foto não está mais no aparelho.", "LOCAL_BLOB_MISSING");
          await deps.transport.uploadPhoto(item, photo, blob);
          item = { ...item, photos: item.photos.map((p) => (p.id === photo.id ? { ...p, uploaded: true } : p)) };
          await persist(item);
        }
        const current = item.photos.find((p) => p.id === photo.id) as QueuedPhoto;
        if (!current.registered) {
          await deps.transport.registerPhoto(item, current);
          item = { ...item, photos: item.photos.map((p) => (p.id === photo.id ? { ...p, registered: true } : p)) };
          await persist(item);
        }
      }
      item = { ...item, status: "SYNCED", syncedAt: now().toISOString(), lastError: null };
      await persist(item);
      // Arquivos locais só saem do aparelho depois de TUDO registrado no servidor.
      for (const photo of item.photos) await deps.store.deleteBlob(blobKey(item.clientId, photo.id)).catch(() => undefined);
      return "SYNCED";
    } catch (error) {
      if (error instanceof TransportError && error.kind === "NETWORK") {
        await persist({ ...item, status: "SAVED_ON_DEVICE", attempts: original.attempts, lastError: null });
        return "OFFLINE";
      }
      const code = error instanceof TransportError ? error.code : null;
      await persist({
        ...item,
        status: "FAILED",
        lastError: code === "LOCAL_BLOB_MISSING" ? "Arquivo da foto não está mais no aparelho. Descarte o registro e refaça." : messageForServerError(code),
        permanentError: code === "LOCAL_BLOB_MISSING" || (code !== null && PERMANENT_ERROR_CODES.includes(code)),
      });
      return "FAILED";
    }
  }

  /**
   * Envia os itens pendentes de `userId`. `retryPermanent` reenvia também os que falharam de forma
   * permanente (ação manual do usuário). Nunca roda duas vezes ao mesmo tempo.
   */
  async function sync(userId: string, options: { retryPermanent?: boolean } = {}): Promise<SyncReport> {
    const remainingOf = async () => (await listForUser(userId)).filter((item) => item.status !== "SYNCED").length;
    if (running) return { outcome: "BUSY", synced: 0, failed: 0, remaining: await remainingOf() };
    running = true;
    try {
      return await withLock("acc-ssma-queue-sync", async () => {
        let sessionUser: string | null;
        try {
          sessionUser = await deps.transport.currentUserId();
        } catch (error) {
          if (error instanceof TransportError && error.kind === "NETWORK") return { outcome: "OFFLINE", synced: 0, failed: 0, remaining: await remainingOf() } as SyncReport;
          throw error;
        }
        if (!sessionUser) return { outcome: "BLOCKED_NO_SESSION", synced: 0, failed: 0, remaining: await remainingOf() } as SyncReport;
        if (sessionUser !== userId) return { outcome: "BLOCKED_USER_MISMATCH", synced: 0, failed: 0, remaining: await remainingOf() } as SyncReport;

        let synced = 0;
        let failed = 0;
        const candidates = (await listForUser(userId))
          .filter((item) => item.status !== "SYNCED" && (options.retryPermanent || !item.permanentError))
          .sort((a, b) => a.clientCreatedAt.localeCompare(b.clientCreatedAt));
        for (const item of candidates) {
          // Revalida a sessão a cada item: a conta pode ter mudado durante o envio.
          const result = await syncOne(item);
          if (result === "OFFLINE") return { outcome: "OFFLINE", synced, failed, remaining: await remainingOf() } as SyncReport;
          if (result === "SYNCED") synced += 1;
          else failed += 1;
        }
        return { outcome: "DONE", synced, failed, remaining: await remainingOf() } as SyncReport;
      });
    } finally {
      running = false;
    }
  }

  /** Descarta um item do usuário (e seus arquivos). Itens já sincronizados só perdem a cópia local. */
  async function discard(userId: string, clientId: string): Promise<boolean> {
    const item = await deps.store.get(clientId);
    if (!item || item.userId !== userId) return false;
    for (const photo of item.photos) await deps.store.deleteBlob(blobKey(item.clientId, photo.id)).catch(() => undefined);
    await deps.store.delete(clientId);
    return true;
  }

  /** Remove do aparelho os itens de outras contas (ação explícita e confirmada pelo usuário atual). */
  async function purgeForeign(userId: string): Promise<number> {
    let count = 0;
    for (const item of await deps.store.list()) {
      if (item.userId === userId) continue;
      for (const photo of item.photos) await deps.store.deleteBlob(blobKey(item.clientId, photo.id)).catch(() => undefined);
      await deps.store.delete(item.clientId);
      count += 1;
    }
    return count;
  }

  return { save, listForUser, foreignPendingCount, recoverInterrupted, sync, discard, purgeForeign };
}

export type FieldQueue = ReturnType<typeof createFieldQueue>;
