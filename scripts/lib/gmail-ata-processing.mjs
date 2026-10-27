// Processamento por mensagem do worker de anexos/atas do Gmail
// (scripts/gmail-ata-ingestion-worker.mjs), isolado para ser testável
// com respostas simuladas — sem Gmail, Supabase ou rede reais.
//
// Diagnóstico: cada ocorrência é registrada com o identificador INTERNO
// do registro (emails.id), a operação e o código HTTP. Nunca registra
// conteúdo de e-mail, endereços, nomes de arquivo, tokens, credenciais
// nem a mensagem do erro (só o nome da classe do erro).
//
// Classificação (HTTP 404 do Gmail):
//   - messages.get 404         -> skippedMissingMessage (aviso explícito;
//                                 NÃO é falha, não marca nada como concluído)
//   - attachments.get 404      -> missingAttachment (processamento
//                                 INCOMPLETO; continua produzindo falha)
//   - qualquer outro erro      -> failures (autenticação 401, permissão
//                                 403, limite 429, servidor 5xx, rede,
//                                 banco/storage...)
//
// Esta correção NÃO recupera o conteúdo inacessível: a mensagem/anexo
// ausente continua ausente e será tentado de novo na próxima execução.

/**
 * Lê o status HTTP como a biblioteca o expõe. Em gaxios 7 (googleapis 176)
 * o GaxiosError tem `status` (number, copiado de response.status) e
 * `response.status`; `code` pode ser string de rede (ex.: "ECONNRESET").
 * Retorna null quando o erro não veio de uma resposta HTTP.
 */
export function getHttpStatus(error) {
  if (!error || typeof error !== "object") return null;
  if (Number.isInteger(error.status)) return error.status;
  if (Number.isInteger(error.response?.status)) return error.response.status;
  if (Number.isInteger(error.code)) return error.code;
  if (typeof error.code === "string" && /^\d{3}$/.test(error.code)) return Number(error.code);
  return null;
}

export class MissingGmailAttachmentError extends Error {
  constructor() {
    super("Anexo ausente no Gmail (HTTP 404).");
    this.name = "MissingGmailAttachmentError";
  }
}

function describe(error) {
  const status = getHttpStatus(error);
  const name = error instanceof Error ? error.name : typeof error;
  const code = typeof error?.code === "string" && !/^\d{3}$/.test(error.code) ? ` code=${error.code}` : "";
  return `httpStatus=${status ?? "n/a"} errorName=${name}${code}`;
}

/**
 * Regra de código de saída (única fonte de verdade):
 *   1  se failures > 0 OU missingAttachment > 0
 *   0  caso contrário — skippedMissingMessage sozinho NÃO falha o job
 *      (permanece visível no aviso e na contagem).
 */
export function computeExitCode(summary) {
  return summary.failures > 0 || summary.missingAttachment > 0 ? 1 : 0;
}

export async function processMessageRows({
  rows,
  planningEmails,
  gmail,
  ingest,
  link,
  collectParts,
  decodeBase64Url,
  isMeetingMinutes,
  projectId,
  mailbox,
  log = console.log,
  warn = console.warn,
  error: logError = console.error,
}) {
  const summary = {
    scanned: 0,
    processed: 0,
    skippedMissingMessage: 0,
    missingAttachment: 0,
    failures: 0,
    attachmentsSeen: 0,
    attachmentsIngested: 0,
    atasPromoted: 0,
  };

  for (const row of rows) {
    if (!planningEmails.has(String(row.from_address ?? "").trim().toLowerCase())) continue;
    summary.scanned += 1;

    let rowIncomplete = false;
    let operation = "gmail.messages.get";

    // Erros de download por anexo, indexados pelo id do anexo no Gmail (o
    // ingest só devolve a mensagem do erro como texto).
    const downloadErrors = new Map();

    try {
      let full;
      try {
        full = await gmail.users.messages.get({
          userId: "me",
          id: row.provider_message_id,
          format: "full",
        });
      } catch (getError) {
        if (getHttpStatus(getError) === 404) {
          summary.skippedMissingMessage += 1;
          warn(
            `::warning::[gmail-ata-worker] mensagem ausente no Gmail, ignorada nesta execucao: ` +
              `recordId=${row.id} operation=gmail.messages.get httpStatus=404. ` +
              `Conteudo NAO recuperado; sera tentado novamente na proxima execucao.`
          );
          continue;
        }
        throw getError;
      }

      const parts = collectParts(full.data.payload);
      if (parts.length === 0) {
        summary.processed += 1;
        continue;
      }

      operation = "ingest";
      const results = await ingest({
        emailId: row.id,
        gmailMessageId: row.provider_message_id,
        gmailThreadId: row.provider_thread_id ?? full.data.threadId ?? null,
        receivedAt: row.sent_at,
        parts,
        downloadAttachmentBytes: async (part) => {
          try {
            const response = await gmail.users.messages.attachments.get({
              userId: "me",
              messageId: row.provider_message_id,
              id: part.gmailAttachmentId,
            });
            return decodeBase64Url(response.data.data);
          } catch (downloadError) {
            downloadErrors.set(part.gmailAttachmentId, downloadError);
            if (getHttpStatus(downloadError) === 404) throw new MissingGmailAttachmentError();
            throw downloadError;
          }
        },
      });

      summary.attachmentsSeen += parts.length;

      for (const result of results) {
        if (result.status === "FAILED") {
          rowIncomplete = true;
          const downloadError = downloadErrors.get(result.gmailAttachmentId);
          if (downloadError && getHttpStatus(downloadError) === 404) {
            summary.missingAttachment += 1;
            warn(
              `::warning::[gmail-ata-worker] anexo ausente no Gmail (processamento INCOMPLETO): ` +
                `recordId=${row.id} operation=gmail.attachments.get httpStatus=404. ` +
                `Conteudo NAO recuperado.`
            );
          } else {
            summary.failures += 1;
            logError(
              `[gmail-ata-worker] falha ao ingerir anexo: recordId=${row.id} ` +
                (downloadError
                  ? `operation=gmail.attachments.get ${describe(downloadError)}`
                  : `operation=ingest.store_or_db (detalhe omitido)`)
            );
          }
          continue;
        }

        if (result.status === "INGESTED") summary.attachmentsIngested += 1;

        const attachment = result.attachment;
        if (!isMeetingMinutes(attachment.originalFileName)) continue;

        operation = "link_attachment_to_document";
        await link({
          attachmentId: attachment.id,
          kind: "ATA_REUNIAO",
          documentTitle: attachment.originalFileName.replace(/\.[^.]+$/, ""),
          documentDate: String(row.sent_at).slice(0, 10),
          author: row.from_address || mailbox,
          summary: `Ata de reunião recebida por e-mail. Assunto: ${row.subject || "(sem assunto)"}`,
        });
        summary.atasPromoted += 1;
      }

      // Mensagem só conta como processada quando nenhum anexo faltou/falhou.
      if (!rowIncomplete) summary.processed += 1;
    } catch (rowError) {
      summary.failures += 1;
      logError(
        `[gmail-ata-worker] falha: recordId=${row.id} operation=${operation} ` +
          describe(rowError)
      );
    }
  }

  return summary;
}

export function formatSummary(summary) {
  return (
    `Resumo: ${summary.processed} processada(s) de ${summary.scanned} examinada(s); ` +
    `${summary.skippedMissingMessage} ignorada(s) por mensagem ausente; ` +
    `${summary.missingAttachment} anexo(s) ausente(s); ${summary.failures} falha(s). ` +
    `Codigo de saida: ${computeExitCode(summary)} (1 se falhas>0 ou anexos ausentes>0; ` +
    `mensagens ausentes isoladas nao falham o job).`
  );
}
