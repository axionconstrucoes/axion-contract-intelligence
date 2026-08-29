import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClientResponseRelationType } from "./types";

// Leitura real (RLS: qualquer membro do projeto, mesma policy de
// document_version_client_responses_select_project_members_only) das
// respostas do cliente vinculadas a uma versão — nunca reescreve nada,
// só lê o vínculo lateral + os campos mínimos do e-mail para exibição.
export interface DocumentVersionClientResponseRow {
  id: string;
  relationType: ClientResponseRelationType;
  excerpt: string | null;
  createdAt: string;
  emailFromAddress: string;
  emailSubject: string;
  emailSentAt: string;
}

export async function getDocumentVersionClientResponses(
  supabase: SupabaseClient,
  documentVersionId: string
): Promise<DocumentVersionClientResponseRow[]> {
  const { data, error } = await supabase
    .from("document_version_client_responses")
    .select("id, relation_type, excerpt, created_at, emails(from_address, subject, sent_at)")
    .eq("document_version_id", documentVersionId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data as unknown as Array<{
    id: string;
    relation_type: ClientResponseRelationType;
    excerpt: string | null;
    created_at: string;
    emails: { from_address: string; subject: string; sent_at: string } | null;
  }>).map((row) => ({
    id: row.id,
    relationType: row.relation_type,
    excerpt: row.excerpt,
    createdAt: row.created_at,
    emailFromAddress: row.emails?.from_address ?? "(remetente desconhecido)",
    emailSubject: row.emails?.subject ?? "(assunto desconhecido)",
    emailSentAt: row.emails?.sent_at ?? row.created_at,
  }));
}

// "CONTESTADO PELO CLIENTE" — quando existe QUALQUER resposta de
// divergência real (DISCORDA/CORRIGE/RESSALVA) — RESPONDE/COMPLEMENTA
// sozinhos nunca disparam o badge de contestação (nunca invalida
// automaticamente o documento nem constitui alteração contratual, ver
// requisito).
const CONTESTED_RELATION_TYPES = new Set<ClientResponseRelationType>(["DISCORDA", "CORRIGE", "RESSALVA"]);

export function hasContestedClientResponse(responses: DocumentVersionClientResponseRow[]): boolean {
  return responses.some((r) => CONTESTED_RELATION_TYPES.has(r.relationType));
}
