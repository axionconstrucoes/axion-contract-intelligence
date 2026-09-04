// Pacote C — download seguro, ZIP não confiável e limpeza de temporários.
//
// Nenhuma chamada real ao Construmanager, nenhuma escrita em Supabase,
// nenhum segredo: os ZIPs são construídos aqui, byte a byte, e o fetch
// é substituído por um dublê local.
//
// Uso: node scripts/test-construmanager-content-download.mjs

import { register } from "node:module";
import { deflateRawSync, crc32 } from "node:zlib";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";

register("./ts-module-resolver.mjs", import.meta.url);

const {
  createBufferReader,
  readZipDirectory,
  selectZipEntry,
  extractZipEntry,
  validateZipEntryName,
  DEFAULT_ZIP_LIMITS,
  ZipSecurityError,
} = await import("../apps/web/lib/integrations/construmanager/zip-reader.ts");

const { ConstrumanagerClient, buildObjectDownloadBody, OBJECT_DOWNLOAD_MAX_IDS } = await import(
  "../apps/web/lib/integrations/construmanager/client.ts"
);

const { downloadConstrumanagerContent, buildContentStoragePath, resolveMimeType } =
  await import("../apps/web/lib/integrations/construmanager/download-content.ts");

const { sanitizeConstrumanagerContentError } = await import(
  "../apps/web/lib/integrations/construmanager/sanitize-error.ts"
);

let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) {
    console.log(`OK   ${name}`);
    passed += 1;
  } else {
    console.log(`FAIL ${name}`);
    failed += 1;
  }
}

async function checkAsync(name, fn) {
  try {
    check(name, await fn());
  } catch (error) {
    console.log(`FAIL ${name} -> ${error?.message ?? error}`);
    failed += 1;
  }
}

async function expectZipError(name, fn, codeOrMatcher) {
  try {
    await fn();
    console.log(`FAIL ${name} -> não lançou erro`);
    failed += 1;
  } catch (error) {
    const matched =
      typeof codeOrMatcher === "function"
        ? codeOrMatcher(error)
        : error?.code === codeOrMatcher;
    check(`${name} (${error?.code ?? error?.name})`, matched);
  }
}

// ------------------------------------------------------------
// Escritor de ZIP mínimo.
//
// Escrito à mão de propósito: nenhuma biblioteca aceitaria produzir os
// pacotes maliciosos que precisamos testar (../, caminho absoluto, UNC,
// symlink, bomba). Só métodos 0 (store) e 8 (deflate).
// ------------------------------------------------------------

function zipEntry(name, content, { method = 0, externalAttributes = 0, versionMadeBy = 0x0014, flags = 0 } = {}) {
  const raw = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const data = method === 8 ? deflateRawSync(raw) : raw;
  return {
    name,
    nameBuffer: Buffer.from(name, "utf8"),
    raw,
    data,
    method,
    crc: crc32(raw),
    externalAttributes,
    versionMadeBy,
    flags,
  };
}

function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.flags, 6);
    local.writeUInt16LE(entry.method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(entry.crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.raw.length, 22);
    local.writeUInt16LE(entry.nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, entry.nameBuffer, entry.data);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(entry.versionMadeBy, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(entry.flags, 8);
    header.writeUInt16LE(entry.method, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(0, 14);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.data.length, 20);
    header.writeUInt32LE(entry.raw.length, 24);
    header.writeUInt16LE(entry.nameBuffer.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(entry.externalAttributes >>> 0, 38);
    header.writeUInt32LE(offset, 42);

    central.push(Buffer.concat([header, entry.nameBuffer]));

    offset += local.length + entry.nameBuffer.length + entry.data.length;
  }

  const centralBuffer = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuffer, eocd]);
}

function readerFor(entries) {
  return createBufferReader(buildZip(entries));
}

async function extractToBuffer(reader, entry, limits = DEFAULT_ZIP_LIMITS) {
  const parts = [];
  const result = await extractZipEntry(reader, entry, (chunk) => {
    parts.push(Buffer.from(chunk));
  }, limits);
  return { buffer: Buffer.concat(parts), result };
}

console.log("");
console.log("PACOTE C — DOWNLOAD SEGURO, ZIP E TEMPORÁRIOS");
console.log("=============================================");
console.log("");
console.log("-- 1..5: parsing e escolha da entrada --");

const SIMPLE_CONTENT = Buffer.from("conteudo tecnico da obra WEG", "utf8");

await checkAsync("ZIP válido de uma entrada é lido pelo diretório central", async () => {
  const entries = await readZipDirectory(
    readerFor([zipEntry("WLI-Topografia.dwg", SIMPLE_CONTENT)])
  );
  return entries.length === 1 && entries[0].baseName === "WLI-Topografia.dwg";
});

await checkAsync("hierarquia de pastas do Construmanager é preservada e lida", async () => {
  const entries = await readZipDirectory(
    readerFor([
      zipEntry("WEG Linhares/01 Projetos/WLI-Topografia.dwg", SIMPLE_CONTENT),
    ])
  );
  return (
    entries[0].name === "WEG Linhares/01 Projetos/WLI-Topografia.dwg" &&
    entries[0].baseName === "WLI-Topografia.dwg"
  );
});

await checkAsync("entrada esperada é encontrada por nome exato dentro de subpasta", async () => {
  const entries = await readZipDirectory(
    readerFor([
      zipEntry("WEG/01/WLI-Topografia.dwg", SIMPLE_CONTENT),
      zipEntry("WEG/01/outro.pdf", "x"),
    ])
  );
  const selection = selectZipEntry(entries, {
    name: "WLI-Topografia.dwg",
    extensionNormalized: "dwg",
  });
  return selection.entry?.baseName === "WLI-Topografia.dwg" && selection.matchedBy === "NOME_EXATO";
});

await checkAsync("ZIP com um único arquivo é aceito quando a extensão confere", async () => {
  const entries = await readZipDirectory(
    readerFor([zipEntry("pasta/nome-diferente.dwg", SIMPLE_CONTENT)])
  );
  const selection = selectZipEntry(entries, {
    name: "WLI-Topografia.dwg",
    extensionNormalized: "dwg",
  });
  return selection.entry !== null && selection.matchedBy === "UNICA_ENTRADA";
});

await checkAsync("único arquivo com extensão DIFERENTE não é escolhido", async () => {
  const entries = await readZipDirectory(
    readerFor([zipEntry("pasta/planilha.xlsx", SIMPLE_CONTENT)])
  );
  const selection = selectZipEntry(entries, {
    name: "WLI-Topografia.dwg",
    extensionNormalized: "dwg",
  });
  return selection.entry === null && /extensão diferente/i.test(selection.error ?? "");
});

await checkAsync("MÚLTIPLAS entradas sem correspondência: nenhuma é escolhida", async () => {
  const entries = await readZipDirectory(
    readerFor([
      zipEntry("a/um.dwg", "1"),
      zipEntry("a/dois.dwg", "2"),
      zipEntry("a/tres.dwg", "3"),
    ])
  );
  const selection = selectZipEntry(entries, {
    name: "WLI-Topografia.dwg",
    extensionNormalized: "dwg",
  });
  return selection.entry === null && /nenhuma escolha foi feita/i.test(selection.error ?? "");
});

await checkAsync("nome esperado DUPLICADO em pastas diferentes vira erro, não palpite", async () => {
  const entries = await readZipDirectory(
    readerFor([
      zipEntry("a/WLI-Topografia.dwg", "1"),
      zipEntry("b/WLI-Topografia.dwg", "2"),
    ])
  );
  const selection = selectZipEntry(entries, {
    name: "WLI-Topografia.dwg",
    extensionNormalized: "dwg",
  });
  return selection.entry === null && /ambígua/i.test(selection.error ?? "");
});

await checkAsync("diretórios não contam como arquivo candidato", async () => {
  const entries = await readZipDirectory(
    readerFor([
      zipEntry("pasta/", ""),
      zipEntry("pasta/WLI-Topografia.dwg", SIMPLE_CONTENT),
    ])
  );
  const selection = selectZipEntry(entries, {
    name: "WLI-Topografia.dwg",
    extensionNormalized: "dwg",
  });
  return selection.entry?.baseName === "WLI-Topografia.dwg";
});

await checkAsync("ZIP sem nenhum arquivo é recusado", async () => {
  const entries = await readZipDirectory(readerFor([zipEntry("pasta/", "")]));
  const selection = selectZipEntry(entries, { name: "x.dwg", extensionNormalized: "dwg" });
  return selection.entry === null && /não contém nenhum arquivo/i.test(selection.error ?? "");
});

await expectZipError(
  "conteúdo que não é ZIP é recusado",
  () => readZipDirectory(createBufferReader(Buffer.from("isto nao e um zip, e um PDF talvez"))),
  "ZIP_INVALIDO"
);

console.log("");
console.log("-- 6..10: caminhos maliciosos e limites --");

const MALICIOUS_NAMES = [
  ["../evil.dwg", "segmento de traversal"],
  ["a/../../evil.dwg", "traversal no meio"],
  ["..\\evil.dwg", "traversal Windows"],
  ["/etc/passwd", "caminho absoluto"],
  ["C:/Windows/System32/evil.dll", "letra de unidade"],
  ["C:\\Windows\\evil.dll", "letra de unidade + barra invertida"],
  ["//servidor/share/evil.dwg", "UNC"],
  ["\\\\servidor\\share\\evil.dwg", "UNC Windows"],
  ["pasta\\arquivo.dwg", "barra invertida no meio"],
  ["arq\u0000.dwg", "byte NUL"],
  ["", "nome vazio"],
  ["./relativo.dwg", "segmento ."],
  [`${"a".repeat(600)}.dwg`, "nome absurdamente longo"],
];

for (const [name, label] of MALICIOUS_NAMES) {
  check(
    `validateZipEntryName rejeita ${label}: ${JSON.stringify(name.slice(0, 40))}`,
    validateZipEntryName(name).ok === false
  );
}

check(
  "validateZipEntryName aceita caminho legítimo com pastas",
  validateZipEntryName("WEG Linhares/01 Projetos/WLI-Topografia.dwg").ok === true
);

check(
  "validateZipEntryName aceita nome com parênteses (padrão de versão da obra)",
  validateZipEntryName("WLI-Topografia(00).dwg").ok === true
);

await checkAsync("Zip Slip: entrada ../ presente no pacote bloqueia a seleção inteira", async () => {
  const entries = await readZipDirectory(
    readerFor([
      zipEntry("../fora.dwg", "x"),
      zipEntry("WLI-Topografia.dwg", SIMPLE_CONTENT),
    ])
  );
  const selection = selectZipEntry(entries, {
    name: "WLI-Topografia.dwg",
    extensionNormalized: "dwg",
  });
  return selection.entry === null && /caminho inseguro/i.test(selection.error ?? "");
});

await expectZipError(
  "extrair entrada com ../ é recusado mesmo se pedido diretamente",
  async () => {
    const reader = readerFor([zipEntry("../fora.dwg", "x")]);
    const entries = await readZipDirectory(reader);
    await extractToBuffer(reader, entries[0]);
  },
  "ZIP_CAMINHO_INSEGURO"
);

await expectZipError(
  "extrair entrada com caminho absoluto é recusado",
  async () => {
    const reader = readerFor([zipEntry("/etc/passwd", "x")]);
    const entries = await readZipDirectory(reader);
    await extractToBuffer(reader, entries[0]);
  },
  "ZIP_CAMINHO_INSEGURO"
);

await expectZipError(
  "extrair entrada UNC é recusado",
  async () => {
    const reader = readerFor([zipEntry("//servidor/share/x.dwg", "x")]);
    const entries = await readZipDirectory(reader);
    await extractToBuffer(reader, entries[0]);
  },
  "ZIP_CAMINHO_INSEGURO"
);

await checkAsync("symlink Unix é detectado pelo modo em externalFileAttributes", async () => {
  // versionMadeBy alto = 3 (Unix), modo 0xA1FF = S_IFLNK | 0777.
  const entries = await readZipDirectory(
    readerFor([
      zipEntry("link.dwg", "/etc/passwd", {
        versionMadeBy: (3 << 8) | 20,
        externalAttributes: 0xa1ff0000,
      }),
    ])
  );
  return entries[0].isSymlink === true;
});

await expectZipError(
  "extrair symlink é recusado",
  async () => {
    const reader = readerFor([
      zipEntry("link.dwg", "/etc/passwd", {
        versionMadeBy: (3 << 8) | 20,
        externalAttributes: 0xa1ff0000,
      }),
    ]);
    const entries = await readZipDirectory(reader);
    await extractToBuffer(reader, entries[0]);
  },
  "ZIP_SYMLINK"
);

await checkAsync("symlink no pacote bloqueia a seleção", async () => {
  const entries = await readZipDirectory(
    readerFor([
      zipEntry("link.dwg", "/etc/passwd", {
        versionMadeBy: (3 << 8) | 20,
        externalAttributes: 0xa1ff0000,
      }),
    ])
  );
  const selection = selectZipEntry(entries, { name: "link.dwg", extensionNormalized: "dwg" });
  return selection.entry === null && /link simbólico/i.test(selection.error ?? "");
});

await checkAsync("entrada criptografada é detectada pelo bit 0 do flag", async () => {
  const entries = await readZipDirectory(
    readerFor([zipEntry("segredo.dwg", "x", { flags: 0x0001 })])
  );
  const selection = selectZipEntry(entries, { name: "segredo.dwg", extensionNormalized: "dwg" });
  return entries[0].encrypted === true && /criptografada/i.test(selection.error ?? "");
});

await expectZipError(
  "excesso de entradas é recusado",
  async () => {
    const many = Array.from({ length: 40 }, (_, i) => zipEntry(`a/f${i}.txt`, "x"));
    await readZipDirectory(readerFor(many), { ...DEFAULT_ZIP_LIMITS, maxEntries: 10 });
  },
  "ZIP_ENTRADAS_DEMAIS"
);

await expectZipError(
  "ZIP maior que o teto do arquivo é recusado antes de qualquer leitura",
  async () => {
    await readZipDirectory(readerFor([zipEntry("a.txt", "x")]), {
      ...DEFAULT_ZIP_LIMITS,
      maxArchiveBytes: 10,
    });
  },
  "ZIP_GRANDE_DEMAIS"
);

await expectZipError(
  "bomba de compressão é interrompida DURANTE a inflação",
  async () => {
    // 8 MiB de zeros comprime para poucos KB: razão muito acima de 20:1.
    const bomb = Buffer.alloc(8 * 1024 * 1024, 0);
    const reader = readerFor([zipEntry("bomba.bin", bomb, { method: 8 })]);
    const entries = await readZipDirectory(reader);
    await extractToBuffer(reader, entries[0], {
      ...DEFAULT_ZIP_LIMITS,
      maxCompressionRatio: 20,
      ratioFloorBytes: 1024,
    });
  },
  "ZIP_BOMBA_DE_COMPRESSAO"
);

await expectZipError(
  "entrada acima do teto individual é recusada",
  async () => {
    const reader = readerFor([zipEntry("grande.bin", Buffer.alloc(64 * 1024, 7))]);
    const entries = await readZipDirectory(reader);
    await extractToBuffer(reader, entries[0], {
      ...DEFAULT_ZIP_LIMITS,
      maxEntryUncompressedBytes: 1024,
    });
  },
  "ZIP_ENTRADA_GRANDE_DEMAIS"
);

await expectZipError(
  "método de compressão não suportado é recusado",
  async () => {
    const reader = readerFor([zipEntry("x.bin", "abc")]);
    const entries = await readZipDirectory(reader);
    entries[0].compressionMethod = 12; // bzip2
    await extractToBuffer(reader, entries[0]);
  },
  "ZIP_COMPRESSAO_NAO_SUPORTADA"
);

console.log("");
console.log("-- 11..15: extração correta, integridade e erros de rede --");

await checkAsync("extração store devolve exatamente os bytes originais", async () => {
  const reader = readerFor([zipEntry("a.bin", SIMPLE_CONTENT)]);
  const entries = await readZipDirectory(reader);
  const { buffer } = await extractToBuffer(reader, entries[0]);
  return buffer.equals(SIMPLE_CONTENT);
});

await checkAsync("extração deflate devolve exatamente os bytes originais", async () => {
  const payload = Buffer.from("linha\n".repeat(5000), "utf8");
  const reader = readerFor([zipEntry("a.txt", payload, { method: 8 })]);
  const entries = await readZipDirectory(reader);
  const { buffer, result } = await extractToBuffer(reader, entries[0]);
  return buffer.equals(payload) && result.bytesWritten === payload.length;
});

await checkAsync("CRC declarado no pacote é conferido de verdade", async () => {
  const reader = readerFor([zipEntry("a.bin", SIMPLE_CONTENT)]);
  const entries = await readZipDirectory(reader);
  const { result } = await extractToBuffer(reader, entries[0]);
  return result.crcVerified === true;
});

await expectZipError(
  "CRC divergente é detectado (conteúdo adulterado)",
  async () => {
    const reader = readerFor([zipEntry("a.bin", SIMPLE_CONTENT)]);
    const entries = await readZipDirectory(reader);
    entries[0].crc32 = 0x1234abcd;
    await extractToBuffer(reader, entries[0]);
  },
  "ZIP_CRC_DIVERGENTE"
);

await expectZipError(
  "tamanho divergente do declarado é detectado",
  async () => {
    const reader = readerFor([zipEntry("a.bin", SIMPLE_CONTENT)]);
    const entries = await readZipDirectory(reader);
    entries[0].uncompressedSize = SIMPLE_CONTENT.length + 10;
    await extractToBuffer(reader, entries[0]);
  },
  (error) =>
    error?.code === "ZIP_TAMANHO_DIVERGENTE" || error?.code === "ZIP_CRC_DIVERGENTE"
);

// ------------------------------------------------------------
// client.downloadObject com fetch dublê
// ------------------------------------------------------------

const FAKE_LOGIN = "usuario-de-teste@exemplo.invalid";
const FAKE_PASSWORD = "senha-ficticia-somente-para-teste-2f9a";

function makeClient() {
  return new ConstrumanagerClient({
    baseUrl: "https://api.construmanager.invalid",
    login: FAKE_LOGIN,
    password: FAKE_PASSWORD,
    timeoutMs: 15000,
  });
}

const realFetch = globalThis.fetch;

function stubFetch(handler) {
  globalThis.fetch = handler;
}

function restoreFetch() {
  globalThis.fetch = realFetch;
}

function binaryResponse(buffer, { contentType = "application/octet-stream", status = 200, headers = {} } = {}) {
  return new Response(buffer, {
    status,
    headers: { "content-type": contentType, ...headers },
  });
}

async function downloadToBuffer(client, options = {}) {
  const parts = [];
  const outcome = await client.downloadObject(
    "token-de-acesso-ficticio-1234567890",
    1645,
    34164,
    37272424,
    buildObjectDownloadBody(34164, 37272424),
    (chunk) => {
      parts.push(Buffer.from(chunk));
    },
    { maxBytes: 10 * 1024 * 1024, ...options }
  );
  return { buffer: Buffer.concat(parts), outcome };
}

await checkAsync("download aceita application/octet-stream e entrega os bytes", async () => {
  const zip = buildZip([zipEntry("WLI-Topografia.dwg", SIMPLE_CONTENT)]);
  stubFetch(async () => binaryResponse(zip));
  try {
    const { buffer, outcome } = await downloadToBuffer(makeClient());
    return buffer.equals(zip) && outcome.bytesReceived === zip.length;
  } finally {
    restoreFetch();
  }
});

await checkAsync("Authorization: Bearer é enviado e o corpo vai como JSON", async () => {
  let seenAuth = null;
  let seenUrl = null;
  const zip = buildZip([zipEntry("a.dwg", "x")]);
  stubFetch(async (url, init) => {
    seenAuth = init.headers.Authorization;
    seenUrl = url;
    return binaryResponse(zip);
  });
  try {
    await downloadToBuffer(makeClient());
    return (
      typeof seenAuth === "string" &&
      seenAuth.startsWith("Bearer ") &&
      String(seenUrl).endsWith("/Objeto/Download")
    );
  } finally {
    restoreFetch();
  }
});

console.log("");
console.log("-- Contrato oficial de Objeto/Download --");

const officialBody = buildObjectDownloadBody(34164, 37272424);

check(
  "corpo tem exatamente os 4 campos do contrato oficial",
  JSON.stringify(Object.keys(officialBody).sort()) ===
    JSON.stringify(["idObjetos", "idObra", "markup", "markupOculto"].sort())
);

check(
  "idObjetos é ARRAY de integer (não string, não lista por vírgula)",
  Array.isArray(officialBody.idObjetos) &&
    officialBody.idObjetos.length === 1 &&
    officialBody.idObjetos[0] === 37272424 &&
    Number.isInteger(officialBody.idObjetos[0])
);

check("idObra é integer", officialBody.idObra === 34164);
check("markup vai explicitamente false", officialBody.markup === false);
check("markupOculto vai explicitamente false", officialBody.markupOculto === false);

// Esta rota NÃO usa empresa — diferente de Pasta/List (empresaId) e
// ListaMestra/List (idEmpresa). Campo estranho ao contrato não entra.
for (const forbidden of ["idEmpresa", "empresaId", "obraId", "idObjeto", "top", "isJSON"]) {
  check(
    `corpo NÃO contém campo estranho ao contrato: ${forbidden}`,
    !(forbidden in officialBody)
  );
}

check(
  "o corpo enviado de fato é o do contrato (serializado)",
  JSON.stringify(officialBody) ===
    '{"idObjetos":[37272424],"idObra":34164,"markup":false,"markupOculto":false}'
);

check("teto oficial de idObjetos é 100", OBJECT_DOWNLOAD_MAX_IDS === 100);

check(
  "exatamente 100 ids é aceito (limite inclusivo)",
  buildObjectDownloadBody(34164, Array.from({ length: 100 }, (_, i) => i + 1)).idObjetos
    .length === 100
);

check(
  "101 ids é recusado antes de qualquer requisição",
  (() => {
    try {
      buildObjectDownloadBody(34164, Array.from({ length: 101 }, (_, i) => i + 1));
      return false;
    } catch (error) {
      return /at most 100 object ids/i.test(error.message);
    }
  })()
);

check(
  "lista vazia é recusada (mínimo oficial é 1)",
  (() => {
    try {
      buildObjectDownloadBody(34164, []);
      return false;
    } catch (error) {
      return /at least one object id/i.test(error.message);
    }
  })()
);

check(
  "id não inteiro é recusado",
  (() => {
    try {
      buildObjectDownloadBody(34164, [1.5]);
      return false;
    } catch (error) {
      return /invalid object id/i.test(error.message);
    }
  })()
);

check(
  "obra inválida é recusada",
  (() => {
    try {
      buildObjectDownloadBody(0, [37272424]);
      return false;
    } catch (error) {
      return /workId is invalid/i.test(error.message);
    }
  })()
);

await checkAsync("resposta JSON (erro disfarçado de 200) é recusada", async () => {
  stubFetch(async () =>
    new Response(JSON.stringify({ status: { id: 1, description: "Registro não encontrado" } }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    })
  );
  try {
    await downloadToBuffer(makeClient());
    return false;
  } catch (error) {
    return /textual payload/i.test(error.message);
  } finally {
    restoreFetch();
  }
});

await checkAsync("erro HTTP é propagado com o status", async () => {
  stubFetch(async () => binaryResponse(Buffer.from("x"), { status: 503 }));
  try {
    await downloadToBuffer(makeClient());
    return false;
  } catch (error) {
    return /HTTP 503/.test(error.message);
  } finally {
    restoreFetch();
  }
});

await checkAsync("resposta vazia (zero bytes) é recusada", async () => {
  stubFetch(async () => binaryResponse(Buffer.alloc(0)));
  try {
    await downloadToBuffer(makeClient());
    return false;
  } catch (error) {
    return /zero bytes/i.test(error.message);
  } finally {
    restoreFetch();
  }
});

await checkAsync("content-length declarado acima do teto é barrado ANTES de ler o corpo", async () => {
  stubFetch(async () =>
    binaryResponse(Buffer.alloc(64), { headers: { "content-length": "999999999" } })
  );
  try {
    await downloadToBuffer(makeClient(), { maxBytes: 1024 });
    return false;
  } catch (error) {
    return /above the 1024 byte limit/i.test(error.message);
  } finally {
    restoreFetch();
  }
});

await checkAsync("teto é aplicado durante o streaming mesmo sem content-length", async () => {
  stubFetch(async () => {
    const stream = new ReadableStream({
      start(controller) {
        for (let i = 0; i < 8; i += 1) {
          controller.enqueue(new Uint8Array(1024));
        }
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    });
  });
  try {
    await downloadToBuffer(makeClient(), { maxBytes: 2048 });
    return false;
  } catch (error) {
    return /exceeded the 2048 byte limit/i.test(error.message);
  } finally {
    restoreFetch();
  }
});

await checkAsync("timeout aborta via AbortController e vira mensagem clara", async () => {
  stubFetch(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      })
  );
  try {
    await downloadToBuffer(makeClient(), { timeoutMs: 60 });
    return false;
  } catch (error) {
    return /timed out after 60 ms/i.test(error.message);
  } finally {
    restoreFetch();
  }
});

console.log("");
console.log("-- Segredo nunca aparece em erro --");

await checkAsync("mensagem de erro do download nunca contém a senha configurada", async () => {
  stubFetch(async () => binaryResponse(Buffer.from("x"), { status: 401 }));
  try {
    await downloadToBuffer(makeClient());
    return false;
  } catch (error) {
    const sanitized = sanitizeConstrumanagerContentError(error);
    return (
      !error.message.includes(FAKE_PASSWORD) && !sanitized.includes(FAKE_PASSWORD)
    );
  } finally {
    restoreFetch();
  }
});

check(
  "sanitizador remove Bearer token",
  !sanitizeConstrumanagerContentError(
    new Error("falhou com Authorization: Bearer abc.def.ghi")
  ).includes("abc.def.ghi")
);

check(
  "sanitizador remove caminho local do Windows",
  sanitizeConstrumanagerContentError(
    new Error("ENOENT: no such file, open 'C:\\Users\\alguem\\AppData\\Local\\Temp\\acc-construmanager-x1\\pacote.zip'")
  ).includes("[caminho local omitido]")
);

check(
  "sanitizador remove caminho local Unix",
  sanitizeConstrumanagerContentError(
    new Error("EACCES: permission denied, open /tmp/acc-construmanager-x1/conteudo.bin")
  ).includes("[caminho local omitido]")
);

check(
  "sanitizador corta stack trace de SQL Server",
  /omitido por segurança/i.test(
    sanitizeConstrumanagerContentError(
      new Error("System.Data.SqlClient.SqlException: Invalid column name 'x'")
    )
  )
);

console.log("");
console.log("-- Temporários: limpos em sucesso E em erro --");

async function countTempDirs() {
  const entries = await readdir(tmpdir());
  return entries.filter((name) => name.startsWith("acc-construmanager-")).length;
}

function fakeClientServing(buffer) {
  return {
    async downloadObject(_token, _c, _w, _o, _body, onChunk) {
      await onChunk(new Uint8Array(buffer));
      return { bytesReceived: buffer.length, contentType: "application/octet-stream" };
    },
  };
}

const baselineTempDirs = await countTempDirs();

await checkAsync("download completo: hash, tamanho e entrada corretos", async () => {
  const zip = buildZip([
    zipEntry("WEG/01 Projetos/WLI-Topografia.dwg", SIMPLE_CONTENT),
  ]);
  const content = await downloadConstrumanagerContent(
    fakeClientServing(zip),
    "token-ficticio-0123456789",
    1645,
    34164,
    { objectId: 37272424, name: "WLI-Topografia.dwg", extensionNormalized: "dwg" }
  );

  const { createHash } = await import("node:crypto");
  const expected = createHash("sha256").update(SIMPLE_CONTENT).digest("hex");

  const ok =
    content.sha256 === expected &&
    content.sizeBytes === SIMPLE_CONTENT.length &&
    content.zipEntryPath === "WEG/01 Projetos/WLI-Topografia.dwg" &&
    content.matchedBy === "NOME_EXATO";

  await content.cleanup();
  return ok;
});

await checkAsync("temporário é removido após cleanup() no caminho de sucesso", async () => {
  return (await countTempDirs()) === baselineTempDirs;
});

await checkAsync("temporário é removido quando a extração falha", async () => {
  const zip = buildZip([zipEntry("../fora.dwg", "x")]);
  try {
    await downloadConstrumanagerContent(
      fakeClientServing(zip),
      "token-ficticio-0123456789",
      1645,
      34164,
      { objectId: 1, name: "fora.dwg", extensionNormalized: "dwg" }
    );
    return false;
  } catch {
    return (await countTempDirs()) === baselineTempDirs;
  }
});

await checkAsync("temporário é removido quando o download em si falha", async () => {
  const failingClient = {
    async downloadObject() {
      throw new Error("Construmanager request /Objeto/Download failed with HTTP 500.");
    },
  };
  try {
    await downloadConstrumanagerContent(failingClient, "token-ficticio-0123456789", 1645, 34164, {
      objectId: 1,
      name: "x.dwg",
      extensionNormalized: "dwg",
    });
    return false;
  } catch {
    return (await countTempDirs()) === baselineTempDirs;
  }
});

console.log("");
console.log("-- Path de Storage é content-addressed --");

const SAMPLE_SHA = "a".repeat(64);

check(
  "path deriva só do sha256, em dois níveis",
  buildContentStoragePath(SAMPLE_SHA) === `sha256/aa/aa/${SAMPLE_SHA}`
);

check("path rejeita sha256 malformado", (() => {
  try {
    buildContentStoragePath("NAO-E-HASH");
    return false;
  } catch {
    return true;
  }
})());

check(
  "path NÃO contém o nome externo do arquivo",
  !buildContentStoragePath(SAMPLE_SHA).includes("Topografia")
);

check("mime conhecido é resolvido", resolveMimeType("pdf") === "application/pdf");
check("mime desconhecido vira null em vez de palpite", resolveMimeType("nwd") === null);

console.log("");
console.log("=====================================================================");
console.log(`Resultado: ${passed} passaram, ${failed} falharam.`);

process.exit(failed === 0 ? 0 : 1);
