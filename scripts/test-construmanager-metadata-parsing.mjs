// Testes puros dos parsers de metadados do Construmanager (Pacote B).
// Sem rede, sem sessão Supabase: tudo roda contra fixtures SANITIZADAS
// capturadas da obra piloto real 34164.
//
// Uso:
//   node scripts/test-construmanager-metadata-parsing.mjs

import { register } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(
  here,
  "..",
  "apps",
  "web",
  "lib",
  "integrations",
  "construmanager",
  "fixtures"
);

const readFixture = (name) =>
  JSON.parse(fs.readFileSync(path.join(fixturesDir, name), "utf8"));

const pastaFixture = readFixture("pasta-list.weg-34164.json");
const masterFixture = readFixture("listamestra-list.weg-34164.json");
const arquivoFixture = readFixture("arquivo-list.weg-34164.json");
const sqlErrorFixture = readFixture("listamestra-sql-error.json");

const {
  normalizeFolders,
  normalizeMetadata,
  extractMasterListRows,
  extractRevisionFromName,
  extractExtension,
  normalizeExtension,
  computeRevisionConflict,
  parseNaiveSourceDate,
  CONSTRUMANAGER_ASSUMED_TIMEZONE,
} = await import(
  "../apps/web/lib/integrations/construmanager/normalize-metadata.ts"
);

const { sanitizeConstrumanagerApiError } = await import(
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

console.log("");
console.log("CONSTRUMANAGER — PARSERS DE METADADOS (fixtures reais da obra 34164)");
console.log("=====================================================================");

// ------------------------------------------------------------
console.log("");
console.log("-- Pasta/List --");

const folders = normalizeFolders(pastaFixture);

check("lê as 25 pastas reais da obra", folders.length === 25);

check(
  "converte parentId de STRING para número",
  folders.every(
    (f) => f.parent_folder_id === null || typeof f.parent_folder_id === "number"
  )
);

const root = folders.find((f) => f.construmanager_folder_id === 37271646);
check(
  "raiz da obra fica com parent_folder_id null (o pai é nó da empresa, ausente da resposta)",
  root && root.parent_folder_id === null
);

check(
  "pastas não-raiz preservam o pai real",
  folders.filter((f) => f.parent_folder_id !== null).length === 24
);

check(
  "todo parent_folder_id não-nulo aponta para uma pasta existente na mesma carga",
  folders
    .filter((f) => f.parent_folder_id !== null)
    .every((f) =>
      folders.some((g) => g.construmanager_folder_id === f.parent_folder_id)
    )
);

check("preserva nível hierárquico", folders.some((f) => f.level === 3));

check(
  "não quebra com resposta vazia ou ausente",
  normalizeFolders(null).length === 0 && normalizeFolders({}).length === 0
);

// ------------------------------------------------------------
console.log("");
console.log("-- ListaMestra/List: extração de linhas --");

check(
  "lê as linhas de listaMestra",
  extractMasterListRows(masterFixture).length === masterFixture.listaMestra.length
);

check(
  "cai para o campo `top` quando listaMestra vem vazio (armadilha real da API)",
  extractMasterListRows({ listaMestra: [], top: [{ cad_objects_id: 1 }] }).length === 1
);

check(
  "prefere listaMestra quando os dois vêm preenchidos",
  extractMasterListRows({
    listaMestra: [{ cad_objects_id: 1 }, { cad_objects_id: 2 }],
    top: [{ cad_objects_id: 9 }],
  }).length === 2
);

check(
  "resposta malformada não lança",
  extractMasterListRows(null).length === 0 &&
    extractMasterListRows({}).length === 0 &&
    extractMasterListRows({ listaMestra: null, top: null }).length === 0
);

// ------------------------------------------------------------
console.log("");
console.log("-- Separação documento vigente x versão histórica --");

const normalized = normalizeMetadata(masterFixture, arquivoFixture);

check(
  "ignora linhas de pasta (cad_objects_tipos_id = 1)",
  !normalized.documents.some((d) => d.name === "[#]") &&
    !normalized.versions.some((v) => v.name === "[#]")
);

check(
  "separa 10 documentos vigentes da fixture",
  normalized.documents.length === 10
);

check("separa as 11 versões históricas reais", normalized.versions.length === 11);

check(
  "nenhum documento vigente entra como versão",
  normalized.versions.every(
    (v) =>
      !normalized.documents.some(
        (d) => d.construmanager_object_id === v.construmanager_version_object_id
      )
  )
);

// ------------------------------------------------------------
console.log("");
console.log("-- cad_objects_super polimórfico --");

const folderIds = new Set(folders.map((f) => f.construmanager_folder_id));

check(
  "no documento vigente, super vira construmanager_folder_id e aponta para uma PASTA real",
  normalized.documents.every((d) => folderIds.has(d.construmanager_folder_id))
);

check(
  "na versão, super vira construmanager_head_object_id e aponta para um DOCUMENTO",
  normalized.versions.every((v) =>
    normalized.documents.some(
      (d) => d.construmanager_object_id === v.construmanager_head_object_id
    )
  )
);

check(
  "documento não expõe head_object_id e versão não expõe folder_id (semânticas não se misturam)",
  normalized.documents.every((d) => !("construmanager_head_object_id" in d)) &&
    normalized.versions.every((v) => !("construmanager_folder_id" in v))
);

// ------------------------------------------------------------
console.log("");
console.log("-- Revisão: FATO (API) x INFERÊNCIA (nome) --");

check(
  'extrai revisão de sufixo "_R04"',
  extractRevisionFromName("PRJ_ARQ_FIOS__EXE_R04.dwg") === "04"
);

check(
  'extrai revisão de sufixo "REV00"',
  extractRevisionFromName("PRJ_ARQ_FIOS_EXE_REV00.bak") === "00"
);

check(
  'extrai revisão de "REV 01" com espaço',
  extractRevisionFromName("GERENCIAMENTO DE RISCO SPDA - WEG REV 01.pdf") === "01"
);

check(
  "extrai revisão mesmo com o ponto duplo real do nome",
  extractRevisionFromName("PRJ_HIDRO_FIOS_01-18_ESG_TER_R03..dwg") === "03"
);

check(
  "extrai revisão do sufixo entre parênteses usado nas versões arquivadas",
  extractRevisionFromName("WLI-Topografia(00).dwg") === "00" &&
    extractRevisionFromName("LISTAGEM DE PROJETOS(01).xls") === "01"
);

check(
  "devolve null quando o nome não carrega revisão",
  extractRevisionFromName("SPDA.txt") === null &&
    extractRevisionFromName("Sondagem WEG.zip") === null
);

check(
  "não confunde número solto no meio do nome com revisão",
  extractRevisionFromName("PF000.701 - WEG - ESTEIRA ENFUSTADOR.dwg") === null
);

check(
  "conflito é falso quando o nome não tem revisão (ausência não é divergência)",
  computeRevisionConflict("00", null) === false
);

check(
  "conflito é falso quando fato e inferência concordam",
  computeRevisionConflict("04", "04") === false
);

check(
  "conflito é verdadeiro quando divergem",
  computeRevisionConflict("00", "03") === true
);

const hidro = normalized.documents.find((d) =>
  d.name.startsWith("PRJ_HIDRO_FIOS_01-18")
);
check(
  "caso real: PRJ_HIDRO_..._R03..dwg tem revisão factual 00 e inferida 03, marcado como conflito",
  hidro &&
    hidro.revision === "00" &&
    hidro.revision_from_name === "03" &&
    hidro.revision_conflict === true
);

const memorial = normalized.documents.find((d) =>
  d.name.startsWith("Memorial Descritivo")
);
check(
  "caso real: Memorial ..._REV01.pdf tem revisão factual 00 e inferida 01, marcado como conflito",
  memorial &&
    memorial.revision === "00" &&
    memorial.revision_from_name === "01" &&
    memorial.revision_conflict === true
);

check(
  "a inferência NUNCA substitui o fato: revision continua sendo o valor da API",
  normalized.documents
    .filter((d) => d.revision_conflict)
    .every((d) => d.revision !== d.revision_from_name)
);

// ------------------------------------------------------------
console.log("");
console.log("-- Extensão --");

check(
  "extrai extensão respeitando o ponto duplo",
  extractExtension("PRJ_HIDRO_FIOS_01-18_ESG_TER_R03..dwg") === "dwg"
);

check(
  "normaliza caixa sem destruir o valor cru",
  normalizeExtension("PDF") === "pdf" && normalizeExtension("pdf") === "pdf"
);

const upperPdf = normalized.documents.find((d) => d.name.endsWith(".PDF"));
const lowerPdf = normalized.documents.find((d) => d.name.endsWith(".pdf"));

check(
  "caso real: .PDF maiúsculo preserva a caixa crua e normaliza para pdf",
  upperPdf &&
    upperPdf.extension === "PDF" &&
    upperPdf.extension_normalized === "pdf"
);

check(
  "caso real: .pdf minúsculo convive com .PDF na mesma obra",
  lowerPdf &&
    lowerPdf.extension === "pdf" &&
    lowerPdf.extension_normalized === "pdf"
);

check(
  "PDF e pdf são o mesmo tipo depois de normalizados",
  upperPdf &&
    lowerPdf &&
    upperPdf.extension_normalized === lowerPdf.extension_normalized &&
    upperPdf.extension !== lowerPdf.extension
);

// ------------------------------------------------------------
console.log("");
console.log("-- Datas naive --");

check(
  "converte data naive assumindo -03:00 e documenta a hipótese",
  CONSTRUMANAGER_ASSUMED_TIMEZONE === "America/Sao_Paulo" &&
    parseNaiveSourceDate("2026-08-21T13:35:00") === "2026-08-21T16:35:00.000Z"
);

check(
  "respeita offset explícito quando a API mandar um",
  parseNaiveSourceDate("2026-08-21T13:35:00-03:00") === "2026-08-21T16:35:00.000Z"
);

check(
  "devolve null para data ausente ou inválida em vez de inventar",
  parseNaiveSourceDate(null) === null &&
    parseNaiveSourceDate("") === null &&
    parseNaiveSourceDate("nao-e-data") === null
);

check(
  "o valor ORIGINAL nunca é perdido: *_raw preservado ao lado da conversão",
  normalized.documents.every(
    (d) =>
      d.source_created_at_raw === null ||
      (typeof d.source_created_at_raw === "string" &&
        !d.source_created_at_raw.endsWith("Z"))
  )
);

check(
  "rastreabilidade: todo documento com data convertida tem o raw correspondente",
  normalized.documents
    .filter((d) => d.source_created_at !== null)
    .every((d) => typeof d.source_created_at_raw === "string")
);

// ------------------------------------------------------------
console.log("");
console.log("-- Conferência cruzada ListaMestra x Arquivo/List --");

check(
  "cruza as duas rotas por id",
  normalized.crossCheck.masterListDocuments === 10 &&
    normalized.crossCheck.fileListDocuments === arquivoFixture.listFile.length
);

check(
  "revisão da lista mestra concorda com review de Arquivo/List (0 divergências reais)",
  normalized.crossCheck.revisionMismatches.length === 0
);

check(
  "nenhum documento vigente da lista mestra falta em Arquivo/List",
  normalized.crossCheck.missingInFileList.length === 0
);

check(
  "Arquivo/List é a autoridade da extensão crua",
  normalized.documents.every((d) => {
    const file = arquivoFixture.listFile.find(
      (f) => f.id === d.construmanager_object_id
    );
    return !file || file.extension === d.extension;
  })
);

// ------------------------------------------------------------
console.log("");
console.log("-- Autoria --");

check(
  "autoria é capturada quando a API fornece",
  normalized.documents.every(
    (d) => typeof d.author_id === "number" && typeof d.author_name === "string"
  )
);

check(
  "versões históricas também carregam autoria própria",
  normalized.versions.every((v) => typeof v.author_id === "number")
);

// ------------------------------------------------------------
console.log("");
console.log("-- Robustez: resposta malformada / vazia --");

check(
  "lista mestra nula não lança e devolve carga vazia",
  (() => {
    const out = normalizeMetadata(null, null);
    return (
      out.documents.length === 0 &&
      out.versions.length === 0 &&
      out.orphanVersionIds.length === 0
    );
  })()
);

check(
  "linhas sem cad_objects_id são descartadas em vez de virar lixo",
  normalizeMetadata(
    { listaMestra: [{ cad_objects_tipos_id: 2, isVersao: 0 }], top: null },
    null
  ).documents.length === 0
);

check(
  "campos ausentes viram null, nunca 'undefined' string",
  (() => {
    const out = normalizeMetadata(
      {
        listaMestra: [
          {
            cad_objects_id: 123,
            cad_objects_super: 456,
            cad_objects_tipos_id: 2,
            isVersao: 0,
            cad_objects_nome: "x.dwg",
            cad_objects_versoes: "00",
          },
        ],
        top: null,
      },
      null
    );
    const doc = out.documents[0];
    return doc.author_name === null && doc.source_created_at === null;
  })()
);

// ------------------------------------------------------------
console.log("");
console.log("-- Sanitização do stack trace de SQL Server --");

const rawSqlError = sqlErrorFixture.rawDescription;

check(
  "a fixture realmente contém o vazamento (senão o teste não prova nada)",
  /SqlException|System\.Data\.SqlClient/i.test(rawSqlError)
);

const sanitized = sanitizeConstrumanagerApiError(new Error(rawSqlError));

check(
  "não repassa SqlException ao usuário",
  !/SqlException/i.test(sanitized)
);

check(
  "não repassa nomes de classes internas do fornecedor",
  !/System\.Data|TdsParser|EntityCommandDefinition/i.test(sanitized)
);

check(
  "não repassa ClientConnectionId nem Error Number",
  !/ClientConnectionId|Error Number/i.test(sanitized)
);

check(
  "não repassa a consulta com os ids internos",
  !/37271646/.test(sanitized)
);

check(
  "a mensagem devolvida é curta e de uma linha só",
  sanitized.length <= 500 && !sanitized.includes("\n")
);

check(
  "mensagem de erro comum continua legível (não vira caixa-preta)",
  sanitizeConstrumanagerApiError(
    new Error("Construmanager request /Pasta/List failed with HTTP 503.")
  ).includes("HTTP 503")
);

check(
  "Bearer token nunca escapa pelo caminho de metadados",
  !sanitizeConstrumanagerApiError(
    new Error("failed with Authorization: Bearer abc123def456ghi789")
  ).includes("abc123def456ghi789")
);

check(
  "token=... nunca escapa pelo caminho de metadados",
  !sanitizeConstrumanagerApiError(
    new Error("bad token=segredosupersecreto123")
  ).includes("segredosupersecreto123")
);

check(
  "timeout continua classificável como falha transitória",
  sanitizeConstrumanagerApiError(
    new Error("Construmanager request /ListaMestra/List timed out after 15000 ms.")
  ).includes("timed out")
);

// ------------------------------------------------------------
console.log("");
console.log("-- Fixtures: ausência de segredo e de PII --");

// Pseudônimo único usado ao gerar as fixtures. A verificação é
// POSITIVA (todo autor tem que ser o pseudônimo) em vez de negativa
// contra uma lista de nomes reais — assim o nome de um terceiro nunca
// precisa existir como literal neste repositório.
const AUTHOR_PSEUDONYM = "Usuario Pseudonimizado";

function collectAuthorValues(node, found = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectAuthorValues(item, found);
    return found;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (/autor|user_nome/i.test(key) && typeof value === "string" && value) {
        found.push(value);
      }
      collectAuthorValues(value, found);
    }
  }
  return found;
}

let totalAuthorValues = 0;

for (const file of fs.readdirSync(fixturesDir)) {
  const content = fs.readFileSync(path.join(fixturesDir, file), "utf8");

  check(
    `${file} não contém Authorization/Bearer/senha/token`,
    !/authorization"?\s*[:=]|bearer\s+[A-Za-z0-9]{8}|"senha"|password/i.test(content)
  );

  const authors = collectAuthorValues(JSON.parse(content));
  totalAuthorValues += authors.length;

  check(
    `${file}: todo campo de autoria está pseudonimizado (${authors.length} ocorrência(s))`,
    authors.every((value) => value === AUTHOR_PSEUDONYM)
  );
}

check(
  "a verificação de pseudonimização realmente inspecionou campos de autoria",
  totalAuthorValues > 0
);

// ------------------------------------------------------------
console.log("");
console.log("=====================================================================");
console.log(`Resultado: ${passed} passaram, ${failed} falharam.`);
console.log("");

if (failed > 0) process.exit(1);
