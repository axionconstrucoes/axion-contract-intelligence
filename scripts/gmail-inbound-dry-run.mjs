import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

const PROJECT_ID =
  process.argv[2] ??
  "00000000-0000-4000-8000-000000000001";

function required(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
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
  const to = extractAddresses(header(headers, "To"));
  const cc = extractAddresses(header(headers, "Cc"));
  const bcc = extractAddresses(header(headers, "Bcc"));

  const recipients = Array.from(
    new Set([...to, ...cc, ...bcc])
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
      reason: "DOMAIN_NOT_AUTHORIZED",
      direction: mailboxIsSender ? "OUTBOUND" : "INBOUND",
    };
  }

  return {
    eligible: true,
    reason: null,
    direction: mailboxIsSender ? "OUTBOUND" : "INBOUND",
  };
}

function gmailDate(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("/");
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
    configError?.message ?? "Email ingestion config not found."
  );
}

const { data: mailboxRows, error: mailboxError } = await supabase
  .from("project_email_ingestion_mailboxes")
  .select("mailbox_address")
  .eq("config_id", config.id)
  .eq("enabled", true);

if (mailboxError) {
  throw new Error(mailboxError.message);
}

const { data: domainRows, error: domainError } = await supabase
  .from("project_email_ingestion_domains")
  .select("domain")
  .eq("config_id", config.id)
  .eq("enabled", true);

if (domainError) {
  throw new Error(domainError.message);
}

const mailbox =
  required("GOOGLE_GMAIL_INBOUND_MAILBOX").toLowerCase();

if (
  !mailboxRows.some(
    (row) => row.mailbox_address.toLowerCase() === mailbox
  )
) {
  throw new Error(
    `Mailbox ${mailbox} is not authorized for this project.`
  );
}

const allowedDomains = new Set(
  domainRows.map((row) => row.domain.toLowerCase())
);

let startAt;

if (config.window_mode === "CUSTOM") {
  startAt = new Date(config.custom_start_at);
} else if (config.window_mode === "FROM_NOW") {
  startAt = new Date(
    config.monitoring_started_at ?? config.created_at
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
  const configuredEnd = new Date(config.custom_end_at);

  if (configuredEnd < effectiveEndAt) {
    effectiveEndAt = configuredEnd;
  }
}

const queryStart = new Date(startAt);
queryStart.setUTCDate(queryStart.getUTCDate() - 1);

const senderQuery = Array.from(allowedDomains)
  .map((domain) => `from:${domain}`)
  .join(" ");

const queryParts = [
  `after:${gmailDate(queryStart)}`,
  `{${senderQuery}}`,
];

if (effectiveEndAt < now) {
  const dayAfterEnd = new Date(effectiveEndAt);
  dayAfterEnd.setUTCDate(dayAfterEnd.getUTCDate() + 1);

  queryParts.push(`before:${gmailDate(dayAfterEnd)}`);
}

const auth = new google.auth.OAuth2(
  required("GOOGLE_GMAIL_INBOUND_CLIENT_ID"),
  required("GOOGLE_GMAIL_INBOUND_CLIENT_SECRET")
);

auth.setCredentials({
  refresh_token: required(
    "GOOGLE_GMAIL_INBOUND_REFRESH_TOKEN"
  ),
});

const gmail = google.gmail({
  version: "v1",
  auth,
});

const profile = await gmail.users.getProfile({
  userId: "me",
});

const authenticatedMailbox =
  profile.data.emailAddress?.toLowerCase();

if (authenticatedMailbox !== mailbox) {
  throw new Error(
    `Authenticated mailbox is ${authenticatedMailbox}; expected ${mailbox}.`
  );
}

console.log("");
console.log("AXION Gmail Inbound - FULL DRY RUN");
console.log("==================================");
console.log("Projeto:", PROJECT_ID);
console.log("Mailbox:", mailbox);
console.log("Domínios:", Array.from(allowedDomains).join(", "));
console.log("Início:", startAt.toISOString());
console.log("Fim efetivo:", effectiveEndAt.toISOString());
console.log("Ingestão ativa:", config.enabled);
console.log("");

let pageToken;
const messageIds = [];

do {
  const response = await gmail.users.messages.list({
    userId: "me",
    q: queryParts.join(" "),
    maxResults: 500,
    pageToken,
    includeSpamTrash: false,
  });

  for (const message of response.data.messages ?? []) {
    if (message.id) {
      messageIds.push(message.id);
    }
  }

  pageToken = response.data.nextPageToken ?? undefined;

  process.stdout.write(
    `\rMensagens localizadas: ${messageIds.length}`
  );
} while (pageToken);

console.log("");
console.log("Analisando metadados...");

let eligible = 0;
let inbound = 0;
let outbound = 0;
let outsidePeriod = 0;
let rejectedDomain = 0;
let firstEligibleAt = null;
let lastEligibleAt = null;

for (let index = 0; index < messageIds.length; index += 20) {
  const batch = messageIds.slice(index, index + 20);

  const messages = await Promise.all(
    batch.map((id) =>
      gmail.users.messages.get({
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
      })
    )
  );

  for (const response of messages) {
    const message = response.data;

    if (!message.internalDate) {
      continue;
    }

    const occurredAt = new Date(
      Number(message.internalDate)
    );

    if (
      occurredAt < startAt ||
      occurredAt > effectiveEndAt
    ) {
      outsidePeriod += 1;
      continue;
    }

    const policy = evaluate(
      message.payload?.headers ?? [],
      mailbox,
      allowedDomains
    );

    if (!policy.eligible) {
      rejectedDomain += 1;
      continue;
    }

    eligible += 1;

    if (policy.direction === "INBOUND") {
      inbound += 1;
    } else {
      outbound += 1;
    }

    if (!firstEligibleAt || occurredAt < firstEligibleAt) {
      firstEligibleAt = occurredAt;
    }

    if (!lastEligibleAt || occurredAt > lastEligibleAt) {
      lastEligibleAt = occurredAt;
    }
  }

  // Mantém o consumo abaixo da quota Gmail por usuário.
  await new Promise((resolve) => setTimeout(resolve, 800));

  if (
    index % 500 === 0 ||
    index + batch.length >= messageIds.length
  ) {
    process.stdout.write(
      `\rAnalisadas: ${Math.min(
        index + batch.length,
        messageIds.length
      )}/${messageIds.length}`
    );
  }
}

console.log("");
console.log("");
console.log("RESULTADO");
console.log("---------");

console.table([
  {
    mensagens_examinadas: messageIds.length,
    elegiveis: eligible,
    inbound,
    outbound,
    rejeitadas_dominio: rejectedDomain,
    fora_periodo_exato: outsidePeriod,
    varredura_completa: true,
  },
]);

console.log(
  "Primeira elegível:",
  firstEligibleAt?.toISOString() ?? "-"
);

console.log(
  "Última elegível:",
  lastEligibleAt?.toISOString() ?? "-"
);

console.log("");
console.log(
  "FULL DRY RUN concluído: nenhuma mensagem foi gravada no Supabase."
);
