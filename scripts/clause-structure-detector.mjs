const DETECTOR = "clause-structure";
const DETECTOR_VERSION = "1";

const NUMBERED_HEADING =
  /^\s*((?:\d+\.)*\d+)\s*(?:[.)\-–—:]\s*|\s+)(.+?)\s*$/u;

const CLAUSE_WORD_HEADING =
  /^\s*CL[ÁA]USULA\s+(.+?)(?:\s*[-–—:]\s*|\s+)(.+?)\s*$/iu;

const ORDINAL_WORDS = new Map([
  ["PRIMEIRA", "1"],
  ["SEGUNDA", "2"],
  ["TERCEIRA", "3"],
  ["QUARTA", "4"],
  ["QUINTA", "5"],
  ["SEXTA", "6"],
  ["SÉTIMA", "7"],
  ["SETIMA", "7"],
  ["OITAVA", "8"],
  ["NONA", "9"],
  ["DÉCIMA", "10"],
  ["DECIMA", "10"],
  ["DÉCIMA PRIMEIRA", "11"],
  ["DECIMA PRIMEIRA", "11"],
  ["DÉCIMA SEGUNDA", "12"],
  ["DECIMA SEGUNDA", "12"],
  ["DÉCIMA TERCEIRA", "13"],
  ["DECIMA TERCEIRA", "13"],
  ["DÉCIMA QUARTA", "14"],
  ["DECIMA QUARTA", "14"],
  ["DÉCIMA QUINTA", "15"],
  ["DECIMA QUINTA", "15"],
  ["DÉCIMA SEXTA", "16"],
  ["DECIMA SEXTA", "16"],
  ["DÉCIMA SÉTIMA", "17"],
  ["DECIMA SETIMA", "17"],
  ["DÉCIMA OITAVA", "18"],
  ["DECIMA OITAVA", "18"],
  ["DÉCIMA NONA", "19"],
  ["DECIMA NONA", "19"],
  ["VIGÉSIMA", "20"],
  ["VIGESIMA", "20"],
]);

function normalizeWhitespace(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function normalizeTitle(value) {
  return normalizeWhitespace(value)
    .replace(/^[\-–—:.\s]+/u, "")
    .replace(/[\-–—:.\s]+$/u, "")
    .trim();
}

function numericOrdinal(value) {
  const normalized =
    normalizeWhitespace(value)
      .toUpperCase()
      .replace(/\.$/u, "");

  if (ORDINAL_WORDS.has(normalized)) {
    return ORDINAL_WORDS.get(normalized);
  }

  const numeric =
    normalized.match(/^(\d+)\s*[ªº°]?$/u);

  return numeric
    ? numeric[1]
    : null;
}

function headingFromLine(line) {
  const text =
    normalizeWhitespace(line);

  if (!text) {
    return null;
  }

  const clauseMatch =
    text.match(CLAUSE_WORD_HEADING);

  if (clauseMatch) {
    const number =
      numericOrdinal(clauseMatch[1]);

    if (!number) {
      return null;
    }

    const title =
      normalizeTitle(clauseMatch[2]);

    if (!title) {
      return null;
    }

    return {
      clauseNumber: number,
      title,
      heading: text,
      confidence: 0.98,
      pattern: "CLAUSE_WORD",
    };
  }

  const numberedMatch =
    text.match(NUMBERED_HEADING);

  if (numberedMatch) {
    const title =
      normalizeTitle(numberedMatch[2]);

    if (
      !title ||
      title.length > 180
    ) {
      return null;
    }

    return {
      clauseNumber:
        numberedMatch[1],
      title,
      heading: text,
      confidence:
        /^[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ0-9 /()\-–—]+$/u.test(
          title
        )
          ? 0.96
          : 0.9,
      pattern:
        "NUMBERED",
    };
  }

  return null;
}

function candidateKey({
  clauseNumber,
  firstSegmentIndex,
  lineIndex,
}) {
  return [
    clauseNumber,
    firstSegmentIndex,
    lineIndex,
  ].join(":");
}

export function detectClauseCandidates(
  segments
) {
  const lines = [];

  for (
    let segmentIndex = 0;
    segmentIndex < segments.length;
    segmentIndex += 1
  ) {
    const segment =
      segments[segmentIndex];

    const segmentLines =
      String(
        segment.textContent ??
          segment.text ??
          ""
      ).split(/\r?\n/u);

    for (
      let lineIndex = 0;
      lineIndex < segmentLines.length;
      lineIndex += 1
    ) {
      const text =
        normalizeWhitespace(
          segmentLines[lineIndex]
        );

      if (!text) {
        continue;
      }

      lines.push({
        text,
        segmentIndex,
        lineIndex,
        sourceSegmentId:
          segment.id ?? null,
        pageNumber:
          segment.pageNumber ?? null,
        locator:
          segment.locator ?? null,
      });
    }
  }

  const headings = [];

  for (
    let index = 0;
    index < lines.length;
    index += 1
  ) {
    const heading =
      headingFromLine(
        lines[index].text
      );

    if (!heading) {
      continue;
    }

    headings.push({
      ...heading,
      linePosition: index,
      source:
        lines[index],
    });
  }

  const candidates = [];

  for (
    let index = 0;
    index < headings.length;
    index += 1
  ) {
    const heading =
      headings[index];

    const next =
      headings[index + 1];

    const start =
      heading.linePosition;

    const end =
      next
        ? next.linePosition
        : lines.length;

    const bodyLines =
      lines
        .slice(start + 1, end)
        .map((item) => item.text)
        .filter(Boolean);

    const proposedText =
      [
        heading.heading,
        ...bodyLines,
      ]
        .join("\n")
        .trim();

    if (!proposedText) {
      continue;
    }

    const lastSource =
      lines[
        Math.max(
          start,
          end - 1
        )
      ];

    const locatorParts = [
      heading.source.locator,
    ];

    if (
      lastSource?.locator &&
      lastSource.locator !==
        heading.source.locator
    ) {
      locatorParts.push(
        lastSource.locator
      );
    }

    candidates.push({
      detector: DETECTOR,
      detectorVersion:
        DETECTOR_VERSION,
      candidateKey:
        candidateKey({
          clauseNumber:
            heading.clauseNumber,
          firstSegmentIndex:
            heading.source.segmentIndex,
          lineIndex:
            heading.source.lineIndex,
        }),
      confidence:
        heading.confidence,
      proposedClauseNumber:
        heading.clauseNumber,
      proposedTitle:
        heading.title,
      proposedText,
      sourceSegmentId:
        heading.source
          .sourceSegmentId,
      pageNumber:
        heading.source
          .pageNumber,
      locator:
        locatorParts
          .filter(Boolean)
          .join(" → ") ||
        null,
      pattern:
        heading.pattern,
    });
  }

  return candidates;
}
