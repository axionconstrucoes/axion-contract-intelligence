import { createClient } from "@supabase/supabase-js";

const PROJECT_ID =
  "00000000-0000-4000-8000-000000000001";

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
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

function matchesIdentifier(
  text,
  identifier
) {
  const needle =
    normalize(identifier.value);

  if (!needle) {
    return false;
  }

  /*
   * WEG e outros nomes curtos precisam aparecer
   * como palavra independente.
   */
  if (
    identifier.kind === "CLIENT_NAME" &&
    needle.length <= 4
  ) {
    const escaped =
      escapeRegex(needle);

    return new RegExp(
      `(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`,
      "i"
    ).test(text);
  }

  return text.includes(needle);
}

const {
  data: identifiers,
  error: identifierError,
} =
  await supabase
    .from(
      "project_relevance_identifiers"
    )
    .select(
      "kind,value,strength,weight"
    )
    .eq(
      "project_id",
      PROJECT_ID
    )
    .eq(
      "active",
      true
    );

if (identifierError) {
  throw new Error(
    identifierError.message
  );
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
        "subject",
        "snippet",
        "sent_at",
        "direction",
        "from_address",
        "to_address",
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

/*
 * Consolidacao por thread.
 */
const threads = new Map();

for (const email of emails ?? []) {
  const threadId =
    email.provider_thread_id ??
    `email:${email.id}`;

  if (!threads.has(threadId)) {
    threads.set(
      threadId,
      []
    );
  }

  threads
    .get(threadId)
    .push(email);
}

const results = [];

for (
  const [threadId, messages]
  of threads.entries()
) {
  const text =
    normalize(
      messages
        .map(
          (message) =>
            [
              message.subject ?? "",
              message.snippet ?? "",
              message.from_address ?? "",
              message.to_address ?? "",
            ].join("\n")
        )
        .join("\n")
    );

  const matches = [];

  for (
    const identifier
    of identifiers ?? []
  ) {
    if (
      !matchesIdentifier(
        text,
        identifier
      )
    ) {
      continue;
    }

    matches.push(
      identifier
    );
  }

  const strong =
    matches.filter(
      (match) =>
        match.strength ===
        "STRONG"
    );

  const supporting =
    matches.filter(
      (match) =>
        match.strength ===
        "SUPPORTING"
    );

  const score =
    matches.reduce(
      (sum, match) =>
        sum +
        Number(match.weight ?? 0),
      0
    );

  /*
   * Fail-closed:
   *
   * STRONG:
   *   pertence ao projeto.
   *
   * Somente sinais SUPPORTING:
   *   nunca atribuem automaticamente.
   */
  let decision =
    "NOT_PROJECT_RELATED";

  if (strong.length > 0) {
    decision =
      "PROJECT_RELATED";
  } else if (
    supporting.length >= 2 &&
    score >= 5
  ) {
    decision =
      "UNCERTAIN";
  }

  results.push({
    thread:
      threadId.slice(0, 16),

    mensagens:
      messages.length,

    decision,

    score,

    strong:
      strong
        .map(
          (x) => x.value
        )
        .join(" | "),

    supporting:
      supporting
        .map(
          (x) => x.value
        )
        .join(" | "),

    assunto:
      (
        messages[0]?.subject ??
        ""
      ).slice(0, 110),
  });
}

const related =
  results
    .filter(
      (x) =>
        x.decision ===
        "PROJECT_RELATED"
    )
    .sort(
      (a, b) =>
        b.score - a.score
    );

const uncertain =
  results
    .filter(
      (x) =>
        x.decision ===
        "UNCERTAIN"
    )
    .sort(
      (a, b) =>
        b.score - a.score
    );

const rejected =
  results.filter(
    (x) =>
      x.decision ===
      "NOT_PROJECT_RELATED"
  );

console.log("");
console.log(
  "AXION - PROJECT RELEVANCE GATE"
);
console.log(
  "=============================="
);
console.log(
  "Projeto: WEG - Fabrica de Fios - Linhares"
);

console.log("");
console.log(
  "PROJECT_RELATED"
);
console.log(
  "---------------"
);

console.table(
  related
);

console.log("");
console.log(
  "UNCERTAIN"
);
console.log(
  "---------"
);

console.table(
  uncertain
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
    emails_total:
      emails?.length ?? 0,

    threads_total:
      results.length,

    project_related:
      related.length,

    uncertain:
      uncertain.length,

    not_project_related:
      rejected.length,

    contract_events_criados:
      0,
  },
]);

console.log("");
console.log(
  "Nenhum Contract Event foi criado."
);
