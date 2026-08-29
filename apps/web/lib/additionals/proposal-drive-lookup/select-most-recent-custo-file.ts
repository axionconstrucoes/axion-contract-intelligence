// Puro, sem I/O. Seleciona o arquivo mais recente cujo nome contém
// "custo" (comparação sem diferenciar maiúsculas/minúsculas) — nunca o
// primeiro da lista, nunca por ordem alfabética. Arquivo sem
// modifiedTime é tratado como o mais antigo possível (nunca escolhido
// sobre um arquivo com data real, mas ainda elegível se for o único).

import type { DriveFileEntry } from "./types";

export function selectMostRecentCustoFile(files: DriveFileEntry[]): DriveFileEntry | null {
  const custoFiles = files.filter((file) => file.name.toLowerCase().includes("custo"));
  if (custoFiles.length === 0) return null;

  return custoFiles.reduce((mostRecent, candidate) => {
    const mostRecentTime = mostRecent.modifiedTime ? Date.parse(mostRecent.modifiedTime) : Number.NEGATIVE_INFINITY;
    const candidateTime = candidate.modifiedTime ? Date.parse(candidate.modifiedTime) : Number.NEGATIVE_INFINITY;
    return candidateTime > mostRecentTime ? candidate : mostRecent;
  });
}
