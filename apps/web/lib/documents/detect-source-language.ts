// Detecção real e offline do idioma de origem de um documento (seção 7),
// a partir do texto já extraído (nunca do arquivo binário, nunca uma
// suposição do Expert/LLM). Puro, sem I/O — chamado tanto pelo worker de
// processamento (scripts/process-document-version.mjs, via dynamic
// import + ts-module-resolver) quanto por testes.

import { franc } from "franc-min";

// Mapa 639-3 → 639-1 só para os idiomas realmente esperados em contratos
// de engenharia/construção neste projeto. Um código 639-3 sem
// mapeamento aqui não é descartado — é retornado como está (melhor do
// que perder a informação), nunca silenciosamente virando null.
const ISO_639_3_TO_1: Record<string, string> = {
  por: "pt",
  eng: "en",
  spa: "es",
  fra: "fr",
  deu: "de",
  ita: "it",
  zho: "zh",
  jpn: "ja",
  kor: "ko",
  rus: "ru",
  arb: "ar",
};

export interface DetectedSourceLanguage {
  // Código ISO 639-1 quando mapeado, senão o código 639-3 bruto do
  // detector. null somente quando o detector não conseguiu determinar
  // ("und") — nunca um palpite fabricado.
  code: string | null;
  // Código bruto retornado pelo franc, preservado para rastreabilidade
  // mesmo quando `code` já é o 639-1 mapeado.
  detectorCode: string;
}

const MIN_TEXT_LENGTH = 20;

export function detectSourceLanguage(text: string): DetectedSourceLanguage {
  const trimmed = text.trim();

  if (trimmed.length < MIN_TEXT_LENGTH) {
    return { code: null, detectorCode: "und" };
  }

  const detectorCode = franc(trimmed);

  if (detectorCode === "und") {
    return { code: null, detectorCode };
  }

  return { code: ISO_639_3_TO_1[detectorCode] ?? detectorCode, detectorCode };
}
