"use client";

// Monta o pacote ZIP de evidências (seção 5): 00_MANIFESTO.pdf,
// 01_INDICE.xlsx, 02_TIMELINE.pdf, EVIDENCIAS/<arquivos>, manifest.json.
// Nunca modifica o conteúdo de um arquivo original — só o organiza dentro
// do pacote. Nomes originais são preservados nos metadados (manifest.json
// + ManifestEvidenceEntry.originalFileName), mesmo quando o nome dentro de
// EVIDENCIAS/ precisa ser sanitizado/prefixado para evitar colisão.

import JSZip from "jszip";

import type { ResolvedEvidenceFile } from "./resolve-evidence-files";
import type { TimelineExportManifest } from "./types";

export interface BuildZipPackageInput {
  manifest: TimelineExportManifest;
  manifestoPdf: Blob;
  indiceXlsx: Blob;
  timelinePdf: Blob;
  evidenceFiles: ResolvedEvidenceFile[];
}

export async function buildZipPackage({
  manifest,
  manifestoPdf,
  indiceXlsx,
  timelinePdf,
  evidenceFiles,
}: BuildZipPackageInput): Promise<Blob> {
  const zip = new JSZip();

  zip.file("00_MANIFESTO.pdf", manifestoPdf);
  zip.file("01_INDICE.xlsx", indiceXlsx);
  zip.file("02_TIMELINE.pdf", timelinePdf);
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  const evidenceFolder = zip.folder("EVIDENCIAS");
  if (!evidenceFolder) {
    throw new Error("Falha ao criar a pasta EVIDENCIAS/ no pacote ZIP.");
  }

  for (const file of evidenceFiles) {
    if (file.content && file.entry.packagedFileName) {
      evidenceFolder.file(file.entry.packagedFileName, file.content);
    }
  }

  return await zip.generateAsync({ type: "blob" });
}
