// Extração de texto de uma planilha .xlsx — tipicamente o CRONOGRAMA da
// obra, que é de onde saem as datas-limite que o Consultor Jurídico
// precisa para raciocinar sobre prazo (extensão day-for-day, multa por
// atraso, proporcionalidade da mora).
//
// Porta o mesmo comportamento de `extractXlsx` em
// scripts/document-extractors.mjs (exceljs, uma linha de texto por linha
// da planilha, com o nome da aba e o número da linha no prefixo), com
// UMA diferença deliberada: célula de data sai em ISO `YYYY-MM-DD`.
//
// Por que a diferença: `cell.text` devolve a data formatada conforme o
// número de formato da célula — que varia com o arquivo e com o locale
// de quem o gerou ("15/03/26", "Mar 15, 2026", ou um Date.toString()
// inteiro com fuso). Numa planilha cujo propósito é justamente a data,
// entregar ao modelo um formato ambíguo é entregar erro: 03/04 é 3 de
// abril ou 4 de março? ISO elimina a ambiguidade e é estável entre
// máquinas.
//
// SOMENTE LEITURA e em memória: não grava extração nenhuma. A
// persistência continua sendo exclusividade de
// scripts/process-document-version.mjs.

import ExcelJS from "exceljs";

/**
 * Rótulo de célula vazia dentro de uma linha que TEM conteúdo. Preservar
 * a posição importa: numa tabela de cronograma, "Atividade | | 10/03" com
 * a coluna do meio vazia diz que a data de início não foi preenchida —
 * colapsar as colunas faria a data de término parecer a de início.
 */
const EMPTY_CELL = "";

function normalizeText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Data em ISO `YYYY-MM-DD`, sem hora. O exceljs entrega datas de planilha
 * em UTC (o formato .xlsx guarda um número de série, não um instante com
 * fuso), então `toISOString` é determinístico — nunca depende do fuso da
 * máquina que está rodando a extração.
 */
function formatDateCell(value: Date): string {
  const time = value.getTime();
  if (!Number.isFinite(time)) return EMPTY_CELL;
  return value.toISOString().slice(0, 10);
}

function cellToText(cell: ExcelJS.Cell): string {
  const value = cell.value;

  if (value === null || value === undefined) return EMPTY_CELL;
  if (value instanceof Date) return formatDateCell(value);

  // Célula de fórmula: o que interessa é o RESULTADO calculado (a data
  // de término que a planilha derivou), nunca o texto da fórmula.
  if (typeof value === "object" && "result" in value) {
    const result = (value as { result?: unknown }).result;
    if (result instanceof Date) return formatDateCell(result);
  }

  return normalizeText(String(cell.text ?? ""));
}

export interface ExtractedXlsxText {
  text: string;
  /** Linhas com conteúdo efetivamente lidas, somando todas as abas. */
  rowCount: number;
  /** Abas com pelo menos uma linha de conteúdo. */
  sheetCount: number;
}

/**
 * Lê todas as abas da planilha e devolve uma linha de texto por linha
 * preenchida, prefixada com aba e número da linha. O prefixo não é
 * enfeite: é o que permite a um achado do especialista apontar a origem
 * exata ("Cronograma, linha 42") e a um humano conferir na planilha —
 * a mesma rastreabilidade que página de PDF dá.
 */
export async function extractXlsxText(buffer: ArrayBuffer): Promise<ExtractedXlsxText> {
  const workbook = new ExcelJS.Workbook();

  // `Buffer.from(buffer)` é aceito por `workbook.xlsx.load` em toda a
  // base; o cast pontual existe porque o @types de exceljs declara um
  // `ExcelJS.Buffer` próprio. Mesmo padrão de
  // lib/additionals/manual-proposal-upload/read-fechamento-estimate-from-buffer.ts.
  await workbook.xlsx.load(Buffer.from(buffer) as unknown as ExcelJS.Buffer);

  const lines: string[] = [];
  let rowCount = 0;
  let sheetCount = 0;

  workbook.eachSheet((worksheet) => {
    let sheetHasContent = false;

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const values: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        values.push(cellToText(cell));
      });

      // Linha sem nenhum conteúdo (só células vazias) não vira linha de
      // texto — mas o número da linha das seguintes continua sendo o da
      // planilha, não um contador nosso, senão a referência não confere.
      const text = values.join(" | ").trim();
      if (!text.replace(/\|/g, "").trim()) return;

      lines.push(`[${worksheet.name} - linha ${rowNumber}] ${text}`);
      rowCount += 1;
      sheetHasContent = true;
    });

    if (sheetHasContent) sheetCount += 1;
  });

  return {
    text: normalizeText(lines.join("\n")),
    rowCount,
    sheetCount,
  };
}
