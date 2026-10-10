import { google } from "googleapis";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { extractGmailBody } from "./lib/gmail-message-body.mjs";

const args = process.argv.slice(2);

const PROJECT_ID =
  args.find((arg) => !arg.startsWith("--")) ??
  "00000000-0000-4000-8000-000000000001";

const APPLY = args.includes("--apply");

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

function normalizeMailbox(value) {
  return String(value ?? "").trim().toLowerCase();
}

function mailboxPrefix(mailbox) {
  const local =
    normalizeMailbox(mailbox)
      .split("@")[0]
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .toUpperCase();

  return `GOOGLE_GMAIL_${local}`;
}

function resolveMailboxCredentials(mailbox) {
  const normalized = normalizeMailbox(mailbox);

  /*
   * Compatibilidade com a credencial Gmail já existente.
   * Ela só pode ser usada se a mailbox declarada coincidir.
   */
  const legacyMailbox =
    normalizeMailbox(
      process.env.GOOGLE_GMAIL_INBOUND_MAILBOX
    );

  if (
    legacyMailbox &&
    legacyMailbox === normalized &&
    process.env.GOOGLE_GMAIL_INBOUND_CLIENT_ID &&
    process.env.GOOGLE_GMAIL_INBOUND_CLIENT_SECRET &&
    process.env.GOOGLE_GMAIL_INBOUND_REFRESH_TOKEN
  ) {
    return {
      source: "GOOGLE_GMAIL_INBOUND_*",
      mailbox: normalized,
      clientId:
        process.env.GOOGLE_GMAIL_INBOUND_CLIENT_ID.trim(),
      clientSecret:
        process.env.GOOGLE_GMAIL_INBOUND_CLIENT_SECRET.trim(),
      refreshToken:
        process.env.GOOGLE_GMAIL_INBOUND_REFRESH_TOKEN.trim(),
    };
  }

  /*
   * Credenciais específicas por mailbox:
   *
   * reynaldo@axion.com.br
   *   GOOGLE_GMAIL_REYNALDO_CLIENT_ID
   *   GOOGLE_GMAIL_REYNALDO_CLIENT_SECRET
   *   GOOGLE_GMAIL_REYNALDO_REFRESH_TOKEN
   *
   * crm@axion.com.br
   *   GOOGLE_GMAIL_CRM_CLIENT_ID
   *   ...
   */
  const prefix = mailboxPrefix(normalized);

  const clientId =
    process.env[`${prefix}_CLIENT_ID`]?.trim();

  const clientSecret =
    process.env[`${prefix}_CLIENT_SECRET`]?.trim();

  const refreshToken =
    process.env[`${prefix}_REFRESH_TOKEN`]?.trim();

  if (
    clientId &&
    clientSecret &&
    refreshToken
  ) {
    return {
      source: `${prefix}_*`,
      mailbox: normalized,
      clientId,
      clientSecret,
      refreshToken,
    };
  }

  return null;
}

async function createGmailForMailbox(mailbox) {
  const credentials =
    resolveMailboxCredentials(mailbox);

  if (!credentials) {
    return {
      ok: false,
      reason:
        `Credenciais OAuth não configuradas para ${mailbox}.`,
      gmail: null,
      authenticatedMailbox: null,
      credentialSource: null,
    };
  }

  const auth = new google.auth.OAuth2(
    credentials.clientId,
    credentials.clientSecret
  );

  auth.setCredentials({
    refresh_token: credentials.refreshToken,
  });

  const gmail = google.gmail({
    version: "v1",
    auth,
  });

  try {
    const profile =
      await gmail.users.getProfile({
        userId: "me",
      });

    const authenticatedMailbox =
      normalizeMailbox(
        profile.data.emailAddress
      );

    if (
      authenticatedMailbox !==
      normalizeMailbox(mailbox)
    ) {
      return {
        ok: false,
        reason:
          `Credencial ${credentials.source} autentica ` +
          `${authenticatedMailbox || "(desconhecida)"}, ` +
          `mas os e-mails pertencem a ${mailbox}.`,
        gmail: null,
        authenticatedMailbox,
        credentialSource: credentials.source,
      };
    }

    return {
      ok: true,
      reason: null,
      gmail,
      authenticatedMailbox,
      credentialSource: credentials.source,
    };
  } catch (error) {
    return {
      ok: false,
      reason:
        error?.response?.data?.error?.message ??
        error?.message ??
        "Falha ao validar credencial Gmail.",
      gmail: null,
      authenticatedMailbox: null,
      credentialSource: credentials.source,
    };
  }
}

async function getFullMessage(gmail, id) {
  for (
    let attempt = 0;
    attempt < 7;
    attempt += 1
  ) {
    try {
      return await gmail.users.messages.get({
        userId: "me",
        id,
        format: "full",
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
        Math.min(
          60000,
          2000 * (2 ** attempt)
        );

      await sleep(wait);
    }
  }
}


function headerValue(headers, name) {
  return (
    (headers ?? []).find(
      (h) => String(h?.name ?? "").toLowerCase() === name.toLowerCase()
    )?.value ?? null
  );
}

function normalizeContentId(value) {
  if (!value) return null;

  return String(value)
    .trim()
    .replace(/^<|>$/g, "")
    .trim();
}

function collectInlineImageParts(part, out = []) {
  if (!part) return out;

  const contentId =
    normalizeContentId(
      headerValue(part.headers, "Content-ID")
    );

  const mimeType =
    String(part.mimeType ?? "").toLowerCase();

  if (
    contentId &&
    mimeType.startsWith("image/") &&
    (part.body?.attachmentId || part.body?.data)
  ) {
    out.push({
      contentId,
      gmailAttachmentId:
        part.body?.attachmentId ?? null,
      inlineData:
        part.body?.data ?? null,
      fileName:
        part.filename ||
        `inline-${contentId.replace(/[^a-zA-Z0-9._-]+/g, "_")}`,
      mimeType:
        part.mimeType ?? "application/octet-stream",
    });
  }

  for (const child of part.parts ?? []) {
    collectInlineImageParts(child, out);
  }

  return out;
}

function decodeBase64UrlToBuffer(value) {
  return Buffer.from(
    String(value ?? "")
      .replace(/-/g, "+")
      .replace(/_/g, "/"),
    "base64"
  );
}

function safeFileName(value) {
  return String(value ?? "inline-image")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .slice(0, 180);
}

async function persistInlineImages({
  supabase,
  gmail,
  projectId,
  emailRow,
  message,
}) {
  const parts =
    collectInlineImageParts(message.payload);

  if (!parts.length) return 0;

  let stored = 0;

  for (const part of parts) {
    try {
      let bytes;

      if (part.inlineData) {
        bytes =
          decodeBase64UrlToBuffer(
            part.inlineData
          );
      } else {
        const { data } =
          await gmail.users.messages.attachments.get({
            userId: "me",
            messageId:
              emailRow.provider_message_id,
            id: part.gmailAttachmentId,
          });

        bytes =
          decodeBase64UrlToBuffer(
            data.data ?? ""
          );
      }

      if (!bytes.length) continue;

      const sha =
        crypto
          .createHash("sha256")
          .update(bytes)
          .digest("hex");

      const fileName =
        safeFileName(part.fileName);

      const storageBucket =
        "project-documents";

      const storagePath =
        `${projectId}/email-inline/${emailRow.id}/${sha}-${fileName}`;

      const upload =
        await supabase.storage
          .from(storageBucket)
          .upload(
            storagePath,
            bytes,
            {
              contentType:
                part.mimeType,
              upsert: true,
            }
          );

      if (
        upload.error &&
        !String(upload.error.message ?? "")
          .toLowerCase()
          .includes("already exists")
      ) {
        throw upload.error;
      }

      const { error } =
        await supabase
          .from("email_inline_images")
          .upsert(
            {
              project_id:
                projectId,
              email_id:
                emailRow.id,
              content_id:
                part.contentId,
              gmail_attachment_id:
                part.gmailAttachmentId,
              original_file_name:
                fileName,
              mime_type:
                part.mimeType,
              file_size_bytes:
                bytes.length,
              sha256_hash:
                sha,
              storage_bucket:
                storageBucket,
              storage_path:
                storagePath,
            },
            {
              onConflict:
                "email_id,content_id",
            }
          );

      if (error) throw error;

      stored += 1;
    } catch (error) {
      console.error(
        `Falha imagem inline ${part.contentId}:`,
        error?.message ?? error
      );
    }
  }

  return stored;
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

/*
 * Carrega todos os e-mails Gmail do projeto que ainda não têm corpo
 * integral persistido.
 */
const rows = [];

let offset = 0;

while (true) {
  const { data, error } = await supabase
    .from("emails")
    .select(
      [
        "id",
        "provider_message_id",
        "mailbox_address",
        "subject",
        "body_text",
        "body_html",
        "body_fetched_at",
      ].join(",")
    )
    .eq("project_id", PROJECT_ID)
    .eq("provider", "GMAIL")
    .not("provider_message_id", "is", null)
    .range(offset, offset + 499);

  if (error) {
    throw new Error(error.message);
  }

  rows.push(...(data ?? []));

  if (!data || data.length < 500) {
    break;
  }

  offset += 500;
}

const pending = rows.filter(
  (row) =>
    !row.body_text &&
    !row.body_html
);

/*
 * Agrupa pelas caixas que realmente originaram os provider_message_id.
 */
const groups = new Map();

for (const row of pending) {
  const mailbox =
    normalizeMailbox(row.mailbox_address);

  const key =
    mailbox || "(mailbox não identificada)";

  const list = groups.get(key) ?? [];
  list.push(row);
  groups.set(key, list);
}

console.log("");
console.log(
  "BACKFILL MULTI-MAILBOX — CORPO COMPLETO"
);
console.log(
  "======================================="
);
console.log("Projeto:", PROJECT_ID);
console.log("E-mails Gmail:", rows.length);
console.log("Pendentes:", pending.length);
console.log("Mailboxes:", groups.size);
console.log("");

const readiness = [];

for (const [mailbox, messages] of groups) {
  if (mailbox === "(mailbox não identificada)") {
    readiness.push({
      mailbox,
      mensagens: messages.length,
      credencial: "NÃO",
      autenticada: "—",
      status: "SEM MAILBOX",
    });

    continue;
  }

  const check =
    await createGmailForMailbox(mailbox);

  readiness.push({
    mailbox,
    mensagens: messages.length,
    credencial:
      check.credentialSource ?? "NÃO CONFIGURADA",
    autenticada:
      check.authenticatedMailbox ?? "—",
    status:
      check.ok ? "PRONTA" : check.reason,
  });
}

console.table(readiness);

if (!APPLY) {
  console.log("");
  console.log(
    "MODO DIAGNÓSTICO — nenhuma alteração foi feita."
  );
  console.log(
    "Use --apply somente depois que as mailboxes necessárias aparecerem como PRONTA."
  );
  process.exit(0);
}

console.log("");
console.log("INICIANDO BACKFILL...");
console.log("");

let updated = 0;
let failed = 0;
let skipped = 0;

for (const [mailbox, messages] of groups) {
  if (mailbox === "(mailbox não identificada)") {
    console.log(
      `PULANDO ${messages.length} mensagem(ns): mailbox não identificada.`
    );

    skipped += messages.length;
    continue;
  }

  const check =
    await createGmailForMailbox(mailbox);

  if (!check.ok || !check.gmail) {
    console.log("");
    console.log(`MAILBOX: ${mailbox}`);
    console.log(`STATUS: PULADA`);
    console.log(`MOTIVO: ${check.reason}`);
    console.log("");

    skipped += messages.length;
    continue;
  }

  console.log("");
  console.log(`MAILBOX: ${mailbox}`);
  console.log(
    `CREDENCIAL: ${check.credentialSource}`
  );
  console.log(
    `MENSAGENS: ${messages.length}`
  );

  let mailboxUpdated = 0;
  let mailboxFailed = 0;

  for (
    let index = 0;
    index < messages.length;
    index += 1
  ) {
    const row = messages[index];

    try {
      const response =
        await getFullMessage(
          check.gmail,
          row.provider_message_id
        );

      const {
        bodyText,
        bodyHtml,
      } =
        extractGmailBody(response.data);

      await persistInlineImages({
        supabase,
        gmail: check.gmail,
        projectId: PROJECT_ID,
        emailRow: row,
        message: response.data,
      });

      const { error } = await supabase
        .from("emails")
        .update({
          body_text:
            bodyText || null,

          body_html:
            bodyHtml || null,

          body_fetched_at:
            new Date().toISOString(),
        })
        .eq("id", row.id);

      if (error) {
        throw error;
      }

      updated += 1;
      mailboxUpdated += 1;
    } catch (error) {
      failed += 1;
      mailboxFailed += 1;

      const detail =
        error?.response?.data?.error?.message ??
        error?.message ??
        String(error);

      console.error("");
      console.error(
        `Falha: ${row.subject}`
      );
      console.error(
        `Message ID: ${row.provider_message_id}`
      );
      console.error(
        `Motivo: ${detail}`
      );
    }

    process.stdout.write(
      `\r${mailbox}: ` +
      `${index + 1}/${messages.length} | ` +
      `OK ${mailboxUpdated} | ` +
      `Falhas ${mailboxFailed}`
    );

    await sleep(120);
  }

  console.log("");
}

console.log("");
console.log("=======================================");
console.log("BACKFILL CONCLUÍDO");
console.log("=======================================");
console.log("Atualizadas:", updated);
console.log("Puladas:", skipped);
console.log("Falhas:", failed);
console.log("=======================================");
