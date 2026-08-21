const ANALYZER = "event-clause-confrontation";
const ANALYZER_VERSION = "3";

const STOP_WORDS = new Set([
  "a","ao","aos","as","com","como","da","das","de","do","dos",
  "e","em","entre","esta","este","foi","mais","na","nas","no","nos",
  "o","os","ou","para","pela","pelas","pelo","pelos","por","que",
  "se","sem","ser","sua","suas","seu","seus","um","uma",
  "boa","bom","tarde","dia","caros","obrigado","atenciosamente",
  "conforme","qualquer","todos","todas","bem"
]);

const GENERIC_DOMAIN_WORDS = new Set([
  "contrato","contratual","contratos",
  "projeto","projetos",
  "obra","obras",
  "documento","documentos",
  "acompanhamento",
  "weg","axion"
]);

const CATEGORY_LEXICONS = {
  PRAZO: [
    "prazo","atraso","cronograma","entrega",
    "prorrogacao","prorrogar","extensao","vigencia"
  ],

  MULTA_PENALIDADE: [
    "multa","penalidade","penalidades","sancao",
    "sancoes","mora","inadimplemento"
  ],

  PAGAMENTO_MEDICAO: [
    "pagamento","pagamentos","medicao","medicoes",
    "fatura","faturamento","retencao","retencoes",
    "preco","precos"
  ],

  ESCOPO_ALTERACAO: [
    "escopo","escopos","alteracao","alteracoes",
    "aditivo","aditivos","adicional","adicionais",
    "quantidade","quantidades","mudanca","mudancas",
    "modificacao","modificacoes"
  ],

  GARANTIA: [
    "garantia","garantias","defeito","defeitos",
    "correcao","reparo","assistencia"
  ],

  RESCISAO: [
    "rescisao","rescindir","terminacao",
    "encerramento","cancelamento","inadimplemento"
  ],

  SEGURO_RESPONSABILIDADE: [
    "seguro","seguros","indenizacao","indenizar",
    "responsabilidade","responsabilidades",
    "danos","sinistro"
  ],

  SSMA_ESG: [
    "ssma","seguranca","saude","ambiental",
    "ambiente","acidente","incidente","residuo","licenca"
  ]
};

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b[\w.+-]+@[\w.-]+\.\w+\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(" ")
    .filter(
      token =>
        token.length >= 3 &&
        !STOP_WORDS.has(token) &&
        !GENERIC_DOMAIN_WORDS.has(token) &&
        !/^\d+$/.test(token)
    );
}

function unique(values) {
  return [...new Set(values)];
}

function detectCategories(text) {
  const tokens =
    new Set(tokenize(text));

  const categories = [];

  for (
    const [category, terms]
    of Object.entries(CATEGORY_LEXICONS)
  ) {
    const matches =
      terms
        .map(normalizeText)
        .filter(term => tokens.has(term));

    if (matches.length) {
      categories.push({
        category,
        matches: unique(matches)
      });
    }
  }

  return categories;
}

function titleCategories(
  title,
  eventCategories
) {
  const normalized =
    normalizeText(title);

  const eventMap =
    new Map(
      eventCategories.map(
        item => [
          item.category,
          item.matches
        ]
      )
    );

  const result = [];

  function addIf(
    category,
    terms
  ) {
    if (!eventMap.has(category)) {
      return;
    }

    if (
      terms.some(
        term =>
          normalized.includes(term)
      )
    ) {
      result.push(category);
    }
  }

  addIf(
    "PRAZO",
    ["prazo","vigencia"]
  );

  addIf(
    "PAGAMENTO_MEDICAO",
    ["pagamento","medicao","preco"]
  );

  addIf(
    "ESCOPO_ALTERACAO",
    ["objeto","escopo","alteracao","aditivo"]
  );

  addIf(
    "GARANTIA",
    ["garantia"]
  );

  addIf(
    "RESCISAO",
    ["rescisao","encerramento"]
  );

  addIf(
    "MULTA_PENALIDADE",
    ["multa","penalidade"]
  );

  addIf(
    "SSMA_ESG",
    ["ssma","seguranca","ambiental"]
  );

  const insurance =
    eventMap.get(
      "SEGURO_RESPONSABILIDADE"
    );

  if (insurance) {
    if (
      normalized.includes("seguro")
    ) {
      result.push(
        "SEGURO_RESPONSABILIDADE"
      );
    }

    const responsibilityTerms =
      new Set([
        "responsabilidade",
        "responsabilidades",
        "indenizacao",
        "indenizar",
        "danos",
        "sinistro"
      ]);

    if (
      normalized.includes(
        "responsabilidade"
      ) &&
      insurance.some(
        term =>
          responsibilityTerms.has(term)
      )
    ) {
      result.push(
        "SEGURO_RESPONSABILIDADE"
      );
    }
  }

  return unique(result);
}

function exactCategoryMatches(
  eventCategories,
  clauseCategories
) {
  const clauseMap =
    new Map(
      clauseCategories.map(
        item => [
          item.category,
          new Set(item.matches)
        ]
      )
    );

  const categories = [];
  const terms = [];

  for (
    const eventCategory
    of eventCategories
  ) {
    const right =
      clauseMap.get(
        eventCategory.category
      );

    if (!right) {
      continue;
    }

    const overlap =
      eventCategory.matches.filter(
        term => right.has(term)
      );

    /*
     * Body-only matching is deliberately strict.
     * One generic coincident term is not enough.
     */
    if (overlap.length >= 2) {
      categories.push(
        eventCategory.category
      );

      terms.push(
        ...overlap
      );
    }
  }

  return {
    categories:
      unique(categories),

    terms:
      unique(terms)
  };
}

function lexicalOverlap(
  left,
  right
) {
  const a =
    new Set(tokenize(left));

  const b =
    new Set(tokenize(right));

  return unique(
    [...a].filter(
      token => b.has(token)
    )
  );
}

function inferSeverity(
  categories,
  confidence
) {
  const set =
    new Set(categories);

  if (
    set.has("RESCISAO") ||
    set.has("MULTA_PENALIDADE")
  ) {
    return confidence >= 0.7
      ? "HIGH"
      : "MEDIUM";
  }

  if (
    set.has("PRAZO") ||
    set.has("PAGAMENTO_MEDICAO") ||
    set.has("ESCOPO_ALTERACAO") ||
    set.has("SEGURO_RESPONSABILIDADE") ||
    set.has("SSMA_ESG")
  ) {
    return "MEDIUM";
  }

  return "LOW";
}

function clamp(value) {
  return Math.max(
    0,
    Math.min(1, value)
  );
}

function shortText(
  value,
  max = 600
) {
  const text =
    String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();

  return text.length <= max
    ? text
    : `${text.slice(0, max)}...`;
}

export function analyzeEventAgainstClauses({
  event,
  clauses
}) {
  const eventText =
    [
      event.title,
      event.description
    ]
      .filter(Boolean)
      .join("\n");

  const eventCategories =
    detectCategories(
      eventText
    );

  const results = [];

  for (const clause of clauses) {
    const clauseText =
      [
        clause.clauseNumber,
        clause.title,
        clause.text
      ]
        .filter(Boolean)
        .join("\n");

    const clauseCategories =
      detectCategories(
        clauseText
      );

    const titleMatched =
      titleCategories(
        clause.title,
        eventCategories
      );

    const exact =
      exactCategoryMatches(
        eventCategories,
        clauseCategories
      );

    const sharedCategories =
      unique([
        ...titleMatched,
        ...exact.categories
      ]);

    /*
     * V3: no thematic evidence = no candidate.
     * Lexical coincidence alone never creates impact.
     */
    if (!sharedCategories.length) {
      continue;
    }

    const lexical =
      lexicalOverlap(
        eventText,
        clauseText
      );

    const titleBonus =
      titleMatched.length
        ? 0.08
        : 0;

    const categoryScore =
      0.55 +
      Math.min(
        (sharedCategories.length - 1) * 0.12,
        0.24
      );

    const exactBonus =
      Math.min(
        exact.terms.length * 0.04,
        0.12
      );

    const lexicalBonus =
      Math.min(
        lexical.length * 0.01,
        0.08
      );

    const score =
      clamp(
        categoryScore +
        titleBonus +
        exactBonus +
        lexicalBonus
      );

    const thematicTerms =
      eventCategories
        .filter(
          item =>
            sharedCategories.includes(
              item.category
            )
        )
        .flatMap(
          item =>
            item.matches
        );

    const evidenceTerms =
      unique([
        ...exact.terms,
        ...thematicTerms,
        ...lexical
      ]).slice(0, 12);

    const severity =
      inferSeverity(
        sharedCategories,
        score
      );

    results.push({
      analyzer:
        ANALYZER,

      analyzerVersion:
        ANALYZER_VERSION,

      candidateKey:
        "primary",

      eventId:
        event.id,

      clauseId:
        clause.id,

      findingType:
        "IMPACTO_POTENCIAL",

      severity,

      confidence:
        Number(
          score.toFixed(4)
        ),

      categories:
        sharedCategories,

      sharedTerms:
        evidenceTerms,

      summary:
        `Possivel relacao contratual nas categorias ${sharedCategories.join(", ")}.`,

      eventBasis:
        shortText(
          eventText
        ),

      clauseBasis:
        shortText(
          `Clausula ${clause.clauseNumber} - ${clause.title}\n${clause.text}`
        )
    });
  }

  return results.sort(
    (a, b) =>
      b.confidence -
      a.confidence
  );
}
