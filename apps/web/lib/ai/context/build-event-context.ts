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
import { resolveNonTrashedDocumentIds } from "../../documents/active-document-filter";
import type { ContractualParentDocumentRow, DocumentContractualLinkContextRow } from "./map-contractual-link-context";
import { mapContractualLinkContext } from "./map-contractual-link-context";
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
  // Presentes só depois da migration 20260829090000 estar aplicada —
  // ver o fallback em resolveClauses() (retry sem essas colunas se o
  // banco ainda não as tiver, nunca quebra o carregamento do contexto).
  contractual_parent_document_id?: string | null;
  contractual_incorporation_basis?: string | null;
  contractual_linked_by_user_id?: string | null;
  contractual_linked_at?: string | null;
};

type DocumentVersionForCurrentLabelRow = {
  document_id: string;
  version_index: number;
  version_label: string;
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

  const EXTENDED_DOCUMENT_COLUMNS =
    "id,kind,title,contractual_parent_document_id,contractual_incorporation_basis,contractual_linked_by_user_id,contractual_linked_at";

  let documentRows: DocumentRow[] = [];
  if (documentIds.length > 0) {
    const extended = await supabase.from("documents").select(EXTENDED_DOCUMENT_COLUMNS).in("id", documentIds);

    if (extended.error) {
      // 42703 = undefined_column: o banco ainda não tem a migration
      // 20260829090000 aplicada (ver relatório, "Compatibilidade de
      // deploy") — refaz a MESMA consulta só com as colunas que sempre
      // existiram, nunca quebra o carregamento do contexto por causa
      // disso. Qualquer OUTRO erro continua sendo lançado normalmente.
      if (extended.error.code === "42703") {
        const fallback = await supabase.from("documents").select("id,kind,title").in("id", documentIds);
        if (fallback.error) {
          throw new Error(`Falha ao carregar documentos do contexto: ${fallback.error.message}`);
        }
        documentRows = fallback.data as unknown as DocumentRow[];
      } else {
        throw new Error(`Falha ao carregar documentos do contexto: ${extended.error.message}`);
      }
    } else {
      documentRows = extended.data as unknown as DocumentRow[];
    }
  }

  const documentById = new Map(documentRows.map((d) => [d.id, d]));

  // Documentos NA LIXEIRA nunca chegam ao Expert/confronto — uma
  // cláusula cujo documento foi enviado para a lixeira é EXCLUÍDA do
  // resultado (não só degradada para "documento não disponível", que é
  // o comportamento já existente para um documento genuinamente não
  // encontrado — casos diferentes, tratados diferente abaixo).
  // Consulta separada, mesmo padrão de fallback em 42703 (migration
  // 20260829150000 pode não estar aplicada nesse banco — nesse caso
  // não existe lixeira possível, todo documento é tratado como ativo).
  const nonTrashedDocumentIds = await resolveNonTrashedDocumentIds(supabase, documentIds);

  // Documentos PAI (contrato-base/aditivo) referenciados pelos filhos
  // acima — nunca presumidos a partir do lote já carregado, porque o
  // pai de um documento nem sempre é um dos documentos das cláusulas
  // deste lote. Ausente/erro de coluna (schema antigo) = mapa vazio,
  // mapContractualLinkContext trata isso como "sem vínculo resolvido".
  const parentIds = Array.from(
    new Set(documentRows.map((d) => d.contractual_parent_document_id).filter((id): id is string => Boolean(id)))
  );

  const parentById = new Map<string, ContractualParentDocumentRow>();
  const parentCurrentVersionLabelById = new Map<string, string>();

  if (parentIds.length > 0) {
    const { data: parentData, error: parentError } = await supabase
      .from("documents")
      .select("id,kind,title")
      .in("id", parentIds);

    if (parentError) {
      throw new Error(`Falha ao carregar documentos pai do contexto: ${parentError.message}`);
    }

    // Um pai NA LIXEIRA nunca é um vínculo contratual válido para o
    // Expert — mesmo critério de resolveClauses acima.
    const nonTrashedParentIds = await resolveNonTrashedDocumentIds(supabase, parentIds);
    for (const parent of parentData as unknown as { id: string; kind: string; title: string }[]) {
      if ((parent.kind === "CONTRATO_BASE" || parent.kind === "ADITIVO") && nonTrashedParentIds.has(parent.id)) {
        parentById.set(parent.id, { id: parent.id, kind: parent.kind, title: parent.title });
      }
    }

    const { data: parentVersionData, error: parentVersionError } = await supabase
      .from("document_versions")
      .select("document_id,version_index,version_label")
      .in("document_id", parentIds)
      .order("version_index", { ascending: false });

    if (parentVersionError) {
      throw new Error(`Falha ao carregar versões dos documentos pai do contexto: ${parentVersionError.message}`);
    }

    // Já ordenado por version_index desc — a PRIMEIRA ocorrência de
    // cada document_id é a versão vigente (mesmo critério de
    // "current = versions[0]" usado em document-management.ts/DocumentCard).
    for (const row of parentVersionData as unknown as DocumentVersionForCurrentLabelRow[]) {
      if (!parentCurrentVersionLabelById.has(row.document_id)) {
        parentCurrentVersionLabelById.set(row.document_id, row.version_label);
      }
    }
  }

  return clauses
    .filter((clause) => {
      const documentId = documentIdByVersionId.get(clause.document_version_id) ?? null;
      // Documento nunca resolvido (não encontrado) continua passando —
      // vira "DESCONHECIDO"/"Documento não disponível" abaixo, mesmo
      // comportamento de sempre. SÓ um documento CONHECIDO e
      // explicitamente trashed é excluído aqui.
      return !documentId || nonTrashedDocumentIds.has(documentId);
    })
    .map((clause) => {
      const documentId = documentIdByVersionId.get(clause.document_version_id) ?? null;
      const document = documentId ? documentById.get(documentId) : undefined;

      const contractualLink: DocumentContractualLinkContextRow = {
        contractual_parent_document_id: document?.contractual_parent_document_id ?? null,
        contractual_incorporation_basis: document?.contractual_incorporation_basis ?? null,
        contractual_linked_by_user_id: document?.contractual_linked_by_user_id ?? null,
        contractual_linked_at: document?.contractual_linked_at ?? null,
      };

      return {
        id: clause.id,
        clauseNumber: clause.clause_number,
        title: clause.title,
        text: clause.text,
        documentId: documentId ?? "",
        documentKind: document?.kind ?? "DESCONHECIDO",
        documentTitle: document?.title ?? "Documento não disponível",
        relation,
        contractualLink: mapContractualLinkContext(contractualLink, parentById, parentCurrentVersionLabelById),
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
