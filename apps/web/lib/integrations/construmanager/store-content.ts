// Armazenamento deduplicado do conteúdo do Construmanager.
//
// Separação de poderes deliberada:
//
//   - AUTORIZAÇÃO e estado: sempre pelo client de sessão do usuário,
//     chamando as RPCs SECURITY DEFINER que exigem ADMINISTRADOR.
//     Nunca service-role. É o mesmo padrão do Pacote B.
//
//   - ESCRITA FÍSICA no bucket: service-role, porque o bucket
//     construmanager-content é content-addressed e não tem policy
//     alguma para authenticated. Um path derivado do sha256 não
//     carrega "o projeto dono" — o mesmo objeto físico pode servir a
//     vários projetos —, então não existe policy de storage.objects
//     capaz de expressar a permissão correta. Ela é avaliada aqui,
//     server-side, antes de qualquer byte ser escrito.
//
// Ordem da deduplicação: o SHA-256 é calculado ANTES do upload e o
// blob é consultado ANTES do upload. Conteúdo já conhecido não é
// enviado de novo — a deduplicação evita a escrita, em vez de
// desfazê-la depois.

import { openAsBlob } from "node:fs";

import type { ConstrumanagerClient } from "./client";
import {
  buildContentStoragePath,
  downloadConstrumanagerContent,
  type ConstrumanagerDownloadTarget,
  type DownloadContentOptions,
} from "./download-content";
import { sanitizeConstrumanagerContentError } from "./sanitize-error";

export const CONSTRUMANAGER_CONTENT_BUCKET = "construmanager-content";

/** Contrato mínimo do client de sessão, para manter isto testável. */
export interface RpcCapableClient {
  rpc(
    fn: string,
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export interface ContentLinkTarget extends ConstrumanagerDownloadTarget {
  linkId: string;
}

/**
 * Escrita física no bucket.
 *
 * Injetável por dois motivos: o client service-role importa
 * "server-only" (que estoura fora do runtime do Next, inviabilizando
 * teste em Node puro) e, principalmente, porque a deduplicação e a
 * idempotência precisam ser testadas de verdade, sem depender de um
 * Storage remoto. O padrão continua sendo o service-role real.
 */
export type ContentUploader = (input: {
  bucket: string;
  path: string;
  body: Blob;
  contentType: string;
}) => Promise<void>;

async function uploadWithServiceRole(input: {
  bucket: string;
  path: string;
  body: Blob;
  contentType: string;
}): Promise<void> {
  // Import dinâmico: mantém "server-only" fora do grafo de módulos de
  // quem só quer a lógica de deduplicação.
  const { createSupabaseAdminClient } = await import("@axion/db/admin");

  const admin = createSupabaseAdminClient();

  const { error } = await admin.storage
    .from(input.bucket)
    .upload(input.path, input.body, {
      contentType: input.contentType,
      // Path é derivado do sha256: reescrever o mesmo caminho só pode
      // significar os mesmos bytes. Torna a corrida entre dois
      // downloads simultâneos inofensiva.
      upsert: true,
    });

  if (error) {
    throw new Error(`Falha ao armazenar o conteúdo: ${error.message}`);
  }
}

export interface StoreContentResult {
  linkId: string;
  objectId: number;
  status: "ARMAZENADO" | "ERRO";
  sha256: string | null;
  sizeBytes: number | null;
  blobReused: boolean | null;
  uploadSkipped: boolean;
  zipEntryPath: string | null;
  error: string | null;
}

function firstRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) {
    return (data[0] as Record<string, unknown>) ?? null;
  }
  if (data && typeof data === "object") {
    return data as Record<string, unknown>;
  }
  return null;
}

async function callRpc(
  supabase: RpcCapableClient,
  fn: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

export async function storeConstrumanagerContent(
  supabase: RpcCapableClient,
  projectId: string,
  target: ContentLinkTarget,
  client: ConstrumanagerClient,
  accessToken: string,
  companyId: number,
  workId: number,
  options: DownloadContentOptions & { uploader?: ContentUploader } = {}
): Promise<StoreContentResult> {
  const uploadContent = options.uploader ?? uploadWithServiceRole;

  await callRpc(supabase, "begin_construmanager_content_download", {
    p_project_id: projectId,
    p_link_id: target.linkId,
  });

  let cleanup: (() => Promise<void>) | null = null;

  try {
    const content = await downloadConstrumanagerContent(
      client,
      accessToken,
      companyId,
      workId,
      target,
      options
    );

    cleanup = content.cleanup;

    const storagePath = buildContentStoragePath(content.sha256);

    // 1) O conteúdo já existe? Então o Storage nem é tocado.
    const existing = firstRow(
      await callRpc(supabase, "find_construmanager_content_blob", {
        p_project_id: projectId,
        p_sha256: content.sha256,
      })
    );

    let uploadSkipped = false;

    if (existing) {
      uploadSkipped = true;
    } else {
      // 2) Upload físico. openAsBlob dá um Blob preguiçoso apoiado no
      //    arquivo: o conteúdo NÃO é carregado inteiro em memória e o
      //    Content-Length sai correto.
      const contentType = content.mimeType ?? "application/octet-stream";

      const body = await openAsBlob(content.contentPath, { type: contentType });

      await uploadContent({
        bucket: CONSTRUMANAGER_CONTENT_BUCKET,
        path: storagePath,
        body,
        contentType,
      });
    }

    // 3) Blob + vínculo numa transação. ON CONFLICT (sha256) resolve a
    //    corrida remanescente.
    const completion = firstRow(
      await callRpc(supabase, "complete_construmanager_content_download", {
        p_project_id: projectId,
        p_link_id: target.linkId,
        p_sha256: content.sha256,
        p_size_bytes: content.sizeBytes,
        p_storage_bucket: CONSTRUMANAGER_CONTENT_BUCKET,
        p_storage_path: storagePath,
        p_mime_type: content.mimeType,
        p_detected_extension: content.detectedExtension,
        p_zip_entry_path: content.zipEntryPath,
      })
    );

    return {
      linkId: target.linkId,
      objectId: target.objectId,
      status: "ARMAZENADO",
      sha256: content.sha256,
      sizeBytes: content.sizeBytes,
      blobReused: Boolean(completion?.blob_reused),
      uploadSkipped,
      zipEntryPath: content.zipEntryPath,
      error: null,
    };
  } catch (error) {
    // Cobre credencial, token, stack trace de SQL Server e ainda o
    // caminho do arquivo temporário local.
    const message = sanitizeConstrumanagerContentError(error);

    await callRpc(supabase, "fail_construmanager_content_download", {
      p_project_id: projectId,
      p_link_id: target.linkId,
      p_error: message,
    }).catch(() => undefined);

    return {
      linkId: target.linkId,
      objectId: target.objectId,
      status: "ERRO",
      sha256: null,
      sizeBytes: null,
      blobReused: null,
      uploadSkipped: false,
      zipEntryPath: null,
      error: message,
    };
  } finally {
    // Temporário some em sucesso e em erro.
    if (cleanup) await cleanup().catch(() => undefined);
  }
}
