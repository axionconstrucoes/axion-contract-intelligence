export type {
  AttachmentDisplayStatus,
  AttachmentDisplayStatusTone,
  AttachmentFindingsSummary,
  DocumentVersionProcessingStatus,
  EmailAttachmentRegistryFilter,
  EmailAttachmentRegistryRow,
  EmailAttachmentRegistrySortKey,
  EmailSummary,
  LinkedDocumentVersionSummary,
} from "./types";
export { resolveAttachmentDisplayStatus } from "./resolve-display-status";
export { buildEmailAttachmentRegistryRows } from "./build-registry-rows";
export type { BuildRegistryRowsInput } from "./build-registry-rows";
export { filterEmailAttachmentRows, searchEmailAttachmentRows, sortEmailAttachmentRows } from "./filter-sort-rows";
export { resolveFileExtensionLabel } from "./resolve-file-extension";

// getEmailAttachmentRegistryForProject NÃO é reexportado aqui de
// propósito: get-attachment-registry.ts é "server-only" (importa
// document-management.ts). Um client component que importasse este
// barrel arrastaria esse import e quebraria o build. A página server
// importa getEmailAttachmentRegistryForProject diretamente de
// "./get-attachment-registry", nunca por este índice.
