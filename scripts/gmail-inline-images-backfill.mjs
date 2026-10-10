import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const PROJECT_ID =
  process.argv.find((arg) => /^[0-9a-f-]{36}$/i.test(arg)) ??
  "00000000-0000-4000-8000-000000000001";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function decodeBase64Url(value) {
  return Buffer.from(
    String(value ?? "")
      .replace(/-/g, "+")
      .replace(/_/g, "/"),
    "base64"
  );
}

function headerValue(headers, name) {
  return (
    (headers ?? []).find(
      (header) =>
        String(header?.name ?? "").toLowerCase() === name.toLowerCase()
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

function safeFileName(value) {
  return String(value || "inline-image")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .slice(0, 180);
}

function collectInlineImages(part, output = []) {
  if (!part) return output;

  const mimeType = String(part.mimeType ?? "").toLowerCase();
  const contentId = normalizeContentId(
    headerValue(part.headers, "Content-ID")
  );

  if (
    contentId &&
    mimeType.startsWith("image/") &&
    (part.body?.attachmentId || part.body?.data)
  ) {
    output.push({
      contentId,
      mimeType: part.mimeType ?? "application/octet-stream",
      fileName:
        part.filename ||
        `inline-${contentId.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
      attachmentId: part.body?.attachmentId ?? null,
      inlineData: part.body?.data ?? null,
    });
  }

  for (const child of part.parts ?? []) {
    collectInlineImages(child, output);
  }

  return output;
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

const auth = new google.auth.OAuth2(
  required("GOOGLE_GMAIL_REYNALDO_CLIENT_ID"),
  required("GOOGLE_GMAIL_REYNALDO_CLIENT_SECRET")
);

auth.setCredentials({
  refresh_token:
    required("GOOGLE_GMAIL_REYNALDO_REFRESH_TOKEN"),
});

const gmail = google.gmail({
  version: "v1",
  auth,
});

const profile =
  await gmail.users.getProfile({
    userId: "me",
  });

if (
  profile.data.emailAddress?.toLowerCase() !==
  "reynaldo@axion.com.br"
) {
  throw new Error(
    `Mailbox incorreta: ${profile.data.emailAddress}`
  );
}

const { data: emails, error: emailError } =
  await supabase
    .from("emails")
    .select(
      "id,provider_message_id,mailbox_address,subject,sent_at,from_address,to_address,body_text,snippet"
    )
    .eq("project_id", PROJECT_ID)
    .eq("provider", "GMAIL")
    .eq("mailbox_address", "reynaldo@axion.com.br")
    .order("sent_at", { ascending: true });

if (emailError) {
  throw new Error(emailError.message);
}

function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function belongsToWegLinhares(email) {
  const subject = normalizeText(email.subject);
  const body = normalizeText(email.body_text || email.snippet);
  const from = normalizeText(email.from_address);
  const to = normalizeText(email.to_address);

  const blob = [subject, body, from, to].join(" ");

  const company =
    from.includes("@weg.net") ||
    to.includes("@weg.net") ||
    from.includes("@axion.com.br") ||
    to.includes("@axion.com.br");

  const strongProjectSignal = [
    "weg",
    "fabrica de fios",
    "fabrica de fiols",
    "linhares",
    "rfq-1015661",
    "lanternim",
    "canteiro",
    "cronograma anexo contratual",
    "projeto executivo - fabrica de fios"
  ].some((term) => blob.includes(term));

  const approvedProbable =
    subject.includes(
      "negociacao - planilha de custos opcao 5 - alt 17,22m cobertura metalica"
    );

  return (
    (company && strongProjectSignal) ||
    approvedProbable
  );
}

const selectedEmails =
  emails.filter(belongsToWegLinhares);

console.log("");
console.log("BACKFILL — IMAGENS INLINE / ASSINATURAS");
console.log("=======================================");
console.log(`E-mails existentes no project_id: ${emails.length}`);
console.log(`E-mails selecionados WEG/Linhares: ${selectedEmails.length}`);
console.log("");

if (!process.argv.includes("--apply")) {
  console.log("MODO DIAGNÓSTICO — nenhuma imagem foi baixada.");
  console.log("Use --apply somente se a quantidade selecionada estiver correta.");
  process.exit(0);
}

let emailsOk = 0;
let imagesFound = 0;
let imagesStored = 0;
let alreadyStored = 0;
let failures = 0;

for (let index = 0; index < selectedEmails.length; index++) {
  const email = selectedEmails[index];

  try {
    const { data: message } =
      await gmail.users.messages.get({
        userId: "me",
        id: email.provider_message_id,
        format: "full",
      });

    emailsOk += 1;

    const images =
      collectInlineImages(message.payload);

    if (images.length) {
      console.log("");
      console.log(
        `[${index + 1}/${selectedEmails.length}] ${email.subject}`
      );
      console.log(
        `Imagens inline: ${images.length}`
      );
    }

    for (const part of images) {
      imagesFound += 1;

      const { data: existing } =
        await supabase
          .from("email_inline_images")
          .select("id")
          .eq("email_id", email.id)
          .eq("content_id", part.contentId)
          .maybeSingle();

      if (existing) {
        alreadyStored += 1;
        continue;
      }

      let bytes;

      if (part.inlineData) {
        bytes =
          decodeBase64Url(part.inlineData);
      } else {
        const { data: attachment } =
          await gmail.users.messages.attachments.get({
            userId: "me",
            messageId:
              email.provider_message_id,
            id: part.attachmentId,
          });

        bytes =
          decodeBase64Url(
            attachment.data ?? ""
          );
      }

      if (!bytes.length) {
        console.log(
          `  VAZIA: ${part.contentId}`
        );
        continue;
      }

      const sha256 =
        crypto
          .createHash("sha256")
          .update(bytes)
          .digest("hex");

      const fileName =
        safeFileName(part.fileName);

      const storageBucket =
        "project-documents";

      const storagePath =
        `${PROJECT_ID}/email-inline/${email.id}/${sha256}-${safeFileName(part.contentId)}-${fileName}`;

      const { error: uploadError } =
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

      if (uploadError) {
        throw new Error(
          `Storage: ${uploadError.message}`
        );
      }

      const { error: insertError } =
        await supabase
          .from("email_inline_images")
          .upsert(
            {
              project_id:
                PROJECT_ID,
              email_id:
                email.id,
              content_id:
                part.contentId,
              gmail_attachment_id:
                part.attachmentId,
              original_file_name:
                fileName,
              mime_type:
                part.mimeType,
              file_size_bytes:
                bytes.length,
              sha256_hash:
                sha256,
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

      if (insertError) {
        throw new Error(
          `Banco: ${insertError.message}`
        );
      }

      imagesStored += 1;

      console.log(
        `  OK: ${fileName}`
      );
    }
  } catch (error) {
    failures += 1;

    console.log("");
    console.log(
      `FALHA: ${email.subject}`
    );
    console.log(
      `Message ID: ${email.provider_message_id}`
    );
    console.log(
      `Motivo: ${error?.message ?? error}`
    );
  }

  if (
    (index + 1) % 50 === 0 ||
    index + 1 === selectedEmails.length
  ) {
    console.log(
      `${index + 1}/${selectedEmails.length} | ` +
      `Imagens ${imagesFound} | ` +
      `Gravadas ${imagesStored} | ` +
      `Existentes ${alreadyStored} | ` +
      `Falhas ${failures}`
    );
  }
}

console.log("");
console.log("=======================================");
console.log("BACKFILL DE IMAGENS CONCLUÍDO");
console.log("=======================================");
console.log(`E-mails acessados: ${emailsOk}`);
console.log(`Imagens encontradas: ${imagesFound}`);
console.log(`Imagens gravadas: ${imagesStored}`);
console.log(`Já existentes: ${alreadyStored}`);
console.log(`Falhas: ${failures}`);
console.log("=======================================");