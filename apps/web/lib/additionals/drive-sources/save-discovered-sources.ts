// Persiste os resultados de discoverProposalDriveSources. Nunca finge
// que o CONTEÚDO foi lido (seção 4) — todo arquivo novo entra sempre
// como processing_status = SOURCE_REQUIRES_PROCESSING; só o
// processamento explícito (fora deste módulo, mesmo princípio de duas
// etapas de email/attachments) pode promover para PROCESSED. Idempotente
// por (proposal_id, drive_file_id) — nunca duplica na redescoberta.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DiscoveredDriveEntry } from "./discover-drive-sources";
import type { AdditionalProposalDriveSource } from "./types";

function mapRow(row: Record<string, unknown>): AdditionalProposalDriveSource {
  return {
    id: row.id as string,
    proposalId: row.proposal_id as string,
    driveFileId: row.drive_file_id as string,
    driveFolderId: (row.drive_folder_id as string | null) ?? null,
    driveRevisionId: (row.drive_revision_id as string | null) ?? null,
    driveModifiedTime: (row.drive_modified_time as string | null) ?? null,
    fileName: row.file_name as string,
    mimeType: row.mime_type as string,
    semanticFolderCategory: (row.semantic_folder_category as AdditionalProposalDriveSource["semanticFolderCategory"]) ?? null,
    sourceClassification: row.source_classification as AdditionalProposalDriveSource["sourceClassification"],
    sha256Hash: (row.sha256_hash as string | null) ?? null,
    processingStatus: row.processing_status as AdditionalProposalDriveSource["processingStatus"],
    documentVersionId: (row.document_version_id as string | null) ?? null,
    discoveredAt: row.discovered_at as string,
    createdByType: row.created_by_type as AdditionalProposalDriveSource["createdByType"],
    createdByUserId: (row.created_by_user_id as string | null) ?? null,
    createdByLabel: (row.created_by_label as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

const SOURCE_COLUMNS =
  "id,proposal_id,drive_file_id,drive_folder_id,drive_revision_id,drive_modified_time,file_name,mime_type,semantic_folder_category,source_classification,sha256_hash,processing_status,document_version_id,discovered_at,created_by_type,created_by_user_id,created_by_label,created_at";

export interface SaveDiscoveredSourceResult {
  source: AdditionalProposalDriveSource;
  /** false quando o arquivo já havia sido descoberto antes (mesmo drive_file_id) — nunca duplicado. */
  created: boolean;
}

export async function saveDiscoveredSources(
  supabase: SupabaseClient,
  proposalId: string,
  entries: DiscoveredDriveEntry[],
  createdByUserId?: string
): Promise<SaveDiscoveredSourceResult[]> {
  const results: SaveDiscoveredSourceResult[] = [];

  for (const entry of entries) {
    const { data: existing, error: existingError } = await supabase
      .from("additional_proposal_drive_sources")
      .select(SOURCE_COLUMNS)
      .eq("proposal_id", proposalId)
      .eq("drive_file_id", entry.driveFileId)
      .maybeSingle();

    if (existingError) throw new Error(`Falha ao verificar fonte Drive existente: ${existingError.message}`);
    if (existing) {
      results.push({ source: mapRow(existing as unknown as Record<string, unknown>), created: false });
      continue;
    }

    const { data, error } = await supabase
      .from("additional_proposal_drive_sources")
      .insert({
        proposal_id: proposalId,
        drive_file_id: entry.driveFileId,
        drive_folder_id: entry.driveFolderId,
        drive_revision_id: entry.driveRevisionId,
        drive_modified_time: entry.driveModifiedTime,
        file_name: entry.fileName,
        mime_type: entry.mimeType,
        semantic_folder_category: entry.semanticFolderCategory,
        source_classification: entry.sourceClassification,
        processing_status: "SOURCE_REQUIRES_PROCESSING",
        created_by_type: createdByUserId ? "USER" : "SYSTEM",
        created_by_user_id: createdByUserId ?? null,
      })
      .select(SOURCE_COLUMNS)
      .single();

    if (error) throw new Error(`Falha ao salvar fonte Drive descoberta: ${error.message}`);
    results.push({ source: mapRow(data as unknown as Record<string, unknown>), created: true });
  }

  return results;
}
