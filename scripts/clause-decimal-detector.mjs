// ============================================================
// DETECTOR DE CLÁUSULAS EM NUMERAÇÃO DECIMAL (ex.: 6, 6.5, 6.5.1)
//
// Complementa clause-structure-detector.mjs (formato "CLÁUSULA
// PRIMEIRA – ..."), que continua tendo prioridade: este detector só é
// usado quando aquele não encontra nenhuma cláusula (ver
// detectClauseCandidates). Regras derivadas do contrato NEWPORT
// (Parte A "05 PRAZOS / 5.1.", Parte B "6. INÍCIO DOS SERVIÇOS / 6.4.1.").
//
// Um número só vira cláusula quando:
//   - está numa FRONTEIRA (início, depois de ". ; : ) ” *", de título em
//     MAIÚSCULAS, do rodapé "Página N de M" ou de carimbo Docusign);
//   - NÃO é referência ("item 3.6.2", "cláusula 13.3", "6.1 a 6.3"),
//     quantidade ("5 (cinco) dias", "18 horas"), valor/identificador
//     ("25.500.000,00", "32.527.626/0001-47"), data, rodapé ou entrada de
//     sumário (título seguido de pontilhado e número de página);
//   - nível 1: seguido de título em MAIÚSCULAS; níveis 2+: seguido de
//     palavra iniciada em maiúscula (título "Xxx." ou início de frase);
//   - respeita a sequência da seção (cláusulas de nível 1 crescentes).
// Quebras de numeração do próprio documento (ex.: "22.1" dentro da
// cláusula 23) são mantidas e SINALIZADAS para revisão humana — nunca
// corrigidas ou descartadas silenciosamente.
//
// Escopo: corpo do contrato. Se houver rodapé "Página N de M", a
// detecção para na página "M de M"; também para na primeira capa de
// "ANEXO ..." depois da primeira cláusula. Anexos têm numeração própria
// e não são detectados como cláusulas do contrato (limitação explícita).
// ============================================================

export const DECIMAL_DETECTOR = "clause-structure-decimal";
export const DECIMAL_DETECTOR_VERSION = "1";

const NUMBER = /(?<![\d.,/\-])(\d{1,2}(?:\s?\.\s?\d{1,2}){0,3})(\s?\.)?(?=\s)/g;
// Palavra INTEIRA antes do número (fronteira de palavra à esquerda):
// sem ela, "CONTROLE 17.1" casava com o conector "e" do fim da palavra.
// "art." fica de fora de propósito: colide com "ART." (Anotação de
// Responsabilidade Técnica) em fim de frase.
const REFERENCE_BEFORE =
  /(?:^|[^\p{L}])(?:cl[aá]usulas?|subcl[aá]usulas?|itens?|subitens?|se[cç][aã]o|se[cç][oõ]es|anexos?|artigos?|par[aá]grafos?|n[ºo°]|§|conforme|previst[oa]s?\s+n[ao]s?|nos\s+termos\s+d[ao]s?|e|a|ou|at[eé]|entre)\s*$|,\s*$/iu;
const BOILERPLATE_BEFORE =
  /(?:P[aá]gina\s+\d+\s+de\s+\d+|Docusign Envelope ID:\s*[A-F0-9-]+|1PRTDPJ-\s*\S+(?:-\S+)*|\*{3})\s*$/iu;
const BOILERPLATE = /P[aá]gina\s+\d+\s+de\s+\d+|Docusign Envelope ID:\s*[A-F0-9-]+|1PRTDPJ-\s*[\d-]+(?:\s*-\s*[\d/]+-\d+)?/giu;
const UPPER_WORD = /^[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÇ\-/]{2,}$/u;
const TOC_AHEAD = /^[^]{0,160}?\.{4,}\s*\d{1,3}\b/u;
const SECTION = /\bPARTE\s+([A-Z])\s*[-–—]\s*/gu;
const FOOTER = /P[aá]gina\s+(\d+)\s+de\s+(\d+)/giu;
const ANNEX_COVER = /^(?:P[aá]gina\s+\d+\s+de\s+\d+\s+)?ANEXO\s+[IVXLC\d]+\b/iu;

function collapse(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function cleanBody(value) {
  return collapse(String(value ?? "").replace(BOILERPLATE, " "));
}

function previousWord(text) {
  const match = text.match(/(\S+)\s*$/u);
  return match ? match[1] : "";
}

// Título de nível 1: palavras em MAIÚSCULAS seguidas (até 10; atravessa
// vírgulas, ex.: "INÍCIO DOS SERVIÇOS, PRAZOS, SUSPENSÃO E PRORROGAÇÕES";
// para na primeira palavra minúscula ou no próximo número).
function upperTitle(after) {
  const words = [];
  for (const raw of after.trim().split(/\s+/u)) {
    const word = raw.replace(/[,;]$/u, "");
    if (!/^[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ0-9][A-ZÁÀÂÃÉÊÍÓÔÕÚÇ0-9\-/()]*$/u.test(word) && !/^(DE|DA|DO|DAS|DOS|E|A|O|EM)$/u.test(word)) break;
    if (/^\d/u.test(word)) break;
    words.push(raw.endsWith(",") ? `${word},` : word);
    if (words.length >= 10) break;
  }
  return words.join(" ").replace(/,$/u, "");
}

// Título de nível 2+: "Escopo da Contratação. O presente..." → "Escopo da Contratação".
function inlineTitle(after) {
  const match = after.match(/^\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][^.;:]{1,110}?)\s?\.\s+(?=[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ“"(])/u);
  if (!match) return null;
  const title = collapse(match[1]);
  return title.split(" ").length <= 12 ? title : null;
}

function firstWords(text, count) {
  const words = collapse(text).split(" ").slice(0, count);
  return `${words.join(" ")}${collapse(text).split(" ").length > count ? "…" : ""}`;
}

/**
 * @param {Array<{ id?: string|null, pageNumber?: number|null, locator?: string|null, textContent?: string, text?: string }>} segments
 */
export function detectDecimalClauseCandidates(segments) {
  // ---------- 1. fluxo único de texto, com mapa de segmentos ----------
  const spans = [];
  let stream = "";
  for (const segment of segments) {
    const text = collapse(segment.textContent ?? segment.text ?? "");
    if (!text) continue;
    if (stream) stream += " ";
    spans.push({ start: stream.length, end: stream.length + text.length, segment });
    stream += text;
  }
  const spanAt = (offset) => {
    let low = 0;
    let high = spans.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (offset < spans[mid].start) high = mid - 1;
      else if (offset > spans[mid].end) low = mid + 1;
      else return spans[mid];
    }
    return spans[Math.max(0, Math.min(spans.length - 1, low))];
  };

  // ---------- 2. limite do corpo do contrato ----------
  let bodyEnd = stream.length;
  for (const match of stream.matchAll(FOOTER)) {
    if (match[1] === match[2]) {
      const span = spanAt(match.index);
      bodyEnd = span.end; // fim do segmento da página "M de M"
      break;
    }
  }

  // ---------- 3. seções (PARTE A / PARTE B ...) ----------
  const sections = [...stream.matchAll(SECTION)].map((match) => ({ label: match[1], start: match.index }));
  const sectionAt = (offset) => {
    let label = null;
    for (const section of sections) if (section.start <= offset) label = section.label;
    return label;
  };

  // ---------- 4. marcadores ----------
  const markers = [];
  const lastTopBySection = new Map();
  const seenBySection = new Map();
  const lastChildByParent = new Map();
  let firstClauseAt = null;

  for (const match of stream.matchAll(NUMBER)) {
    const offset = match.index;
    if (offset >= bodyEnd) break;

    const span = spanAt(offset);
    // Para na primeira capa de anexo depois do início das cláusulas.
    if (firstClauseAt !== null && ANNEX_COVER.test(stream.slice(span.start, span.end)) && span.start > firstClauseAt) break;

    const rawNumber = match[1];
    const parts = rawNumber.replace(/\s/gu, "").split(".").map((part) => Number.parseInt(part, 10));
    if (parts.some((part) => !Number.isFinite(part)) || parts[0] === 0) continue;
    const depth = parts.length;
    const hasDot = Boolean(match[2]);
    const before = stream.slice(Math.max(0, offset - 60), offset);
    const after = stream.slice(offset + match[0].length, offset + match[0].length + 400);

    // Fronteira.
    const trimmedBefore = before.trimEnd();
    const lastChar = trimmedBefore.slice(-1);
    const atBoundary =
      trimmedBefore.length === 0 ||
      /[.;:)”"*]/u.test(lastChar) ||
      BOILERPLATE_BEFORE.test(trimmedBefore) ||
      UPPER_WORD.test(previousWord(trimmedBefore));
    const sectionKeyHere = sectionAt(offset) ?? "_";
    // Quadro-resumo (Parte A): o item seguinte pode vir colado ao conteúdo
    // da célula anterior (ex.: "...@newportgp.com 10 CONTRAPARTE DA
    // CONTRATADA"). Aceito só se for EXATAMENTE o próximo número da
    // sequência e vier título em MAIÚSCULAS com 2+ palavras.
    const parentHere = parts.slice(0, -1).join(".");
    const sequenceRescue =
      !atBoundary &&
      (parts.length === 1
        ? parts[0] === (lastTopBySection.get(sectionKeyHere) ?? 0) + 1 &&
          upperTitle(after.trimStart()).split(" ").filter((word) => word.length >= 3).length >= 2
        : // Subcláusula sem pontuação antes ("...processual civil 7.4.
          // Correção de Defeitos"): só se for EXATAMENTE o próximo irmão.
          parts[0] === (lastTopBySection.get(sectionKeyHere) ?? 0) &&
          parts.at(-1) === (lastChildByParent.get(`${sectionKeyHere}|${parentHere}`) ?? 0) + 1 &&
          /^[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]/u.test(after.trimStart()));
    if (!atBoundary && !sequenceRescue) continue;
    if (REFERENCE_BEFORE.test(trimmedBefore) && !BOILERPLATE_BEFORE.test(trimmedBefore) && !sequenceRescue) continue;

    // O que vem depois.
    const afterTrim = after.trimStart();
    if (/^(?:\(|[a-zà-ú]|\d|%|R\$)/u.test(afterTrim)) continue;
    // Sumário: pontilhado + página LOGO após o título — só até o fim da
    // frase (primeiro ponto simples), para não confundir uma cláusula que
    // fecha a página com o sumário que começa na página seguinte.
    const sentenceEnd = afterTrim.search(/[^.]\.(?!\.)\s/u);
    const headingSpan = sentenceEnd >= 0 ? afterTrim.slice(0, sentenceEnd + 1) : afterTrim;
    if (TOC_AHEAD.test(headingSpan) && !/^[^]{0,160}?\s\d{1,2}\.\d/u.test(headingSpan.split(/\.{4,}/u)[0])) continue;

    let title = null;
    if (depth === 1) {
      title = upperTitle(afterTrim);
      if (!title || title.replace(/[^A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]/gu, "").length < 4) continue;
      // Sem ponto ("05 PRAZOS") só vale com título claramente em maiúsculas.
      if (!hasDot && title.split(" ").length < 1) continue;
    } else {
      if (!/^[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ“"]/u.test(afterTrim)) continue;
      title = inlineTitle(afterTrim);
    }

    const section = sectionAt(offset);
    const sectionKey = section ?? "_";
    const lastTop = lastTopBySection.get(sectionKey) ?? 0;
    const flags = [];
    if (sequenceRescue) flags.push("INICIO_SEM_PONTUACAO: confirmar início da cláusula");

    if (depth === 1) {
      // Sequência: nível 1 cresce dentro da seção (salto de até 3).
      if (parts[0] <= lastTop || parts[0] - lastTop > 3) continue;
      lastTopBySection.set(sectionKey, parts[0]);
    } else {
      if (lastTop === 0) {
        // Subcláusula antes de qualquer título: aceita só se começa a seção.
        if (parts[0] > 3) continue;
        lastTopBySection.set(sectionKey, parts[0]);
        flags.push("TITULO_DA_CLAUSULA_NAO_DETECTADO");
      } else if (parts[0] === lastTop) {
        // normal
      } else if (parts[0] === lastTop + 1) {
        lastTopBySection.set(sectionKey, parts[0]);
        flags.push("TITULO_DA_CLAUSULA_NAO_DETECTADO");
      } else if (parts[0] < lastTop) {
        // Ex.: "22.1" dentro da cláusula 23 — quebra do próprio documento.
        flags.push(`NUMERACAO_INCONSISTENTE: ${parts.join(".")} aparece dentro da cláusula ${lastTop}`);
      } else {
        continue;
      }
    }

    const number = parts.join(".");
    const seen = seenBySection.get(sectionKey) ?? new Map();
    const occurrence = (seen.get(number) ?? 0) + 1;
    seen.set(number, occurrence);
    seenBySection.set(sectionKey, seen);
    if (occurrence > 1) flags.push(`NUMERO_REPETIDO: ${number} ocorre ${occurrence}x na seção`);

    if (firstClauseAt === null) firstClauseAt = offset;
    if (depth > 1) lastChildByParent.set(`${sectionKey}|${parts.slice(0, -1).join(".")}`, parts.at(-1));

    markers.push({
      offset,
      end: offset + match[0].length,
      number,
      depth,
      section,
      sectionKey,
      occurrence,
      title,
      flags,
      span,
    });
  }

  // ---------- 5. candidatos (texto até o próximo marcador de qualquer nível) ----------
  const pathByNumber = new Map();
  return markers.map((marker, index) => {
    const next = markers[index + 1];
    const contentEnd = Math.min(next ? next.offset : bodyEnd, bodyEnd);
    const content = stream.slice(marker.end, contentEnd);
    const endSpan = spanAt(Math.max(marker.end, contentEnd - 1));

    const startPage = marker.span.segment.pageNumber ?? null;
    const endPage = endSpan.segment.pageNumber ?? startPage;

    // Hierarquia: título do pai (6 → 6.5 → 6.5.1) dentro da seção.
    const pathKey = `${marker.sectionKey}|${marker.number}`;
    const parentNumber = marker.number.split(".").slice(0, -1).join(".");
    // Pai imediato ausente no documento (ex.: 3.5.1 sem 3.5): sobe até o
    // ancestral mais próximo que existe (3), em vez de perder a hierarquia.
    let parentPath = null;
    for (let ancestor = marker.number.split(".").slice(0, -1); ancestor.length > 0 && !parentPath; ancestor = ancestor.slice(0, -1)) {
      parentPath = pathByNumber.get(`${marker.sectionKey}|${ancestor.join(".")}`) ?? null;
    }
    const label = marker.title ? `${marker.number} ${marker.title}` : marker.number;
    const path = parentPath ? `${parentPath} › ${label}` : label;
    pathByNumber.set(pathKey, path);

    const body = cleanBody(content);
    const title = marker.title ?? firstWords(body, 8);
    const crossesPages = startPage !== null && endPage !== null && endPage > startPage;

    let confidence = marker.depth === 1 ? 0.92 : marker.title ? 0.9 : 0.82;
    if (marker.flags.length) confidence -= 0.15;
    if (/· OCR /u.test(marker.span.segment.locator ?? "")) confidence -= 0.1;

    const header = [
      `[Estrutura decimal${marker.section ? ` · Parte ${marker.section}` : ""} · ${path}]`,
      crossesPages ? `[Atravessa páginas: ${startPage}–${endPage}]` : null,
      ...marker.flags.map((flag) => `[REVISAR: ${flag}]`),
    ].filter(Boolean);

    return {
      detector: DECIMAL_DETECTOR,
      detectorVersion: DECIMAL_DETECTOR_VERSION,
      // Estável entre reprocessamentos (não depende da posição do segmento).
      candidateKey: `${marker.sectionKey}|${marker.number}|${marker.occurrence}`,
      confidence: Math.max(0.5, Math.round(confidence * 100) / 100),
      // Número repetido no documento (ex.: "22.1" dentro da cláusula 23)
      // ganha a ocorrência no rótulo — nunca dois candidatos idênticos.
      proposedClauseNumber:
        (marker.section ? `${marker.section}-${marker.number}` : marker.number) +
        (marker.occurrence > 1 ? ` (${marker.occurrence}ª ocorrência)` : ""),
      proposedTitle: title || `Cláusula ${marker.number}`,
      proposedText: [...header, `${marker.number}${marker.depth === 1 ? "." : ""} ${body}`.trim()].join("\n"),
      sourceSegmentId: marker.span.segment.id ?? null,
      pageNumber: startPage,
      locator: crossesPages
        ? `${marker.span.segment.locator ?? ""} · até pág. global ${endPage}`
        : marker.span.segment.locator ?? null,
      pattern: "DECIMAL",
      depth: marker.depth,
      parentNumber: parentNumber || null,
      section: marker.section,
      startPage,
      endPage,
      flags: marker.flags,
    };
  });
}
