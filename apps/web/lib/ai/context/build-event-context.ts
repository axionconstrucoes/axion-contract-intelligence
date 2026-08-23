// Context builder somente-leitura: monta o EventAnalysisContext de um
// evento a partir das fontes autorizadas do próprio projeto. Nunca cria,
// atualiza ou apaga dados — apenas SELECT.
//
// Recebe o cliente Supabase já pronto (injeção de dependência) em vez de
// criar um internamente: assim funciona tanto a partir de Server
// Components/Actions (createSupabaseServerClient, sob RLS) quanto de um
// script standalone (createClient com service role), sem depender de
// next/headers. Ver scripts/analyze-event-with-commercial-director.mjs.
//
// Ordem de prioridade da montagem (controle futuro de tokens/custo):
// Evento → Evidências → Cláusulas relacionadas → Documentos fonte → E-mails.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmailAttachmentsForEmails } from "../../email/attachments/get-email-attachments";
import type {
  ContextClause,
  ContextConfrontationCandidate,
  ContextEmail,
  ContextEventNote,
  ContextEvidence,
  EventAnalysisContext,
} from "./types";

type EventRow = {
  id: string;
  project_id: string;
  title: string;
  description: string;
  occurred_at: string;
  source_type: string;
  status: string;
};

type EvidenceRow = {
  id: string;
  source_type: string;
  label: string;
  locator: string;
  email_id: string | null;
  document_version_id: string | null;
};

type CandidateRow = {
  id: string;
  event_id: string;
  clause_id: string;
  status: string;
  finding_type: string;
  severity: string;
  confidence: number | string;
  summary: string;
  event_basis: string;
  clause_basis: string;
};

type CrossReferenceRow = {
  clause_id: string | null;
  email_id: string | null;
  kind: string;
};

type ClauseRow = {
  id: string;
  document_version_id: string;
  clause_number: string;
  title: string;
  text: string;
};

type DocumentVersionRow = {
  id: string;
  document_id: string;
};

type DocumentRow = {
  id: string;
  kind: string;
  title: string;
};

type EmailRow = {
  id: string;
  subject: string;
  snippet: string;
  sent_at: string;
  from_address: string;
  to_address: string;
};

type EventNoteRow = {
  id: string;
  category: string;
  text: string;
  author_user_id: string;
  created_at: string;
};

type ProfileRow = {
  id: string;
  name: string;
};

async function resolveClauses(
  supabase: SupabaseClient,
  clauseIds: string[],
  relation: ContextClause["relation"]
): Promise<ContextClause[]> {
  if (clauseIds.length === 0) {
    return [];
  }

  const { data: clauseData, error: clauseError } = await supabase
    .from("clauses")
    .select("id,document_version_id,clause_number,title,text")
    .in("id", clauseIds);

  if (clauseError) {
    throw new Error(`Falha ao carregar cláusulas do contexto: ${clauseError.message}`);
  }

  const clauses = clauseData as unknown as ClauseRow[];
  if (clauses.length === 0) {
    return [];
  }

  const versionIds = Array.from(new Set(clauses.map((c) => c.document_version_id)));

  const { data: versionData, error: versionError } = await supabase
    .from("document_versions")
    .select("id,document_id")
    .in("id", versionIds);

  if (versionError) {
    throw new Error(`Falha ao carregar versões de documento do contexto: ${versionError.message}`);
  }

  const versions = versionData as unknown as DocumentVersionRow[];
  const documentIdByVersionId = new Map(versions.map((v) => [v.id, v.document_id]));

  const documentIds = Array.from(new Set(versions.map((v) => v.document_id)));

  const { data: documentData, error: documentError } =
    documentIds.length > 0
      ? await supabase.from("documents").select("id,kind,title").in("id", documentIds)
      : { data: [] as DocumentRow[], error: null };

  if (documentError) {
    throw new Error(`Falha ao carregar documentos do contexto: ${documentError.message}`);
  }

  const documentById = new Map((documentData as unknown as DocumentRow[]).map((d) => [d.id, d]));

  return clauses.map((clause) => {
    const documentId = documentIdByVersionId.get(clause.document_version_id) ?? null;
    const document = documentId ? documentById.get(documentId) : undefined;

    return {
      id: clause.id,
      clauseNumber: clause.clause_number,
      title: clause.title,
      text: clause.text,
      documentId: documentId ?? "",
      documentKind: document?.kind ?? "DESCONHECIDO",
      documentTitle: document?.title ?? "Documento não disponível",
      relation,
    } satisfies ContextClause;
  });
}

async function resolveEmails(supabase: SupabaseClient, emailIds: string[]): Promise<ContextEmail[]> {
  if (emailIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("emails")
    .select("id,subject,snippet,sent_at,from_address,to_address")
    .in("id", emailIds);

  if (error) {
    throw new Error(`Falha ao carregar e-mails do contexto: ${error.message}`);
  }

  // Nunca deixa o Expert ignorar uma planilha/PDF anexado que seja a
  // fonte material da comunicação: todo e-mail no contexto sempre
  // declara seus anexos (mesmo os ainda não promovidos a documento —
  // ver ContextEmailAttachment).
  const attachmentsByEmailId = await getEmailAttachmentsForEmails(supabase, emailIds);

  return (data as unknown as EmailRow[]).map((row) => ({
    id: row.id,
    subject: row.subject,
    snippet: row.snippet,
    sentAt: row.sent_at,
    fromAddress: row.from_address,
    toAddress: row.to_address,
    attachments: (attachmentsByEmailId.get(row.id) ?? []).map((attachment) => ({
      id: attachment.id,
      originalFileName: attachment.originalFileName,
      mimeType: attachment.mimeType,
      processingStatus: attachment.processingStatus,
      documentVersionId: attachment.documentVersionId,
    })),
  }));
}

async function resolveEventNotes(supabase: SupabaseClient, eventId: string): Promise<ContextEventNote[]> {
  const { data: noteData, error: noteError } = await supabase
    .from("event_notes")
    .select("id,category,text,author_user_id,created_at")
    .eq("event_id", eventId)
    .order("created_at", { ascending: true });

  if (noteError) {
    throw new Error(`Falha ao carregar anotações do evento no contexto: ${noteError.message}`);
  }

  const notes = noteData as unknown as EventNoteRow[];
  if (notes.length === 0) {
    return [];
  }

  const authorIds = Array.from(new Set(notes.map((n) => n.author_user_id)));

  const { data: profileData, error: profileError } = await supabase
    .from("profiles")
    .select("id,name")
    .in("id", authorIds);

  if (profileError) {
    throw new Error(`Falha ao carregar autores das anotações do contexto: ${profileError.message}`);
  }

  const authorNameById = new Map((profileData as unknown as ProfileRow[]).map((p) => [p.id, p.name]));

  // Nunca representa fato documental: sourceType/evidentialStatus fixos
  // avisam qualquer consumidor (Expert ou UI) de que isto é informação
  // declarada internamente, não evidência confirmada.
  return notes.map((note) => ({
    id: note.id,
    category: note.category,
    text: note.text,
    author: authorNameById.get(note.author_user_id) ?? "Usuário não disponível",
    createdAt: note.created_at,
    sourceType: "USER_NOTE",
    evidentialStatus: "DECLARED_CONTEXT",
  }));
}

export interface BuildEventAnalysisContextInput {
  projectId: string;
  eventId: string;
  /** Quando informado, restringe cláusulas/candidatos a este único candidato — contexto mínimo necessário. */
  candidateId?: string;
}

export async function buildEventAnalysisContext(
  supabase: SupabaseClient,
  input: BuildEventAnalysisContextInput
): Promise<EventAnalysisContext> {
  const { projectId, eventId, candidateId } = input;

  // 1. Evento — deve pertencer ao projeto informado.
  const { data: eventData, error: eventError } = await supabase
    .from("contract_events")
    .select("id,project_id,title,description,occurred_at,source_type,status")
    .eq("id", eventId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (eventError) {
    throw new Error(`Falha ao carregar evento do contexto: ${eventError.message}`);
  }

  const eventRow = eventData as unknown as EventRow | null;
  if (!eventRow) {
    throw new Error(
      `Evento (id=${eventId}) não encontrado para o projeto (id=${projectId}). O context builder nunca monta contexto de outro projeto.`
    );
  }

  // 2. Evidências.
  const { data: evidenceData, error: evidenceError } = await supabase
    .from("event_evidence")
    .select("id,source_type,label,locator,email_id,document_version_id")
    .eq("event_id", eventId);

  if (evidenceError) {
    throw new Error(`Falha ao carregar evidências do contexto: ${evidenceError.message}`);
  }

  const evidence: ContextEvidence[] = (evidenceData as unknown as EvidenceRow[]).map((row) => ({
    id: row.id,
    sourceType: row.source_type,
    label: row.label,
    locator: row.locator,
    emailId: row.email_id,
    documentVersionId: row.document_version_id,
  }));

  let relatedClauses: ContextClause[] = [];
  let confrontationCandidates: ContextConfrontationCandidate[] = [];
  let crossReferenceEmailIds: string[] = [];

  if (candidateId) {
    // Modo restrito: somente o candidato explicitamente pedido.
    const { data: candidateData, error: candidateError } = await supabase
      .from("event_clause_confrontation_candidates")
      .select("id,event_id,clause_id,status,finding_type,severity,confidence,summary,event_basis,clause_basis")
      .eq("id", candidateId)
      .eq("event_id", eventId)
      .maybeSingle();

    if (candidateError) {
      throw new Error(`Falha ao carregar candidato do contexto: ${candidateError.message}`);
    }

    const candidateRow = candidateData as unknown as CandidateRow | null;
    if (!candidateRow) {
      throw new Error(
        `Candidato de confrontação (id=${candidateId}) não encontrado para o evento (id=${eventId}).`
      );
    }

    confrontationCandidates = [
      {
        id: candidateRow.id,
        clauseId: candidateRow.clause_id,
        status: candidateRow.status,
        findingType: candidateRow.finding_type,
        severity: candidateRow.severity,
        confidence: Number(candidateRow.confidence),
        summary: candidateRow.summary,
        eventBasis: candidateRow.event_basis,
        clauseBasis: candidateRow.clause_basis,
      },
    ];

    relatedClauses = await resolveClauses(supabase, [candidateRow.clause_id], "CONFRONTATION_CANDIDATE");
  } else {
    // Modo completo: todos os candidatos + todas as cross-references já confirmadas.
    const [candidatesResult, crossReferencesResult] = await Promise.all([
      supabase
        .from("event_clause_confrontation_candidates")
        .select("id,event_id,clause_id,status,finding_type,severity,confidence,summary,event_basis,clause_basis")
        .eq("event_id", eventId),
      supabase.from("event_cross_references").select("clause_id,email_id,kind").eq("event_id", eventId),
    ]);

    if (candidatesResult.error) {
      throw new Error(`Falha ao carregar candidatos de confrontação do contexto: ${candidatesResult.error.message}`);
    }
    if (crossReferencesResult.error) {
      throw new Error(`Falha ao carregar referências cruzadas do contexto: ${crossReferencesResult.error.message}`);
    }

    const candidateRows = candidatesResult.data as unknown as CandidateRow[];
    confrontationCandidates = candidateRows.map((row) => ({
      id: row.id,
      clauseId: row.clause_id,
      status: row.status,
      findingType: row.finding_type,
      severity: row.severity,
      confidence: Number(row.confidence),
      summary: row.summary,
      eventBasis: row.event_basis,
      clauseBasis: row.clause_basis,
    }));

    const crossReferenceRows = crossReferencesResult.data as unknown as CrossReferenceRow[];
    const crossReferenceClauseIds = crossReferenceRows
      .map((row) => row.clause_id)
      .filter((id): id is string => Boolean(id));
    crossReferenceEmailIds = crossReferenceRows
      .filter((row) => row.kind === "COMUNICACAO")
      .map((row) => row.email_id)
      .filter((id): id is string => Boolean(id));

    const candidateClauseIds = candidateRows.map((row) => row.clause_id);

    const [candidateClauses, crossReferenceClauses] = await Promise.all([
      resolveClauses(supabase, Array.from(new Set(candidateClauseIds)), "CONFRONTATION_CANDIDATE"),
      resolveClauses(
        supabase,
        Array.from(new Set(crossReferenceClauseIds.filter((id) => !candidateClauseIds.includes(id)))),
        "CROSS_REFERENCE"
      ),
    ]);

    relatedClauses = [...candidateClauses, ...crossReferenceClauses];
  }

  // 5. E-mails pertinentes — referenciados pela evidência do evento e,
  // no modo completo, também pelas cross-references de comunicação.
  const emailIdsFromEvidence = evidence.map((e) => e.emailId).filter((id): id is string => Boolean(id));
  const emailIds = Array.from(new Set([...emailIdsFromEvidence, ...crossReferenceEmailIds]));
  const relatedEmails = await resolveEmails(supabase, emailIds);

  // Anotações do evento — sempre incluídas (informação declarada, nunca
  // fato documental; ver ContextEventNote).
  const eventNotes = await resolveEventNotes(supabase, eventId);

  return {
    projectId,
    eventId,
    focusCandidateId: candidateId ?? null,
    event: {
      id: eventRow.id,
      projectId: eventRow.project_id,
      title: eventRow.title,
      description: eventRow.description,
      occurredAt: eventRow.occurred_at,
      sourceType: eventRow.source_type,
      status: eventRow.status,
    },
    evidence,
    relatedClauses,
    relatedEmails,
    confrontationCandidates,
    eventNotes,
  };
}
