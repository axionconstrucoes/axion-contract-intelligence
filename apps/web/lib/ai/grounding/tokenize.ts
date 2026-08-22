// Tokenização determinística mínima em português — sem embeddings, sem
// stemmer real, sem biblioteca de NLP. Usa um truque simples e
// documentado (prefixo de 5 caracteres) para tolerar variações comuns
// de conjugação verbal/gênero/número em português
// (ex.: "incluímos"/"incluído", "fundação"/"fundações") sem precisar de
// um stemmer de verdade. Isso é uma heurística deliberadamente simples
// — ver docs/ai/grounding-and-citation-guardrails.md, seção
// "Limitações", para os casos que ela não cobre bem.

const PREFIX_LENGTH = 5;
const MIN_TOKEN_LENGTH = 3;

// Lista curada, não exaustiva — cobre conectores/verbos auxiliares
// muito comuns que não carregam significado próprio para checagem de
// grounding. Estender esta lista é seguro (só reduz falso-positivo).
const STOPWORDS = new Set([
  "a","o","as","os","um","uma","uns","umas","de","do","da","dos","das","em","no","na","nos","nas",
  "por","pelo","pela","pelos","pelas","para","com","sem","sob","sobre","entre","até","após",
  "e","ou","mas","que","se","ao","aos","à","às","é","foi","será","são","seja","sejam","ser","estar",
  "está","estão","estava","estavam","tem","têm","tinha","tinham","ter","haver","há",
  "este","esta","estes","estas","isso","isto","esse","essa","esses","essas","aquele","aquela",
  "aqueles","aquelas","aquilo","como","mais","menos","muito","muita","muitos","muitas","também",
  "já","não","sim","nao","seu","sua","seus","suas","o que","qual","quais","quando","onde","porque",
  "pois","assim","portanto","além","alem","disso","conforme","referente","informado","informa",
  "informou","segue","abaixo","seguinte","atenciosamente","prezados","prezado","cordialmente",
]);

// Usa ̀-ͯ (faixa Unicode de diacríticos combinantes) via
// new RegExp em vez de um literal /[...]/ no código-fonte — um literal
// com caracteres combinantes embutidos já causou um bug real neste
// projeto (ver histórico de apps/web/lib/timeline-export/), pois o
// caractere pode ser invisível/mal interpretado dependendo do editor.
const DIACRITICS_REGEX = new RegExp("[\\u0300-\\u036f]", "g");

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(DIACRITICS_REGEX, "");
}

export function normalizeText(value: string): string {
  return stripDiacritics(value.toLowerCase());
}

/** Divide um texto em tokens alfabéticos normalizados, descartando pontuação/números (números são tratados à parte, ver extract-claims.ts). */
export function tokenizeWords(text: string): string[] {
  const normalized = normalizeText(text);
  const matches = normalized.match(/[a-z]+/g);
  return matches ?? [];
}

/** Tokens "significativos" — sem stopwords, sem tokens muito curtos. */
export function significantTokens(text: string): string[] {
  return tokenizeWords(text).filter((token) => token.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(token));
}

/** Chave de comparação tolerante a variação morfológica simples (prefixo). */
export function prefixKey(token: string): string {
  return token.length <= PREFIX_LENGTH ? token : token.slice(0, PREFIX_LENGTH);
}

/** Constrói o vocabulário (conjunto de prefixKeys) a partir de todos os textos-fonte disponíveis. */
export function buildVocabulary(sourceTexts: string[]): Set<string> {
  const vocabulary = new Set<string>();
  for (const text of sourceTexts) {
    for (const token of significantTokens(text)) {
      vocabulary.add(prefixKey(token));
    }
  }
  return vocabulary;
}

export function vocabularyHasToken(vocabulary: Set<string>, token: string): boolean {
  return vocabulary.has(prefixKey(token));
}
