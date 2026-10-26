// Ordem documental dos candidatos a cláusula (puro, sem I/O).
//
// Rótulos possíveis:
//   - detector decimal:   "A-5.5.1", "B-22.1 (2ª ocorrência)"
//   - detector "CLÁUSULA": "1", "12"
// Ordem: parte (sem parte primeiro, depois A, B, ...) → hierarquia
// numérica componente a componente (6.2 antes de 6.10; 6 antes de 6.1)
// → ocorrência (a 1ª antes da "2ª ocorrência").

export type ParsedClauseLabel = {
  section: string | null;
  parts: number[];
  occurrence: number;
};

export function parseClauseLabel(label: string): ParsedClauseLabel {
  const match = label.trim().match(/^(?:([A-Z])-)?(\d+(?:\.\d+)*)(?:\s*\((\d+)ª ocorrência\))?/u);
  if (!match) return { section: null, parts: [], occurrence: 1 };
  return {
    section: match[1] ?? null,
    parts: match[2].split(".").map((part) => Number.parseInt(part, 10)),
    occurrence: match[3] ? Number.parseInt(match[3], 10) : 1,
  };
}

/**
 * Ordem documental + hierarquia numérica.
 *
 * Itens normais seguem a hierarquia numérica (6.2 antes de 6.10). Itens
 * com numeração anômala do próprio documento (ex.: "22.1 (2ª
 * ocorrência)" escrito dentro da cláusula 23) não podem ir para junto
 * do "22.1" original: ficam logo depois do item que os precede no
 * documento (docIndex = ordem de detecção, que segue o texto).
 */
export function orderDocumentally<T>(
  items: T[],
  options: { label: (item: T) => string; docIndex: (item: T) => number; isAnomaly: (item: T) => boolean }
): T[] {
  const normal = items.filter((item) => !options.isAnomaly(item)).sort((a, b) => compareClauseLabels(options.label(a), options.label(b)));
  const anomalies = items.filter((item) => options.isAnomaly(item)).sort((a, b) => options.docIndex(a) - options.docIndex(b));

  const result = [...normal];
  for (const anomaly of anomalies) {
    const position = options.docIndex(anomaly);
    let insertAt = 0;
    let bestIndex = -Infinity;
    result.forEach((item, index) => {
      const itemIndex = options.docIndex(item);
      if (itemIndex < position && itemIndex >= bestIndex) {
        bestIndex = itemIndex;
        insertAt = index + 1;
      }
    });
    result.splice(insertAt, 0, anomaly);
  }
  return result;
}

export function compareClauseLabels(a: string, b: string): number {
  const left = parseClauseLabel(a);
  const right = parseClauseLabel(b);

  const sectionA = left.section ?? "";
  const sectionB = right.section ?? "";
  if (sectionA !== sectionB) return sectionA < sectionB ? -1 : 1;

  const length = Math.max(left.parts.length, right.parts.length);
  for (let index = 0; index < length; index += 1) {
    const partA = left.parts[index];
    const partB = right.parts[index];
    if (partA === undefined) return -1; // pai antes do filho
    if (partB === undefined) return 1;
    if (partA !== partB) return partA - partB;
  }

  if (left.occurrence !== right.occurrence) return left.occurrence - right.occurrence;
  return a.localeCompare(b, "pt-BR");
}
