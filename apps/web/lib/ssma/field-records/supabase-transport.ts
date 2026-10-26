// Transporte da fila offline sobre o cliente Supabase do NAVEGADOR (somente a sessão do usuário —
// nenhuma chave de serviço; a autorização é imposta pelas RPCs/RLS). Ver queue-core.ts.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeFileName } from "@/lib/documents/multi-upload/queue-core";
import { TransportError, type SyncTransport } from "./queue-core";
import { extractServerErrorCode, type QueuedPhoto, type QueuedRecord } from "./types";

const NETWORK_PATTERN = /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|offline/i;

function isNetworkFailure(error: { message?: string; code?: string; status?: number } | null | undefined): boolean {
  if (!error) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return NETWORK_PATTERN.test(error.message ?? "") && !error.code;
}

function toTransportError(error: { message?: string; code?: string; status?: number }): TransportError {
  if (isNetworkFailure(error)) return new TransportError("NETWORK", "Sem conexão.");
  return new TransportError("SERVER", "Recusado pelo servidor.", extractServerErrorCode(error.message));
}

export function photoStoragePath(item: Pick<QueuedRecord, "projectId" | "clientId">, photo: Pick<QueuedPhoto, "id" | "name">): string {
  return `${item.projectId}/ssma-registros/${item.clientId}/${photo.id}-${sanitizeFileName(photo.name)}`;
}

export function createSupabaseTransport(supabase: SupabaseClient): SyncTransport {
  return {
    async currentUserId() {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) {
          if (isNetworkFailure(error)) throw new TransportError("NETWORK", "Sem conexão.");
          return null;
        }
        return data.user?.id ?? null;
      } catch (error) {
        if (error instanceof TransportError) throw error;
        throw new TransportError("NETWORK", "Sem conexão.");
      }
    },

    async submitRecord(item) {
      const { error } = await supabase.rpc("ssma_field_record_submit", {
        p_claimed_user_id: item.userId,
        p_id: item.clientId,
        p_project_id: item.projectId,
        p_kind: item.draft.kind,
        p_category: item.draft.category,
        p_description: item.draft.description,
        p_location: item.draft.location,
        p_occurred_at: item.draft.occurredAt,
        p_client_created_at: item.clientCreatedAt,
        p_risk_level: item.draft.risk,
        p_responsible_user_id: item.draft.responsibleUserId,
        p_due_date: item.draft.dueDate,
      });
      if (error) throw toTransportError(error);
    },

    async uploadPhoto(item, photo, blob) {
      const { error } = await supabase.storage.from("project-documents").upload(photoStoragePath(item, photo), blob, {
        upsert: false,
        contentType: photo.mimeType,
      });
      if (!error) return;
      // Reenvio depois de uma queda: o arquivo já está lá — idempotente.
      const status = (error as { statusCode?: string | number }).statusCode;
      if (String(status) === "409" || /already exists|duplicate/i.test(error.message)) return;
      throw toTransportError(error);
    },

    async registerPhoto(item, photo) {
      const { error } = await supabase.rpc("ssma_field_record_register_photo", {
        p_claimed_user_id: item.userId,
        p_photo_id: photo.id,
        p_record_id: item.clientId,
        p_purpose: photo.purpose,
        p_storage_path: photoStoragePath(item, photo),
        p_original_file_name: photo.name,
        p_mime_type: photo.mimeType,
        p_file_size_bytes: photo.size,
        p_sha256_hash: photo.sha256,
      });
      if (error) throw toTransportError(error);
    },
  };
}

/** Evidência de ação corretiva enviada ONLINE (conclusão exige conexão): Storage + registro da foto. */
export async function uploadActionEvidencePhoto(
  supabase: SupabaseClient,
  input: { userId: string; projectId: string; recordId: string; file: File; sha256: string }
): Promise<string> {
  const photoId = crypto.randomUUID();
  const item = { projectId: input.projectId, clientId: input.recordId };
  const path = photoStoragePath(item, { id: photoId, name: input.file.name });
  const { error: uploadError } = await supabase.storage.from("project-documents").upload(path, input.file, { upsert: false, contentType: input.file.type });
  if (uploadError) throw toTransportError(uploadError);
  const { error } = await supabase.rpc("ssma_field_record_register_photo", {
    p_claimed_user_id: input.userId,
    p_photo_id: photoId,
    p_record_id: input.recordId,
    p_purpose: "EVIDENCIA_ACAO",
    p_storage_path: path,
    p_original_file_name: input.file.name,
    p_mime_type: input.file.type,
    p_file_size_bytes: input.file.size,
    p_sha256_hash: input.sha256,
  });
  if (error) throw toTransportError(error);
  return photoId;
}
