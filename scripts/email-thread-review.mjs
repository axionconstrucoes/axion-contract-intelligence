import { createClient } from "@supabase/supabase-js";

const PROJECT_ID =
  "00000000-0000-4000-8000-000000000001";

const RULE_VERSION =
  "email-triage-v2";

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

const {
  data: triage,
  error: triageError,
} =
  await supabase
    .from("email_triage_results")
    .select(
      [
        "email_id",
        "priority",
        "score",
        "matched_categories",
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
    .eq(
      "decision",
      "REVIEW_REQUIRED"
    );

if (triageError) {
  throw new Error(
    triageError.message
  );
}

const emailIds =
  (triage ?? [])
    .map(row => row.email_id);

if (!emailIds.length) {
  console.log(
    "Nenhum email REVIEW_REQUIRED encontrado."
  );

  process.exit(0);
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
        "provider_thread_id",
      ].join(",")
    )
    .in(
      "id",
      emailIds
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

const triageByEmail =
  new Map(
    (triage ?? []).map(
      row => [
        row.email_id,
        row,
      ]
    )
  );

const groups =
  new Map();

for (const email of emails ?? []) {
  const threadId =
    email.provider_thread_id ??
    `email:${email.id}`;

  if (!groups.has(threadId)) {
    groups.set(
      threadId,
      []
    );
  }

  groups
    .get(threadId)
    .push(email);
}

function priorityRank(priority) {
  return {
    BAIXA: 1,
    MEDIA: 2,
    ALTA: 3,
    CRITICA: 4,
  }[priority] ?? 0;
}

const summaries = [];

for (
  const [threadId, messages]
  of groups.entries()
) {
  messages.sort(
    (a, b) =>
      new Date(a.sent_at) -
      new Date(b.sent_at)
  );

  const categories =
    new Set();

  let maxScore = 0;
  let maxPriority =
    "BAIXA";

  let inbound = 0;
  let outbound = 0;

  for (const message of messages) {
    const result =
      triageByEmail.get(
        message.id
      );

    if (result) {
      maxScore =
        Math.max(
          maxScore,
          result.score ?? 0
        );

      if (
        priorityRank(
          result.priority
        ) >
        priorityRank(
          maxPriority
        )
      ) {
        maxPriority =
          result.priority;
      }

      for (
        const category
        of result.matched_categories ?? []
      ) {
        categories.add(
          category
        );
      }
    }

    if (
      message.direction ===
      "INBOUND"
    ) {
      inbound += 1;
    }

    if (
      message.direction ===
      "OUTBOUND"
    ) {
      outbound += 1;
    }
  }

  const first =
    messages[0];

  const last =
    messages[
      messages.length - 1
    ];

  summaries.push({
    thread_id:
      threadId,

    mensagens:
      messages.length,

    inbound,

    outbound,

    prioridade:
      maxPriority,

    score_max:
      maxScore,

    categorias:
      Array
        .from(categories)
        .join(","),

    inicio:
      first.sent_at,

    fim:
      last.sent_at,

    assunto:
      first.subject ??
      last.subject ??
      "",
  });
}

summaries.sort(
  (a, b) =>
    priorityRank(
      b.prioridade
    ) -
    priorityRank(
      a.prioridade
    ) ||
    b.score_max -
    a.score_max
);

console.log("");
console.log(
  "AXION - THREAD REVIEW"
);
console.log(
  "====================="
);

console.table([
  {
    emails_review_required:
      emailIds.length,

    threads:
      summaries.length,
  },
]);

console.log("");
console.log(
  "THREADS CONSOLIDADAS"
);
console.log(
  "--------------------"
);

console.table(
  summaries.map(
    (thread, index) => ({
      n:
        index + 1,

      mensagens:
        thread.mensagens,

      inbound:
        thread.inbound,

      outbound:
        thread.outbound,

      prioridade:
        thread.prioridade,

      score:
        thread.score_max,

      categorias:
        thread.categorias,

      thread:
        thread.thread_id
          .slice(0, 16),

      assunto:
        thread.assunto
          .slice(0, 105),
    })
  )
);

console.log("");
console.log(
  "DETALHE DAS THREADS"
);
console.log(
  "-------------------"
);

let index = 0;

for (
  const [threadId, messages]
  of groups.entries()
) {
  index += 1;

  console.log("");
  console.log(
    `THREAD ${index}`
  );

  console.log(
    `ID: ${threadId}`
  );

  for (
    const message
    of messages
  ) {
    console.log("");
    console.log(
      `[${message.sent_at}] ${message.direction ?? "?"}`
    );

    console.log(
      `ASSUNTO: ${message.subject ?? ""}`
    );

    console.log(
      `RESUMO: ${(message.snippet ?? "")
        .replace(/\s+/g, " ")
        .slice(0, 500)}`
    );
  }

  console.log("");
  console.log(
    "----------------------------------------"
  );
}

console.log("");
console.log(
  "Nenhum Contract Event foi criado."
);
