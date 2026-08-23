import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

const PROJECT_ID =
  process.argv[2] ??
  "00000000-0000-4000-8000-000000000001";

if (!process.argv.includes("--apply")) {
  console.error("ERRO: use --apply para autorizar gravação real.");
  process.exit(1);
}

function required(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractAddresses(value) {
  if (!value) return [];

  return Array.from(
    new Set(
      (value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [])
        .map((value) => value.toLowerCase())
    )
  );
}

function header(headers, name) {
  return (
    headers.find(
      (item) =>
        item.name?.toLowerCase() === name.toLowerCase()
    )?.value ?? null
  );
}

function domainOf(address) {
  return address.split("@")[1]?.toLowerCase() ?? null;
}

function evaluate(headers, mailbox, allowedDomains) {
  const from = extractAddresses(header(headers, "From"));

  const recipients = Array.from(
    new Set([
      ...extractAddresses(header(headers, "To")),
      ...extractAddresses(header(headers, "Cc")),
      ...extractAddresses(header(headers, "Bcc")),
    ])
  );

  const addresses = Array.from(
    new Set([...from, ...recipients])
  );

  const mailboxIsSender = from.includes(mailbox);

  const rejectedDomains = Array.from(
    new Set(
      addresses
        .map(domainOf)
        .filter(Boolean)
        .filter((domain) => !allowedDomains.has(domain))
    )
  );

  if (rejectedDomains.length > 0) {
    return {
      eligible: false,
      direction: mailboxIsSender ? "OUTBOUND" : "INBOUND",
      from,
      recipients,
    };
  }

  return {
    eligible: true,
    direction: mailboxIsSender ? "OUTBOUND" : "INBOUND",
    from,
    recipients,
  };
}

function gmailDate(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("/");
}

async function gmailGetWithRetry(gmail, id) {
  let attempt = 0;

  while (true) {
    try {
      return await gmail.users.messages.get({
        userId: "me",
        id,
        format: "metadata",
        metadataHeaders: [
          "From",
          "To",
          "Cc",
          "Bcc",
          "Date",
          "Message-ID",
          "Subject",
        ],
      });
    } catch (error) {
      attempt += 1;

      const status =
        error?.status ??
        error?.code ??
        error?.response?.status;

      const rateLimited =
        status === 403 ||
        status === 429;

      if (!rateLimited || attempt > 7) {
        throw error;
      }

      const waitMs = Math.min(
        60000,
        2000 * Math.pow(2, attempt - 1)
      );

      console.log(
        `Quota Gmail atingida. Aguardando ${waitMs / 1000}s...`
      );

      await sleep(waitMs);
    }
  }
}

const supabase = createClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("SUPABASE_SECRET_KEY"),
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

const { data: config, error: configError } = await supabase
  .from("project_email_ingestion_configs")
  .select("*")
  .eq("project_id", PROJECT_ID)
  .single();

if (configError || !config) {
  throw new Error(
    configError?.message ??
    "Email ingestion config not found."
  );
}

const { data: mailboxRows, error: mailboxError } = await supabase
  .from("project_email_ingestion_mailboxes")
  .select("mailbox_address")
  .eq("config_id", config.id)
  .eq("enabled", true);

if (mailboxError) throw new Error(mailboxError.message);

const { data: domainRows, error: domainError } = await supabase
  .from("project_email_ingestion_domains")
  .select("domain")
  .eq("config_id", config.id)
  .eq("enabled", true);

if (domainError) throw new Error(domainError.message);

const mailbox =
  required("GOOGLE_GMAIL_INBOUND_MAILBOX")
    .toLowerCase();

if (
  !mailboxRows.some(
    (row) =>
      row.mailbox_address.toLowerCase() === mailbox
  )
) {
  throw new Error(
    `Mailbox ${mailbox} não autorizada para o projeto.`
  );
}

const allowedDomains = new Set(
  domainRows.map(
    (row) => row.domain.toLowerCase()
  )
);

let startAt;

if (config.window_mode === "CUSTOM") {
  startAt = new Date(config.custom_start_at);
} else if (config.window_mode === "FROM_NOW") {
  startAt = new Date(
    config.monitoring_started_at ??
    config.created_at
  );
} else if (config.window_mode === "FROM_PROJECT_START") {
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("project_start_date")
    .eq("id", PROJECT_ID)
    .single();

  if (projectError) throw new Error(projectError.message);

  if (!project?.project_start_date) {
    throw new Error(
      "FROM_PROJECT_START requer projects.project_start_date configurado (ver Start-up ACC)."
    );
  }

  startAt = new Date(project.project_start_date);
} else {
  throw new Error(`window_mode desconhecido: ${config.window_mode}`);
}

const now = new Date();
let effectiveEndAt = now;

if (config.custom_end_at) {
  const configuredEnd =
    new Date(config.custom_end_at);

  if (configuredEnd < effectiveEndAt) {
    effectiveEndAt = configuredEnd;
  }
}

const queryStart = new Date(startAt);
queryStart.setUTCDate(
  queryStart.getUTCDate() - 1
);

const senderQuery =
  Array.from(allowedDomains)
    .map((domain) => `from:${domain}`)
    .join(" ");

const queryParts = [
  `after:${gmailDate(queryStart)}`,
  `{${senderQuery}}`,
];

const auth = new google.auth.OAuth2(
  required("GOOGLE_GMAIL_INBOUND_CLIENT_ID"),
  required("GOOGLE_GMAIL_INBOUND_CLIENT_SECRET")
);

auth.setCredentials({
  refresh_token:
    required(
      "GOOGLE_GMAIL_INBOUND_REFRESH_TOKEN"
    ),
});

const gmail = google.gmail({
  version: "v1",
  auth,
});

const profile =
  await gmail.users.getProfile({
    userId: "me",
  });

const authenticatedMailbox =
  profile.data.emailAddress?.toLowerCase();

if (authenticatedMailbox !== mailbox) {
  throw new Error(
    `Mailbox autenticada ${authenticatedMailbox}; esperada ${mailbox}.`
  );
}

console.log("");
console.log("AXION Gmail Inbound - BACKFILL REAL");
console.log("===================================");

console.log("Projeto:", PROJECT_ID);
console.log("Mailbox:", mailbox);
console.log(
  "Domínios:",
  Array.from(allowedDomains).join(", ")
);
console.log(
  "Monitoramento contínuo:",
  config.enabled
);
console.log("");

let pageToken;
const messageIds = [];

do {
  const response =
    await gmail.users.messages.list({
      userId: "me",
      q: queryParts.join(" "),
      maxResults: 500,
      pageToken,
      includeSpamTrash: false,
    });

  for (
    const message
    of response.data.messages ?? []
  ) {
    if (message.id) {
      messageIds.push(message.id);
    }
  }

  pageToken =
    response.data.nextPageToken ??
    undefined;

} while (pageToken);

console.log(
  "Mensagens candidatas:",
  messageIds.length
);

const existingIds = new Set();

let offset = 0;

while (true) {
  const { data, error } = await supabase
    .from("emails")
    .select("provider_message_id")
    .eq("project_id", PROJECT_ID)
    .eq("provider", "GMAIL")
    .eq("mailbox_address", mailbox)
    .range(offset, offset + 999);

  if (error) {
    throw new Error(error.message);
  }

  for (const row of data ?? []) {
    if (row.provider_message_id) {
      existingIds.add(
        row.provider_message_id
      );
    }
  }

  if (!data || data.length < 1000) {
    break;
  }

  offset += 1000;
}

console.log(
  "Mensagens Gmail já existentes:",
  existingIds.size
);

let eligible = 0;
let rejected = 0;
let duplicates = 0;
let inserted = 0;
let inbound = 0;
let outbound = 0;

const rowsToInsert = [];

for (
  let index = 0;
  index < messageIds.length;
  index += 20
) {
  const batch =
    messageIds.slice(
      index,
      index + 20
    );

  const responses =
    await Promise.all(
      batch.map(
        (id) =>
          gmailGetWithRetry(
            gmail,
            id
          )
      )
    );

  for (const response of responses) {
    const message = response.data;

    if (
      !message.id ||
      !message.internalDate
    ) {
      continue;
    }

    const occurredAt =
      new Date(
        Number(message.internalDate)
      );

    if (
      occurredAt < startAt ||
      occurredAt > effectiveEndAt
    ) {
      continue;
    }

    const headers =
      message.payload?.headers ?? [];

    const policy =
      evaluate(
        headers,
        mailbox,
        allowedDomains
      );

    if (!policy.eligible) {
      rejected += 1;
      continue;
    }

    eligible += 1;

    if (
      existingIds.has(message.id)
    ) {
      duplicates += 1;
      continue;
    }

    if (
      policy.direction === "INBOUND"
    ) {
      inbound += 1;
    } else {
      outbound += 1;
    }

    rowsToInsert.push({
      project_id: PROJECT_ID,

      from_address:
        policy.from[0] ??
        "",

      to_address:
        policy.recipients.join(", "),

      subject:
        header(headers, "Subject") ??
        "(sem assunto)",

      sent_at:
        occurredAt.toISOString(),

      snippet:
        message.snippet ??
        "",

      provider: "GMAIL",

      provider_message_id:
        message.id,

      provider_thread_id:
        message.threadId ??
        null,

      message_id_header:
        header(
          headers,
          "Message-ID"
        ),

      mailbox_address:
        mailbox,

      direction:
        policy.direction,
    });
  }

  await sleep(800);

  if (
    index % 500 === 0 ||
    index + batch.length >= messageIds.length
  ) {
    process.stdout.write(
      `\rAnalisadas: ${
        Math.min(
          index + batch.length,
          messageIds.length
        )
      }/${messageIds.length}`
    );
  }
}

console.log("");
console.log("");

for (
  let index = 0;
  index < rowsToInsert.length;
  index += 100
) {
  const batch =
    rowsToInsert.slice(
      index,
      index + 100
    );

  const { error } =
    await supabase
      .from("emails")
      .insert(batch);

  if (error) {
    /*
     * Se algum outro processo inseriu
     * uma mensagem entre a leitura e
     * este INSERT, cai para inserção
     * individual protegida pelo índice
     * único do Gmail Message ID.
     */
    for (const row of batch) {
      const result =
        await supabase
          .from("emails")
          .insert(row);

      if (!result.error) {
        inserted += 1;
      } else if (
        result.error.code === "23505"
      ) {
        duplicates += 1;
      } else {
        throw new Error(
          result.error.message
        );
      }
    }
  } else {
    inserted += batch.length;
  }
}

const completedAt =
  new Date().toISOString();

const { error: configUpdateError } =
  await supabase
    .from(
      "project_email_ingestion_configs"
    )
    .update({
      last_sync_at: completedAt,
      updated_at: completedAt,
    })
    .eq("id", config.id);

if (configUpdateError) {
  throw new Error(
    configUpdateError.message
  );
}

const {
  error: integrationError
} = await supabase
  .from("project_integrations")
  .update({
    status: "PENDENTE",
    last_sync_at: completedAt,
    detail:
      `Backfill Gmail DEV concluído. ` +
      `${inserted} mensagens gravadas. ` +
      `Monitoramento contínuo ainda não ativado.`,
    updated_at: completedAt,
  })
  .eq("project_id", PROJECT_ID)
  .eq("source_type", "EMAIL");

if (integrationError) {
  throw new Error(
    integrationError.message
  );
}

const {
  error: auditError
} = await supabase
  .from("audit_log_entries")
  .insert({
    project_id: PROJECT_ID,

    actor_type: "SYSTEM",
    actor_user_id: null,
    actor_label: null,

    action:
      "Backfill Gmail executado",

    entity_type:
      "EmailIngestionRun",

    entity_id:
      `GMAIL:${completedAt}`,

    detail:
      `Mailbox ${mailbox}. ` +
      `${inserted} mensagens inseridas; ` +
      `${duplicates} duplicadas; ` +
      `${rejected} rejeitadas pelo perímetro. ` +
      `Monitoramento contínuo permanece desativado.`,
  });

if (auditError) {
  throw new Error(
    auditError.message
  );
}

console.log("RESULTADO");
console.log("---------");

console.table([
  {
    candidatas:
      messageIds.length,

    elegiveis:
      eligible,

    inseridas:
      inserted,

    duplicadas:
      duplicates,

    inbound_novas:
      inbound,

    outbound_novas:
      outbound,

    rejeitadas:
      rejected,

    monitoramento_continuo:
      config.enabled,
  },
]);

console.log("");
console.log(
  "BACKFILL concluído com sucesso."
);
