// Fronteira entre o formato de fio da API Construmanager e o formato
// que vai para o banco. Este é o ÚNICO módulo que conhece as
// peculiaridades do JSON real — e é puro, para ser testável sem rede.
//
// Todas as decisões aqui vêm da validação contra a obra piloto 34164,
// não de suposição. Onde a API é ambígua, o comentário diz qual foi a
// evidência.

import type {
  ConstrumanagerFile,
  ConstrumanagerFileListResponse,
  ConstrumanagerFolder,
  ConstrumanagerFolderListResponse,
  ConstrumanagerMasterListItem,
  ConstrumanagerMasterListResponse,
  MetadataCrossCheck,
  NormalizedDocument,
  NormalizedDocumentVersion,
  NormalizedFolder,
  NormalizedMetadata,
} from "./types";

// A API devolve data naive ("2026-08-21T13:35:00", sem timezone). O
// Construmanager opera em horário do Brasil e todos os carimbos de
// processamento observados vieram com offset -03:00. O Brasil não tem
// mais horário de verão desde 2019, então o offset é fixo o ano todo.
//
// HIPÓTESE EXPLÍCITA, exigida pela regra 11 do CLAUDE.md: o valor
// original nunca é descartado — fica em *_raw ao lado da conversão.
export const CONSTRUMANAGER_ASSUMED_TIMEZONE = "America/Sao_Paulo";
const CONSTRUMANAGER_ASSUMED_UTC_OFFSET = "-03:00";

export function parseNaiveSourceDate(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Só tratamos o formato naive que a API realmente usa. Se um dia ela
  // passar a mandar offset, respeitamos o que veio em vez de forçar.
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const candidate = hasOffset
    ? trimmed
    : `${trimmed}${CONSTRUMANAGER_ASSUMED_UTC_OFFSET}`;

  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toISOString();
}

// Extensão a partir do nome. Precisa tolerar o ponto duplo real dos 18
// arquivos "PRJ_HIDRO_FIOS_..._R03..dwg".
export function extractExtension(name: string): string {
  if (typeof name !== "string") return "";
  const match = name.match(/\.([^.\\/]+)$/);
  return match ? match[1] : "";
}

// A API preserva a caixa da extensão: "pdf" e "PDF" coexistem na mesma
// obra (58 + 16). O valor cru é preservado; a comparação usa o
// normalizado.
export function normalizeExtension(extension: string): string {
  return typeof extension === "string" ? extension.trim().toLowerCase() : "";
}

// Revisão embutida no NOME — INFERÊNCIA, nunca fato.
//
// Padrões reais observados:
//   PRJ_ARQ_FIOS__EXE_R04.dwg              -> 04
//   PRJ_ARQ_FIOS_EXE_REV00.bak             -> 00
//   ... - WEG REV 01.pdf                   -> 01
//   PRJ_HIDRO_FIOS_01-18_ESG_TER_R03..dwg  -> 03  (ponto duplo)
//   WLI-Topografia(00).dwg                 -> 00  (nome de versão)
//   LISTAGEM DE PROJETOS(01).xls           -> 01
//
// Devolve sempre 2 dígitos, para poder comparar com
// cad_objects_versoes ("00".."11").
export function extractRevisionFromName(name: string): string | null {
  if (typeof name !== "string") return null;

  const withoutExtension = name
    .replace(/\.[^.\\/]+$/, "")
    .replace(/\.+$/, "")
    .trim();

  if (!withoutExtension) return null;

  // Sufixo entre parênteses: como o Construmanager renomeia a versão
  // arquivada quando o nome original não tinha token de revisão.
  const parenthesized = withoutExtension.match(/\((\d{1,3})\)$/);
  if (parenthesized) {
    return String(Number(parenthesized[1])).padStart(2, "0");
  }

  const tagged = withoutExtension.match(/[_\s-]?(?:REV|R)[\s_-]?(\d{1,3})$/i);
  if (tagged) {
    return String(Number(tagged[1])).padStart(2, "0");
  }

  return null;
}

// Normaliza a revisão factual da API para comparação. cad_objects_versoes
// já vem com 2 dígitos em 100% dos casos reais, mas não dependemos disso.
function normalizeRevision(revision: string | null | undefined): string {
  if (typeof revision !== "string") return "";
  const trimmed = revision.trim();
  if (!trimmed) return "";
  return /^\d+$/.test(trimmed)
    ? String(Number(trimmed)).padStart(2, "0")
    : trimmed;
}

// FATO (API) x INFERÊNCIA (nome). Divergiu em 20 de 171 arquivos reais
// — por isso os dois são preservados e o desacordo é marcado, em vez de
// um "vencer" o outro.
export function computeRevisionConflict(
  apiRevision: string,
  revisionFromName: string | null
): boolean {
  if (revisionFromName === null) return false;
  return normalizeRevision(apiRevision) !== normalizeRevision(revisionFromName);
}

// Pasta/List entrega parentId como STRING. A raiz da obra aponta para
// um nó da empresa que NÃO vem na resposta: esse pai vira null em vez
// de virar FK órfã.
export function normalizeFolders(
  response: ConstrumanagerFolderListResponse | null | undefined
): NormalizedFolder[] {
  const rows: ConstrumanagerFolder[] = Array.isArray(response?.listFolder)
    ? response!.listFolder
    : [];

  const knownIds = new Set(rows.map((row) => Number(row.id)));

  return rows
    .filter((row) => Number.isInteger(Number(row.id)) && Number(row.id) > 0)
    .map((row) => {
      const parent = Number(row.parentId);
      const hasKnownParent = Number.isInteger(parent) && knownIds.has(parent);

      return {
        construmanager_folder_id: Number(row.id),
        parent_folder_id: hasKnownParent ? parent : null,
        name: String(row.name ?? ""),
        path: String(row.path ?? ""),
        level: Number.isInteger(Number(row.level)) ? Number(row.level) : 0,
      };
    });
}

// A API devolve as linhas em `listaMestra` normalmente, mas em `top`
// quando a requisição manda `top`. Nós não mandamos, mas ler as duas
// evita um "0 documentos" silencioso se isso mudar.
export function extractMasterListRows(
  response: ConstrumanagerMasterListResponse | null | undefined
): ConstrumanagerMasterListItem[] {
  if (!response) return [];
  if (Array.isArray(response.listaMestra) && response.listaMestra.length > 0) {
    return response.listaMestra;
  }
  if (Array.isArray(response.top) && response.top.length > 0) {
    return response.top;
  }
  return Array.isArray(response.listaMestra) ? response.listaMestra : [];
}

// cad_objects_tipos_id: 1 = pasta, 2 = arquivo (5 e 203 na obra real).
const TIPO_ARQUIVO = 2;

function isFileRow(row: ConstrumanagerMasterListItem): boolean {
  return Number(row.cad_objects_tipos_id) === TIPO_ARQUIVO;
}

function toNullableNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNullableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function normalizeMetadata(
  masterList: ConstrumanagerMasterListResponse | null | undefined,
  fileList: ConstrumanagerFileListResponse | null | undefined
): NormalizedMetadata {
  const rows = extractMasterListRows(masterList).filter(isFileRow);

  const files: ConstrumanagerFile[] = Array.isArray(fileList?.listFile)
    ? fileList!.listFile
    : [];
  const filesById = new Map(files.map((file) => [Number(file.id), file]));

  const documents: NormalizedDocument[] = [];
  const versions: NormalizedDocumentVersion[] = [];

  for (const row of rows) {
    const objectId = Number(row.cad_objects_id);
    if (!Number.isInteger(objectId) || objectId <= 0) continue;

    const name = String(row.cad_objects_nome ?? "");
    const revision = String(row.cad_objects_versoes ?? "");
    const revisionFromName = extractRevisionFromName(name);

    // Arquivo/List é a autoridade da extensão CRUA (preserva a caixa
    // como o usuário subiu). Versões históricas não aparecem lá, então
    // caímos para o nome.
    const crossFile = filesById.get(objectId);
    const extension = crossFile?.extension ?? extractExtension(name);

    const shared = {
      revision,
      revision_from_name: revisionFromName,
      revision_conflict: computeRevisionConflict(revision, revisionFromName),
      name,
      extension,
      extension_normalized: normalizeExtension(extension),
      author_id: toNullableNumber(row.cad_user_cons_id),
      author_name: toNullableText(row.cad_user_nome),
      source_created_at_raw: toNullableText(row.cad_objects_criacao),
      source_created_at: parseNaiveSourceDate(row.cad_objects_criacao),
      source_approved_at_raw: toNullableText(row.cad_objects_aprovado_data),
      source_approved_at: parseNaiveSourceDate(row.cad_objects_aprovado_data),
      size_bytes: toNullableNumber(row.cad_objects_tamanho),
      status_label: toNullableText(row.cad_objects_status),
    };

    // cad_objects_super é POLIMÓRFICO. Aqui é o único lugar do sistema
    // onde essa ambiguidade é resolvida, e ela é resolvida para dois
    // campos com nomes diferentes — nunca para um "parent_id" genérico.
    const superId = Number(row.cad_objects_super);

    if (Number(row.isVersao) === 1) {
      versions.push({
        ...shared,
        construmanager_version_object_id: objectId,
        // super de uma VERSÃO = documento-cabeça.
        construmanager_head_object_id: superId,
        folder_path:
          toNullableText(row.cad_objects_caminho_pai_versao) ??
          toNullableText(row.cad_objects_caminho_pai),
      });
      continue;
    }

    documents.push({
      ...shared,
      construmanager_object_id: objectId,
      // super de um DOCUMENTO VIGENTE = pasta.
      construmanager_folder_id: superId,
      has_versions: Boolean(row.isContemVersao),
      folder_path: toNullableText(row.cad_objects_caminho_pai),
    });
  }

  const documentIds = new Set(documents.map((doc) => doc.construmanager_object_id));

  // Versão sem cabeça na mesma resposta: nunca inventar vínculo. Sai da
  // carga e vira diagnóstico.
  const orphanVersionIds = versions
    .filter((version) => !documentIds.has(version.construmanager_head_object_id))
    .map((version) => version.construmanager_version_object_id);

  const orphanSet = new Set(orphanVersionIds);
  const linkedVersions = versions.filter(
    (version) => !orphanSet.has(version.construmanager_version_object_id)
  );

  return {
    folders: [],
    documents,
    versions: linkedVersions,
    orphanVersionIds,
    crossCheck: buildCrossCheck(documents, files),
  };
}

// Conferência cruzada ListaMestra x Arquivo/List por id. Diagnóstico
// puro: não altera a carga, só expõe desacordo entre as duas rotas.
export function buildCrossCheck(
  documents: NormalizedDocument[],
  files: ConstrumanagerFile[]
): MetadataCrossCheck {
  const documentsById = new Map(
    documents.map((doc) => [doc.construmanager_object_id, doc])
  );
  const fileIds = new Set(files.map((file) => Number(file.id)));

  const missingInFileList = documents
    .filter((doc) => !fileIds.has(doc.construmanager_object_id))
    .map((doc) => doc.construmanager_object_id);

  const missingInMasterList = files
    .map((file) => Number(file.id))
    .filter((id) => !documentsById.has(id));

  // review (Arquivo/List) x cad_objects_versoes (ListaMestra):
  // concordaram em 192/192 na obra real. Se algum dia divergirem,
  // queremos saber em vez de escolher em silêncio.
  const revisionMismatches = files
    .filter((file) => {
      const doc = documentsById.get(Number(file.id));
      if (!doc) return false;
      return normalizeRevision(file.review) !== normalizeRevision(doc.revision);
    })
    .map((file) => Number(file.id));

  return {
    masterListDocuments: documents.length,
    fileListDocuments: files.length,
    missingInFileList,
    missingInMasterList,
    revisionMismatches,
  };
}
