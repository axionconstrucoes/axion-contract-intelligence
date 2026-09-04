// Pacote C — SHA-256, deduplicação por conteúdo, idempotência e
// auditoria estática da migration (RLS, grants, search_path, FKs).
//
// Nenhuma chamada real ao Construmanager, nenhum Supabase remoto,
// nenhum Storage real: o banco e o bucket são dublês em memória que
// reproduzem exatamente a semântica das RPCs da migration
// (ON CONFLICT (sha256) DO NOTHING + reaproveitamento do vencedor).
//
// Uso: node scripts/test-construmanager-content-storage.mjs

import { register } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { crc32 } from "node:zlib";

register("./ts-module-resolver.mjs", import.meta.url);

const { storeConstrumanagerContent, CONSTRUMANAGER_CONTENT_BUCKET } = await import(
  "../apps/web/lib/integrations/construmanager/store-content.ts"
);

const { buildContentStoragePath } = await import(
  "../apps/web/lib/integrations/construmanager/download-content.ts"
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

// ------------------------------------------------------------
// ZIP mínimo (store), igual ao do outro suite.
// ------------------------------------------------------------

function buildSingleEntryZip(name, content) {
  const raw = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const nameBuffer = Buffer.from(name, "utf8");
  const crc = crc32(raw);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(raw.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(nameBuffer.length, 26);

  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 6);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(raw.length, 20);
  header.writeUInt32LE(raw.length, 24);
  header.writeUInt16LE(nameBuffer.length, 28);
  header.writeUInt32LE(0, 42);

  const central = Buffer.concat([header, nameBuffer]);
  const offset = local.length + nameBuffer.length + raw.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([local, nameBuffer, raw, central, eocd]);
}

function clientServing(zip) {
  return {
    async downloadObject(_token, _c, _w, _o, _body, onChunk) {
      await onChunk(new Uint8Array(zip));
      return { bytesReceived: zip.length, contentType: "application/octet-stream" };
    },
  };
}

// ------------------------------------------------------------
// Banco em memória com a semântica das RPCs da migration.
// ------------------------------------------------------------

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";

function createFakeDb() {
  const blobsBySha = new Map();
  const links = new Map();
  const uploads = [];

  function addLink(objectId, sourceName, kind) {
    const id = randomUUID();
    links.set(id, {
      id,
      project_id: PROJECT_ID,
      construmanager_object_id: objectId,
      source_name: sourceName,
      document_id: kind === "DOCUMENTO" ? randomUUID() : null,
      version_id: kind === "VERSAO" ? randomUUID() : null,
      content_blob_id: null,
      download_status: "PENDENTE",
      download_attempts: 0,
      downloaded_at: null,
      download_error: null,
      zip_entry_path: null,
    });
    return id;
  }

  const supabase = {
    async rpc(fn, args) {
      if (args.p_project_id !== PROJECT_ID) {
        return { data: null, error: { message: "Permissao ADMINISTRADOR e necessaria." } };
      }

      if (fn === "begin_construmanager_content_download") {
        const link = links.get(args.p_link_id);
        if (!link) return { data: null, error: { message: "Vinculo nao encontrado." } };
        link.download_status = "BAIXANDO";
        link.download_attempts += 1;
        link.download_error = null;
        return { data: null, error: null };
      }

      if (fn === "find_construmanager_content_blob") {
        if (!/^[0-9a-f]{64}$/.test(args.p_sha256)) {
          return { data: null, error: { message: "SHA-256 invalido." } };
        }
        const blob = blobsBySha.get(args.p_sha256);
        return {
          data: blob
            ? [
                {
                  blob_id: blob.id,
                  storage_bucket: blob.storage_bucket,
                  storage_path: blob.storage_path,
                  size_bytes: blob.size_bytes,
                },
              ]
            : [],
          error: null,
        };
      }

      if (fn === "complete_construmanager_content_download") {
        const link = links.get(args.p_link_id);
        if (!link) return { data: null, error: { message: "Vinculo nao encontrado." } };

        // ON CONFLICT (sha256) DO NOTHING + resolução do vencedor.
        let reused = true;
        let blob = blobsBySha.get(args.p_sha256);
        if (!blob) {
          blob = {
            id: randomUUID(),
            sha256: args.p_sha256,
            size_bytes: args.p_size_bytes,
            storage_bucket: args.p_storage_bucket,
            storage_path: args.p_storage_path,
            mime_type: args.p_mime_type,
            detected_extension: args.p_detected_extension,
          };
          blobsBySha.set(args.p_sha256, blob);
          reused = false;
        }

        link.content_blob_id = blob.id;
        link.download_status = "ARMAZENADO";
        link.downloaded_at = new Date().toISOString();
        link.download_error = null;
        link.zip_entry_path = args.p_zip_entry_path;

        return { data: [{ blob_id: blob.id, blob_reused: reused }], error: null };
      }

      if (fn === "fail_construmanager_content_download") {
        const link = links.get(args.p_link_id);
        if (!link) return { data: null, error: { message: "Vinculo nao encontrado." } };
        link.download_status = "ERRO";
        link.download_error = args.p_error;
        // Nunca apaga content_blob_id: conteúdo já preservado sobrevive.
        return { data: null, error: null };
      }

      return { data: null, error: { message: `RPC desconhecida: ${fn}` } };
    },
  };

  const uploader = async (input) => {
    uploads.push({ ...input, size: input.body.size });
  };

  return { supabase, uploader, blobsBySha, links, uploads, addLink };
}

async function runStore(db, linkId, objectId, name, zip) {
  return storeConstrumanagerContent(
    db.supabase,
    PROJECT_ID,
    { linkId, objectId, name, extensionNormalized: "dwg" },
    clientServing(zip),
    "token-ficticio-0123456789",
    1645,
    34164,
    { uploader: db.uploader }
  );
}

console.log("");
console.log("PACOTE C — SHA-256, DEDUPLICAÇÃO E IDEMPOTÊNCIA");
console.log("===============================================");
console.log("");
console.log("-- 16..18: hash e tamanho --");

const TOPOGRAFIA_BYTES = Buffer.from(
  "DWG sintético representando WLI-Topografia — bytes idênticos nas duas revisões.",
  "utf8"
);
const OUTRO_BYTES = Buffer.from("conteúdo materialmente diferente", "utf8");

const TOPOGRAFIA_SHA = createHash("sha256").update(TOPOGRAFIA_BYTES).digest("hex");
const OUTRO_SHA = createHash("sha256").update(OUTRO_BYTES).digest("hex");

const zipHead = buildSingleEntryZip("WLI-Topografia.dwg", TOPOGRAFIA_BYTES);
// A versão histórica tem OUTRO nome de arquivo, mas os MESMOS bytes.
const zipVersion = buildSingleEntryZip("WLI-Topografia(00).dwg", TOPOGRAFIA_BYTES);
const zipDifferent = buildSingleEntryZip("Outro.dwg", OUTRO_BYTES);

await checkAsync("SHA-256 gravado é o dos bytes extraídos, não o do ZIP", async () => {
  const db = createFakeDb();
  const linkId = db.addLink(37272424, "WLI-Topografia.dwg", "DOCUMENTO");
  const result = await runStore(db, linkId, 37272424, "WLI-Topografia.dwg", zipHead);

  const zipSha = createHash("sha256").update(zipHead).digest("hex");
  return result.sha256 === TOPOGRAFIA_SHA && result.sha256 !== zipSha;
});

await checkAsync("size_bytes é o do arquivo real, não o do pacote", async () => {
  const db = createFakeDb();
  const linkId = db.addLink(37272424, "WLI-Topografia.dwg", "DOCUMENTO");
  const result = await runStore(db, linkId, 37272424, "WLI-Topografia.dwg", zipHead);
  return (
    result.sizeBytes === TOPOGRAFIA_BYTES.length && result.sizeBytes !== zipHead.length
  );
});

await checkAsync("mesma entrada processada duas vezes produz o mesmo hash", async () => {
  const db = createFakeDb();
  const a = db.addLink(1, "WLI-Topografia.dwg", "DOCUMENTO");
  const b = db.addLink(2, "WLI-Topografia.dwg", "DOCUMENTO");
  const r1 = await runStore(db, a, 1, "WLI-Topografia.dwg", zipHead);
  const r2 = await runStore(db, b, 2, "WLI-Topografia.dwg", zipHead);
  return r1.sha256 === r2.sha256;
});

console.log("");
console.log("-- 19..20: deduplicação por conteúdo --");

await checkAsync(
  "PROVA WLI-Topografia: cabeça e versão com bytes iguais reusam UM blob e continuam DUAS versões",
  async () => {
    const db = createFakeDb();
    const headLink = db.addLink(37272424, "WLI-Topografia.dwg", "DOCUMENTO");
    const versionLink = db.addLink(39274704, "WLI-Topografia(00).dwg", "VERSAO");

    const head = await runStore(db, headLink, 37272424, "WLI-Topografia.dwg", zipHead);
    const version = await runStore(
      db,
      versionLink,
      39274704,
      "WLI-Topografia(00).dwg",
      zipVersion
    );

    const headRow = db.links.get(headLink);
    const versionRow = db.links.get(versionLink);

    return (
      // mesmo SHA-256
      head.sha256 === version.sha256 &&
      // um único blob físico
      db.blobsBySha.size === 1 &&
      headRow.content_blob_id === versionRow.content_blob_id &&
      // o segundo reaproveitou
      head.blobReused === false &&
      version.blobReused === true &&
      // e continuam sendo dois vínculos documentais distintos
      db.links.size === 2 &&
      headRow.construmanager_object_id !== versionRow.construmanager_object_id &&
      headRow.document_id !== null &&
      versionRow.version_id !== null
    );
  }
);

await checkAsync("conteúdo idêntico NÃO é enviado ao Storage duas vezes", async () => {
  const db = createFakeDb();
  const a = db.addLink(37272424, "WLI-Topografia.dwg", "DOCUMENTO");
  const b = db.addLink(39274704, "WLI-Topografia(00).dwg", "VERSAO");
  await runStore(db, a, 37272424, "WLI-Topografia.dwg", zipHead);
  const second = await runStore(db, b, 39274704, "WLI-Topografia(00).dwg", zipVersion);
  return db.uploads.length === 1 && second.uploadSkipped === true;
});

await checkAsync("os dois vínculos apontam para o MESMO path físico", async () => {
  const db = createFakeDb();
  const a = db.addLink(1, "WLI-Topografia.dwg", "DOCUMENTO");
  const b = db.addLink(2, "WLI-Topografia(00).dwg", "VERSAO");
  await runStore(db, a, 1, "WLI-Topografia.dwg", zipHead);
  await runStore(db, b, 2, "WLI-Topografia(00).dwg", zipVersion);
  const blob = db.blobsBySha.get(TOPOGRAFIA_SHA);
  return (
    blob.storage_path === buildContentStoragePath(TOPOGRAFIA_SHA) &&
    blob.storage_bucket === CONSTRUMANAGER_CONTENT_BUCKET &&
    db.uploads[0].path === blob.storage_path
  );
});

await checkAsync("conteúdo diferente gera blobs diferentes", async () => {
  const db = createFakeDb();
  const a = db.addLink(1, "WLI-Topografia.dwg", "DOCUMENTO");
  const b = db.addLink(2, "Outro.dwg", "DOCUMENTO");
  const r1 = await runStore(db, a, 1, "WLI-Topografia.dwg", zipHead);
  const r2 = await runStore(db, b, 2, "Outro.dwg", zipDifferent);
  return (
    r1.sha256 === TOPOGRAFIA_SHA &&
    r2.sha256 === OUTRO_SHA &&
    r1.sha256 !== r2.sha256 &&
    db.blobsBySha.size === 2 &&
    db.uploads.length === 2 &&
    db.links.get(a).content_blob_id !== db.links.get(b).content_blob_id
  );
});

await checkAsync("nomes de arquivo diferentes não impedem a deduplicação", async () => {
  const db = createFakeDb();
  const a = db.addLink(1, "WLI-Topografia.dwg", "DOCUMENTO");
  const b = db.addLink(2, "WLI-Topografia(00).dwg", "VERSAO");
  await runStore(db, a, 1, "WLI-Topografia.dwg", zipHead);
  await runStore(db, b, 2, "WLI-Topografia(00).dwg", zipVersion);
  return db.blobsBySha.size === 1;
});

console.log("");
console.log("-- 21: idempotência --");

await checkAsync("rebaixar o MESMO alvo não cria blob novo nem novo upload", async () => {
  const db = createFakeDb();
  const linkId = db.addLink(37272424, "WLI-Topografia.dwg", "DOCUMENTO");

  const first = await runStore(db, linkId, 37272424, "WLI-Topografia.dwg", zipHead);
  const blobIdAfterFirst = db.links.get(linkId).content_blob_id;

  const second = await runStore(db, linkId, 37272424, "WLI-Topografia.dwg", zipHead);
  const row = db.links.get(linkId);

  return (
    first.blobReused === false &&
    second.blobReused === true &&
    second.uploadSkipped === true &&
    db.blobsBySha.size === 1 &&
    db.uploads.length === 1 &&
    // vínculo intacto
    row.content_blob_id === blobIdAfterFirst &&
    row.download_status === "ARMAZENADO" &&
    // tentativas contadas, carimbo atualizado
    row.download_attempts === 2 &&
    row.downloaded_at !== null
  );
});

await checkAsync("falha registra ERRO sanitizado e não apaga conteúdo já preservado", async () => {
  const db = createFakeDb();
  const linkId = db.addLink(37272424, "WLI-Topografia.dwg", "DOCUMENTO");

  await runStore(db, linkId, 37272424, "WLI-Topografia.dwg", zipHead);
  const blobId = db.links.get(linkId).content_blob_id;

  const failing = {
    async downloadObject() {
      throw new Error(
        "ENOENT: open '/tmp/acc-construmanager-abc/pacote.zip' com Authorization: Bearer segredo.aqui"
      );
    },
  };

  const result = await storeConstrumanagerContent(
    db.supabase,
    PROJECT_ID,
    { linkId, objectId: 37272424, name: "WLI-Topografia.dwg", extensionNormalized: "dwg" },
    failing,
    "token-ficticio-0123456789",
    1645,
    34164,
    { uploader: db.uploader }
  );

  const row = db.links.get(linkId);

  return (
    result.status === "ERRO" &&
    row.download_status === "ERRO" &&
    row.content_blob_id === blobId &&
    !row.download_error.includes("segredo.aqui") &&
    !row.download_error.includes("/tmp/acc-construmanager-abc") &&
    db.blobsBySha.size === 1
  );
});

await checkAsync("erro de permissão no início não deixa o alvo em BAIXANDO indefinido", async () => {
  const db = createFakeDb();
  const linkId = db.addLink(1, "x.dwg", "DOCUMENTO");
  try {
    await storeConstrumanagerContent(
      db.supabase,
      "11111111-1111-4111-8111-111111111111",
      { linkId, objectId: 1, name: "x.dwg", extensionNormalized: "dwg" },
      clientServing(zipHead),
      "token-ficticio-0123456789",
      1645,
      34164,
      { uploader: db.uploader }
    );
    return false;
  } catch (error) {
    // A RPC de início rejeita antes de qualquer download ou upload.
    return (
      /ADMINISTRADOR/i.test(error.message) &&
      db.uploads.length === 0 &&
      db.links.get(linkId).download_status === "PENDENTE"
    );
  }
});

// ------------------------------------------------------------
// 22..24: auditoria estática da migration
// ------------------------------------------------------------

console.log("");
console.log("-- 22..24: migration, RLS, grants e não-regressão --");

const MIGRATION_PATH =
  "supabase/migrations/20260904090000_construmanager_content_storage.sql";
const migration = readFileSync(MIGRATION_PATH, "utf8");

const PACKAGE_C_RPCS = [
  "ensure_construmanager_content_links",
  "find_construmanager_content_blob",
  "begin_construmanager_content_download",
  "complete_construmanager_content_download",
  "fail_construmanager_content_download",
];

check(
  "migration cria as duas tabelas do Pacote C",
  /create table if not exists public\.construmanager_content_blobs/.test(migration) &&
    /create table if not exists public\.construmanager_content_links/.test(migration)
);

check(
  "UNIQUE(sha256) garante um blob por conteúdo",
  /construmanager_content_blobs_sha256_key unique \(sha256\)/.test(migration)
);

check(
  "sha256 é forçado a hex minúsculo de 64 (dedup não fura por maiúscula)",
  /check \(sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/.test(migration)
);

// Isola o CREATE TABLE dos blobs por fatiamento simples: sem isolar, o
// project_id da tabela de vinculos (logo abaixo) daria falso positivo.
// Regex multilinha aqui so tornaria o teste fragil.
function tableBlock(sql, tableName) {
  const start = sql.indexOf("create table if not exists public." + tableName + " (");
  if (start < 0) return "";
  const end = sql.indexOf("\n);", start);
  return end < 0 ? "" : sql.slice(start, end);
}

const blobsTableSql = tableBlock(migration, "construmanager_content_blobs");
const linksTableSql = tableBlock(migration, "construmanager_content_links");

check(
  "bloco da tabela de blobs foi isolado corretamente para auditoria",
  blobsTableSql.includes("sha256") &&
    !blobsTableSql.includes("download_status") &&
    linksTableSql.includes("download_status")
);

check(
  "blob NAO tem project_id (deduplicacao entre projetos)",
  !/\bproject_id\b/.test(blobsTableSql)
);

check(
  "vinculo TEM project_id (escopo por projeto vive no vinculo)",
  /\bproject_id uuid not null\b/.test(linksTableSql)
);

check(
  "vínculo aceita exatamente um alvo: documento OU versão",
  /num_nonnulls\(document_id, version_id\) = 1/.test(migration)
);

check(
  "um vínculo por documento e um por versão",
  /construmanager_content_links_document_key unique \(document_id\)/.test(migration) &&
    /construmanager_content_links_version_key unique \(version_id\)/.test(migration)
);

check(
  "chave natural (integration_id, construmanager_object_id) é única",
  /construmanager_content_links_integration_object_key\s*\n?\s*unique \(integration_id, construmanager_object_id\)/.test(
    migration
  )
);

check(
  "ARMAZENADO exige blob",
  /download_status <> 'ARMAZENADO' or content_blob_id is not null/.test(migration)
);

check(
  "FK para o blob é RESTRICT (conteúdo referenciado não some por cascata)",
  /references public\.construmanager_content_blobs \(id\) on delete restrict/.test(migration)
);

check(
  "FKs para documento e versão existem",
  /document_id uuid\s*\n\s*references public\.construmanager_documents \(id\)/.test(migration) &&
    /version_id uuid\s*\n\s*references public\.construmanager_document_versions \(id\)/.test(
      migration
    )
);

check(
  "RLS habilitada nas duas tabelas novas",
  /alter table public\.construmanager_content_blobs enable row level security/.test(migration) &&
    /alter table public\.construmanager_content_links enable row level security/.test(migration)
);

check(
  "somente policies de SELECT (nenhuma escrita direta de usuário)",
  (migration.match(/create policy/g) ?? []).length === 2 &&
    (migration.match(/for select/g) ?? []).length === 2 &&
    !/for (insert|update|delete)/i.test(migration)
);

check(
  "blob só é visível através de um vínculo visível ao membro",
  /construmanager_content_blobs_select_via_visible_link[\s\S]{0,400}is_project_member\(l\.project_id\)/.test(
    migration
  )
);

check(
  "vínculo é visível só para membro do projeto",
  /construmanager_content_links_select_project_members_only[\s\S]{0,200}is_project_member\(project_id\)/.test(
    migration
  )
);

for (const rpc of PACKAGE_C_RPCS) {
  const definition = new RegExp(
    `create or replace function public\\.${rpc}\\(([\\s\\S]*?)\\$\\$;`,
    "m"
  ).exec(migration);

  check(`${rpc}: definida na migration`, definition !== null);

  if (definition) {
    check(
      `${rpc}: security definer com search_path travado`,
      /security definer/.test(definition[1]) &&
        /set search_path = ''/.test(definition[1])
    );
    check(
      `${rpc}: exige ADMINISTRADOR`,
      /has_project_permission\(p_project_id, 'ADMINISTRADOR'\)/.test(definition[1])
    );
    check(
      `${rpc}: exige sessão autenticada`,
      /auth\.uid\(\) is null/.test(definition[1])
    );
  }

  check(
    `${rpc}: execute revogado de public/anon e concedido só a authenticated`,
    new RegExp(`revoke all on function public\\.${rpc}\\([^)]*\\) from public;`).test(migration) &&
      new RegExp(`revoke all on function public\\.${rpc}\\([^)]*\\) from anon;`).test(migration) &&
      new RegExp(`grant execute on function public\\.${rpc}\\([^)]*\\) to authenticated;`).test(
        migration
      )
  );
}

check(
  "bucket é criado PRIVADO",
  /'construmanager-content',\s*\n\s*'construmanager-content',\s*\n\s*false/.test(migration)
);

check(
  "bucket não recebe nenhuma policy de storage.objects (inacessível ao navegador)",
  !/on storage\.objects/.test(migration)
);

check(
  "bucket não assume o limite de 50 MB do bucket de documentos",
  /2147483648/.test(migration) && !/52428800/.test(migration)
);

check(
  "migration é aditiva: nenhum DROP TABLE",
  !/drop table/i.test(migration)
);

check(
  "migration NÃO altera nenhuma tabela do Pacote B",
  !/alter table public\.construmanager_(documents|folders|document_versions|sync_runs)/i.test(
    migration
  )
);

// Comentarios da migration citam "token" justamente para PROIBIR seu
// armazenamento; auditar o texto cru daria falso positivo. So o SQL
// executavel e' inspecionado aqui.
const migrationCode = migration
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

check(
  "nenhuma coluna de conteudo bruto ou URL publica e' criada",
  !/\bcontent_bytes\b|\bpublic_url\b|\bsigned_url\b|\bfile_content\b/i.test(migrationCode)
);

check(
  "nenhuma coluna de token e' criada",
  !/^\s*\w*token\w*\s+(text|bytea|uuid|jsonb)/im.test(migrationCode)
);

check(
  "path fisico documentado como content-addressed, nao derivado do nome",
  /sha256\/aa\/bb\/<sha256>/.test(migration) &&
    /Nunca derivado do nome do arquivo/.test(migration)
);

check(
  "migration registra que sha256 NAO e' identidade documental",
  /sha256 NAO e' identidade documental/.test(migration)
);

console.log("");
console.log("-- Lote respeita o teto oficial de 100 idObjetos --");

const actionsSource = readFileSync(
  "apps/web/app/[projectId]/integracoes/actions.ts",
  "utf8"
);

const maxBatch = Number(
  /const CONTENT_DOWNLOAD_MAX_BATCH = (\d+);/.exec(actionsSource)?.[1] ?? NaN
);
const defaultBatch = Number(
  /const CONTENT_DOWNLOAD_DEFAULT_BATCH = (\d+);/.exec(actionsSource)?.[1] ?? NaN
);

check("teto de lote da acao esta definido", Number.isInteger(maxBatch));

check(
  `teto de lote (${maxBatch}) nao ultrapassa o maximo oficial de 100 idObjetos`,
  maxBatch <= 100
);

check(
  `lote padrao (${defaultBatch}) e' pequeno e nunca maior que o teto`,
  defaultBatch >= 1 && defaultBatch <= maxBatch
);

check(
  "o valor vindo do formulario e' limitado pelo teto do servidor",
  /requestedBatch > CONTENT_DOWNLOAD_MAX_BATCH\s*\n?\s*\? CONTENT_DOWNLOAD_MAX_BATCH/.test(
    actionsSource
  )
);

check(
  "cada requisicao baixa UM objeto (idObjetos sempre com 1 item)",
  /buildObjectDownloadBody\(workId, target\.objectId\)/.test(
    readFileSync(
      "apps/web/lib/integrations/construmanager/download-content.ts",
      "utf8"
    )
  )
);

console.log("");
console.log("-- Pacote C nao invade o Pacote D --");

const SOURCES = [
  "apps/web/lib/integrations/construmanager/zip-reader.ts",
  "apps/web/lib/integrations/construmanager/download-content.ts",
  "apps/web/lib/integrations/construmanager/store-content.ts",
  "apps/web/lib/integrations/construmanager/get-content-overview.ts",
];

for (const file of SOURCES) {
  const body = readFileSync(file, "utf8");
  check(
    `${file.split("/").pop()}: nao compara revisoes nem gera evento`,
    !/CONTEUDO_ALTERADO|event_ledger|createEvent|candidato a evento|compareRevision/i.test(body)
  );
}

check(
  "migration nao cria nada de Event Ledger",
  !/event_ledger|conteudo_alterado/i.test(migration)
);

console.log("");
console.log("=====================================================================");
console.log(`Resultado: ${passed} passaram, ${failed} falharam.`);

process.exit(failed === 0 ? 0 : 1);
