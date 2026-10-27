// Índice de correlação das respostas aos alertas — PURO (sem I/O), compartilhado
// pelo store real (supabase-store.ts) e pelos testes.
//
// `seenMessageIds` alimenta o filtro anti-loop (filterInboundMessage → IGNORED_LOOP).
// Ele deve conter apenas mensagens JÁ CONHECIDAS como tratadas:
//   - todas as mensagens ENVIADAS pelo ACC (OUTBOUND): uma "resposta" cujo Message-ID
//     é o de um e-mail nosso é eco/loop;
//   - mensagens RECEBIDAS que já saíram do estado RECEIVED (processadas/ignoradas):
//     a reentrega do mesmo Message-ID é duplicidade.
// Uma mensagem RECEBIDA ainda pendente (status RECEIVED) NUNCA entra: ela é justamente
// a que está sendo processada — incluí-la fazia toda resposta legítima ser descartada
// como IGNORED_LOOP. A deduplicação de duas pendentes com o mesmo Message-ID é feita
// pelo processador (a primeira aceita registra o id; a segunda vira IGNORED_LOOP).

import type { CorrelationIndex } from "./reply-pipeline";

export interface CorrelationMessageRow {
  case_id: string | null;
  message_id_header: string | null;
  reply_token_hash: string | null;
  direction: string | null;
  status: string | null;
}

export interface CorrelationConversationRow {
  case_id: string | null;
  reply_token_hash: string | null;
}

export interface CorrelationCaseRow {
  id: string;
  visible_code: string | null;
}

export function buildCorrelationIndex(
  messages: CorrelationMessageRow[],
  conversations: CorrelationConversationRow[],
  cases: CorrelationCaseRow[]
): CorrelationIndex & { seenMessageIds: Set<string> } {
  const byMessageId = new Map<string, string>();
  const byReplyTokenHash = new Map<string, string>();
  const seenMessageIds = new Set<string>();
  for (const row of messages) {
    if (row.message_id_header && row.case_id) byMessageId.set(row.message_id_header, row.case_id);
    if (row.message_id_header && (row.direction === "OUTBOUND" || (row.direction === "INBOUND" && row.status !== "RECEIVED"))) {
      seenMessageIds.add(row.message_id_header);
    }
    if (row.reply_token_hash && row.case_id) byReplyTokenHash.set(row.reply_token_hash, row.case_id);
  }
  for (const row of conversations) if (row.reply_token_hash && row.case_id) byReplyTokenHash.set(row.reply_token_hash, row.case_id);
  const byVisibleCode = new Map(cases.filter((row) => row.visible_code).map((row) => [row.visible_code as string, row.id]));
  return { byMessageId, byReplyTokenHash, byVisibleCode, seenMessageIds };
}
