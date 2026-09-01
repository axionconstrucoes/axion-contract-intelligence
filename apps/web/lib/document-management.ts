import "server-only";

import { createSupabaseServerClient } from "@axion/db/server";
import { withActiveDocumentFilter } from "@/lib/documents/active-document-filter";
import { mapContractualLinkFields } from "@/lib/documents/map-contractual-link-fields";

export type TranslationStatus = "NOT_TRANSLATED" | "REQUESTED" | "AVAILABLE";

export type ManagedDocumentVersion = {
  id: string;
  documentId: string;
  versionLabel: string;
  versionIndex: number;
  documentDate: string;
  sourceType: string;
  author: string;
  summary: string;
  filePath: string | null;
  storageBucket: string | null;
  originalFileName: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  processingStatus: string;
  processingError: string | null;
  uploadedAt: string;
  notes: string | null;
  // Idioma real do texto extraído (ISO 639-1 quando mapeado), detectado
  // pelo worker de processamento — null até ser processado/detectável.
  sourceLanguage: string | null;
  translationLanguage: string | null;
  translationStatus: TranslationStatus;
  // Invariante fixo (tipo literal, nunca uma coluna): o arquivo original
  // é sempre a fonte autoritativa — uma tradução, quando existir, é
  // apoio, nunca substitui o original. Mesmo padrão de
  // AiAssessment.requiresHumanReview.
  originalIsAuthoritative: true;
  // SHA-256 do conteúdo do arquivo (migration 20260825130000) — null
  // para versões enviadas antes desta migration, pelo upload
  // individual sem hash, ou por qualquer fluxo futuro que não o
  // informe. Usado só para deduplicação client-side no upload
  // múltiplo, nunca como identificador de segurança por si só.
  sha256Hash: string | null;
  // true quando este documento exige revisão humana antes de ser
  // considerado confiável (hoje: só Ata de Reunião, calculado no
  // servidor a partir do kind — nunca aceito do cliente).
  requiresHumanReview: boolean;
};

export type ManagedDocument = {
  id: string;
  projectId: string;
  kind: string;
  title: string;
  createdAt: string;
  versions: ManagedDocumentVersion[];
  // Vínculo real com o documento pai (contrato-base ou aditivo ao qual
  // este documento foi formalmente incorporado como anexo contratual)
  // — usado por group-contractual-documents.ts e pela regra de cor
  // bordô (isContractualAttachment). O SCHEMA para persistir isso já
  // existe (migration 20260829090000_document_contractual_attachment_linkage.sql
  // — contractual_parent_document_id/incorporation_basis/
  // linked_by_user_id/linked_at em documents, com RPCs
  // link_document_as_contractual_attachment/
  // unlink_document_contractual_attachment como único caminho de
  // escrita), mas essa migration AINDA NÃO FOI APLICADA no banco que
  // esta aplicação usa hoje (ver relatório, "Compatibilidade de
  // deploy") — por isso estes 5 campos continuam sempre `null` aqui,
  // deliberadamente, até a migration ser revisada/aplicada e só então
  // a leitura real ser ligada (troca de uma linha em
  // getManagedDocuments, usando mapContractualLinkFields, já escrita e
  // testada com mocks em
  // apps/web/lib/documents/map-contractual-link-fields.ts). Nunca
  // inferido pelo nome/título — só por esse vínculo persistido.
  parentDocumentId: string | null;
  contractualIncorporationBasis: string | null;
  contractualLinkedByUserId: string | null;
  contractualLinkedByUserName: string | null;
  contractualLinkedAt: string | null;
};

type DocumentRow = {
  id: string;
  project_id: string;
  kind: string;
  title: string;
  created_at: string;
  // Presentes só depois da migration 20260829090000 ser aplicada —
  // select("*") nunca falha pela ausência deles (não é uma lista
  // explícita de colunas), então o mapeamento abaixo trata a ausência
  // como "sem vínculo" (undefined ?? null), nunca como erro. Ver
  // map-contractual-link-fields.ts.
  contractual_parent_document_id?: string | null;
  contractual_incorporation_basis?: string | null;
  contractual_linked_by_user_id?: string | null;
  contractual_linked_at?: string | null;
};

type VersionRow = {
  id: string;
  document_id: string;
  version_label: string;
  version_index: number;
  document_date: string;
  source_type: string;
  author: string;
  summary: string;
  file_path: string | null;
  storage_bucket: string | null;
  original_file_name: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  processing_status: string;
  processing_error: string | null;
  uploaded_at: string;
  notes: string | null;
  source_language: string | null;
  translation_language: string | null;
  translation_status: string;
  sha256_hash: string | null;
  requires_human_review: boolean;
};

export async function getManagedDocuments(
  projectId: string
): Promise<ManagedDocument[]> {
  const supabase = await createSupabaseServerClient();

  // Regra CANÔNICA de "documento ativo" — ver
  // apps/web/lib/documents/active-document-filter.ts. 42703
  // (undefined_column) = migration 20260829150000 ainda não aplicada
  // nesse banco: refaz a MESMA consulta sem o filtro, nunca quebra a
  // lista; qualquer OUTRO erro é propagado.
  const { data: documentsData, error: documentsError } = await withActiveDocumentFilter((filterActive) => {
    let query = supabase.from("documents").select("*").eq("project_id", projectId);
    if (filterActive) query = query.is("deleted_at", null);
    return query.order("created_at", { ascending: false });
  });

  if (documentsError) {
    if (documentsError.code === "22P02") {
      return [];
    }
    throw documentsError;
  }

  const documents =
    (documentsData ?? []) as unknown as DocumentRow[];

  if (documents.length === 0) {
    return [];
  }

  const { data: versionsData, error: versionsError } =
    await supabase
      .from("document_versions")
      .select("*")
      .in(
        "document_id",
        documents.map((document) => document.id)
      )
      .order("version_index", { ascending: false });

  if (versionsError) {
    throw versionsError;
  }

  const versions =
    (versionsData ?? []) as unknown as VersionRow[];

  const versionsByDocument =
    new Map<string, ManagedDocumentVersion[]>();

  for (const version of versions) {
    const list =
      versionsByDocument.get(version.document_id) ?? [];

    list.push({
      id: version.id,
      documentId: version.document_id,
      versionLabel: version.version_label,
      versionIndex: version.version_index,
      documentDate: version.document_date,
      sourceType: version.source_type,
      author: version.author,
      summary: version.summary,
      filePath: version.file_path,
      storageBucket: version.storage_bucket,
      originalFileName: version.original_file_name,
      mimeType: version.mime_type,
      fileSizeBytes: version.file_size_bytes,
      processingStatus: version.processing_status,
      processingError: version.processing_error,
      uploadedAt: version.uploaded_at,
      notes: version.notes,
      sourceLanguage: version.source_language,
      translationLanguage: version.translation_language,
      translationStatus: version.translation_status as TranslationStatus,
      originalIsAuthoritative: true,
      sha256Hash: version.sha256_hash,
      requiresHumanReview: version.requires_human_review,
    });

    versionsByDocument.set(
      version.document_id,
      list
    );
  }

  // Nomes de quem vinculou cada anexo contratual (join com profiles,
  // mesmo padrão de event-notes.ts) — só resolvido para os ids
  // realmente presentes nesta página; ausente (migration não aplicada,
  // ou nenhum vínculo) = mapa vazio, mapContractualLinkFields trata bem
  // os dois casos.
  const linkedByUserIds = Array.from(
    new Set(
      documents
        .map((document) => document.contractual_linked_by_user_id)
        .filter((id): id is string => Boolean(id))
    )
  );

  const linkedByUserNameById = new Map<string, string>();
  if (linkedByUserIds.length > 0) {
    const { data: profilesData, error: profilesError } = await supabase
      .from("profiles")
      .select("id,name")
      .in("id", linkedByUserIds);

    if (profilesError) {
      throw profilesError;
    }

    for (const profile of (profilesData ?? []) as unknown as { id: string; name: string }[]) {
      linkedByUserNameById.set(profile.id, profile.name);
    }
  }

  return documents.map((document) => ({
    id: document.id,
    projectId: document.project_id,
    kind: document.kind,
    title: document.title,
    createdAt: document.created_at,
    versions:
      versionsByDocument.get(document.id) ?? [],
    ...mapContractualLinkFields(
      {
        contractual_parent_document_id: document.contractual_parent_document_id ?? null,
        contractual_incorporation_basis: document.contractual_incorporation_basis ?? null,
        contractual_linked_by_user_id: document.contractual_linked_by_user_id ?? null,
        contractual_linked_at: document.contractual_linked_at ?? null,
      },
      linkedByUserNameById
    ),
  }));
}

// "Anexos do Contrato" (document_version_files, file_role =
// 'ANEXO_CONTRATUAL' — migration 20260825010713 + 20260831210000) —
// só a CONTAGEM por versão, para o contador do card ("Anexos do
// contrato (N)") já aparecer no primeiro render sem esperar o usuário
// expandir o painel. A lista completa (nome/tamanho/uploader/etc.) é
// buscada client-side sob demanda, só quando o painel é expandido — ver
// use-contract-attachments.ts.
export async function getContractAttachmentCounts(
  documentVersionIds: readonly string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (documentVersionIds.length === 0) {
    return counts;
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("document_version_files")
    .select("document_version_id")
    .in("document_version_id", documentVersionIds)
    .eq("file_role", "ANEXO_CONTRATUAL");

  if (error) {
    // Mesma filosofia fail-safe de getTrashedDocuments: uma migration
    // ainda não aplicada nesse banco (42P01/PGRST205, tabela ausente)
    // nunca quebra a página inteira — o contador simplesmente aparece
    // como 0 até a migration ser aplicada. Qualquer OUTRO erro continua
    // propagado.
    if (error.code === "42P01" || error.code === "PGRST205" || error.code === "42703") {
      return counts;
    }
    throw error;
  }

  for (const row of (data ?? []) as unknown as { document_version_id: string }[]) {
    counts.set(row.document_version_id, (counts.get(row.document_version_id) ?? 0) + 1);
  }

  return counts;
}

export type TrashedDocument = {
  id: string;
  kind: string;
  title: string;
  deletedAt: string;
  deletedByUserName: string | null;
};

type TrashedDocumentRow = {
  id: string;
  kind: string;
  title: string;
  deleted_at: string;
  deleted_by_user_id: string | null;
};

// Lixeira (migration 20260829150000) — SEMPRE via a RPC
// list_trashed_project_documents (SECURITY DEFINER), NUNCA um SELECT
// direto em documents: "visualizar a lixeira" é ADMIN-only no
// SERVIDOR (a RPC recusa quem não for ADMINISTRADOR ativo do
// projeto), não só uma tela escondida na UI — mesma exigência das
// RPCs trash/restore. page.tsx chama esta função incondicionalmente
// (em paralelo com as outras, antes de saber a permissão do usuário),
// então dois erros são esperados e tratados como "lixeira vazia para
// mim", nunca como falha fatal da página inteira:
//   - a própria RPC recusando por falta de permissão (mensagem com o
//     prefixo estável "Somente Administrador", nunca inferido de texto
//     livre além desse prefixo já usado por trash/restore);
//   - 42703/PGRST202 (função ainda não existe nesse banco — migration
//     não aplicada).
// Qualquer OUTRO erro continua propagado (nunca escondido).
export async function getTrashedDocuments(
  projectId: string
): Promise<TrashedDocument[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("list_trashed_project_documents", {
    p_project_id: projectId,
  });

  if (error) {
    if (
      error.code === "42703" ||
      error.code === "42883" ||
      error.code === "PGRST202" ||
      error.code === "22P02" ||
      error.message.startsWith("Somente Administrador")
    ) {
      return [];
    }
    throw error;
  }

  const rows = (data ?? []) as unknown as TrashedDocumentRow[];
  if (rows.length === 0) {
    return [];
  }

  const deletedByUserIds = Array.from(
    new Set(rows.map((row) => row.deleted_by_user_id).filter((id): id is string => Boolean(id)))
  );

  const nameById = new Map<string, string>();
  if (deletedByUserIds.length > 0) {
    const { data: profilesData, error: profilesError } = await supabase
      .from("profiles")
      .select("id,name")
      .in("id", deletedByUserIds);

    if (profilesError) {
      throw profilesError;
    }

    for (const profile of (profilesData ?? []) as unknown as { id: string; name: string }[]) {
      nameById.set(profile.id, profile.name);
    }
  }

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    deletedAt: row.deleted_at,
    deletedByUserName: row.deleted_by_user_id ? (nameById.get(row.deleted_by_user_id) ?? null) : null,
  }));
}
