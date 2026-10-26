// ============================================================
// CAMADA NORMALIZADA DE TEXTO EXTRAÍDO (busca e análise)
//
// Alguns PDFs (ex.: contrato NEWPORT, Parte 1) têm fonte com tabela de
// codificação trocada: o texto nativo sai com bytes Latin-1 lidos como
// Mac Roman — "construÁ„o" (construção), "Aplic·vel" (Aplicável),
// "TÈcnica" (Técnica), "INFORMA«√O" (INFORMAÇÃO), "1∫" (1º), "ß 2" (§ 2).
//
// Este módulo NUNCA altera o texto armazenado: produz uma camada
// derivada, calculada na leitura, usada por busca e análise. O texto
// original continua sendo a evidência (document_text_segments.text_content)
// e cada correção é listada (original → normalizado) para auditoria.
//
// Conservador por construção — nunca uma substituição global:
//   1. só atua em trechos com sinal forte de corrupção (glifo típico
//      ENTRE letras minúsculas, ex.: "a„o", "c·v", "uÁ„");
//   2. corrige palavra a palavra, só quando o glifo está numa posição
//      impossível em português correto (ex.: maiúscula acentuada no meio
//      de palavra minúscula; "„" colado a letras);
//   3. só aceita a palavra corrigida se ela tiver apenas letras do
//      português e caixa coerente (minúscula, Capitalizada ou MAIÚSCULA);
//   4. texto vindo de OCR e marcadores de página pendente não são tocados.
// ============================================================

export const FONT_ENCODING_REPAIR_VERSION = "macroman-latin1-v1";

// Glifo Mac Roman exibido → caractere Latin-1 original.
const GLYPH_TO_CHAR: Record<string, string> = {
  "‡": "à",
  "·": "á",
  "‚": "â",
  "„": "ã",
  Á: "ç",
  Ë: "è",
  È: "é",
  Í: "ê",
  Ì: "í",
  Û: "ó",
  Ù: "ô",
  ı: "õ",
  "˙": "ú",
  "¸": "ü",
  "¿": "À",
  "¡": "Á",
  "¬": "Â",
  "√": "Ã",
  "«": "Ç",
  "…": "É",
  Õ: "Í",
  "”": "Ó",
  "‘": "Ô",
  "’": "Õ",
  "⁄": "Ú",
  "‹": "Ü",
  "∫": "º",
  "™": "ª",
};

// Glifos que também são letras válidas em português (ex.: "Água",
// "INFORMAÇÕES"): só são corrigidos no MEIO de palavra que tem minúsculas.
const AMBIGUOUS_LETTERS = new Set(["Á", "È", "Í", "Ì", "Û", "Ù", "Ë", "Õ"]);

// Pontuação tipográfica legítima ("d’água", «aspas», reticências…): só é
// corrigida dentro de palavra em MAIÚSCULAS (ex.: "INFORMA«√O").
const PUNCTUATION_GLYPHS = new Set(["«", "…", "”", "‘", "’", "‹"]);

// Sinal forte de corrupção: glifo típico colado a letras — minúsculas
// ("a„o", "c·v", "uÁ„") ou MAIÚSCULAS ("A«√O", "A«’E", "S√O"), padrões
// que não ocorrem em português correto.
const STRONG_SIGNAL = /[A-Za-z][„·‡‚ı˙¸][a-z]|[a-z][ÁÈÍÌÛÙ][a-z„·]|[A-Z]«[A-Z√’]|[A-Z]√[A-Z]|[A-Z]?Õ[BCDFGHJKLMNPQRSTVXZ][A-Z]/;

const TOKEN = /[\p{L}\p{N}‡·‚„ı˙¸√¡¬¿⁄∫™«…”‘’‹]+/gu;
const PORTUGUESE_WORD = /^[A-Za-zÀÁÂÃÇÉÊÍÓÔÕÚÜàáâãçéêíóôõúü]+$/;
const ORDINAL = /^(?:\d+|[Nn])[ºª]$/;

export type FontEncodingRepair = {
  original: string;
  normalized: string;
};

export type NormalizedText = {
  text: string;
  repairs: FontEncodingRepair[];
};

function hasCoherentCase(word: string): boolean {
  const letters = word.replace(/[^\p{L}]/gu, "");
  if (!letters) return false;
  if (letters === letters.toLowerCase()) return true;
  if (letters === letters.toUpperCase()) return true;
  const rest = letters.slice(1);
  return letters[0] === letters[0].toUpperCase() && rest === rest.toLowerCase();
}

function repairWord(word: string): string | null {
  const glyphs = [...word].filter((char) => char in GLYPH_TO_CHAR);
  if (glyphs.length === 0) return null;

  const letters = word.replace(/[^\p{L}]/gu, "");
  const hasLowercase = /[a-z]/.test(word);
  const upperContext = !hasLowercase && letters.length >= 2;
  // Palavra já comprovadamente corrompida (tem glifo inequívoco, ex.:
  // "Ûrg„os"): a maiúscula acentuada do INÍCIO também é corrigida.
  const provenCorrupt = [...word].some(
    (char) => char in GLYPH_TO_CHAR && !AMBIGUOUS_LETTERS.has(char) && !PUNCTUATION_GLYPHS.has(char)
  );

  let changed = false;
  let output = "";
  const chars = [...word];
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    const replacement = GLYPH_TO_CHAR[char];
    if (!replacement) {
      output += char;
      continue;
    }

    if (char === "Õ" && upperContext && /[BCDFGHJKLMNPQRSTVXZ]/u.test(chars[index + 1] ?? "")) {
      // "ÕNDICE", "ÕNICIO", "LOGÕSTICA": em MAIÚSCULAS, "Õ" antes de
      // consoante não existe em português (Õ correto vem antes de E/S
      // finais: "AÇÕES"); é "Í" (Latin-1 0xCD lido como Mac Roman).
      output += "Í";
      changed = true;
      continue;
    }

    let repair = false;
    if (AMBIGUOUS_LETTERS.has(char)) {
      // "construÁ„o", "TÈcnica": maiúscula acentuada no meio de palavra
      // com minúsculas não existe em português correto.
      repair = hasLowercase && (index > 0 || provenCorrupt);
    } else if (PUNCTUATION_GLYPHS.has(char)) {
      repair = upperContext && index > 0 && index < chars.length - 1;
    } else if (char === "∫" || char === "™") {
      // "1∫", "2™", "n∫": ordinal colado a número ou ao "n" de "nº".
      repair = index > 0 && (/\d/.test(chars[index - 1]) || (index === 1 && /[Nn]/.test(chars[0])));
    } else if (char === "‡" && chars.length === 1) {
      // "‡" isolado = crase "à" (a adaga dupla não ocorre em contrato).
      repair = true;
    } else {
      // "„", "·", "√", "¡"…: glifo colado a letra.
      repair = chars.length > 1;
    }

    if (repair) {
      output += replacement;
      changed = true;
    } else {
      output += char;
    }
  }

  if (!changed) return null;
  if (!(PORTUGUESE_WORD.test(output) || ORDINAL.test(output))) return null;
  if (!ORDINAL.test(output) && !hasCoherentCase(output)) return null;
  return output;
}

/**
 * Camada normalizada de um texto extraído. Devolve o texto original
 * intacto quando não há sinal forte de corrupção de codificação.
 */
export function normalizeExtractedText(text: string): NormalizedText {
  if (!text || !STRONG_SIGNAL.test(text)) {
    return { text, repairs: [] };
  }

  const repairs: FontEncodingRepair[] = [];
  let normalized = text.replace(TOKEN, (word) => {
    const repaired = repairWord(word);
    if (!repaired) return word;
    repairs.push({ original: word, normalized: repaired });
    return repaired;
  });

  // "ß 2" / "ß2" → "§ 2": parágrafo seguido de número (ß não existe em
  // português; Latin-1 0xA7 "§" aparece como "ß" em Mac Roman).
  normalized = normalized.replace(/(^|[\s(])ß(\s?\d)/g, (_match, before: string, after: string) => {
    repairs.push({ original: `ß${after}`, normalized: `§${after}` });
    return `${before}§${after}`;
  });

  // "que È o" → "que é o": verbo "é" isolado (Latin-1 0xE9 aparece como
  // "È"), só entre palavras minúsculas — "È" isolado não existe em português.
  normalized = normalized.replace(/(?<=[a-zà-ü,;]\s)È(?=\s[a-zà-ü])/g, () => {
    repairs.push({ original: "È", normalized: "é" });
    return "é";
  });

  return { text: normalized, repairs };
}

const OCR_OR_MARKER_LOCATOR = /· (OCR|PENDENTE)\b/;

/**
 * Camada normalizada de um segmento. Texto de OCR (já sai em UTF-8
 * correto) e marcadores de página pendente nunca são tocados.
 */
export function normalizeSegmentText(textContent: string, locator: string | null | undefined): NormalizedText {
  if (locator && OCR_OR_MARKER_LOCATOR.test(locator)) {
    return { text: textContent, repairs: [] };
  }
  return normalizeExtractedText(textContent);
}
