const DETECTOR = "clause-structure";
const DETECTOR_VERSION = "2";

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
  ["VIGÉSIMA PRIMEIRA", "21"],
  ["VIGESIMA PRIMEIRA", "21"],
  ["VIGÉSIMA SEGUNDA", "22"],
  ["VIGESIMA SEGUNDA", "22"],
  ["VIGÉSIMA TERCEIRA", "23"],
  ["VIGESIMA TERCEIRA", "23"],
  ["VIGÉSIMA QUARTA", "24"],
  ["VIGESIMA QUARTA", "24"],
  ["VIGÉSIMA QUINTA", "25"],
  ["VIGESIMA QUINTA", "25"],
  ["TRIGÉSIMA", "30"],
  ["TRIGESIMA", "30"],
]);

function normalize(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeTitle(value) {
  return normalize(value)
    .replace(/^[\-–—:.\s]+/u, "")
    .replace(/[\-–—:.\s]+$/u, "")
    .trim();
}

function numericOrdinal(value) {
  const normalized =
    normalize(value)
      .toUpperCase()
      .replace(/\.$/u, "");

  if (ORDINAL_WORDS.has(normalized)) {
    return ORDINAL_WORDS.get(normalized);
  }

  const match =
    normalized.match(
      /^(\d+)\s*[ªº°]?$/u
    );

  return match
    ? match[1]
    : null;
}

const CLAUSE_MARKER =
  /C\s*L[ÁA]USULA\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ0-9ªº° ]{1,50}?)\s*[-–—:]\s*/giu;

function splitTitleAndBody(value) {
  const text =
    normalize(value);

  if (!text) {
    return {
      title: "Cláusula",
      body: "",
      confidence: 0.85,
    };
  }

  const numberedBody =
    text.match(
      /\s+(?=\d+(?:\.\d+)+(?:[.)])?\s)/u
    );

  if (
    numberedBody?.index != null
  ) {
    return {
      title:
        normalizeTitle(
          text.slice(
            0,
            numberedBody.index
          )
        ),

      body:
        normalize(
          text.slice(
            numberedBody.index
          )
        ),

      confidence:
        0.99,
    };
  }

  const proseBoundary =
    text.match(
      /\s+(?=(?:A|O|AS|OS|UM|UMA|ESTE|ESTA|ESSA|ESSE|CABERÁ|FICA|SERÁ|SÃO)\s+)/iu
    );

  if (
    proseBoundary?.index != null
  ) {
    return {
      title:
        normalizeTitle(
          text.slice(
            0,
            proseBoundary.index
          )
        ),

      body:
        normalize(
          text.slice(
            proseBoundary.index
          )
        ),

      confidence:
        0.97,
    };
  }

  const words =
    text.split(" ");

  const headingWords = [];

  for (const word of words) {
    if (
      headingWords.length >= 12 ||
      /[a-záàâãéêíóôõúç]/u.test(word)
    ) {
      break;
    }

    headingWords.push(word);
  }

  if (headingWords.length) {
    const rawTitle =
      headingWords.join(" ");

    return {
      title:
        normalizeTitle(rawTitle),

      body:
        normalize(
          text.slice(
            rawTitle.length
          )
        ),

      confidence:
        0.92,
    };
  }

  return {
    title: "Cláusula",
    body: text,
    confidence: 0.85,
  };
}

function getContentBetween(
  segments,
  current,
  next
) {
  if (!next) {
    const parts = [
      segments[
        current.segmentIndex
      ].text.slice(
        current.end
      ),
    ];

    for (
      let index =
        current.segmentIndex + 1;
      index < segments.length;
      index += 1
    ) {
      parts.push(
        segments[index].text
      );
    }

    return normalize(
      parts.join(" ")
    );
  }

  if (
    current.segmentIndex ===
    next.segmentIndex
  ) {
    return normalize(
      segments[
        current.segmentIndex
      ].text.slice(
        current.end,
        next.start
      )
    );
  }

  const parts = [
    segments[
      current.segmentIndex
    ].text.slice(
      current.end
    ),
  ];

  for (
    let index =
      current.segmentIndex + 1;
    index < next.segmentIndex;
    index += 1
  ) {
    parts.push(
      segments[index].text
    );
  }

  parts.push(
    segments[
      next.segmentIndex
    ].text.slice(
      0,
      next.start
    )
  );

  return normalize(
    parts.join(" ")
  );
}

export function detectClauseCandidates(
  segments
) {
  const normalizedSegments =
    segments.map(
      (segment, segmentIndex) => ({
        segmentIndex,

        text:
          normalize(
            segment.textContent ??
              segment.text ??
              ""
          ),

        id:
          segment.id ?? null,

        pageNumber:
          segment.pageNumber ?? null,

        locator:
          segment.locator ?? null,
      })
    );

  const markers = [];

  for (
    const segment of
      normalizedSegments
  ) {
    CLAUSE_MARKER.lastIndex = 0;

    let match;

    while (
      (
        match =
          CLAUSE_MARKER.exec(
            segment.text
          )
      ) !== null
    ) {
      const clauseNumber =
        numericOrdinal(
          match[1]
        );

      if (!clauseNumber) {
        continue;
      }

      markers.push({
        clauseNumber,

        ordinal:
          normalize(
            match[1]
          ),

        segmentIndex:
          segment.segmentIndex,

        start:
          match.index,

        end:
          CLAUSE_MARKER.lastIndex,

        sourceSegmentId:
          segment.id,

        pageNumber:
          segment.pageNumber,

        locator:
          segment.locator,
      });
    }
  }

  if (!markers.length) {
    return [];
  }

  return markers.map(
    (current, index) => {
      const next =
        markers[
          index + 1
        ];

      const content =
        getContentBetween(
          normalizedSegments,
          current,
          next
        );

      const {
        title,
        body,
        confidence,
      } =
        splitTitleAndBody(
          content
        );

      const safeTitle =
        title ||
        `Cláusula ${current.clauseNumber}`;

      return {
        detector:
          DETECTOR,

        detectorVersion:
          DETECTOR_VERSION,

        candidateKey:
          [
            current.clauseNumber,
            current.segmentIndex,
            current.start,
          ].join(":"),

        confidence,

        proposedClauseNumber:
          current.clauseNumber,

        proposedTitle:
          safeTitle,

        proposedText:
          [
            `CLÁUSULA ${current.ordinal} - ${safeTitle}`,
            body,
          ]
            .filter(Boolean)
            .join("\n")
            .trim(),

        sourceSegmentId:
          current.sourceSegmentId,

        pageNumber:
          current.pageNumber,

        locator:
          current.locator,

        pattern:
          "CLAUSE_WORD",
      };
    }
  );
}
