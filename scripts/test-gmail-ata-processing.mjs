// Testes do processamento por mensagem do worker de anexos/atas do Gmail,
// com respostas simuladas (sem Gmail, Supabase ou rede). Os erros HTTP são
// GaxiosError REAIS (mesma classe que googleapis lança), para validar que a
// classificação lê o status como a biblioteca de fato o expõe.
//
// Uso: node scripts/test-gmail-ata-processing.mjs

import assert from "node:assert/strict";
import { GaxiosError } from "gaxios";
import {
  computeExitCode,
  getHttpStatus,
  processMessageRows,
} from "./lib/gmail-ata-processing.mjs";

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`OK   ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`FAIL ${name}`);
    console.log(`     ${error.message}`);
    failed += 1;
  }
}

function httpError(status, message = "Requested entity was not found.") {
  return new GaxiosError(message, { url: "https://gmail.googleapis.com/x" }, {
    status,
    data: { error: { code: status, message } },
    headers: {},
    config: {},
    statusText: "",
  });
}

const PLANNING = new Set(["planejamento@example.test"]);
const row = (id) => ({
  id,
  provider_message_id: `gmail-${id}`,
  provider_thread_id: null,
  sent_at: "2026-10-26T10:00:00Z",
  subject: "assunto-sigiloso",
  from_address: "planejamento@example.test",
});

function makeEnv({ messages = {}, attachments = {}, ingestFailures = {}, linkError = null } = {}) {
  const logs = { warn: [], error: [], log: [] };
  const linked = [];
  const gmail = {
    users: {
      messages: {
        get: async ({ id }) => {
          const behavior = messages[id] ?? "ok";
          if (behavior instanceof Error) throw behavior;
          return {
            data: {
              threadId: "t",
              payload: { parts: [{ filename: "Ata Semanal.pdf", attachmentId: `att-${id}` }] },
            },
          };
        },
        attachments: {
          get: async ({ id }) => {
            const behavior = attachments[id] ?? "ok";
            if (behavior instanceof Error) throw behavior;
            return { data: { data: "YWJj" } };
          },
        },
      },
    },
  };
  // Imita ingestSinglePart: nunca lança; converte exceção em FAILED com texto.
  const ingest = async ({ parts, downloadAttachmentBytes, emailId }) => {
    const results = [];
    for (const part of parts) {
      try {
        if (ingestFailures[emailId]) throw new Error("Falha ao salvar anexo no Supabase Storage: x");
        await downloadAttachmentBytes(part);
        results.push({
          status: "INGESTED",
          attachment: { id: `a-${emailId}`, originalFileName: part.originalFileName },
        });
      } catch (error) {
        results.push({
          status: "FAILED",
          gmailAttachmentId: part.gmailAttachmentId,
          originalFileName: part.originalFileName,
          error: error.message,
        });
      }
    }
    return results;
  };
  const link = async (input) => {
    if (linkError) throw linkError;
    linked.push(input.attachmentId);
  };
  const run = (rows) =>
    processMessageRows({
      rows,
      planningEmails: PLANNING,
      gmail,
      ingest,
      link,
      collectParts: (payload) =>
        (payload.parts ?? []).map((p) => ({
          gmailAttachmentId: p.attachmentId,
          originalFileName: p.filename,
          mimeType: "application/pdf",
          declaredSizeBytes: 3,
        })),
      decodeBase64Url: (v) => Buffer.from(v, "base64"),
      isMeetingMinutes: (name) => /ata/i.test(name),
      projectId: "p",
      mailbox: "caixa@example.test",
      log: (m) => logs.log.push(m),
      warn: (m) => logs.warn.push(m),
      error: (m) => logs.error.push(m),
    });
  return { run, logs, linked };
}

console.log("");
console.log("======================================");
console.log("GMAIL ATA WORKER — TESTES");
console.log("======================================");
console.log("");

await check("status HTTP é lido de GaxiosError real (404, 401, 503) e é null para erro de rede", () => {
  assert.equal(getHttpStatus(httpError(404)), 404);
  assert.equal(getHttpStatus(httpError(401, "Invalid Credentials")), 401);
  assert.equal(getHttpStatus(httpError(503, "backend")), 503);
  assert.equal(getHttpStatus(Object.assign(new Error("x"), { code: "ECONNRESET" })), null);
  assert.equal(getHttpStatus(null), null);
});

await check("sucesso: processada, nenhuma ausência/falha, exit code 0, ata promovida", async () => {
  const env = makeEnv();
  const s = await env.run([row("1")]);
  assert.deepEqual(
    {
      processed: s.processed,
      skipped: s.skippedMissingMessage,
      missing: s.missingAttachment,
      failures: s.failures,
      atas: s.atasPromoted,
      ingested: s.attachmentsIngested,
    },
    { processed: 1, skipped: 0, missing: 0, failures: 0, atas: 1, ingested: 1 }
  );
  assert.equal(computeExitCode(s), 0);
});

await check("messages.get 404: skippedMissingMessage, aviso explícito, NÃO é falha, nada promovido, exit 0", async () => {
  const env = makeEnv({ messages: { "gmail-1": httpError(404) } });
  const s = await env.run([row("1")]);
  assert.equal(s.skippedMissingMessage, 1);
  assert.equal(s.failures, 0);
  assert.equal(s.missingAttachment, 0);
  assert.equal(s.processed, 0, "mensagem ausente não pode contar como processada");
  assert.equal(env.linked.length, 0);
  assert.equal(computeExitCode(s), 0);
  assert.equal(env.logs.warn.length, 1);
  assert.match(env.logs.warn[0], /^::warning::.*recordId=1 operation=gmail\.messages\.get httpStatus=404/);
});

await check("attachments.get 404: missingAttachment (separado de falhas), incompleto, ata NÃO promovida, exit 1", async () => {
  const env = makeEnv({ attachments: { "att-gmail-1": httpError(404) } });
  const s = await env.run([row("1")]);
  assert.equal(s.missingAttachment, 1);
  assert.equal(s.failures, 0);
  assert.equal(s.processed, 0, "mensagem com anexo ausente não é concluída");
  assert.equal(s.atasPromoted, 0);
  assert.equal(env.linked.length, 0);
  assert.equal(computeExitCode(s), 1);
  assert.match(env.logs.warn[0], /recordId=1 operation=gmail\.attachments\.get httpStatus=404/);
});

await check("autenticação (401 em messages.get) é falha real, exit 1", async () => {
  const env = makeEnv({ messages: { "gmail-1": httpError(401, "Invalid Credentials") } });
  const s = await env.run([row("1")]);
  assert.equal(s.failures, 1);
  assert.equal(s.skippedMissingMessage, 0);
  assert.equal(computeExitCode(s), 1);
  assert.match(env.logs.error[0], /recordId=1 operation=gmail\.messages\.get httpStatus=401/);
});

await check("permissão (403) e limite (429) em attachments.get são falhas reais, não 'anexo ausente'", async () => {
  for (const status of [403, 429]) {
    const env = makeEnv({ attachments: { "att-gmail-1": httpError(status, "x") } });
    const s = await env.run([row("1")]);
    assert.equal(s.failures, 1, `status ${status}`);
    assert.equal(s.missingAttachment, 0, `status ${status}`);
    assert.equal(computeExitCode(s), 1);
    assert.match(env.logs.error[0], new RegExp(`operation=gmail\\.attachments\\.get httpStatus=${status}`));
  }
});

await check("erro transitório (503 e erro de rede) é falha real, exit 1", async () => {
  const env503 = makeEnv({ messages: { "gmail-1": httpError(503, "backend error") } });
  const s503 = await env503.run([row("1")]);
  assert.equal(s503.failures, 1);
  assert.equal(computeExitCode(s503), 1);

  const net = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
  const envNet = makeEnv({ messages: { "gmail-1": net } });
  const sNet = await envNet.run([row("1")]);
  assert.equal(sNet.failures, 1);
  assert.equal(computeExitCode(sNet), 1);
  assert.match(envNet.logs.error[0], /httpStatus=n\/a errorName=Error code=ECONNRESET/);
});

await check("falha de armazenamento/banco na ingestão é falha real e logada sem a mensagem do erro", async () => {
  const env = makeEnv({ ingestFailures: { 1: true } });
  const s = await env.run([row("1")]);
  assert.equal(s.failures, 1);
  assert.equal(s.missingAttachment, 0);
  assert.equal(computeExitCode(s), 1);
  assert.match(env.logs.error[0], /recordId=1 operation=ingest\.store_or_db/);
  assert.ok(!/Storage/.test(env.logs.error[0]), "não deve vazar a mensagem do erro");
});

await check("falha ao promover ata (link) é falha real com operação identificada", async () => {
  const env = makeEnv({ linkError: new Error("db down") });
  const s = await env.run([row("1")]);
  assert.equal(s.failures, 1);
  assert.equal(s.atasPromoted, 0);
  assert.match(env.logs.error[0], /recordId=1 operation=link_attachment_to_document/);
});

await check("uma ocorrência não impede as demais: 404 na mensagem 2 e 404 de anexo na 4 não bloqueiam 1, 3 e 5", async () => {
  const env = makeEnv({
    messages: { "gmail-2": httpError(404) },
    attachments: { "att-gmail-4": httpError(404) },
  });
  const s = await env.run([row("1"), row("2"), row("3"), row("4"), row("5")]);
  assert.equal(s.processed, 3);
  assert.equal(s.skippedMissingMessage, 1);
  assert.equal(s.missingAttachment, 1);
  assert.equal(s.failures, 0);
  assert.deepEqual(env.linked.sort(), ["a-1", "a-3", "a-5"]);
  assert.equal(computeExitCode(s), 1, "anexo ausente mantém resultado de falha");
});

await check("mensagem ausente isolada entre mensagens boas: exit 0, aviso e contagem visíveis", async () => {
  const env = makeEnv({ messages: { "gmail-2": httpError(404) } });
  const s = await env.run([row("1"), row("2"), row("3")]);
  assert.equal(s.processed, 2);
  assert.equal(s.skippedMissingMessage, 1);
  assert.equal(computeExitCode(s), 0);
  assert.equal(env.logs.warn.length, 1);
});

await check("remetente fora do planejamento é ignorado sem consultar o Gmail", async () => {
  const env = makeEnv({ messages: { "gmail-1": httpError(500, "nao deveria ser chamado") } });
  const s = await env.run([{ ...row("1"), from_address: "outro@example.test" }]);
  assert.equal(s.scanned, 0);
  assert.equal(s.failures, 0);
});

await check("diagnóstico nunca contém assunto, endereço, nome de arquivo ou id da mensagem/anexo do Gmail", async () => {
  const env = makeEnv({
    messages: { "gmail-2": httpError(404) },
    attachments: { "att-gmail-3": httpError(404) },
  });
  await env.run([row("1"), row("2"), row("3")]);
  const all = [...env.logs.warn, ...env.logs.error, ...env.logs.log].join("\n");
  for (const secret of ["assunto-sigiloso", "planejamento@example.test", "Ata Semanal", "gmail-2", "att-gmail-3"]) {
    assert.ok(!all.includes(secret), `vazou: ${secret}`);
  }
});

await check("regra do código de saída: 1 se falhas>0 ou anexos ausentes>0; mensagens ausentes sozinhas = 0", () => {
  const base = { failures: 0, missingAttachment: 0, skippedMissingMessage: 0 };
  assert.equal(computeExitCode(base), 0);
  assert.equal(computeExitCode({ ...base, skippedMissingMessage: 5 }), 0);
  assert.equal(computeExitCode({ ...base, failures: 1 }), 1);
  assert.equal(computeExitCode({ ...base, missingAttachment: 1 }), 1);
});

console.log("");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
if (failed > 0) process.exit(1);
