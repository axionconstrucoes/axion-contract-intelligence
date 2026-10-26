// Adaptador IndexedDB da fila offline (browser). Sem imports de runtime: o mesmo arquivo é
// transpilado e exercitado em um Chrome real nos testes (scripts/test-ssma-offline-browser.mjs).
//
// Esquema (banco "acc-ssma-offline", versão 1):
//   records — itens da fila (chave: clientId; índice por userId)
//   blobs   — fotos (chave "clientId:photoId")
//   meta    — contexto por usuário (chave "context:{userId}") e o último usuário ("lastUser")
//
// Dados de uma conta nunca são lidos por outra: a fila filtra por userId e o contexto é chaveado
// por usuário. O adaptador NÃO guarda tokens nem senhas.

import type { QueueStore } from "./queue-core";
import type { QueuedRecord } from "./types";

const DB_NAME = "acc-ssma-offline";
const DB_VERSION = 1;

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Falha no IndexedDB."));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("Transação do IndexedDB abortada."));
    tx.onerror = () => reject(tx.error ?? new Error("Falha no IndexedDB."));
  });
}

export function openOfflineDb(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const records = db.createObjectStore("records", { keyPath: "clientId" });
      records.createIndex("userId", "userId", { unique: false });
      db.createObjectStore("blobs");
      db.createObjectStore("meta");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Não foi possível abrir o armazenamento do aparelho."));
    request.onblocked = () => reject(new Error("Armazenamento do aparelho bloqueado por outra aba."));
  });
}

export interface OfflineMetaStore {
  putMeta(key: string, value: unknown): Promise<void>;
  getMeta<T>(key: string): Promise<T | null>;
  deleteMeta(key: string): Promise<void>;
}

export function createIdbStore(db: IDBDatabase): QueueStore & OfflineMetaStore {
  return {
    async put(item) {
      const tx = db.transaction("records", "readwrite");
      tx.objectStore("records").put(item);
      await transactionDone(tx);
    },
    async get(clientId) {
      const tx = db.transaction("records", "readonly");
      return ((await requestToPromise(tx.objectStore("records").get(clientId))) as QueuedRecord | undefined) ?? null;
    },
    async list() {
      const tx = db.transaction("records", "readonly");
      return (await requestToPromise(tx.objectStore("records").getAll())) as QueuedRecord[];
    },
    async delete(clientId) {
      const tx = db.transaction("records", "readwrite");
      tx.objectStore("records").delete(clientId);
      await transactionDone(tx);
    },
    async putBlob(key, blob) {
      const tx = db.transaction("blobs", "readwrite");
      tx.objectStore("blobs").put(blob, key);
      await transactionDone(tx);
    },
    async getBlob(key) {
      const tx = db.transaction("blobs", "readonly");
      return ((await requestToPromise(tx.objectStore("blobs").get(key))) as Blob | undefined) ?? null;
    },
    async deleteBlob(key) {
      const tx = db.transaction("blobs", "readwrite");
      tx.objectStore("blobs").delete(key);
      await transactionDone(tx);
    },
    async putMeta(key, value) {
      const tx = db.transaction("meta", "readwrite");
      tx.objectStore("meta").put(value, key);
      await transactionDone(tx);
    },
    async getMeta<T>(key: string) {
      const tx = db.transaction("meta", "readonly");
      return ((await requestToPromise(tx.objectStore("meta").get(key))) as T | undefined) ?? null;
    },
    async deleteMeta(key) {
      const tx = db.transaction("meta", "readwrite");
      tx.objectStore("meta").delete(key);
      await transactionDone(tx);
    },
  };
}

/** Contexto mínimo guardado no aparelho para abrir o formulário sem rede (por usuário). */
export interface OfflineContext {
  userId: string;
  userLabel: string;
  projects: Array<{
    id: string;
    label: string;
    /** Só para ajustar a tela; a permissão real é sempre imposta pelo servidor. */
    canManage: boolean;
    /** Membros ativos da obra — só id e nome, para escolher o responsável. */
    members: Array<{ userId: string; name: string }>;
  }>;
  savedAt: string;
}

export const contextKey = (userId: string) => `context:${userId}`;
export const LAST_USER_KEY = "lastUser";
export const lastProjectKey = (userId: string) => `lastProject:${userId}`;
