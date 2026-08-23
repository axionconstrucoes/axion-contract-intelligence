import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdditionalProposalDriveSource } from "./types";

const SOURCE_COLUMNS =
  "id,proposal_id,drive_file_id,drive_folder_id,drive_revision_id,drive_modified_time,file_name,mime_type,semantic_folder_category,source_classification,sha256_hash,processing_status,document_version_id,discovered_at,created_by_type,created_by_user_id,created_by_label,created_at";

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

export async function getDriveSourcesForProposal(supabase: SupabaseClient, proposalId: string): Promise<AdditionalProposalDriveSource[]> {
  const { data, error } = await supabase
    .from("additional_proposal_drive_sources")
    .select(SOURCE_COLUMNS)
    .eq("proposal_id", proposalId)
    .order("discovered_at", { ascending: true });
  if (error) throw new Error(`Falha ao carregar fontes Drive da proposta: ${error.message}`);
  return (data as unknown as Record<string, unknown>[]).map(mapRow);
}
