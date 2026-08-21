const ANALYZER = "event-clause-lexical";
const ANALYZER_VERSION = "1";

const STOP_WORDS = new Set([
  "a","ao","aos","as","com","como","da","das","de","do","dos","e","em","entre",
  "essa","esse","esta","este","foi","na","nas","no","nos","o","os","ou","para",
  "pela","pelas","pelo","pelos","por","que","se","sem","ser","sua","suas","seu",
  "seus","um","uma"
]);

const CATEGORY_LEXICONS = {
  PRAZO: ["prazo","atraso","cronograma","dias","data","entrega","prorrogacao","prorrogar","extensao","vigencia"],
  MULTA_PENALIDADE: ["multa","penalidade","penalidades","sancao","sancoes","mora","inadimplemento","atraso"],
  PAGAMENTO_MEDICAO: ["pagamento","medicao","medicoes","fatura","faturamento","preco","valor","retencao","financeiro"],
  ESCOPO_ALTERACAO: ["escopo","alteracao","alteracoes","aditivo","adicional","servico","servicos","quantidade","projeto","mudanca","modificacao"],
  GARANTIA: ["garantia","garantias","defeito","defeitos","correcao","reparo","assistencia","responsabilidade"],
  RESCISAO: ["rescisao","rescindir","terminacao","encerramento","cancelamento","inadimplemento"],
  SEGURO_RESPONSABILIDADE: ["seguro","indenizacao","indenizar","responsabilidade","danos","sinistro"],
  SSMA_ESG: ["ssma","seguranca","saude","ambiental","meio","ambiente","acidente","incidente","residuo","licenca"]
};

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function unique(values) {
  return [...new Set(values)];
}

function detectCategories(text) {
  const tokens = new Set(tokenize(text));
  const categories = [];

  for (const [category, terms] of Object.entries(CATEGORY_LEXICONS)) {
    const matches = terms
      .map(normalizeText)
      .filter((term) => tokens.has(term));

    if (matches.length > 0) {
      categories.push({
        category,
        matches: unique(matches)
      });
    }
  }

  return categories;
}

function overlapTerms(a, b) {
  const first = new Set(tokenize(a));
  const second = new Set(tokenize(b));

  return unique(
    [...first].filter((token) => second.has(token))
  );
}

function categoryIntersection(a, b) {
  const right = new Set(
    b.map((item) => item.category)
  );

  return a
    .map((item) => item.category)
    .filter((category) => right.has(category));
}

function inferSeverity(categories, score) {
  const set = new Set(categories);

  if (
    set.has("RESCISAO") ||
    set.has("MULTA_PENALIDADE")
  ) {
    return score >= 0.6 ? "HIGH" : "MEDIUM";
  }

  if (
    set.has("PRAZO") ||
    set.has("PAGAMENTO_MEDICAO") ||
    set.has("SSMA_ESG")
  ) {
    return "MEDIUM";
  }

  return "LOW";
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

function shortText(value, max = 600) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

  return text.length <= max
    ? text
    : text.slice(0, max - 1) + "…";
}

export function analyzeEventAgainstClauses({ event, clauses }) {
  const eventText = [
    event.title,
    event.description
  ].filter(Boolean).join("\n");

  const eventCategories = detectCategories(eventText);
  const results = [];

  for (const clause of clauses) {
    const clauseText = [
      clause.clauseNumber,
      clause.title,
      clause.text
    ].filter(Boolean).join("\n");

    const clauseCategories = detectCategories(clauseText);
    const sharedTerms = overlapTerms(eventText, clauseText);

    const sharedCategories = categoryIntersection(
      eventCategories,
      clauseCategories
    );

    const eventTokenCount = Math.max(
      tokenize(eventText).length,
      1
    );

    const lexicalScore = Math.min(
      sharedTerms.length / Math.min(eventTokenCount, 12),
      1
    );

    const categoryScore = Math.min(
      sharedCategories.length * 0.3,
      0.6
    );

    const titleBonus =
      overlapTerms(
        event.title,
        [clause.clauseNumber, clause.title]
          .filter(Boolean)
          .join(" ")
      ).length > 0
        ? 0.15
        : 0;

    const score = clamp(
      lexicalScore * 0.5 +
      categoryScore +
      titleBonus
    );

    if (
      score < 0.18 ||
      (
        sharedTerms.length === 0 &&
        sharedCategories.length === 0
      )
    ) {
      continue;
    }

    const severity = inferSeverity(
      sharedCategories,
      score
    );

    const evidenceTerms = unique([
      ...sharedTerms,
      ...eventCategories.flatMap(
        (item) => item.matches
      )
    ]).slice(0, 12);

    results.push({
      analyzer: ANALYZER,
      analyzerVersion: ANALYZER_VERSION,
      candidateKey: "primary",
      eventId: event.id,
      clauseId: clause.id,
      findingType: "IMPACTO_POTENCIAL",
      severity,
      confidence: Number(score.toFixed(4)),
      categories: sharedCategories,
      sharedTerms: evidenceTerms,

      summary:
        sharedCategories.length > 0
          ? `Possível relação contratual nas categorias ${sharedCategories.join(", ")}.`
          : `Possível relação contratual por termos coincidentes: ${sharedTerms.slice(0, 6).join(", ")}.`,

      eventBasis: shortText(eventText),

      clauseBasis: shortText(
        `Cláusula ${clause.clauseNumber} – ${clause.title}\n${clause.text}`
      )
    });
  }

  return results.sort(
    (a, b) => b.confidence - a.confidence
  );
}
