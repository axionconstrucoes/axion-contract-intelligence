// Alguns registros históricos (ex.: audit_log_entries, project_integrations
// gravados por execuções antigas do sync do Gmail) foram persistidos com
// mojibake: bytes UTF-8 originais foram decodificados como Windows-1252 e
// regravados como UTF-8. Este módulo desfaz exatamente essa corrupção — sem
// nunca tocar no dado armazenado — para exibição correta na UI.
//
// A correção NUNCA altera o Supabase: é aplicada somente no momento de
// renderizar campos textuais legados vindos desses registros.

// Único intervalo em que Windows-1252 diverge de Latin-1/ISO-8859-1.
const CP1252_HIGH_BYTE_TO_CODE_POINT: Record<number, number> = {
  0x80: 0x20ac, // €
  0x82: 0x201a, // ‚
  0x83: 0x0192, // ƒ
  0x84: 0x201e, // „
  0x85: 0x2026, // …
  0x86: 0x2020, // †
  0x87: 0x2021, // ‡
  0x88: 0x02c6, // ˆ
  0x89: 0x2030, // ‰
  0x8a: 0x0160, // Š
  0x8b: 0x2039, // ‹
  0x8c: 0x0152, // Œ
  0x8e: 0x017d, // Ž
  0x91: 0x2018, // '
  0x92: 0x2019, // '
  0x93: 0x201c, // "
  0x94: 0x201d, // "
  0x95: 0x2022, // •
  0x96: 0x2013, // –
  0x97: 0x2014, // —
  0x98: 0x02dc, // ˜
  0x99: 0x2122, // ™
  0x9a: 0x0161, // š
  0x9b: 0x203a, // ›
  0x9c: 0x0153, // œ
  0x9e: 0x017e, // ž
  0x9f: 0x0178, // Ÿ
};

const CODE_POINT_TO_CP1252_HIGH_BYTE = new Map<number, number>(
  Object.entries(CP1252_HIGH_BYTE_TO_CODE_POINT).map(([byte, codePoint]) => [codePoint, Number(byte)])
);

// Reconstrói, byte a byte, a sequência original antes da corrupção: cada
// caractere da string atual corresponde a UM byte Windows-1252. Se algum
// caractere não puder ser representado como byte único (conteúdo Unicode
// legítimo, fora de Latin-1/CP1252), a string não é candidata a este tipo
// de mojibake e a função retorna null.
function toWindows1252Bytes(text: string): Uint8Array | null {
  const bytes = new Uint8Array(text.length);

  for (let i = 0; i < text.length; i += 1) {
    const codePoint = text.codePointAt(i)!;

    if (codePoint <= 0xff) {
      bytes[i] = codePoint;
      continue;
    }

    const mapped = CODE_POINT_TO_CP1252_HIGH_BYTE.get(codePoint);
    if (mapped === undefined) {
      return null;
    }
    bytes[i] = mapped;
  }

  return bytes;
}

function attemptRepair(text: string): string | null {
  const bytes = toWindows1252Bytes(text);
  if (!bytes) {
    return null;
  }

  const decoded = Buffer.from(bytes).toString("utf8");

  // Buffer#toString("utf8") substitui sequências inválidas por U+FFFD.
  // Texto corretamente codificado nunca produz isso ao reinterpretar seus
  // próprios bytes como UTF-8 — é o que impede, por exemplo, que "NÃO"
  // (Ã seguido de O, Português correto) seja alterado.
  if (decoded.includes("�")) {
    return null;
  }

  return decoded;
}

const MOJIBAKE_MARKER = /Ã.|Â.|â€./;

/**
 * Corrige, apenas para exibição, mojibake causado por bytes UTF-8 legados
 * decodificados como Windows-1252 (ex.: "SincronizaÃ§Ã£o" -> "Sincronização").
 * Não altera o dado original: use somente ao renderizar texto vindo de
 * registros históricos. Texto já correto é sempre retornado inalterado.
 */
export function normalizeLegacyMojibake<T extends string | null | undefined>(text: T): T {
  if (!text) {
    return text;
  }

  if (!MOJIBAKE_MARKER.test(text)) {
    return text;
  }

  const repaired = attemptRepair(text);

  if (repaired === null || repaired === text) {
    return text;
  }

  return repaired as T;
}
