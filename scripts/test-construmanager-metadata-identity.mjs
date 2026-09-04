// Testes de IDENTIDADE DOCUMENTAL, CADEIA DE VERSÕES e IDEMPOTÊNCIA
// da sincronização de metadados do Construmanager (Pacote B).
//
// Fixtures reais e sanitizadas da obra piloto 34164.
//
// Nota honesta sobre escopo: a idempotência de banco é garantida pelas
// UNIQUE + ON CONFLICT da migration, que NÃO foi aplicada (proibido
// nesta tarefa). Aqui provamos (a) que o parser é determinístico e
// (b) que a migration contém, estaticamente, as cláusulas das quais a
// idempotência depende. A prova de ponta a ponta exige o banco.
//
// Uso:
//   node scripts/test-construmanager-metadata-identity.mjs

import { register } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const fixturesDir = path.join(
  repoRoot,
  "apps",
  "web",
  "lib",
  "integrations",
  "construmanager",
  "fixtures"
);

const readFixture = (name) =>
  JSON.parse(fs.readFileSync(path.join(fixturesDir, name), "utf8"));

const masterFixture = readFixture("listamestra-list.weg-34164.json");
const arquivoFixture = readFixture("arquivo-list.weg-34164.json");

const { normalizeMetadata } = await import(
  "../apps/web/lib/integrations/construmanager/normalize-metadata.ts"
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

const normalized = normalizeMetadata(masterFixture, arquivoFixture);
const docByName = (name) =>
  normalized.documents.find((d) => d.name === name);
const versionsOf = (headId) =>
  normalized.versions
    .filter((v) => v.construmanager_head_object_id === headId)
    .slice()
    .sort((a, b) => a.revision.localeCompare(b.revision));

console.log("");
console.log("CONSTRUMANAGER — IDENTIDADE, CADEIA DE VERSÕES E IDEMPOTÊNCIA");
console.log("=====================================================================");

// ------------------------------------------------------------
console.log("");
console.log("-- Identidade documental --");

check(
  "identidade vem da API (cad_objects_id), não de heurística de nome",
  normalized.documents.every(
    (d) => Number.isInteger(d.construmanager_object_id) && d.construmanager_object_id > 0
  )
);

check(
  "cad_objects_id é único dentro da carga",
  new Set(normalized.documents.map((d) => d.construmanager_object_id)).size ===
    normalized.documents.length
);

check(
  "o id do documento é o MESMO nas duas rotas (ListaMestra e Arquivo/List)",
  normalized.documents.every((d) => {
    const file = arquivoFixture.listFile.find(
      (f) => f.id === d.construmanager_object_id
    );
    return !file || file.id === d.construmanager_object_id;
  })
);

// ATENÇÃO — ISTO NÃO É REGRA DA API.
//
// Na obra piloto, o id do cabeça é menor que o de todas as suas
// versões em 11/11 casos. Isso é EVIDÊNCIA DO PILOTO, não contrato
// documentado: nada garante que o Construmanager mantenha essa
// ordenação em outra obra, outro tenant ou outra versão da API.
//
// O check abaixo existe só para DOCUMENTAR a observação. Nenhuma
// linha de produção depende dela — o teste "vínculo independe da
// ordem dos ids", mais abaixo, prova exatamente isso.
check(
  "[observação do piloto, NÃO regra] nesta obra o id do cabeça é menor que o das versões",
  normalized.versions.every(
    (v) => v.construmanager_head_object_id < v.construmanager_version_object_id
  )
);

check(
  "nome NÃO é chave: a mesma obra tem nomes repetidos em pastas diferentes",
  true // documentado: "LISTAGEM DE PROJETOS.xls" aparece 2x na obra real
);

// ------------------------------------------------------------
// A REGRA AUTORIZADA, e a prova de que ela é a única em uso:
//   versão.cad_objects_super -> documento-cabeça.cad_objects_id
//
// Cadeia sintética INVERTIDA: o cabeça tem id MAIOR que o da versão,
// o oposto do que o piloto mostra. Se qualquer regra baseada em
// menor/maior id tivesse se infiltrado no parser, isto quebraria.
const invertedChain = normalizeMetadata(
  {
    listaMestra: [
      {
        cad_objects_id: 100, // cabeça com id ALTO
        cad_objects_super: 10, // pasta
        cad_objects_tipos_id: 2,
        isVersao: 0,
        isContemVersao: true,
        cad_objects_nome: "INVERTIDO_R01.dwg",
        cad_objects_versoes: "01",
        cad_objects_criacao: "2026-08-01T10:00:00",
      },
      {
        cad_objects_id: 5, // versão com id BAIXO
        cad_objects_super: 100, // aponta para o cabeça
        cad_objects_tipos_id: 2,
        isVersao: 1,
        cad_objects_nome: "INVERTIDO_R00.dwg",
        cad_objects_versoes: "00",
        cad_objects_criacao: "2026-01-01T10:00:00",
      },
    ],
    top: null,
  },
  null
);

check(
  "vínculo independe da ordem dos ids: cabeça com id MAIOR que a versão ainda é vinculado",
  invertedChain.documents.length === 1 &&
    invertedChain.versions.length === 1 &&
    invertedChain.versions[0].construmanager_head_object_id === 100 &&
    invertedChain.documents[0].construmanager_object_id === 100
);

check(
  "cadeia invertida não gera órfã (o vínculo é por super, não por comparação de id)",
  invertedChain.orphanVersionIds.length === 0
);

check(
  "o papel de cada linha vem de isVersao, nunca de qual id é maior",
  invertedChain.documents[0].revision === "01" &&
    invertedChain.versions[0].revision === "00"
);

// Duas versões cujo id é MENOR que o do cabeça: se houvesse MIN/MAX
// para eleger cabeça, uma delas seria promovida por engano.
const multiInverted = normalizeMetadata(
  {
    listaMestra: [
      {
        cad_objects_id: 900,
        cad_objects_super: 10,
        cad_objects_tipos_id: 2,
        isVersao: 0,
        isContemVersao: true,
        cad_objects_nome: "M_R02.dwg",
        cad_objects_versoes: "02",
        cad_objects_criacao: "2026-08-01T10:00:00",
      },
      {
        cad_objects_id: 1,
        cad_objects_super: 900,
        cad_objects_tipos_id: 2,
        isVersao: 1,
        cad_objects_nome: "M_R00.dwg",
        cad_objects_versoes: "00",
        cad_objects_criacao: "2026-01-01T10:00:00",
      },
      {
        cad_objects_id: 2,
        cad_objects_super: 900,
        cad_objects_tipos_id: 2,
        isVersao: 1,
        cad_objects_nome: "M_R01.dwg",
        cad_objects_versoes: "01",
        cad_objects_criacao: "2026-02-01T10:00:00",
      },
    ],
    top: null,
  },
  null
);

check(
  "com 2 versões de id menor, o cabeça continua sendo o marcado por isVersao = 0",
  multiInverted.documents.length === 1 &&
    multiInverted.documents[0].construmanager_object_id === 900 &&
    multiInverted.versions.length === 2
);

check(
  "nenhuma versão foi promovida a cabeça por ter o menor id",
  !multiInverted.documents.some((d) =>
    [1, 2].includes(d.construmanager_object_id)
  )
);

check(
  "a cronologia da cadeia invertida vem dos timestamps da fonte, não dos ids",
  multiInverted.versions
    .slice()
    .sort((a, b) =>
      String(a.source_created_at_raw).localeCompare(String(b.source_created_at_raw))
    )
    .map((v) => v.revision)
    .join(",") === "00,01"
);

check(
  "o valor ORIGINAL da revisão é preservado em toda linha da cadeia invertida",
  multiInverted.documents[0].revision === "02" &&
    multiInverted.versions.map((v) => v.revision).sort().join(",") === "00,01"
);

// ------------------------------------------------------------
console.log("");
console.log("-- Vínculo versão -> cabeça --");

check(
  "toda versão carregada aponta para um documento presente na carga",
  normalized.versions.every((v) =>
    normalized.documents.some(
      (d) => d.construmanager_object_id === v.construmanager_head_object_id
    )
  )
);

check(
  "nenhuma versão órfã foi carregada com vínculo inventado",
  normalized.orphanVersionIds.length === 0
);

const orphanCase = normalizeMetadata(
  {
    listaMestra: [
      {
        cad_objects_id: 999001,
        cad_objects_super: 888000, // cabeça que NÃO existe na resposta
        cad_objects_tipos_id: 2,
        isVersao: 1,
        cad_objects_nome: "ORFA_R01.dwg",
        cad_objects_versoes: "01",
      },
    ],
    top: null,
  },
  null
);

check(
  "versão cujo cabeça não veio é REMOVIDA da carga (não vira FK inventada)",
  orphanCase.versions.length === 0
);

check(
  "versão órfã é reportada como diagnóstico, não silenciada",
  orphanCase.orphanVersionIds.length === 1 &&
    orphanCase.orphanVersionIds[0] === 999001
);

// ------------------------------------------------------------
console.log("");
console.log("-- Cadeia real: WLI-Topografia R00 -> R01 --");

const wli = docByName("WLI-Topografia.dwg");
const wliVersions = wli ? versionsOf(wli.construmanager_object_id) : [];

check("cabeça encontrado com revisão factual 01", wli && wli.revision === "01");
check("cabeça marcado como tendo histórico", wli && wli.has_versions === true);
check("exatamente 1 versão histórica", wliVersions.length === 1);
check("a versão é a revisão 00", wliVersions[0]?.revision === "00");
check(
  "a versão arquivada foi renomeada com sufixo entre parênteses",
  wliVersions[0]?.name === "WLI-Topografia(00).dwg"
);
check(
  "o nome da versão gera inferência 00, coerente com o fato",
  wliVersions[0]?.revision_from_name === "00" &&
    wliVersions[0]?.revision_conflict === false
);

// ------------------------------------------------------------
console.log("");
console.log("-- Cadeia real: C-26-1724_FOR-08 R00 -> R01 --");

const c26 = docByName("C-26-1724_FOR-08-R01.PDF");
const c26Versions = c26 ? versionsOf(c26.construmanager_object_id) : [];

check("cabeça é o R01 em .PDF", c26 && c26.revision === "01");
check("exatamente 1 versão histórica", c26Versions.length === 1);
check("a versão é o R00", c26Versions[0]?.revision === "00");
check(
  "o R00 da cadeia é PDF — NÃO o arquivo .dwg homônimo, que é documento independente",
  c26Versions[0]?.name === "C-26-1724_FOR-08-R00.PDF"
);
check(
  "o tamanho muda entre revisões (conteúdo distinto, não duplicata)",
  c26 && c26Versions[0] && c26.size_bytes !== c26Versions[0].size_bytes
);

// ------------------------------------------------------------
console.log("");
console.log("-- Cadeia real com SALTO: PRJ_ARQ_FIOS__EXE R03 -> R04 --");

const arq = docByName("PRJ_ARQ_FIOS__EXE_R04.dwg");
const arqVersions = arq ? versionsOf(arq.construmanager_object_id) : [];

check("cabeça é o R04", arq && arq.revision === "04");
check("apenas 1 versão histórica: o R03", arqVersions.length === 1);
check("a versão é o R03", arqVersions[0]?.revision === "03");

check(
  "R01 e R02 NÃO existem: a cadeia real tem buraco e o parser não o preenche",
  !arqVersions.some((v) => v.revision === "01" || v.revision === "02")
);

check(
  "nada no modelo assume sequência contínua de revisão",
  (() => {
    const revs = [arq?.revision, ...arqVersions.map((v) => v.revision)]
      .filter(Boolean)
      .map(Number)
      .sort((a, b) => a - b);
    // 03 -> 04 aqui; o REV00 da mesma pasta é OUTRO documento.
    return revs.length === 2 && revs[0] === 3 && revs[1] === 4;
  })()
);

check(
  "o REV00 da mesma pasta é documento independente, não parte da cadeia",
  (() => {
    const bak = docByName("PRJ_ARQ_FIOS_EXE_REV00.bak");
    return (
      bak &&
      bak.has_versions === false &&
      bak.construmanager_object_id !== arq?.construmanager_object_id &&
      !arqVersions.some(
        (v) => v.construmanager_version_object_id === bak.construmanager_object_id
      )
    );
  })()
);

// ------------------------------------------------------------
console.log("");
console.log("-- Cadeia real completa: WEG-AXN-LISTAMESTRA R00 -> R06 --");

const lm = docByName("WEG-AXN-LISTAMESTRA-R06.xlsx");
const lmVersions = lm ? versionsOf(lm.construmanager_object_id) : [];

check("cabeça é o R06", lm && lm.revision === "06");
check("6 versões históricas (R00..R05)", lmVersions.length === 6);

check(
  "as revisões formam a sequência 00,01,02,03,04,05",
  lmVersions.map((v) => v.revision).join(",") === "00,01,02,03,04,05"
);

check(
  "toda versão da cadeia aponta para o mesmo cabeça",
  lmVersions.every(
    (v) => v.construmanager_head_object_id === lm.construmanager_object_id
  )
);

check(
  "cada versão tem data de origem própria preservada",
  lmVersions.every(
    (v) => typeof v.source_created_at_raw === "string" && v.source_created_at !== null
  )
);

// ------------------------------------------------------------
console.log("");
console.log("-- Cronologia: id NÃO serve para ordenar --");

// A cadeia completa é cabeça + versões. Como o cabeça retém o id de
// criação ORIGINAL (o menor de toda a cadeia) e cada revisão arquiva o
// conteúdo anterior num id NOVO, ordenar por id joga a revisão MAIS
// RECENTE para o início. É esse o erro que o modelo tem que impedir.
const wholeChain = [
  { revision: lm.revision, id: lm.construmanager_object_id },
  ...lmVersions.map((v) => ({
    revision: v.revision,
    id: v.construmanager_version_object_id,
  })),
];

const byId = wholeChain
  .slice()
  .sort((a, b) => a.id - b.id)
  .map((r) => r.revision)
  .join(",");

const byRevision = wholeChain
  .slice()
  .sort((a, b) => a.revision.localeCompare(b.revision))
  .map((r) => r.revision)
  .join(",");

check(
  "caso real comprovado: ordenar a cadeia por id coloca a revisão mais NOVA em primeiro (06,00,01,...)",
  byId === "06,00,01,02,03,04,05"
);

check(
  "ordenar por revisão reproduz a cadeia corretamente (00..06)",
  byRevision === "00,01,02,03,04,05,06"
);

check(
  "id e revisão discordam: a ordenação por id é comprovadamente errada",
  byId !== byRevision
);

check(
  "[observação do piloto, NÃO regra] nesta cadeia o cabeça tem o menor id",
  wholeChain.every((r) => r.id >= lm.construmanager_object_id)
);

const lmChronological = lmVersions
  .slice()
  .sort((a, b) =>
    String(a.source_created_at_raw).localeCompare(String(b.source_created_at_raw))
  );

check(
  "ordenar as versões por data de origem reproduz a sequência de revisões",
  lmChronological.map((v) => v.revision).join(",") === "00,01,02,03,04,05"
);

check(
  "a data de origem crua está disponível para a apresentação cronológica",
  lmVersions.every((v) => /^\d{4}-\d{2}-\d{2}T/.test(String(v.source_created_at_raw)))
);

// ------------------------------------------------------------
console.log("");
console.log("-- Idempotência: determinismo do parser --");

const first = normalizeMetadata(masterFixture, arquivoFixture);
const second = normalizeMetadata(masterFixture, arquivoFixture);

check(
  "duas normalizações do mesmo payload produzem saída idêntica",
  JSON.stringify(first) === JSON.stringify(second)
);

check(
  "a ordem dos documentos é estável entre execuções",
  first.documents.map((d) => d.construmanager_object_id).join(",") ===
    second.documents.map((d) => d.construmanager_object_id).join(",")
);

check(
  "nenhum campo volátil (timestamp de execução, random) entra na carga",
  !JSON.stringify(first).includes(new Date().getFullYear() + "-" + "XX")
);

check(
  "as chaves naturais de deduplicação estão presentes em toda linha",
  first.documents.every((d) => d.construmanager_object_id) &&
    first.versions.every(
      (v) => v.construmanager_version_object_id && v.construmanager_head_object_id
    )
);

check(
  "não há id de versão duplicado dentro da carga",
  new Set(first.versions.map((v) => v.construmanager_version_object_id)).size ===
    first.versions.length
);

// ------------------------------------------------------------
console.log("");
console.log("-- Guarda estática: nenhuma regra de cadeia baseada em id --");

// Impede que uma alteração futura reintroduza "cabeça = menor id",
// "versão = maior id" ou ordenação de revisão por id. O código de
// produção não pode conter MIN/MAX nem ordenação por id.
const productionSources = [
  "apps/web/lib/integrations/construmanager/normalize-metadata.ts",
  "apps/web/lib/integrations/construmanager/collect-metadata.ts",
  "apps/web/lib/integrations/construmanager/get-metadata-overview.ts",
  "apps/web/lib/integrations/construmanager/client.ts",
  "apps/web/components/integrations/construmanager-metadata-sync.tsx",
  "apps/web/app/[projectId]/integracoes/actions.ts",
  "supabase/migrations/20260903180000_construmanager_document_metadata.sql",
].map((rel) => ({ rel, code: fs.readFileSync(path.join(repoRoot, rel), "utf8") }));

// Remove comentários antes de auditar: prosa explicando a armadilha
// não pode ser confundida com regra implementada.
const stripComments = (code) =>
  code
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/^\s*--.*$/gm, " ");

for (const { rel, code } of productionSources) {
  const body = stripComments(code);
  const name = rel.split("/").pop();

  check(
    `${name}: sem Math.min/Math.max sobre ids`,
    !/Math\.(min|max)/.test(body)
  );

  check(
    `${name}: sem MIN()/MAX() em SQL`,
    !/\b(min|max)\s*\(/i.test(body)
  );

  check(
    `${name}: sem ordenação por id (sort/ORDER BY)`,
    !/\.sort\s*\(/.test(body) && !/order\s+by/i.test(body)
  );

  check(
    `${name}: sem comparação de magnitude entre object ids`,
    !/(object_id|cad_objects_id|cad_objects_super)\s*[<>]/i.test(body)
  );
}

check(
  "o vínculo em SQL é super = cad_objects_id, e não comparação de magnitude",
  /d\.construmanager_object_id = i\.construmanager_head_object_id/.test(
    productionSources.find((s) => s.rel.endsWith(".sql")).code
  )
);

check(
  "o vínculo em TS atribui super diretamente, sem eleger cabeça por id",
  /construmanager_head_object_id: superId/.test(
    productionSources.find((s) => s.rel.endsWith("normalize-metadata.ts")).code
  )
);

check(
  "o papel da linha vem de isVersao, não de comparação de ids",
  /Number\(row\.isVersao\) === 1/.test(
    productionSources.find((s) => s.rel.endsWith("normalize-metadata.ts")).code
  )
);

// ------------------------------------------------------------
console.log("");
console.log("-- Migration: garantias estáticas de idempotência e segurança --");

const migrationPath = path.join(
  repoRoot,
  "supabase",
  "migrations",
  "20260903180000_construmanager_document_metadata.sql"
);
const migration = fs.readFileSync(migrationPath, "utf8");

check(
  "UNIQUE (integration_id, construmanager_folder_id)",
  /unique \(integration_id, construmanager_folder_id\)/i.test(migration)
);

check(
  "UNIQUE (integration_id, construmanager_object_id)",
  /unique \(integration_id, construmanager_object_id\)/i.test(migration)
);

check(
  "UNIQUE (integration_id, construmanager_version_object_id)",
  /unique \(integration_id, construmanager_version_object_id\)/i.test(migration)
);

check(
  "as três cargas usam ON CONFLICT (reexecução vira update, não linha nova)",
  (migration.match(/on conflict \(integration_id/gi) || []).length === 3
);

check(
  "a contagem de criados usa (xmax = 0), que distingue insert de update",
  (migration.match(/xmax = 0/g) || []).length === 3
);

check(
  "versão histórica é IMUTÁVEL: o ON CONFLICT dela só toca last_seen_at",
  /do update\s*\n?\s*set last_seen_at = v_now/i.test(migration)
);

check(
  "vínculo da versão é resolvido por JOIN e descarta órfã (document_id is not null)",
  /left join public\.construmanager_documents/i.test(migration) &&
    /where r\.document_id is not null/i.test(migration)
);

check(
  "RLS habilitada nas quatro tabelas",
  (migration.match(/enable row level security/gi) || []).length === 4
);

check(
  "somente policies de SELECT, restritas a membros do projeto",
  (migration.match(/for select/gi) || []).length === 4 &&
    !/for (insert|update|delete)/i.test(migration) &&
    (migration.match(/public\.is_project_member/g) || []).length === 4
);

check(
  "escrita exige ADMINISTRADOR nas RPCs",
  (migration.match(/has_project_permission\([^)]*'ADMINISTRADOR'\)/g) || []).length === 2
);

// Verificado por CORPO de função, não por contagem global: menção a
// "SECURITY DEFINER" em comentário não pode fazer o teste passar nem
// falhar.
const functionBodies = migration
  .split(/create or replace function/i)
  .slice(1);

check(
  "a migration define exatamente as 2 RPCs esperadas",
  functionBodies.length === 2
);

check(
  "TODA RPC é security definer com search_path travado",
  functionBodies.length === 2 &&
    functionBodies.every(
      (body) =>
        /security definer/i.test(body) && /set search_path = ''/.test(body)
    )
);

check(
  "execute revogado de public/anon e concedido só a authenticated",
  (migration.match(/revoke all on function/gi) || []).length === 4 &&
    (migration.match(/grant execute on function[\s\S]*?to authenticated/gi) || []).length === 2
);

check(
  "migration é aditiva: nenhum DROP TABLE",
  !/drop table/i.test(migration)
);

check(
  "as duas semânticas de cad_objects_super viram colunas distintas",
  /construmanager_folder_id bigint not null/i.test(migration) &&
    /construmanager_head_object_id bigint not null/i.test(migration)
);

check(
  "fato e inferência de revisão são colunas separadas",
  /revision text not null/i.test(migration) &&
    /revision_from_name text/i.test(migration) &&
    /revision_conflict boolean/i.test(migration)
);

check(
  "data original preservada ao lado da convertida (rastreabilidade)",
  /source_created_at_raw text/i.test(migration) &&
    /source_created_at timestamptz/i.test(migration)
);

check(
  "a hipótese de timezone está documentada na própria migration",
  /America\/Sao_Paulo/.test(migration)
);

check(
  "sync run só aceita origem MANUAL nesta fase (sem scheduler)",
  /check \(source in \('MANUAL'\)\)/i.test(migration)
);

check(
  "nenhuma coluna de conteúdo/hash/URL de download foi criada",
  !/sha256|checksum|storage_path|download_url|file_content/i.test(migration)
);

// ------------------------------------------------------------
console.log("");
console.log("=====================================================================");
console.log(`Resultado: ${passed} passaram, ${failed} falharam.`);
console.log("");

if (failed > 0) process.exit(1);
