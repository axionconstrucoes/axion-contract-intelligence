import { createClient } from "@supabase/supabase-js";

const PROJECT_ID =
  "00000000-0000-4000-8000-000000000001";

const RULE_VERSION = "email-triage-v2";

const APPLY =
  process.argv.includes("--apply");

function required(name) {
  const value =
    process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `Missing environment variable: ${name}`
    );
  }

  return value;
}

const supabase =
  createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("SUPABASE_SECRET_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

function normalize(value) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const strongSignals = [
  {
    category: "MULTAS",
    weight: 9,
    terms: [
      "multa contratual",
      "aplicacao de multa",
      "cobranca de multa",
    ],
  },

  {
    category: "PENALIDADES",
    weight: 9,
    terms: [
      "inadimplemento",
      "rescisao contratual",
      "penalidade contratual",
      "descumprimento contratual",
      "nao cumprimento de obrigacoes contratuais",
    ],
  },

  {
    category: "NOTIFICACOES",
    weight: 8,
    terms: [
      "notificacao extrajudicial",
      "notificacao por nao cumprimento",
      "notificacao por descumprimento",
      "notificacao formal de atraso",
    ],
  },

  {
    category: "CLAIMS_CHANGE_ORDERS",
    weight: 8,
    terms: [
      "solicitacao de aditivo",
      "aditivo contratual",
      "aditamento contratual",
      "aditamento contrato",
      "change order",
      "fora do escopo",
      "pleito contratual",
      "servico adicional",
      "servicos adicionais",
    ],
  },

  {
    category: "PRAZO",
    weight: 8,
    terms: [
      "extensao de prazo",
      "prorrogacao contratual",
      "atraso contratual",
      "paralisacao por responsabilidade",
    ],
  },

  {
    category: "CUSTO",
    weight: 8,
    terms: [
      "custo adicional",
      "impacto financeiro",
      "acrescimo de custo",
      "preco adicional",
    ],
  },

  {
    category: "PAGAMENTOS",
    weight: 8,
    terms: [
      "pagamento em atraso",
      "pagamento pendente",
      "inadimplencia",
      "fatura vencida",
    ],
  },

  {
    category: "MEDICOES",
    weight: 8,
    terms: [
      "glosa de medicao",
      "medicao rejeitada",
      "medicao recusada",
    ],
  },
];

const supportingSignals = [
  {
    category: "CLAIMS_CHANGE_ORDERS",
    weight: 3,
    terms: [
      "aditivo",
      "aditamento",
      "adicionais",
      "pleito",
    ],
  },

  {
    category: "NOTIFICACOES",
    weight: 3,
    terms: [
      "notificacao",
      "notificamos",
    ],
  },

  {
    category: "PRAZO",
    weight: 3,
    terms: [
      "atraso",
      "prazo",
      "cronograma",
      "prorrogacao",
      "paralisacao",
    ],
  },

  {
    category: "ESCOPO",
    weight: 3,
    terms: [
      "escopo",
      "ampliacao",
      "reducao de escopo",
      "alteracao de escopo",
    ],
  },

  {
    category: "ALTERACOES_PROJETO",
    weight: 3,
    terms: [
      "alteracao de projeto",
      "revisao de projeto",
      "mudanca de projeto",
    ],
  },

  {
    category: "CUSTO",
    weight: 3,
    terms: [
      "custo",
      "valor adicional",
      "reajuste",
    ],
  },

  {
    category: "MEDICOES",
    weight: 3,
    terms: [
      "medicao",
      "glosa",
    ],
  },

  {
    category: "PAGAMENTOS",
    weight: 3,
    terms: [
      "pagamento",
      "fatura",
      "nota fiscal",
    ],
  },

  {
    category: "RESPONSABILIDADES",
    weight: 3,
    terms: [
      "responsabilidade do cliente",
      "responsabilidade da contratada",
      "responsabilidade da axion",
      "obrigacao contratual",
    ],
  },
];

const calendarPrefixes = [
  "aceita:",
  "accepted:",
  "recusada:",
  "declined:",
  "tentativa:",
  "tentative:",
  "cancelada:",
  "canceled:",
];

const meetingNoise = [
  "notificacao de encaminhamento de reuniao",
  "notificacao de encaminhamento da reuniao",
];

const actionableMeetingContext = [
  "solicitacao",
  "aprovacao",
  "proposta",
  "assinatura",
  "formalizacao",
  "cobranca",
  "notificacao extrajudicial",
  "fora do escopo",
  "custo adicional",
];

function classify(email) {
  const subject =
    normalize(email.subject);

  const snippet =
    normalize(email.snippet);

  const text =
    `${subject}\n${snippet}`;

  for (const prefix of calendarPrefixes) {
    if (subject.startsWith(prefix)) {
      return {
        requiresReview: false,
        priority: "BAIXA",
        score: 0,
        categories: [],
        matches: [
          {
            type: "EXCLUSION",
            reason:
              "calendar_response",
          },
        ],
      };
    }
  }

  if (
    meetingNoise.some(
      (term) => text.includes(term)
    )
  ) {
    return {
      requiresReview: false,
      priority: "BAIXA",
      score: 0,
      categories: [],
      matches: [
        {
          type: "EXCLUSION",
          reason:
            "meeting_notification",
        },
      ],
    };
  }

  const looksLikeMeeting =
    text.includes(
      "reuniao | microsoft teams"
    ) ||
    text.includes(
      "reuniao microsoft teams"
    );

  const hasActionableMeetingContext =
    actionableMeetingContext.some(
      (term) => text.includes(term)
    );

  if (
    looksLikeMeeting &&
    !hasActionableMeetingContext
  ) {
    return {
      requiresReview: false,
      priority: "BAIXA",
      score: 0,
      categories: [],
      matches: [
        {
          type: "EXCLUSION",
          reason:
            "meeting_invitation",
        },
      ],
    };
  }

  let score = 0;
  let strongHitCount = 0;

  const categories =
    new Set();

  const matches = [];

  for (const rule of strongSignals) {
    const found =
      rule.terms.filter(
        (term) =>
          text.includes(
            normalize(term)
          )
      );

    if (!found.length) {
      continue;
    }

    strongHitCount += 1;

    categories.add(
      rule.category
    );

    score +=
      rule.weight +
      Math.min(
        found.length - 1,
        2
      );

    matches.push({
      type: "STRONG",
      category:
        rule.category,
      terms: found,
      weight:
        rule.weight,
    });
  }

  for (
    const rule
    of supportingSignals
  ) {
    const found =
      rule.terms.filter(
        (term) =>
          text.includes(
            normalize(term)
          )
      );

    if (!found.length) {
      continue;
    }

    categories.add(
      rule.category
    );

    score +=
      rule.weight;

    matches.push({
      type: "SUPPORTING",
      category:
        rule.category,
      terms: found,
      weight:
        rule.weight,
    });
  }

  const categoryArray =
    Array.from(categories);

  /*
   * Fail-closed:
   *
   * - 1 sinal forte ja justifica revisão;
   * OU
   * - combinacao >= 8 pontos em pelo
   *   menos 2 categorias.
   *
   * Isso evita que "aditivo" isolado
   * gere um evento contratual.
   */
  const requiresReview =
    strongHitCount > 0 ||
    (
      score >= 8 &&
      categoryArray.length >= 2
    );

  let priority =
    "BAIXA";

  if (requiresReview) {
    if (score >= 16) {
      priority =
        "CRITICA";
    } else if (score >= 11) {
      priority =
        "ALTA";
    } else {
      priority =
        "MEDIA";
    }
  }

  return {
    requiresReview,
    priority,
    score,
    categories:
      categoryArray,
    matches,
  };
}

const {
  data: emails,
  error: emailError,
} =
  await supabase
    .from("emails")
    .select(
      [
        "id",
        "project_id",
        "subject",
        "sent_at",
        "snippet",
        "provider",
        "direction",
        "provider_thread_id",
      ].join(",")
    )
    .eq(
      "project_id",
      PROJECT_ID
    )
    .eq(
      "provider",
      "GMAIL"
    )
    .order(
      "sent_at",
      {
        ascending: true,
      }
    );

if (emailError) {
  throw new Error(
    emailError.message
  );
}

const {
  data: existing,
  error: existingError,
} =
  await supabase
    .from(
      "email_triage_results"
    )
    .select("email_id")
    .eq(
      "project_id",
      PROJECT_ID
    )
    .eq(
      "rule_version",
      RULE_VERSION
    );

if (existingError) {
  throw new Error(
    existingError.message
  );
}

const processed =
  new Set(
    (existing ?? [])
      .map(
        (row) =>
          row.email_id
      )
  );

const results = [];

for (const email of emails ?? []) {
  if (
    processed.has(email.id)
  ) {
    continue;
  }

  results.push({
    email,
    classification:
      classify(email),
  });
}

const review =
  results.filter(
    ({ classification }) =>
      classification
        .requiresReview
  );

const skipped =
  results.length -
  review.length;

const reviewThreads =
  new Set(
    review
      .map(
        ({ email }) =>
          email.provider_thread_id
      )
      .filter(Boolean)
  );

console.log("");
console.log(
  "AXION - EMAIL CONTRACT TRIAGE V2"
);
console.log(
  "================================"
);
console.log(
  "Rule version:",
  RULE_VERSION
);
console.log(
  "Modo:",
  APPLY
    ? "APPLY SCREENING"
    : "DRY RUN"
);
console.log("");

console.table([
  {
    emails_total:
      emails?.length ?? 0,

    ja_processados_v2:
      processed.size,

    novos_para_triagem:
      results.length,

    review_required:
      review.length,

    threads_em_revisao:
      reviewThreads.size,

    skipped,
  },
]);

const categoryCounts = {};

for (const row of review) {
  for (
    const category
    of row.classification.categories
  ) {
    categoryCounts[category] =
      (categoryCounts[category] ?? 0) +
      1;
  }
}

console.log("");
console.log(
  "CATEGORIAS PARA REVISAO"
);
console.log(
  "-----------------------"
);

console.table(
  Object
    .entries(categoryCounts)
    .sort(
      (a, b) =>
        b[1] - a[1]
    )
    .map(
      ([category, count]) => ({
        category,
        count,
      })
    )
);

console.log("");
console.log(
  "AMOSTRA REVIEW_REQUIRED"
);
console.log(
  "-----------------------"
);

console.table(
  [...review]
    .sort(
      (a, b) =>
        b.classification.score -
        a.classification.score
    )
    .slice(0, 25)
    .map(
      ({ email, classification }) => ({
        score:
          classification.score,

        prioridade:
          classification.priority,

        categorias:
          classification
            .categories
            .join(","),

        thread:
          email.provider_thread_id
            ? email.provider_thread_id
                .slice(0, 16)
            : "",

        assunto:
          (email.subject ?? "")
            .slice(0, 100),
      })
    )
);

if (!APPLY) {
  console.log("");
  console.log(
    "DRY RUN concluido."
  );
  console.log(
    "Nenhum Contract Event foi criado."
  );
  console.log(
    "Nenhum resultado foi gravado."
  );

  process.exit(0);
}

let reviewWritten = 0;
let skippedWritten = 0;

for (const row of results) {
  const c =
    row.classification;

  const {
    data,
    error,
  } =
    await supabase.rpc(
      "register_email_triage_screening",
      {
        p_email_id:
          row.email.id,

        p_rule_version:
          RULE_VERSION,

        p_requires_review:
          c.requiresReview,

        p_priority:
          c.priority,

        p_score:
          c.score,

        p_categories:
          c.categories,

        p_matched_terms:
          c.matches,
      }
    );

  if (error) {
    console.error(
      "ERRO:",
      row.email.id,
      error.message
    );

    process.exit(1);
  }

  if (
    data ===
    "REVIEW_REQUIRED"
  ) {
    reviewWritten += 1;
  } else {
    skippedWritten += 1;
  }
}

console.log("");
console.log(
  "SCREENING GRAVADO"
);
console.log(
  "-----------------"
);

console.table([
  {
    review_required:
      reviewWritten,

    skipped:
      skippedWritten,

    contract_events_criados:
      0,
  },
]);

console.log("");
console.log(
  "Nenhum Contract Event foi criado."
);
console.log(
  "Proxima camada: analise do thread e evidencia."
);
