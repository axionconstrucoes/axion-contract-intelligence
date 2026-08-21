import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import mammoth from "mammoth";
import ExcelJS from "exceljs";

const MAX_SEGMENT_CHARS = 5000;

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitLongText(text, locator, pageNumber = null) {
  const normalized = normalizeText(text);

  if (!normalized) {
    return [];
  }

  const segments = [];

  let start = 0;
  let part = 1;

  while (start < normalized.length) {
    let end = Math.min(
      start + MAX_SEGMENT_CHARS,
      normalized.length
    );

    if (end < normalized.length) {
      const candidate =
        normalized.lastIndexOf("\n", end);

      if (
        candidate > start + 1000
      ) {
        end = candidate;
      }
    }

    const chunk =
      normalized.slice(start, end).trim();

    if (chunk) {
      segments.push({
        pageNumber,
        locator:
          part === 1
            ? locator
            : `${locator}, parte ${part}`,
        text: chunk,
      });
    }

    start = end;
    part += 1;
  }

  return segments;
}

async function extractPdf(buffer) {
  const loadingTask =
    pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      isEvalSupported: false,
    });

  const pdf =
    await loadingTask.promise;

  const segments = [];

  for (
    let pageNumber = 1;
    pageNumber <= pdf.numPages;
    pageNumber += 1
  ) {
    const page =
      await pdf.getPage(pageNumber);

    const content =
      await page.getTextContent();

    const text =
      normalizeText(
        content.items
          .map((item) =>
            "str" in item
              ? item.str
              : ""
          )
          .join(" ")
      );

    segments.push(
      ...splitLongText(
        text,
        `PDF página ${pageNumber}`,
        pageNumber
      )
    );
  }

  const text =
    segments
      .map((segment) => segment.text)
      .join("\n\n");

  return {
    extractor: "pdfjs-dist",
    extractorVersion: "1",
    pageCount: pdf.numPages,
    text,
    segments,
  };
}

async function extractDocx(buffer) {
  const result =
    await mammoth.extractRawText({
      buffer,
    });

  const text =
    normalizeText(result.value);

  const blocks =
    text
      .split(/\n{2,}/)
      .map((value) => value.trim())
      .filter(Boolean);

  const segments = [];

  for (
    let index = 0;
    index < blocks.length;
    index += 1
  ) {
    segments.push(
      ...splitLongText(
        blocks[index],
        `DOCX bloco ${index + 1}`
      )
    );
  }

  return {
    extractor: "mammoth",
    extractorVersion: "1",
    pageCount: null,
    text,
    segments,
  };
}

async function extractXlsx(buffer) {
  const workbook =
    new ExcelJS.Workbook();

  await workbook.xlsx.load(buffer);

  const segments = [];
  const complete = [];

  workbook.eachSheet((worksheet) => {
    worksheet.eachRow(
      { includeEmpty: false },
      (row, rowNumber) => {
        const values = [];

        row.eachCell(
          { includeEmpty: true },
          (cell) => {
            values.push(
              normalizeText(cell.text)
            );
          }
        );

        const text =
          values.join(" | ").trim();

        if (!text) {
          return;
        }

        complete.push(
          `[${worksheet.name} - linha ${rowNumber}] ${text}`
        );

        segments.push(
          ...splitLongText(
            text,
            `Planilha "${worksheet.name}", linha ${rowNumber}`
          )
        );
      }
    );
  });

  return {
    extractor: "exceljs",
    extractorVersion: "1",
    pageCount: null,
    text: normalizeText(
      complete.join("\n")
    ),
    segments,
  };
}

function extractLineBased(
  buffer,
  type
) {
  const text =
    normalizeText(
      buffer.toString("utf8")
    );

  const lines =
    text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

  const segments = [];

  for (
    let index = 0;
    index < lines.length;
    index += 1
  ) {
    segments.push(
      ...splitLongText(
        lines[index],
        `${type} linha ${index + 1}`
      )
    );
  }

  return {
    extractor:
      `native-${type.toLowerCase()}`,
    extractorVersion: "1",
    pageCount: null,
    text,
    segments,
  };
}

export async function extractDocument({
  buffer,
  mimeType,
  fileName,
}) {
  const extension =
    String(fileName ?? "")
      .split(".")
      .pop()
      ?.toLowerCase() ?? "";

  if (
    mimeType === "application/pdf" ||
    extension === "pdf"
  ) {
    return extractPdf(buffer);
  }

  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extension === "docx"
  ) {
    return extractDocx(buffer);
  }

  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    extension === "xlsx"
  ) {
    return extractXlsx(buffer);
  }

  if (
    mimeType === "text/csv" ||
    extension === "csv"
  ) {
    return extractLineBased(
      buffer,
      "CSV"
    );
  }

  if (
    mimeType === "text/plain" ||
    extension === "txt"
  ) {
    return extractLineBased(
      buffer,
      "TXT"
    );
  }

  if (
    mimeType === "application/xml" ||
    mimeType === "text/xml" ||
    extension === "xml"
  ) {
    return extractLineBased(
      buffer,
      "XML"
    );
  }

  if (
    extension === "doc" ||
    mimeType === "application/msword"
  ) {
    throw new Error(
      "Formato DOC legado ainda não possui extrator. Converter para DOCX."
    );
  }

  if (
    extension === "xls" ||
    mimeType === "application/vnd.ms-excel"
  ) {
    throw new Error(
      "Formato XLS legado ainda não possui extrator. Converter para XLSX."
    );
  }

  if (
    extension === "mpp" ||
    mimeType === "application/vnd.ms-project"
  ) {
    throw new Error(
      "Formato MPP ainda não possui extrator."
    );
  }

  if (
    mimeType === "image/jpeg" ||
    mimeType === "image/png"
  ) {
    throw new Error(
      "Imagem requer OCR. OCR automático ainda não está habilitado."
    );
  }

  throw new Error(
    `Formato não suportado: ${mimeType || extension || "desconhecido"}.`
  );
}
