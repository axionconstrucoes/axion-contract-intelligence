// Puro, sem I/O. Extrai o número da proposta a partir do nome completo
// da pasta Drive (ex.: "AXN CP 617 - DUX VINHEDO - SP" -> "AXN CP 617").
// Nunca adivinha um número que não está literalmente no nome — sem
// match reconhecível, cai para o primeiro segmento antes do primeiro
// " - ", e na ausência disso, o nome inteiro (nunca lança, nunca vazio
// quando o nome não é vazio).

const PROPOSAL_NUMBER_PATTERN = /^([A-Za-z]+\s*CP\s*\d+)/i;

export function parseProposalNumberFromFolderName(folderName: string): string {
  const trimmed = folderName.trim();
  const match = trimmed.match(PROPOSAL_NUMBER_PATTERN);
  if (match) {
    return match[1].toUpperCase().replace(/\s+/g, " ").trim();
  }
  const firstSegment = trimmed.split(" - ")[0]?.trim();
  return firstSegment || trimmed;
}
