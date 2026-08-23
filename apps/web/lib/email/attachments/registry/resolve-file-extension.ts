// Rótulo de "tipo de arquivo" — sempre derivado da extensão do
// filename original (nunca inventa uma taxonomia nova). Puro, sem I/O.

export function resolveFileExtensionLabel(originalFileName: string): string {
  const lastDot = originalFileName.lastIndexOf(".");
  if (lastDot < 0 || lastDot === originalFileName.length - 1) return "—";
  return originalFileName.slice(lastDot + 1).toUpperCase();
}
