import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);

const PROJECT_ID =
  args.find((arg) => !arg.startsWith("--")) ??
  "00000000-0000-4000-8000-000000000001";

if (!args.includes("--apply")) {
  console.error("ERRO: use --apply para autorizar gravação.");
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
        .map((address) => address.toLowerCase())
    )
  );
}

function getHeader(headers, name) {
  return (
    headers.find(
      (header) =>
        header.name?.toLowerCase() === name.toLowerCase()
    )?.value ?? null
  );
}

function domainOf(address) {
  return address.split("@")[1]?.toLowerCase() ?? null;
}

function evaluate(headers, mailbox, allowedDomains) {
  const from = extractAddresses(getHeader(headers, "From"));

  const recipients = Array.from(
    new Set([
      ...extractAddresses(getHeader(headers, "To")),
      ...extractAddresses(getHeader(headers, "Cc")),
      ...extractAddresses(getHeader(headers, "Bcc")),
    ])
  );

  const addresses = Array.from(
    new Set([...from, ...recipients])
  );

  const rejectedDomains = Array.from(
    new Set(
      addresses
        .map(domainOf)
        .filter(Boolean)
        .filter((domain) => !allowedDomains.has(domain))
    )
  );

  const outbound = from.includes(mailbox);

  return {
    eligible: rejectedDomains.length === 0,
    direction: outbound ? "OUTBOUND" : "INBOUND",
    from,
    recipients,
  };
}

async function getMessage(gmail, id) {
  for (let attempt = 0; attempt < 7; attempt += 1) {
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
      const status =
        error?.status ??
        error?.code ??
        error?.response?.status;

      if (
        ![403, 429, 500, 502, 503, 504].includes(status) ||
        attempt === 6
      ) {
        throw error;
      }

      const wait =
        Math.min(60000, 2000 * (2 ** attempt));

      console.log(
        `Gmail API temporariamente indisponível/quota. Retry em ${wait / 1000}s...`
      );

      await sleep(wait);
    }
  }
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

const { data: config, error: configError } = await supabase
  .from("project_email_ingestion_configs")
  .select("*")
  .eq("project_id", PROJECT_ID)
  .single();

if (configError || !config) {
  throw new Error(
    configError?.message ??
    "Configuração de ingestão não encontrada."
  );
}

if (!config.enabled) {
  console.log("");
  console.log("Monitoramento Gmail desativado para este projeto.");
  console.log("Nenhuma sincronização foi executada.");
  process.exit(0);
}

if (!config.last_sync_at) {
  throw new Error(
    "last_sync_at inexistente. O backfill precisa ser executado primeiro."
  );
}

const { data: mailboxes, error: mailboxError } =
  await supabase
    .from("project_email_ingestion_mailboxes")
    .select("mailbox_address")
    .eq("config_id", config.id)
    .eq("enabled", true);

if (mailboxError) {
  throw new Error(mailboxError.message);
}

const { data: domains, error: domainError } =
  await supabase
    .from("project_email_ingestion_domains")
    .select("domain")
    .eq("config_id", config.id)
    .eq("enabled", true);

if (domainError) {
  throw new Error(domainError.message);
}

const mailbox =
  required("GOOGLE_GMAIL_INBOUND_MAILBOX")
    .toLowerCase();

if (
  !mailboxes.some(
    (row) =>
      row.mailbox_address.toLowerCase() === mailbox
  )
) {
  throw new Error(
    `Mailbox ${mailbox} não autorizada para o projeto.`
  );
}

const allowedDomains =
  new Set(
    domains.map(
      (row) => row.domain.toLowerCase()
    )
  );

/*
 * Overlap de 10 minutos.
 * Mesmo que uma mensagem apareça atrasada no Gmail,
 * a janela se sobrepõe à sincronização anterior.
 *
 * O índice único de provider_message_id protege
 * contra duplicação.
 */
const lastSyncAt =
  new Date(config.last_sync_at);

const overlapStart =
  new Date(
    lastSyncAt.getTime() -
    10 * 60 * 1000
  );

const syncStartedAt =
  new Date();

/*
 * Gmail API aceita epoch seconds em after:/before:.
 * Assim evitamos reler o dia inteiro.
 */
const afterEpoch =
  Math.floor(
    overlapStart.getTime() / 1000
  );

const beforeEpoch =
  Math.ceil(
    syncStartedAt.getTime() / 1000
  );

const senderFilter =
  Array.from(allowedDomains)
    .map((domain) => `from:${domain}`)
    .join(" ");

const query =
  `after:${afterEpoch} before:${beforeEpoch} {${senderFilter}}`;

const auth =
  new google.auth.OAuth2(
    required("GOOGLE_GMAIL_INBOUND_CLIENT_ID"),
    required("GOOGLE_GMAIL_INBOUND_CLIENT_SECRET")
  );

auth.setCredentials({
  refresh_token:
    required(
      "GOOGLE_GMAIL_INBOUND_REFRESH_TOKEN"
    ),
});

const gmail =
  google.gmail({
    version: "v1",
    auth,
  });

const profile =
  await gmail.users.getProfile({
    userId: "me",
  });

if (
  profile.data.emailAddress?.toLowerCase() !== mailbox
) {
  throw new Error(
    "A mailbox autenticada no Gmail não coincide com a mailbox configurada."
  );
}

console.log("");
console.log(
  "AXION Gmail - SINCRONIZAÇÃO INCREMENTAL"
);
console.log(
  "======================================="
);
console.log(
  "Último sync:",
  lastSyncAt.toISOString()
);
console.log(
  "Overlap desde:",
  overlapStart.toISOString()
);
console.log(
  "Mailbox:",
  mailbox
);
console.log("");

let pageToken;
const ids = [];

do {
  const response =
    await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 500,
      pageToken,
      includeSpamTrash: false,
    });

  for (
    const message
    of response.data.messages ?? []
  ) {
    if (message.id) {
      ids.push(message.id);
    }
  }

  pageToken =
    response.data.nextPageToken ??
    undefined;

} while (pageToken);

console.log(
  "Mensagens candidatas:",
  ids.length
);

const { data: existingRows, error: existingError } =
  await supabase
    .from("emails")
    .select("provider_message_id")
    .eq("project_id", PROJECT_ID)
    .eq("provider", "GMAIL")
    .eq("mailbox_address", mailbox)
    .gte(
      "sent_at",
      overlapStart.toISOString()
    );

if (existingError) {
  throw new Error(existingError.message);
}

const existingIds =
  new Set(
    (existingRows ?? [])
      .map(
        (row) =>
          row.provider_message_id
      )
      .filter(Boolean)
  );

const rows = [];

let eligible = 0;
let rejected = 0;
let duplicates = 0;
let inbound = 0;
let outbound = 0;

for (
  let index = 0;
  index < ids.length;
  index += 10
) {
  const batch =
    ids.slice(index, index + 10);

  const responses =
    await Promise.all(
      batch.map(
        (id) =>
          getMessage(gmail, id)
      )
    );

  for (const response of responses) {
    const message =
      response.data;

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
      occurredAt < overlapStart ||
      occurredAt > syncStartedAt
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

    rows.push({
      project_id:
        PROJECT_ID,

      from_address:
        policy.from[0] ?? "",

      to_address:
        policy.recipients.join(", "),

      subject:
        getHeader(
          headers,
          "Subject"
        ) ?? "(sem assunto)",

      sent_at:
        occurredAt.toISOString(),

      snippet:
        message.snippet ?? "",

      provider:
        "GMAIL",

      provider_message_id:
        message.id,

      provider_thread_id:
        message.threadId ?? null,

      message_id_header:
        getHeader(
          headers,
          "Message-ID"
        ),

      mailbox_address:
        mailbox,

      direction:
        policy.direction,
    });
  }

  /*
   * 10 requests/segundo aproximadamente.
   * Mantém margem abaixo da quota Gmail.
   */
  await sleep(1000);
}

let inserted = 0;

for (
  let index = 0;
  index < rows.length;
  index += 100
) {
  const batch =
    rows.slice(
      index,
      index + 100
    );

  const { error } =
    await supabase
      .from("emails")
      .insert(batch);

  if (!error) {
    inserted +=
      batch.length;

    continue;
  }

  /*
   * Fallback individual para corrida de concorrência.
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
}

const completedAt =
  new Date().toISOString();

const { error: updateError } =
  await supabase
    .from(
      "project_email_ingestion_configs"
    )
    .update({
      last_sync_at:
        completedAt,

      updated_at:
        completedAt,
    })
    .eq("id", config.id);

if (updateError) {
  throw new Error(
    updateError.message
  );
}

const { error: integrationError } =
  await supabase
    .from("project_integrations")
    .update({
      last_sync_at:
        completedAt,

      detail:
        `Sincronização incremental Gmail concluída: ` +
        `${inserted} novas mensagens. ` +
        `Monitoramento automático ainda ` +
        `${config.enabled ? "habilitado" : "desabilitado"}.`,

      updated_at:
        completedAt,
    })
    .eq(
      "project_id",
      PROJECT_ID
    )
    .eq(
      "source_type",
      "EMAIL"
    );

if (integrationError) {
  throw new Error(
    integrationError.message
  );
}

const { error: auditError } =
  await supabase
    .from("audit_log_entries")
    .insert({
      project_id:
        PROJECT_ID,

      actor_type:
        "SYSTEM",

      actor_user_id:
        null,

      actor_label:
        null,

      action:
        "Sincronização incremental Gmail executada",

      entity_type:
        "EmailIngestionRun",

      entity_id:
        `GMAIL-INCREMENTAL:${completedAt}`,

      detail:
        `${inserted} novas; ` +
        `${duplicates} duplicadas; ` +
        `${rejected} rejeitadas pelo perímetro.`,
    });

if (auditError) {
  throw new Error(
    auditError.message
  );
}

console.log("");
console.log("RESULTADO");
console.log("---------");

console.table([
  {
    candidatas:
      ids.length,

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

    monitoramento_automatico:
      config.enabled,
  },
]);

console.log("");
console.log(
  "SINCRONIZAÇÃO INCREMENTAL concluída."
);
