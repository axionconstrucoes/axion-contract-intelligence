// Leitor de ZIP com acesso aleatório, streaming e limites explícitos.
//
// Por que não usar uma biblioteca pronta:
//
//   - jszip (única declarada em apps/web) carrega o arquivo INTEIRO em
//     memória. A obra piloto tem um .ifc de ~263 MiB e o requisito é
//     explicitamente "não carregar arquivo grande inteiro em memória";
//   - unzipper e fflate existem em node_modules apenas como
//     dependências transitivas — versão fora do nosso controle;
//   - as proteções obrigatórias (Zip Slip, bomba de compressão,
//     symlink, excesso de entradas) precisam ser aplicadas ANTES e
//     DURANTE a extração, não depois. Um leitor próprio deixa cada
//     uma delas explícita, testável e auditável.
//
// O ZIP recebido do Construmanager é ENTRADA NÃO CONFIÁVEL. Nenhum
// caminho vindo dele é usado para escrever em disco: quem grava
// escolhe o destino (ver download-content.ts), e o nome da entrada
// serve só para casar o objeto esperado e para diagnóstico.
//
// Só as duas compressões do ZIP clássico são aceitas: 0 (store) e 8
// (deflate), esta última via zlib nativo do Node.

import { createInflateRaw, crc32 as zlibCrc32 } from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// ------------------------------------------------------------
// Leitor de acesso aleatório
//
// Abstrai a origem dos bytes para que os testes possam alimentar um
// ZIP em memória sem tocar em disco.
// ------------------------------------------------------------

export interface RandomAccessReader {
  readonly byteLength: number;
  read(
    target: Uint8Array,
    targetOffset: number,
    length: number,
    position: number
  ): Promise<number>;
}

export function createBufferReader(source: Uint8Array): RandomAccessReader {
  return {
    byteLength: source.byteLength,
    async read(target, targetOffset, length, position) {
      if (position < 0 || position > source.byteLength) return 0;
      const available = Math.min(length, source.byteLength - position);
      if (available <= 0) return 0;
      target.set(source.subarray(position, position + available), targetOffset);
      return available;
    },
  };
}

// ------------------------------------------------------------
// Limites
// ------------------------------------------------------------

export interface ZipLimits {
  /** Bytes máximos do próprio ZIP baixado. */
  maxArchiveBytes: number;
  /** Entradas máximas no diretório central. */
  maxEntries: number;
  /** Bytes máximos de UMA entrada descompactada. */
  maxEntryUncompressedBytes: number;
  /**
   * Razão máxima descompactado/compactado. Só é aplicada acima de
   * ratioFloorBytes: arquivos minúsculos têm razão alta por overhead
   * de cabeçalho, não por ataque.
   */
  maxCompressionRatio: number;
  ratioFloorBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  // 2 GiB, alinhado ao file_size_limit do bucket. O maior arquivo
  // real observado tem ~263 MiB — o limite de 50 MB do bucket de
  // documentos não vale aqui.
  maxArchiveBytes: 2 * 1024 * 1024 * 1024,
  maxEntries: 10_000,
  maxEntryUncompressedBytes: 2 * 1024 * 1024 * 1024,
  maxCompressionRatio: 200,
  ratioFloorBytes: 1024 * 1024,
};

export class ZipSecurityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ZipSecurityError";
    this.code = code;
  }
}

// ------------------------------------------------------------
// Validação de nome — a defesa contra Zip Slip
//
// Função pura de propósito: é o ponto mais testável da segurança do
// pacote. Rejeita e NUNCA tenta "consertar" um nome: normalizar
// silenciosamente um `../` é como um atacante consegue o que quer.
// ------------------------------------------------------------

export interface ZipNameVerdict {
  ok: boolean;
  reason?: string;
}

const MAX_ENTRY_NAME_LENGTH = 512;

export function validateZipEntryName(name: string): ZipNameVerdict {
  if (typeof name !== "string" || name.length === 0) {
    return { ok: false, reason: "nome vazio" };
  }

  if (name.length > MAX_ENTRY_NAME_LENGTH) {
    return { ok: false, reason: "nome excessivamente longo" };
  }

  // NUL e caracteres de controle truncam caminho em várias camadas de
  // sistema de arquivos.
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    return { ok: false, reason: "nome contém caractere de controle" };
  }

  // O ZIP só admite "/" como separador. Uma "\" aqui é ou nome
  // inválido ou tentativa de traversal no Windows.
  if (name.includes("\\")) {
    return { ok: false, reason: "nome contém barra invertida" };
  }

  // UNC: \\servidor\share já foi barrado acima; //servidor/share não.
  if (name.startsWith("//")) {
    return { ok: false, reason: "caminho UNC" };
  }

  if (name.startsWith("/")) {
    return { ok: false, reason: "caminho absoluto" };
  }

  // Letra de unidade do Windows (C:, c:/, C:algo).
  if (/^[A-Za-z]:/.test(name)) {
    return { ok: false, reason: "caminho com letra de unidade" };
  }

  const segments = name.split("/");

  for (const segment of segments) {
    if (segment === "..") {
      return { ok: false, reason: "segmento de traversal (..)" };
    }
    if (segment === ".") {
      return { ok: false, reason: "segmento relativo (.)" };
    }
  }

  // Segmento vazio no meio ("a//b") indica caminho malformado.
  if (segments.slice(0, -1).some((segment) => segment.length === 0)) {
    return { ok: false, reason: "segmento vazio no caminho" };
  }

  return { ok: true };
}

// ------------------------------------------------------------
// Entradas
// ------------------------------------------------------------

export interface ZipEntry {
  name: string;
  baseName: string;
  isDirectory: boolean;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  localHeaderOffset: number;
  encrypted: boolean;
  isSymlink: boolean;
}

const SIGNATURE_EOCD = 0x06054b50;
const SIGNATURE_ZIP64_LOCATOR = 0x07064b50;
const SIGNATURE_ZIP64_EOCD = 0x06064b50;
const SIGNATURE_CENTRAL = 0x02014b50;
const SIGNATURE_LOCAL = 0x04034b50;

const ZIP64_SENTINEL_32 = 0xffffffff;
const ZIP64_SENTINEL_16 = 0xffff;

async function readExactly(
  reader: RandomAccessReader,
  position: number,
  length: number
): Promise<Buffer> {
  if (length < 0 || position < 0 || position + length > reader.byteLength) {
    throw new ZipSecurityError(
      "ZIP_TRUNCADO",
      "O pacote terminou antes do esperado."
    );
  }

  const target = Buffer.alloc(length);
  let filled = 0;

  while (filled < length) {
    const read = await reader.read(
      target,
      filled,
      length - filled,
      position + filled
    );
    if (read <= 0) {
      throw new ZipSecurityError(
        "ZIP_TRUNCADO",
        "O pacote terminou antes do esperado."
      );
    }
    filled += read;
  }

  return target;
}

interface EndOfCentralDirectory {
  entryCount: number;
  centralDirectoryOffset: number;
  centralDirectorySize: number;
}

async function findEndOfCentralDirectory(
  reader: RandomAccessReader
): Promise<EndOfCentralDirectory> {
  const maxCommentLength = 0xffff;
  const minEocdLength = 22;
  const scanLength = Math.min(
    reader.byteLength,
    maxCommentLength + minEocdLength
  );

  if (scanLength < minEocdLength) {
    throw new ZipSecurityError(
      "ZIP_INVALIDO",
      "O conteúdo recebido é pequeno demais para ser um pacote ZIP."
    );
  }

  const scanStart = reader.byteLength - scanLength;
  const tail = await readExactly(reader, scanStart, scanLength);

  let eocdOffset = -1;
  for (let i = tail.length - minEocdLength; i >= 0; i -= 1) {
    if (tail.readUInt32LE(i) === SIGNATURE_EOCD) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset < 0) {
    throw new ZipSecurityError(
      "ZIP_INVALIDO",
      "O conteúdo recebido não é um pacote ZIP válido."
    );
  }

  let entryCount = tail.readUInt16LE(eocdOffset + 10);
  let centralDirectorySize = tail.readUInt32LE(eocdOffset + 12);
  let centralDirectoryOffset = tail.readUInt32LE(eocdOffset + 16);

  const needsZip64 =
    entryCount === ZIP64_SENTINEL_16 ||
    centralDirectorySize === ZIP64_SENTINEL_32 ||
    centralDirectoryOffset === ZIP64_SENTINEL_32;

  if (needsZip64) {
    const locatorOffset = eocdOffset - 20;

    if (
      locatorOffset < 0 ||
      tail.readUInt32LE(locatorOffset) !== SIGNATURE_ZIP64_LOCATOR
    ) {
      throw new ZipSecurityError(
        "ZIP_INVALIDO",
        "Pacote declara ZIP64 mas não traz o localizador correspondente."
      );
    }

    const zip64EocdOffset = Number(tail.readBigUInt64LE(locatorOffset + 8));
    const zip64Header = await readExactly(reader, zip64EocdOffset, 56);

    if (zip64Header.readUInt32LE(0) !== SIGNATURE_ZIP64_EOCD) {
      throw new ZipSecurityError(
        "ZIP_INVALIDO",
        "Cabeçalho ZIP64 ausente ou corrompido."
      );
    }

    entryCount = Number(zip64Header.readBigUInt64LE(32));
    centralDirectorySize = Number(zip64Header.readBigUInt64LE(40));
    centralDirectoryOffset = Number(zip64Header.readBigUInt64LE(48));
  }

  return { entryCount, centralDirectoryOffset, centralDirectorySize };
}

function decodeEntryName(raw: Buffer, flags: number): string {
  // Bit 11 declara UTF-8. Sem ele o padrão é CP437; como o nome nunca
  // vira caminho de escrita, decodificar como UTF-8 tolerante é
  // suficiente para casar o arquivo esperado e diagnosticar.
  const utf8 = flags & 0x0800;
  return raw.toString(utf8 ? "utf8" : "latin1");
}

function readZip64Extra(
  extra: Buffer,
  entry: {
    uncompressedSize: number;
    compressedSize: number;
    localHeaderOffset: number;
  }
): void {
  let cursor = 0;

  while (cursor + 4 <= extra.length) {
    const headerId = extra.readUInt16LE(cursor);
    const dataSize = extra.readUInt16LE(cursor + 2);
    const dataStart = cursor + 4;

    if (dataStart + dataSize > extra.length) break;

    if (headerId === 0x0001) {
      let fieldCursor = dataStart;

      // A ordem é fixa e só os campos que estavam saturados aparecem.
      if (
        entry.uncompressedSize === ZIP64_SENTINEL_32 &&
        fieldCursor + 8 <= dataStart + dataSize
      ) {
        entry.uncompressedSize = Number(extra.readBigUInt64LE(fieldCursor));
        fieldCursor += 8;
      }
      if (
        entry.compressedSize === ZIP64_SENTINEL_32 &&
        fieldCursor + 8 <= dataStart + dataSize
      ) {
        entry.compressedSize = Number(extra.readBigUInt64LE(fieldCursor));
        fieldCursor += 8;
      }
      if (
        entry.localHeaderOffset === ZIP64_SENTINEL_32 &&
        fieldCursor + 8 <= dataStart + dataSize
      ) {
        entry.localHeaderOffset = Number(extra.readBigUInt64LE(fieldCursor));
      }

      return;
    }

    cursor = dataStart + dataSize;
  }
}

export async function readZipDirectory(
  reader: RandomAccessReader,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS
): Promise<ZipEntry[]> {
  if (reader.byteLength > limits.maxArchiveBytes) {
    throw new ZipSecurityError(
      "ZIP_GRANDE_DEMAIS",
      `Pacote excede o limite de ${limits.maxArchiveBytes} bytes.`
    );
  }

  const eocd = await findEndOfCentralDirectory(reader);

  if (eocd.entryCount > limits.maxEntries) {
    throw new ZipSecurityError(
      "ZIP_ENTRADAS_DEMAIS",
      `Pacote declara ${eocd.entryCount} entradas, acima do limite de ${limits.maxEntries}.`
    );
  }

  if (
    eocd.centralDirectoryOffset < 0 ||
    eocd.centralDirectoryOffset + eocd.centralDirectorySize > reader.byteLength
  ) {
    throw new ZipSecurityError(
      "ZIP_INVALIDO",
      "Diretório central do pacote aponta para fora do arquivo."
    );
  }

  const directory = await readExactly(
    reader,
    eocd.centralDirectoryOffset,
    eocd.centralDirectorySize
  );

  const entries: ZipEntry[] = [];
  let cursor = 0;

  for (let index = 0; index < eocd.entryCount; index += 1) {
    if (cursor + 46 > directory.length) {
      throw new ZipSecurityError(
        "ZIP_INVALIDO",
        "Diretório central do pacote está truncado."
      );
    }

    if (directory.readUInt32LE(cursor) !== SIGNATURE_CENTRAL) {
      throw new ZipSecurityError(
        "ZIP_INVALIDO",
        "Assinatura inválida no diretório central."
      );
    }

    const versionMadeBy = directory.readUInt16LE(cursor + 4);
    const flags = directory.readUInt16LE(cursor + 8);
    const compressionMethod = directory.readUInt16LE(cursor + 10);
    const crc = directory.readUInt32LE(cursor + 16);
    const nameLength = directory.readUInt16LE(cursor + 28);
    const extraLength = directory.readUInt16LE(cursor + 30);
    const commentLength = directory.readUInt16LE(cursor + 32);
    const externalAttributes = directory.readUInt32LE(cursor + 38);

    const sizes = {
      compressedSize: directory.readUInt32LE(cursor + 20),
      uncompressedSize: directory.readUInt32LE(cursor + 24),
      localHeaderOffset: directory.readUInt32LE(cursor + 42),
    };

    const nameStart = cursor + 46;
    const extraStart = nameStart + nameLength;
    const commentStart = extraStart + extraLength;
    const nextCursor = commentStart + commentLength;

    if (nextCursor > directory.length) {
      throw new ZipSecurityError(
        "ZIP_INVALIDO",
        "Entrada do diretório central ultrapassa o próprio diretório."
      );
    }

    readZip64Extra(directory.subarray(extraStart, commentStart), sizes);

    const name = decodeEntryName(
      directory.subarray(nameStart, extraStart),
      flags
    );

    const isDirectory = name.endsWith("/");

    // Unix guarda o modo nos 16 bits altos; S_IFLNK = 0xA000.
    const madeByUnix = versionMadeBy >> 8 === 3;
    const unixMode = (externalAttributes >>> 16) & 0xf000;
    const isSymlink = madeByUnix && unixMode === 0xa000;

    entries.push({
      name,
      baseName: isDirectory ? "" : (name.split("/").pop() ?? ""),
      isDirectory,
      compressionMethod,
      compressedSize: sizes.compressedSize,
      uncompressedSize: sizes.uncompressedSize,
      crc32: crc,
      localHeaderOffset: sizes.localHeaderOffset,
      encrypted: (flags & 0x0001) !== 0,
      isSymlink,
    });

    cursor = nextCursor;
  }

  return entries;
}

// ------------------------------------------------------------
// Escolha da entrada — seção 8 do requisito
//
// Regra dura: na dúvida, NÃO escolhe. Um pacote ambíguo vira erro
// diagnosticado, nunca um palpite que produziria um SHA-256 atribuído
// ao documento errado.
// ------------------------------------------------------------

export interface ZipEntrySelection {
  entry: ZipEntry | null;
  /** Motivo sanitizado quando entry é nulo. */
  error: string | null;
  /** Como a entrada foi encontrada, para auditoria. */
  matchedBy: "NOME_EXATO" | "NOME_CASE_INSENSITIVE" | "UNICA_ENTRADA" | null;
}

export function selectZipEntry(
  entries: ZipEntry[],
  expected: { name: string; extensionNormalized?: string | null }
): ZipEntrySelection {
  const files: ZipEntry[] = [];

  for (const entry of entries) {
    if (entry.isDirectory) continue;

    if (entry.isSymlink) {
      return {
        entry: null,
        error: "O pacote contém link simbólico, que não é aceito.",
        matchedBy: null,
      };
    }

    if (entry.encrypted) {
      return {
        entry: null,
        error: "O pacote contém entrada criptografada, que não é aceita.",
        matchedBy: null,
      };
    }

    const verdict = validateZipEntryName(entry.name);
    if (!verdict.ok) {
      return {
        entry: null,
        error: `O pacote contém caminho inseguro (${verdict.reason}).`,
        matchedBy: null,
      };
    }

    files.push(entry);
  }

  if (files.length === 0) {
    return {
      entry: null,
      error: "O pacote não contém nenhum arquivo.",
      matchedBy: null,
    };
  }

  const expectedName = expected.name.trim();

  const exact = files.filter((entry) => entry.baseName === expectedName);
  if (exact.length === 1) {
    return { entry: exact[0], error: null, matchedBy: "NOME_EXATO" };
  }
  if (exact.length > 1) {
    return {
      entry: null,
      error: `O pacote traz ${exact.length} arquivos com o nome esperado; escolha ambígua não é feita automaticamente.`,
      matchedBy: null,
    };
  }

  const lowered = expectedName.toLocaleLowerCase();
  const insensitive = files.filter(
    (entry) => entry.baseName.toLocaleLowerCase() === lowered
  );
  if (insensitive.length === 1) {
    return {
      entry: insensitive[0],
      error: null,
      matchedBy: "NOME_CASE_INSENSITIVE",
    };
  }
  if (insensitive.length > 1) {
    return {
      entry: null,
      error: `O pacote traz ${insensitive.length} arquivos equivalentes ao nome esperado; escolha ambígua não é feita automaticamente.`,
      matchedBy: null,
    };
  }

  // Nenhum nome bateu. Só aceitamos o caso inequívoco: o pacote tem
  // exatamente um arquivo E a extensão confere.
  if (files.length === 1) {
    const expectedExtension = (expected.extensionNormalized ?? "")
      .replace(/^\./, "")
      .toLocaleLowerCase();
    const actualExtension = (files[0].baseName.split(".").pop() ?? "")
      .toLocaleLowerCase();

    if (!expectedExtension || expectedExtension === actualExtension) {
      return { entry: files[0], error: null, matchedBy: "UNICA_ENTRADA" };
    }

    return {
      entry: null,
      error:
        "O único arquivo do pacote tem extensão diferente da esperada; nenhuma escolha foi feita.",
      matchedBy: null,
    };
  }

  return {
    entry: null,
    error: `O pacote traz ${files.length} arquivos e nenhum corresponde ao nome esperado; nenhuma escolha foi feita.`,
    matchedBy: null,
  };
}

// ------------------------------------------------------------
// Extração de UMA entrada
//
// Streaming do início ao fim: os bytes descompactados passam por
// onChunk e nunca são acumulados aqui. Os limites são aplicados
// DURANTE a inflação — o tamanho declarado no cabeçalho é controlado
// pelo atacante e por isso não serve de garantia sozinho.
// ------------------------------------------------------------

export interface ZipExtractionResult {
  bytesWritten: number;
  crc32: number | null;
  crcVerified: boolean;
}

const READ_CHUNK_BYTES = 256 * 1024;

async function resolveDataOffset(
  reader: RandomAccessReader,
  entry: ZipEntry
): Promise<number> {
  const header = await readExactly(reader, entry.localHeaderOffset, 30);

  if (header.readUInt32LE(0) !== SIGNATURE_LOCAL) {
    throw new ZipSecurityError(
      "ZIP_INVALIDO",
      "Cabeçalho local da entrada é inválido."
    );
  }

  // Os comprimentos do cabeçalho local podem diferir dos do diretório
  // central; usar os do central aqui desalinharia o offset dos dados.
  const nameLength = header.readUInt16LE(26);
  const extraLength = header.readUInt16LE(28);

  return entry.localHeaderOffset + 30 + nameLength + extraLength;
}

export async function extractZipEntry(
  reader: RandomAccessReader,
  entry: ZipEntry,
  onChunk: (chunk: Buffer) => void | Promise<void>,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS
): Promise<ZipExtractionResult> {
  if (entry.isDirectory) {
    throw new ZipSecurityError(
      "ZIP_ENTRADA_INVALIDA",
      "Entrada de diretório não pode ser extraída como arquivo."
    );
  }

  if (entry.encrypted) {
    throw new ZipSecurityError(
      "ZIP_CRIPTOGRAFADO",
      "Entrada criptografada não é aceita."
    );
  }

  if (entry.isSymlink) {
    throw new ZipSecurityError(
      "ZIP_SYMLINK",
      "Link simbólico não é aceito."
    );
  }

  const nameVerdict = validateZipEntryName(entry.name);
  if (!nameVerdict.ok) {
    throw new ZipSecurityError(
      "ZIP_CAMINHO_INSEGURO",
      `Caminho inseguro no pacote (${nameVerdict.reason}).`
    );
  }

  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    throw new ZipSecurityError(
      "ZIP_COMPRESSAO_NAO_SUPORTADA",
      `Método de compressão ${entry.compressionMethod} não é aceito.`
    );
  }

  if (entry.uncompressedSize > limits.maxEntryUncompressedBytes) {
    throw new ZipSecurityError(
      "ZIP_ENTRADA_GRANDE_DEMAIS",
      `Entrada declara ${entry.uncompressedSize} bytes, acima do limite de ${limits.maxEntryUncompressedBytes}.`
    );
  }

  const dataOffset = await resolveDataOffset(reader, entry);

  if (dataOffset + entry.compressedSize > reader.byteLength) {
    throw new ZipSecurityError(
      "ZIP_TRUNCADO",
      "Os dados da entrada ultrapassam o fim do pacote."
    );
  }

  const compressedSize = entry.compressedSize;
  let bytesWritten = 0;
  let running: number | null = null;
  let crcVerified = false;

  const canHashCrc = typeof zlibCrc32 === "function";

  async function* readCompressed(): AsyncGenerator<Buffer> {
    let remaining = compressedSize;
    let position = dataOffset;

    while (remaining > 0) {
      const length = Math.min(READ_CHUNK_BYTES, remaining);
      const chunk = await readExactly(reader, position, length);
      position += length;
      remaining -= length;
      yield chunk;
    }
  }

  const sink = async (source: AsyncIterable<Buffer>) => {
    for await (const chunk of source) {
      bytesWritten += chunk.length;

      if (bytesWritten > limits.maxEntryUncompressedBytes) {
        throw new ZipSecurityError(
          "ZIP_ENTRADA_GRANDE_DEMAIS",
          "A entrada ultrapassou o limite de tamanho durante a extração."
        );
      }

      // Bomba de compressão: verificada com o que REALMENTE saiu, não
      // com o tamanho declarado no cabeçalho.
      if (
        bytesWritten > limits.ratioFloorBytes &&
        compressedSize > 0 &&
        bytesWritten / compressedSize > limits.maxCompressionRatio
      ) {
        throw new ZipSecurityError(
          "ZIP_BOMBA_DE_COMPRESSAO",
          "Razão de compressão anormal; extração interrompida."
        );
      }

      if (canHashCrc) {
        running = zlibCrc32(chunk, running ?? 0);
      }

      await onChunk(chunk);
    }
  };

  const source = Readable.from(readCompressed());

  if (entry.compressionMethod === 0) {
    await pipeline(source, sink);
  } else {
    await pipeline(source, createInflateRaw(), sink);
  }

  if (
    entry.uncompressedSize > 0 &&
    bytesWritten !== entry.uncompressedSize
  ) {
    throw new ZipSecurityError(
      "ZIP_TAMANHO_DIVERGENTE",
      "O tamanho extraído não confere com o declarado no pacote."
    );
  }

  if (canHashCrc && running !== null) {
    if ((running >>> 0) !== (entry.crc32 >>> 0)) {
      throw new ZipSecurityError(
        "ZIP_CRC_DIVERGENTE",
        "O CRC do conteúdo extraído não confere com o declarado no pacote."
      );
    }
    crcVerified = true;
  }

  return {
    bytesWritten,
    crc32: running === null ? null : running >>> 0,
    crcVerified,
  };
}
