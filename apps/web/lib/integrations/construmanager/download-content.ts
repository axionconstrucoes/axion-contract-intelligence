// Orquestração do download de conteúdo real do Construmanager.
//
// Server-side apenas. Nada aqui é importado por Client Component: o
// token vive só dentro de client.downloadObject() e nunca é devolvido,
// logado ou persistido.
//
// Sequência, toda em streaming:
//
//   Objeto/Download  ->  arquivo temporário (.zip)
//                    ->  diretório central lido por acesso aleatório
//                    ->  UMA entrada escolhida sem ambiguidade
//                    ->  inflate  ->  sha256 + arquivo temporário
//
// O ZIP é entrada não confiável: nenhum caminho vindo dele é usado
// para escrever em disco. Os dois arquivos temporários têm nome fixo
// dentro de um diretório criado por mkdtemp — o nome externo só serve
// para casar a entrada certa e para diagnóstico.
//
// O diretório temporário é removido em sucesso E em erro.

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FileHandle } from "node:fs/promises";

import type { ConstrumanagerClient } from "./client";
import { buildObjectDownloadBody } from "./client";
import {
  DEFAULT_ZIP_LIMITS,
  extractZipEntry,
  readZipDirectory,
  selectZipEntry,
  ZipSecurityError,
  type RandomAccessReader,
  type ZipLimits,
} from "./zip-reader";

export interface ConstrumanagerDownloadTarget {
  /** cad_objects_id do cabeça OU da versão. Identidade do Pacote B. */
  objectId: number;
  /** Nome esperado, vindo do metadado do Pacote B. */
  name: string;
  extensionNormalized: string | null;
}

export interface ConstrumanagerDownloadedContent {
  sha256: string;
  sizeBytes: number;
  archiveBytes: number;
  zipEntryPath: string;
  matchedBy: string;
  detectedExtension: string | null;
  mimeType: string | null;
  crcVerified: boolean;
  /** Caminho local do conteúdo extraído, válido até cleanup(). */
  contentPath: string;
  /** Remove o diretório temporário. Idempotente. */
  cleanup: () => Promise<void>;
}

const ARCHIVE_FILE_NAME = "pacote.zip";
const CONTENT_FILE_NAME = "conteudo.bin";

// Mapa mínimo e conservador. Só cobre o que a obra real tem; qualquer
// coisa fora dele fica sem mime_type em vez de receber um palpite.
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  zip: "application/zip",
  dwg: "image/vnd.dwg",
  ifc: "application/x-step",
};

export function resolveMimeType(extension: string | null): string | null {
  if (!extension) return null;
  return MIME_BY_EXTENSION[extension.replace(/^\./, "").toLowerCase()] ?? null;
}

export function createFileHandleReader(
  handle: FileHandle,
  byteLength: number
): RandomAccessReader {
  return {
    byteLength,
    async read(target, targetOffset, length, position) {
      const { bytesRead } = await handle.read(
        target,
        targetOffset,
        length,
        position
      );
      return bytesRead;
    },
  };
}

export interface DownloadContentOptions {
  zipLimits?: ZipLimits;
  timeoutMs?: number;
}

export async function downloadConstrumanagerContent(
  client: ConstrumanagerClient,
  accessToken: string,
  companyId: number,
  workId: number,
  target: ConstrumanagerDownloadTarget,
  options: DownloadContentOptions = {}
): Promise<ConstrumanagerDownloadedContent> {
  const limits = options.zipLimits ?? DEFAULT_ZIP_LIMITS;

  const workDir = await mkdtemp(path.join(tmpdir(), "acc-construmanager-"));
  const archivePath = path.join(workDir, ARCHIVE_FILE_NAME);
  const contentPath = path.join(workDir, CONTENT_FILE_NAME);

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await rm(workDir, { recursive: true, force: true });
  };

  let handle: FileHandle | null = null;

  try {
    // 1) ZIP direto para disco. O corpo da resposta nunca é
    //    materializado inteiro em memória.
    const archiveStream = createWriteStream(archivePath);

    let downloadError: unknown = null;

    try {
      const outcome = await client.downloadObject(
        accessToken,
        companyId,
        workId,
        target.objectId,
        buildObjectDownloadBody(workId, target.objectId),
        async (chunk) => {
          if (!archiveStream.write(chunk)) {
            await new Promise<void>((resolve, reject) => {
              archiveStream.once("drain", resolve);
              archiveStream.once("error", reject);
            });
          }
        },
        {
          maxBytes: limits.maxArchiveBytes,
          timeoutMs: options.timeoutMs,
        }
      );

      void outcome;
    } catch (error) {
      downloadError = error;
    } finally {
      await new Promise<void>((resolve) => {
        archiveStream.end(() => resolve());
      });
    }

    if (downloadError) throw downloadError;

    const archiveStat = await stat(archivePath);

    // 2) Diretório central por acesso aleatório — não relê o arquivo
    //    inteiro para descobrir o que há dentro.
    handle = await open(archivePath, "r");
    const reader = createFileHandleReader(handle, archiveStat.size);

    const entries = await readZipDirectory(reader, limits);

    // 3) Escolha da entrada. Ambiguidade vira erro, nunca palpite.
    const selection = selectZipEntry(entries, {
      name: target.name,
      extensionNormalized: target.extensionNormalized,
    });

    if (!selection.entry) {
      throw new ZipSecurityError(
        "ZIP_ENTRADA_NAO_RESOLVIDA",
        selection.error ?? "Não foi possível identificar o arquivo esperado no pacote."
      );
    }

    const entry = selection.entry;

    // 4) Inflate em streaming, com hash e gravação simultâneos.
    //    O SHA-256 é dos bytes REAIS do arquivo, nunca do ZIP.
    const hash = createHash("sha256");
    const contentStream = createWriteStream(contentPath);

    let writeError: unknown = null;

    try {
      const extraction = await extractZipEntry(
        reader,
        entry,
        async (chunk) => {
          hash.update(chunk);
          if (!contentStream.write(chunk)) {
            await new Promise<void>((resolve, reject) => {
              contentStream.once("drain", resolve);
              contentStream.once("error", reject);
            });
          }
        },
        limits
      );

      await new Promise<void>((resolve, reject) => {
        contentStream.end((error?: Error | null) =>
          error ? reject(error) : resolve()
        );
      });

      const detectedExtension =
        (entry.baseName.includes(".")
          ? entry.baseName.split(".").pop()?.toLowerCase()
          : null) ?? null;

      return {
        sha256: hash.digest("hex"),
        sizeBytes: extraction.bytesWritten,
        archiveBytes: archiveStat.size,
        zipEntryPath: entry.name,
        matchedBy: selection.matchedBy ?? "DESCONHECIDO",
        detectedExtension,
        mimeType: resolveMimeType(detectedExtension),
        crcVerified: extraction.crcVerified,
        contentPath,
        cleanup,
      };
    } catch (error) {
      writeError = error;
      throw error;
    } finally {
      if (writeError) {
        await new Promise<void>((resolve) => {
          contentStream.destroy();
          resolve();
        });
      }
    }
  } catch (error) {
    // Falhou em qualquer ponto: nada de temporário fica para trás.
    await cleanup();
    throw error;
  } finally {
    if (handle) {
      await handle.close().catch(() => undefined);
    }
  }
}

/**
 * Path físico content-addressed.
 *
 * Deliberadamente independente do nome do arquivo: dois documentos com
 * nomes diferentes e bytes iguais compartilham o mesmo objeto físico, e
 * nenhum nome externo vira caminho de Storage. Os dois níveis de
 * prefixo evitam um diretório único com centenas de milhares de
 * entradas.
 */
export function buildContentStoragePath(sha256: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error("SHA-256 inválido para montar o caminho de Storage.");
  }

  return `sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
}
