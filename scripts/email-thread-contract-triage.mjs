import { createClient } from "@supabase/supabase-js";

const PROJECT_ID =
  "00000000-0000-4000-8000-000000000001";

const RULE_VERSION =
  "thread-contract-v3";

const APPLY =
  process.argv.includes("--apply");

function required(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

const supabase = createClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("SUPABASE_SECRET_KEY"),
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesIdentifier(text, identifier) {
  const needle = normalize(identifier.value);

  if (!needle) {
    return false;
  }

  if (
    identifier.kind === "CLIENT_NAME" &&
    needle.length <= 4
  ) {
    const escaped = escapeRegex(needle);

    return new RegExp(
      `(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`,
      "i"
    ).test(text);
  }

  return text.includes(needle);
}

/*
 * Regras V3.
 *
 * Esta camada somente envia threads para REVIEW_REQUIRED.
 * Ela NAO cria Contract Event.
 */

const strongRules = [
  {
    category: "CLAIMS_CHANGE_ORDERS",
    weight: 10,
    terms: [
      "aditivo",
      "aditivo de contrato",
      "aditivo contratual",
      "aditivo 01",
      "aditamento",
      "pleito axion",
      "change order",
      "fora do escopo",
      "servicos adicionais",
      "servico adicional"
    ]
  },

  {
    category: "ESCOPO",
    weight: 9,
    terms: [
      "fora do escopo",
      "alteracao de escopo",
      "mudanca de escopo",
      "ampliacao predio",
      "ampliacao do predio",
      "itens excluidos",
      "remocao de pilares"
    ]
  },

  {
    category: "ALTERACOES_PROJETO",
    weight: 9,
    terms: [
      "alteracao de projeto",
      "alteracoes do projeto",
      "revisao de projeto",
      "reforco de vigas",
      "remocao de 4 pilares",
      "mudanca de projeto"
    ]
  },

  {
    category: "CUSTO",
    weight: 8,
    terms: [
      "revisao de orcamento",
      "orcamento revisado",
      "custo adicional",
      "valor adicional",
      "acrescimo de custo",
      "impacto financeiro"
    ]
  },

  {
    category: "PAGAMENTOS",
    weight: 9,
    terms: [
      "faturamento direto",
      "retencao contratual",
      "devolucao da retencao",
      "liberacao da retencao",
      "caucao contratual",
      "pagamento em atraso"
    ]
  },

  {
    category: "PRAZO",
    weight: 8,
    terms: [
      "extensao de prazo",
      "prorrogacao de prazo",
      "atraso contratual",
      "impacto no prazo",
      "prazo adicional"
    ]
  },

  {
    category: "PENALIDADES",
    weight: 10,
    terms: [
      "multa contratual",
      "penalidade",
      "inadimplemento",
      "descumprimento contratual"
    ]
  },

  {
    category: "NOTIFICACOES",
    weight: 9,
    terms: [
      "notificacao extrajudicial",
      "notificacao contratual",
      "contranotificacao"
    ]
  },

  {
    category: "MEDICOES",
    weight: 8,
    terms: [
      "glosa de medicao",
      "medicao rejeitada",
      "medicao recusada"
    ]
  }
];

const supportingRules = [
  {
    category: "CLAIMS_CHANGE_ORDERS",
    weight: 4,
    terms: [
      "aditivo",
      "adicionais",
      "pleito"
    ]
  },

  {
    category: "ESCOPO",
    weight: 3,
    terms: [
      "escopo",
      "ampliacao"
    ]
  },

  {
    category: "CUSTO",
    weight: 3,
    terms: [
      "orcamento",
      "valor",
      "preco"
    ]
  },

  {
    category: "PRAZO",
    weight: 3,
    terms: [
      "prazo",
      "cronograma",
      "atraso"
    ]
  },

  {
    category: "PAGAMENTOS",
    weight: 3,
    terms: [
      "faturamento",
      "retencao",
      "caucao",
      "pagamento"
    ]
  },

  {
    category: "ALTERACOES_PROJETO",
    weight: 3,
    terms: [
      "projeto executivo",
      "alteracao",
      "revisao"
    ]
  },

  {
    category: "RESPONSABILIDADES",
    weight: 3,
    terms: [
      "responsabilidade",
      "contratual"
    ]
  }
];

function contractualTriage(text) {
  let score = 0;
  let strongHits = 0;

  const categories = new Set();
  const matches = [];

  for (const rule of strongRules) {
    const found =
      rule.terms.filter(
        (term) =>
          text.includes(normalize(term))
      );

    if (!found.length) {
      continue;
    }

    strongHits += 1;
    categories.add(rule.category);

    score +=
      rule.weight +
      Math.min(found.length - 1, 2);

    matches.push({
      type: "STRONG",
      category: rule.category,
      terms: found
    });
  }

  for (const rule of supportingRules) {
    const found =
      rule.terms.filter(
        (term) =>
          text.includes(normalize(term))
      );

    if (!found.length) {
      continue;
    }

    categories.add(rule.category);
    score += rule.weight;

    matches.push({
      type: "SUPPORTING",
      category: rule.category,
      terms: found
    });
  }

  const categoryList =
    Array.from(categories);

  const reviewRequired =
    strongHits > 0 ||
    (
      score >= 10 &&
      categoryList.length >= 2
    );

  let priority = "BAIXA";

  if (reviewRequired) {
    if (score >= 22) {
      priority = "CRITICA";
    } else if (score >= 14) {
      priority = "ALTA";
    } else {
      priority = "MEDIA";
    }
  }

  return {
    reviewRequired,
    priority,
    score,
    categories: categoryList,
    matches
  };
}


/*
 * Fingerprint do projeto.
 */

const {
  data: identifiers,
  error: identifiersError
} = await supabase
  .from("project_relevance_identifiers")
  .select("kind,value,strength,weight")
  .eq("project_id", PROJECT_ID)
  .eq("active", true);

if (identifiersError) {
  throw new Error(identifiersError.message);
}


/*
 * Todos os emails Gmail do projeto.
 */

const {
  data: emails,
  error: emailError
} = await supabase
  .from("emails")
  .select(
    [
      "id",
      "subject",
      "snippet",
      "sent_at",
      "direction",
      "from_address",
      "to_address",
      "provider_thread_id"
    ].join(",")
  )
  .eq("project_id", PROJECT_ID)
  .eq("provider", "GMAIL")
  .order("sent_at", {
    ascending: true
  });

if (emailError) {
  throw new Error(emailError.message);
}


/*
 * Agrupar por thread Gmail.
 */

const threads = new Map();

for (const email of emails ?? []) {
  const threadId =
    email.provider_thread_id ??
    `email:${email.id}`;

  if (!threads.has(threadId)) {
    threads.set(threadId, []);
  }

  threads.get(threadId).push(email);
}


/*
 * Primeiro: Project Relevance Gate.
 * Depois: triagem contratual V3.
 */

const related = [];
const review = [];
const skipped = [];

for (const [threadId, messages] of threads.entries()) {
  const text =
    normalize(
      messages
        .map((message) =>
          [
            message.subject ?? "",
            message.snippet ?? "",
            message.from_address ?? "",
            message.to_address ?? ""
          ].join("\n")
        )
        .join("\n")
    );

  const identifierMatches = [];

  for (const identifier of identifiers ?? []) {
    if (
      matchesIdentifier(
        text,
        identifier
      )
    ) {
      identifierMatches.push(identifier);
    }
  }

  const strongIdentifiers =
    identifierMatches.filter(
      (match) =>
        match.strength === "STRONG"
    );

  if (!strongIdentifiers.length) {
    continue;
  }

  const triage =
    contractualTriage(text);

  const row = {
    providerThreadId:
      threadId,

    emailIds:
      messages.map(
        (message) => message.id
      ),

    subjectFull:
      messages[0]?.subject ?? "",
    thread:
      threadId.slice(0, 16),

    mensagens:
      messages.length,

    prioridade:
      triage.priority,

    score:
      triage.score,

    categorias:
      triage.categories.join(","),

    assunto:
      (messages[0]?.subject ?? "")
        .slice(0, 110)
  };

  related.push(row);

  if (triage.reviewRequired) {
    review.push(row);
  } else {
    skipped.push(row);
  }
}

review.sort(
  (a, b) =>
    b.score - a.score
);

console.log("");
console.log(
  "AXION - THREAD CONTRACT TRIAGE V3"
);
console.log(
  "================================"
);

console.log("");
console.log(
  "PROJECT_RELATED ANALISADAS:",
  related.length
);

console.log("");
console.log(
  "REVIEW_REQUIRED"
);
console.log(
  "---------------"
);

console.table(
  review.map(
    ({
      providerThreadId,
      emailIds,
      ...visible
    }) => visible
  )
);

console.log("");
console.log(
  "PROJECT_RELATED SEM SINAL CONTRATUAL"
);
console.log(
  "------------------------------------"
);

console.table(
  skipped.map(
    ({
      providerThreadId,
      emailIds,
      ...visible
    }) => visible
  )
);

console.log("");
console.log(
  "RESUMO"
);
console.log(
  "------"
);

console.table([
  {
    project_related:
      related.length,

    review_required:
      review.length,

    sem_sinal_contratual:
      skipped.length,

    contract_events_criados:
      0
  }
]);

if (APPLY) {
  let recorded = 0;

  for (const row of review) {
    const {
      error
    } = await supabase.rpc(
      "register_email_thread_event_candidate",
      {
        p_project_id:
          PROJECT_ID,

        p_provider_thread_id:
          row.providerThreadId,

        p_rule_version:
          RULE_VERSION,

        p_priority:
          row.prioridade,

        p_score:
          row.score,

        p_categories:
          row.categorias
            ? row.categorias.split(",")
            : [],

        p_subject:
          row.subjectFull,

        p_email_ids:
          row.emailIds
      }
    );

    if (error) {
      console.error(
        "ERRO AO REGISTRAR CANDIDATO:",
        row.thread,
        error.message
      );

      process.exit(1);
    }

    recorded += 1;
  }

  const {
    data: queue,
    error: queueError
  } = await supabase
    .from(
      "email_thread_event_candidates"
    )
    .select(
      [
        "provider_thread_id",
        "status",
        "priority",
        "score",
        "categories",
        "message_count",
        "subject"
      ].join(",")
    )
    .eq(
      "project_id",
      PROJECT_ID
    )
    .eq(
      "rule_version",
      RULE_VERSION
    )
    .order(
      "score",
      {
        ascending: false
      }
    );

  if (queueError) {
    throw new Error(
      queueError.message
    );
  }

  console.log("");
  console.log(
    "FILA DE CANDIDATOS GRAVADA"
  );
  console.log(
    "--------------------------"
  );

  console.table(
    (queue ?? []).map(
      (row) => ({
        thread:
          row.provider_thread_id
            .slice(0, 16),

        status:
          row.status,

        prioridade:
          row.priority,

        score:
          row.score,

        mensagens:
          row.message_count,

        categorias:
          (row.categories ?? [])
            .join(","),

        assunto:
          row.subject
      })
    )
  );

  console.log("");
  console.log(
    "Candidatos processados:",
    recorded
  );
}

console.log("");
console.log(
  "Contract Events criados: 0"
);