import type { DocumentKind } from "@axion/types";

// Único ponto de decisão da aparência visual do cartão de documento por
// TIPO DOCUMENTAL (documents.kind) — não representa risco, severidade,
// processamento ou resultado de análise (essas cores continuam vindo
// de apps/web/components/shared/badges.tsx e --risk-media/--severity-*
// em globals.css, nunca daqui). Baseado exclusivamente em `kind` —
// nunca em nome de arquivo, título, resumo ou qualquer outro texto.
// Toda visualização de documento cadastrado na página Documentos deve
// chamar esta função em vez de reimplementar a regra.
//
// Cada grupo é tipado como DocumentKind[] só para checagem em tempo de
// compilação (erro de digitação vira erro de build); a comparação em
// si é feita sobre `string` porque `ManagedDocument.kind`
// (lib/document-management.ts) é a coluna crua do banco, tipada como
// string — nunca estreitada para DocumentKind nesta camada. `kind` pode
// chegar `null`/`undefined` (dado inesperado) e permanece neutro.
const STRONG_YELLOW_KINDS: readonly DocumentKind[] = [
  // Contrato / Contrato Base: rótulos visuais do mesmo kind canônico.
  "CONTRATO_BASE",
  // Aditivo Contratual.
  "ADITIVO",
];

const LIGHT_RED_KINDS: readonly DocumentKind[] = [
  // Documento periódico semanal.
  "RELATORIO_SEMANAL",
];

const LIGHT_GREEN_KINDS: readonly DocumentKind[] = [
  // Documento periódico.
  "ATA_REUNIAO",
  // Documentos de consulta, concorrência ou contratação.
  "RFI",
  "RFP",
  "EDITAL",
];

const LIGHT_BLUE_KINDS: readonly DocumentKind[] = [
  // Documento periódico diário.
  "DIARIO_OBRA",
];

const STRONG_YELLOW: ReadonlySet<string> = new Set(STRONG_YELLOW_KINDS);
const LIGHT_RED: ReadonlySet<string> = new Set(LIGHT_RED_KINDS);
const LIGHT_GREEN: ReadonlySet<string> = new Set(LIGHT_GREEN_KINDS);
const LIGHT_BLUE: ReadonlySet<string> = new Set(LIGHT_BLUE_KINDS);

export type DocumentKindCardAppearance = {
  // Aplicado ao cartão inteiro (fundo + borda + cor de texto base).
  cardClassName: string | undefined;
  // Aplicado só ao título — negrito/alto contraste extra, hoje
  // exclusivo de contrato-base/aditivo, para que tenham destaque
  // visual superior ao dos grupos periódicos (vermelho/verde/azul).
  titleClassName: string | undefined;
};

const NEUTRAL_APPEARANCE: DocumentKindCardAppearance = {
  cardClassName: undefined,
  titleClassName: undefined,
};

export function getDocumentKindCardAppearance(
  kind: string | null | undefined
): DocumentKindCardAppearance {
  if (typeof kind !== "string") {
    return NEUTRAL_APPEARANCE;
  }

  if (STRONG_YELLOW.has(kind)) {
    return {
      cardClassName: "border-2 border-yellow-700 bg-yellow-200 text-black",
      titleClassName: "font-bold text-black",
    };
  }

  if (LIGHT_RED.has(kind)) {
    return {
      cardClassName: "border-2 border-red-400 bg-red-50 text-black",
      titleClassName: undefined,
    };
  }

  if (LIGHT_GREEN.has(kind)) {
    return {
      cardClassName: "border-2 border-green-500 bg-green-50 text-black",
      titleClassName: undefined,
    };
  }

  if (LIGHT_BLUE.has(kind)) {
    return {
      cardClassName: "border-2 border-blue-500 bg-blue-50 text-black",
      titleClassName: undefined,
    };
  }

  return NEUTRAL_APPEARANCE;
}
