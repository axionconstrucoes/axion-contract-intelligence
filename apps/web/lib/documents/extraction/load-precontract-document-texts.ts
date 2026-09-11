// Carrega, NO SERVIDOR, o texto contratual dos documentos de uma análise
// pré-contratual. É a única fonte de conteúdo documental do Consultor
// Jurídico — o navegador nunca envia texto de contrato, apenas o
// identificador da rota.
//
// Isolamento (quatro camadas, nenhuma delas opcional):
//   1. todo SELECT parte de `documents.project_id = :projectId`;
//   2. RLS: o cliente é sempre o de sessão do usuário
//      (createSupabaseServerClient), nunca o admin — um projeto do qual o
//      usuário não é membro simplesmente não retorna linha;
//   3. o Storage tem policy própria por membro do projeto, ancorada no
//      primeiro segmento do path (o projectId) — ver migration
//      20260821004108 (project_documents_storage_select_members);
//   4. o prefixo do path é conferido AQUI, explicitamente, antes de
//      qualquer download — nunca se confia só na policy.
//
// Somente leitura: nenhuma linha é criada, atualizada ou apagada. A
// persistência de extrações continua sendo responsabilidade exclusiva de
// scripts/process-document-version.mjs.

// NAO usa `import "server-only"`: este modulo esta no grafo de imports de
// ai/context/build-project-context.ts, que por sua vez e carregado pelos
// scripts Node do repositorio (scripts/test-*.mjs, analise offline). O
// pacote server-only quebraria todos eles. A garantia de servidor vem do
// uso: quem chama e Server Action/Server Component, e nada aqui le
// variavel de ambiente nem secret.

import type { SupabaseClient } from "@supabase/supabase-js";
import { planContractualBudget } from "../../legal/precontract-context-budget";
import {
  EmptyDocumentTextError,
  UnsupportedDocumentFormatError,
  extractDocumentText,
  truncateForContext,
} from "./extract-document-text";
import { resolveExtractionFormat } from "./document-format";

const STORAGE_BUCKET = "project-documents";

/** Tipos documentais que compõem a base contratual de uma negociação. */
const CONTRACTUAL_KINDS = [
  "CONTRATO_BASE",
  "ADITIVO",
  "EDITAL",
  "PROPOSTA_COMERCIAL",
  "PROPOSTA_TECNICA",
  "PROPOSTA_AXION",
  "PLANILHA_CONTRATUAL",
  "ESPECIFICACAO",
  "CLARIFICACAO_CLIENTE",
] as const;

/**
 * Teto explícito de documentos considerados por consulta. Documentar o
 * teto é parte do requisito: acima disto os mais antigos são OMITIDOS de
 * forma declarada (ver `availableCount`/`omitted`), nunca em silêncio.
 */
const MAX_DOCUMENTS = 5;

/**
 * Orçamento de caracteres para a base contratual inteira. Caractere, não
 * token: é uma aproximação conservadora (~4 chars/token) para não
 * estourar ANTHROPIC_MAX_TOKENS. O rateio entre documentos é
 * determinístico — ver lib/legal/precontract-context-budget.ts.
 */
const CONTRACTUAL_TEXT_BUDGET = 120_000;

interface DocumentRow {
  id: string;
  kind: string;
  title: string;
  project_id: string;
}

interface VersionRow {
  id: string;
  document_id: string;
  version_index: number;
  version_label: string | null;
  // Nomes REAIS das colunas em document_versions: `file_path` e
  // `storage_bucket`. Nao existe `storage_path` nesta tabela — esse
  // nome pertence a email_attachments/contract_attachments, e usa-lo
  // aqui fazia o Postgres recusar o SELECT inteiro com 42703.
  file_path: string | null;
  storage_bucket: string | null;
  original_file_name: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  processing_status: string | null;
}

export interface PrecontractDocumentText {
  documentId: string;
  documentVersionId: string;
  title: string;
  kind: string;
  versionLabel: string | null;
  fileName: string;
  pageCount: number | null;
  /** Caracteres do documento COMPLETO, antes de qualquer corte. */
  characterCount: number;
  /** Texto já ajustado ao rateio — pode estar truncado. */
  text: string;
  truncated: boolean;
  omittedCharacters: number;
}

export interface PrecontractDocumentFailure {
  documentId: string;
  title: string;
  fileName: string;
  reason: string;
}

export interface PrecontractDocumentLoadResult {
  documents: PrecontractDocumentText[];
  failures: PrecontractDocumentFailure[];
  /** Documentos contratuais ativos que existem no projeto. */
  availableCount: number;
  /** Legíveis que não couberam no orçamento e ficaram de fora. */
  omittedForBudget: PrecontractDocumentFailure[];
  includedCharacters: number;
  omittedCharacters: number;
  /** true se QUALQUER documento incluído teve corte. */
  truncated: boolean;
}

/**
 * Baixa um objeto usando o bucket REGISTRADO NA PRÓPRIA VERSÃO — mesma
 * abordagem de scripts/process-document-version.mjs. O prefixo do path e
 * o bucket já foram conferidos pelo chamador; esta função nunca recebe
 * um par (bucket, path) não verificado.
 */
async function downloadStorageObject(
  supabase: SupabaseClient,
  bucket: string,
  filePath: string
): Promise<ArrayBuffer> {
  const { data, error } = await supabase.storage.from(bucket).download(filePath);

  if (error || !data) {
    throw new Error(`Falha ao baixar o documento do armazenamento: ${error?.message ?? "sem detalhe"}`);
  }

  return data.arrayBuffer();
}

/** Versão vigente = maior version_index do documento. */
function pickCurrentVersions(versions: VersionRow[]): Map<string, VersionRow> {
  const currentByDocument = new Map<string, VersionRow>();

  for (const version of versions) {
    const existing = currentByDocument.get(version.document_id);
    if (!existing || version.version_index > existing.version_index) {
      currentByDocument.set(version.document_id, version);
    }
  }

  return currentByDocument;
}

/**
 * Confere que o objeto pertence mesmo à pasta do projeto. A policy do
 * Storage já faz isso no banco; repetir aqui garante que um path
 * divergente NUNCA chegue a virar um download, mesmo que a policy mude.
 */
export function isStoragePathInsideProject(storagePath: string, projectId: string): boolean {
  return storagePath.startsWith(`${projectId}/`);
}

/**
 * Lista os documentos contratuais ATIVOS do projeto e extrai o texto da
 * versão vigente de cada um, respeitando o rateio de contexto.
 * Documentos que não puderem ser lidos entram em `failures` com o
 * motivo; os que não couberem, em `omittedForBudget`. Nada some em
 * silêncio, e nenhuma versão antiga é usada como substituta quando a
 * vigente falha.
 */
export async function loadPrecontractDocumentTexts(
  supabase: SupabaseClient,
  input: { projectId: string; maxDocuments?: number; budget?: number }
): Promise<PrecontractDocumentLoadResult> {
  const { projectId } = input;
  const limit = input.maxDocuments ?? MAX_DOCUMENTS;
  const budget = input.budget ?? CONTRACTUAL_TEXT_BUDGET;

  const empty: PrecontractDocumentLoadResult = {
    documents: [],
    failures: [],
    availableCount: 0,
    omittedForBudget: [],
    includedCharacters: 0,
    omittedCharacters: 0,
    truncated: false,
  };

  const { data: documentsData, error: documentsError } = await supabase
    .from("documents")
    .select("id,kind,title,project_id")
    .eq("project_id", projectId)
    .in("kind", [...CONTRACTUAL_KINDS])
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (documentsError) {
    throw new Error(`Falha ao carregar documentos da análise: ${documentsError.message}`);
  }

  const documents = (documentsData ?? []) as unknown as DocumentRow[];
  if (documents.length === 0) return empty;

  // Defesa redundante ao filtro e à RLS: nenhuma linha de outro projeto
  // pode seguir adiante, nem por engano de query futura.
  if (documents.some((document) => document.project_id !== projectId)) {
    throw new Error(
      "Documento de outro projeto retornado pelo banco — consulta abortada. Nenhum conteúdo é enviado ao Expert."
    );
  }

  const { data: versionsData, error: versionsError } = await supabase
    .from("document_versions")
    .select(
      "id,document_id,version_index,version_label,file_path,storage_bucket,original_file_name,mime_type,file_size_bytes,processing_status"
    )
    .in(
      "document_id",
      documents.map((document) => document.id)
    )
    .order("version_index", { ascending: false });

  if (versionsError) {
    throw new Error(`Falha ao carregar versões dos documentos: ${versionsError.message}`);
  }

  const currentByDocument = pickCurrentVersions((versionsData ?? []) as unknown as VersionRow[]);

  // --- Passo 1: extrair o texto completo do que for legível -----------
  const extracted: Array<{
    documentId: string;
    documentVersionId: string;
    title: string;
    kind: string;
    versionLabel: string | null;
    fileName: string;
    pageCount: number | null;
    fullText: string;
  }> = [];
  const failures: PrecontractDocumentFailure[] = [];

  for (const document of documents) {
    const version = currentByDocument.get(document.id);
    const fileName = version?.original_file_name ?? document.title;

    if (!version || !version.file_path) {
      failures.push({
        documentId: document.id,
        title: document.title,
        fileName,
        reason: "Documento sem arquivo armazenado.",
      });
      continue;
    }

    // Bucket: nunca um fallback silencioso. Ausente ou diferente do
    // bucket autorizado para documentos de projeto, o documento e
    // recusado ANTES de qualquer download.
    if (version.storage_bucket !== STORAGE_BUCKET) {
      console.error(
        "[precontract-context] bucket inesperado para o documento — download recusado:",
        { documentId: document.id, bucket: version.storage_bucket }
      );
      failures.push({
        documentId: document.id,
        title: document.title,
        fileName,
        reason: "Documento armazenado fora do repositório autorizado desta análise.",
      });
      continue;
    }

    // Isolamento explícito antes de qualquer download.
    if (!isStoragePathInsideProject(version.file_path, projectId)) {
      console.error("[precontract-context] path fora do projeto — download recusado:", document.id);
      failures.push({
        documentId: document.id,
        title: document.title,
        fileName,
        reason: "Documento não pertence a esta análise.",
      });
      continue;
    }

    if (resolveExtractionFormat(version.mime_type, fileName) === null) {
      failures.push({
        documentId: document.id,
        title: document.title,
        fileName,
        reason: "Formato não suportado para leitura (use PDF, DOCX ou TXT).",
      });
      continue;
    }

    try {
      const buffer = await downloadStorageObject(supabase, version.storage_bucket, version.file_path);
      const result = await extractDocumentText({ buffer, mimeType: version.mime_type, fileName });

      extracted.push({
        documentId: document.id,
        documentVersionId: version.id,
        title: document.title,
        kind: document.kind,
        versionLabel: version.version_label,
        fileName,
        pageCount: result.pageCount,
        fullText: result.text,
      });
    } catch (error) {
      // Falha da versão VIGENTE nunca cai para uma versão anterior: o
      // usuário precisa saber que o documento atual não foi lido.
      const reason =
        error instanceof UnsupportedDocumentFormatError || error instanceof EmptyDocumentTextError
          ? error.detail
          : "Não foi possível ler o conteúdo deste documento.";

      failures.push({ documentId: document.id, title: document.title, fileName, reason });
    }
  }

  // --- Passo 2: rateio determinístico do orçamento -------------------
  const plan = planContractualBudget(
    extracted.map((item) => ({ id: item.documentVersionId, characterCount: item.fullText.length })),
    budget
  );
  const allowedById = new Map(plan.allocations.map((allocation) => [allocation.id, allocation]));

  const loaded: PrecontractDocumentText[] = [];
  const omittedForBudget: PrecontractDocumentFailure[] = [];
  let includedCharacters = 0;
  let omittedCharacters = 0;

  for (const item of extracted) {
    const allocation = allowedById.get(item.documentVersionId);

    if (!allocation || !allocation.included) {
      omittedCharacters += item.fullText.length;
      omittedForBudget.push({
        documentId: item.documentId,
        title: item.title,
        fileName: item.fileName,
        reason: "Não coube no limite de contexto desta consulta.",
      });
      continue;
    }

    const slice = truncateForContext(item.fullText, allocation.allowedCharacters);
    includedCharacters += slice.text.length;
    omittedCharacters += slice.omittedCharacters;

    loaded.push({
      documentId: item.documentId,
      documentVersionId: item.documentVersionId,
      title: item.title,
      kind: item.kind,
      versionLabel: item.versionLabel,
      fileName: item.fileName,
      pageCount: item.pageCount,
      characterCount: item.fullText.length,
      text: slice.text,
      truncated: slice.truncated,
      omittedCharacters: slice.omittedCharacters,
    });
  }

  return {
    documents: loaded,
    failures,
    availableCount: documents.length,
    omittedForBudget,
    includedCharacters,
    omittedCharacters,
    truncated: loaded.some((document) => document.truncated) || omittedForBudget.length > 0,
  };
}

export { CONTRACTUAL_KINDS, CONTRACTUAL_TEXT_BUDGET, MAX_DOCUMENTS, STORAGE_BUCKET };
