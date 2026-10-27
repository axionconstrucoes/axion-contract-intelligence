"use server";

import { createSupabaseServerClient } from "@axion/db/server";
import { normalizeExtractedText } from "@/lib/documents/extraction/repair-font-encoding";

export interface TimelineArchiveHit {
  id: string;
  kind:
    | "EMAIL"
    | "ANEXO_EMAIL"
    | "DOCUMENTO"
    | "TEXTO_DOCUMENTO"
    | "CONSTRUMANAGER"
    | "DIARIO_OBRA"
    | "RELATORIO_SEMANAL"
    | "EVENTO"
    | "ANOTACAO";
  sourceType: string;
  date: string;
  title: string;
  detail: string;
  matchedIn: string;
  href: string;
}

export interface TimelineArchiveSearchResult {
  ok: boolean;
  hits: TimelineArchiveHit[];
  scannedCount: number;
  error: string | null;
}

export interface TimelineArchiveSearchInput {
  projectId: string;
  query: string;
  dateFrom: string | null;
  dateTo: string | null;
  sources: string[];
  categories: string[];
  participants: string[];
}

function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

function termsFromQuery(query: string): string[] {
  return normalize(query)
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function matchesTerms(value: unknown, terms: string[]): boolean {
  const normalized = normalize(value);
  return terms.every((term) => normalized.includes(term));
}

function dateOnly(value: unknown): string {
  return String(value ?? "").slice(0, 10);
}

function inPeriod(
  value: unknown,
  dateFrom: string | null,
  dateTo: string | null
): boolean {
  const date = dateOnly(value);

  if (!date) return true;
  if (dateFrom && date < dateFrom) return false;
  if (dateTo && date > dateTo) return false;

  return true;
}

function snippet(value: unknown, terms: string[]): string {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();

  if (!raw) return "";

  const normalized = normalize(raw);
  let index = -1;

  for (const term of terms) {
    const current = normalized.indexOf(term);
    if (current >= 0 && (index < 0 || current < index)) {
      index = current;
    }
  }

  if (index < 0) return raw.slice(0, 320);

  const start = Math.max(0, index - 100);
  const end = Math.min(raw.length, index + 240);

  return `${start > 0 ? "…" : ""}${raw.slice(start, end)}${
    end < raw.length ? "…" : ""
  }`;
}

function sourceAllowed(source: string, sources: string[]): boolean {
  return sources.length === 0 || sources.includes(source);
}

function participantAllowed(
  from: unknown,
  to: unknown,
  participants: string[]
): boolean {
  if (participants.length === 0) return true;

  const haystack = normalize(`${from ?? ""} ${to ?? ""}`);

  return participants.some((participant) =>
    haystack.includes(normalize(participant))
  );
}

export async function searchTimelineArchive(
  input: TimelineArchiveSearchInput
): Promise<TimelineArchiveSearchResult> {
  const query = input.query.trim();

  if (!query) {
    return {
      ok: true,
      hits: [],
      scannedCount: 0,
      error: null,
    };
  }

  const terms = termsFromQuery(query);

  if (terms.length === 0) {
    return {
      ok: true,
      hits: [],
      scannedCount: 0,
      error: null,
    };
  }

  const supabase = await createSupabaseServerClient();

  const { data: authData } = await supabase.auth.getUser();

  if (!authData.user) {
    return {
      ok: false,
      hits: [],
      scannedCount: 0,
      error: "Usuário não autenticado.",
    };
  }

  const [
    emailsResult,
    attachmentsResult,
    documentsResult,
    cmResult,
    rdoResult,
    weeklyResult,
    eventsResult,
  ] = await Promise.all([
    supabase
      .from("emails")
      .select(
        "id,from_address,to_address,subject,sent_at,snippet,body_text,body_html"
      )
      .eq("project_id", input.projectId)
      .eq("project_scope_status", "IN_SCOPE"),

    supabase
      .from("email_attachments")
      .select(
        "id,email_id,original_file_name,mime_type,received_at,ingested_at,processing_status"
      )
      .eq("project_id", input.projectId),

    supabase
      .from("documents")
      .select("id,title,kind,created_at")
      .eq("project_id", input.projectId)
      .is("deleted_at", null),

    supabase
      .from("construmanager_documents")
      .select(
        "id,name,extension,revision,author_name,folder_path,status_label,source_created_at,source_approved_at,first_seen_at"
      )
      .eq("project_id", input.projectId),

    supabase
      .from("diario_de_obra_reports")
      .select(
        "id,report_number,reference_date,weekday,status_label,activities,occurrences,comments,materials,labor,equipment,checklist"
      )
      .eq("project_id", input.projectId),

    supabase
      .from("weekly_report_sheets")
      .select(
        "id,category,status,original_sheet_name,cutoff_date,data,metrics,cross_check,risk_reasons,alerts,created_at"
      )
      .eq("project_id", input.projectId),

    supabase
      .from("contract_events")
      .select(
        "id,occurred_at,title,description,source_type,status"
      )
      .eq("project_id", input.projectId),
  ]);

  const firstError =
    emailsResult.error ??
    attachmentsResult.error ??
    documentsResult.error ??
    cmResult.error ??
    rdoResult.error ??
    weeklyResult.error ??
    eventsResult.error;

  if (firstError) {
    return {
      ok: false,
      hits: [],
      scannedCount: 0,
      error: firstError.message,
    };
  }

  const inScopeEmailIds =
    new Set((emailsResult.data ?? []).map((row) => row.id));

  const documents = documentsResult.data ?? [];
  const documentIds = documents.map((row) => row.id);

  const events = eventsResult.data ?? [];
  const eventIds = events.map((row) => row.id);

  const [versionsResult, categoriesResult, notesResult] =
    await Promise.all([
      documentIds.length > 0
        ? supabase
            .from("document_versions")
            .select(
              "id,document_id,version_label,document_date,source_type,author,summary,notes,original_file_name,uploaded_at,processing_status"
            )
            .in("document_id", documentIds)
        : Promise.resolve({ data: [], error: null }),

      eventIds.length > 0
        ? supabase
            .from("event_categories")
            .select("event_id,category")
            .in("event_id", eventIds)
        : Promise.resolve({ data: [], error: null }),

      eventIds.length > 0
        ? supabase
            .from("event_notes")
            .select("id,event_id,category,text,created_at")
            .in("event_id", eventIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

  if (versionsResult.error || categoriesResult.error || notesResult.error) {
    return {
      ok: false,
      hits: [],
      scannedCount: 0,
      error:
        versionsResult.error?.message ??
        categoriesResult.error?.message ??
        notesResult.error?.message ??
        "Falha na busca.",
    };
  }

  const versions = versionsResult.data ?? [];
  const versionIds = versions.map((row) => row.id);

  const extractionResult =
    versionIds.length > 0
      ? await supabase
          .from("document_extractions")
          .select(
            "id,document_version_id,status,text_content,error_message,completed_at,created_at"
          )
          .in("document_version_id", versionIds)
      : { data: [], error: null };

  if (extractionResult.error) {
    return {
      ok: false,
      hits: [],
      scannedCount: 0,
      error: extractionResult.error.message,
    };
  }

  const hits: TimelineArchiveHit[] = [];

  const documentById = new Map(
    documents.map((row) => [row.id, row])
  );

  const versionById = new Map(
    versions.map((row) => [row.id, row])
  );

  const eventById = new Map(
    events.map((row) => [row.id, row])
  );

  const categoriesByEventId = new Map<string, string[]>();

  for (const row of categoriesResult.data ?? []) {
    const list = categoriesByEventId.get(row.event_id) ?? [];
    list.push(row.category);
    categoriesByEventId.set(row.event_id, list);
  }

  // ----------------------------------------------------------
  // E-MAILS
  // ----------------------------------------------------------

  for (const email of emailsResult.data ?? []) {
    if (!sourceAllowed("EMAIL", input.sources)) continue;
    if (!inPeriod(email.sent_at, input.dateFrom, input.dateTo)) continue;

    if (
      !participantAllowed(
        email.from_address,
        email.to_address,
        input.participants
      )
    ) {
      continue;
    }

    const searchable = [
      email.subject,
      email.snippet,
      email.body_text,
      email.body_html,
      email.from_address,
      email.to_address,
    ].join(" ");

    if (!matchesTerms(searchable, terms)) continue;

    hits.push({
      id: `email:${email.id}`,
      kind: "EMAIL",
      sourceType: "EMAIL",
      date: email.sent_at,
      title: email.subject || "(E-mail sem assunto)",
      detail: snippet(
        email.body_text ??
        email.snippet ??
        email.body_html,
        terms
      ),
      matchedIn: "E-mail",
      href: `/${input.projectId}/documentos/emails/${email.id}`,
    });
  }

  // ----------------------------------------------------------
  // ANEXOS DE E-MAIL
  // ----------------------------------------------------------

  for (const attachment of attachmentsResult.data ?? []) {
    if (!inScopeEmailIds.has(attachment.email_id)) continue;
    if (!sourceAllowed("EMAIL", input.sources)) continue;

    const date =
      attachment.received_at ??
      attachment.ingested_at ??
      "";

    if (!inPeriod(date, input.dateFrom, input.dateTo)) continue;

    const searchable = [
      attachment.original_file_name,
      attachment.mime_type,
      attachment.processing_status,
    ].join(" ");

    if (!matchesTerms(searchable, terms)) continue;

    hits.push({
      id: `attachment:${attachment.id}`,
      kind: "ANEXO_EMAIL",
      sourceType: "EMAIL",
      date,
      title:
        attachment.original_file_name ||
        "Anexo de e-mail",
      detail: `Anexo de e-mail · ${attachment.mime_type ?? "tipo não informado"}`,
      matchedIn: "Nome do anexo",
      href: `/${input.projectId}/documentos/emails/${attachment.email_id}/anexos/${attachment.id}`,
    });
  }

  // ----------------------------------------------------------
  // DOCUMENTOS E VERSÕES
  // ----------------------------------------------------------

  for (const version of versions) {
    const document = documentById.get(version.document_id);

    if (!document) continue;

    const sourceType = String(
      version.source_type ?? "CONTRATO"
    );

    if (!sourceAllowed(sourceType, input.sources)) continue;

    const date =
      version.document_date ??
      version.uploaded_at ??
      document.created_at;

    if (!inPeriod(date, input.dateFrom, input.dateTo)) continue;

    const searchable = [
      document.title,
      document.kind,
      version.version_label,
      version.author,
      version.summary,
      version.notes,
      version.original_file_name,
    ].join(" ");

    if (!matchesTerms(searchable, terms)) continue;

    hits.push({
      id: `document:${version.id}`,
      kind: "DOCUMENTO",
      sourceType,
      date,
      title: document.title,
      detail: snippet(
        `${version.original_file_name ?? ""} ${version.summary ?? ""} ${version.notes ?? ""}`,
        terms
      ),
      matchedIn: "Documento / metadados",
      href: `/${input.projectId}/documentos/versoes/${version.id}`,
    });
  }

  // ----------------------------------------------------------
  // TEXTO INTEGRAL EXTRAÍDO DOS DOCUMENTOS
  // ----------------------------------------------------------

  // Uma versão pode ter várias extrações (reprocessamento — ex.: OCR):
  // as anteriores ficam como histórico. A busca usa só a PROCESSED mais
  // recente de cada versão, para nunca devolver o mesmo trecho duas vezes.
  const latestExtractionByVersion = new Map<string, NonNullable<typeof extractionResult.data>[number]>();
  for (const extraction of extractionResult.data ?? []) {
    if (extraction.status !== "PROCESSED") continue;
    const current = latestExtractionByVersion.get(extraction.document_version_id);
    const stamp = extraction.completed_at ?? extraction.created_at;
    if (!current || stamp > (current.completed_at ?? current.created_at)) {
      latestExtractionByVersion.set(extraction.document_version_id, extraction);
    }
  }

  for (const extraction of latestExtractionByVersion.values()) {
    const version = versionById.get(
      extraction.document_version_id
    );

    if (!version) continue;

    const document = documentById.get(version.document_id);

    if (!document) continue;

    const sourceType = String(
      version.source_type ?? "CONTRATO"
    );

    if (!sourceAllowed(sourceType, input.sources)) continue;

    const date =
      version.document_date ??
      extraction.completed_at ??
      extraction.created_at;

    if (!inPeriod(date, input.dateFrom, input.dateTo)) continue;

    // Busca na camada normalizada (codificação de fonte corrigida, ex.:
    // "execuÁ„o" → "execução"); o texto armazenado não é alterado.
    const searchableText = normalizeExtractedText(extraction.text_content ?? "").text;

    if (!matchesTerms(searchableText, terms)) continue;

    // Extração com cobertura parcial: o resultado nunca é apresentado
    // como busca no documento inteiro.
    const partialCoverage = String(extraction.error_message ?? "").startsWith("COBERTURA PARCIAL");

    hits.push({
      id: `extraction:${extraction.id}`,
      kind: "TEXTO_DOCUMENTO",
      sourceType,
      date,
      title: document.title,
      detail: snippet(searchableText, terms),
      matchedIn: partialCoverage
        ? "Conteúdo extraído do documento (leitura parcial — há páginas não lidas)"
        : "Conteúdo extraído do documento",
      href: `/${input.projectId}/documentos/versoes/${version.id}`,
    });
  }

  // ----------------------------------------------------------
  // CONSTRUMANAGER
  // ----------------------------------------------------------

  for (const row of cmResult.data ?? []) {
    if (!sourceAllowed("CONSTRUMANAGER", input.sources)) continue;

    const date =
      row.source_created_at ??
      row.source_approved_at ??
      row.first_seen_at ??
      "";

    if (!inPeriod(date, input.dateFrom, input.dateTo)) continue;

    const searchable = [
      row.name,
      row.extension,
      row.revision,
      row.author_name,
      row.folder_path,
      row.status_label,
    ].join(" ");

    if (!matchesTerms(searchable, terms)) continue;

    hits.push({
      id: `cm:${row.id}`,
      kind: "CONSTRUMANAGER",
      sourceType: "CONSTRUMANAGER",
      date,
      title: row.name,
      detail: snippet(
        `${row.folder_path ?? ""} ${row.revision ?? ""} ${row.author_name ?? ""}`,
        terms
      ),
      matchedIn: "Construmanager",
      href: `/${input.projectId}/integracoes`,
    });
  }

  // ----------------------------------------------------------
  // DIÁRIO DE OBRA
  // ----------------------------------------------------------

  for (const row of rdoResult.data ?? []) {
    if (!sourceAllowed("DIARIO_OBRA", input.sources)) continue;

    const date = row.reference_date ?? "";

    if (!inPeriod(date, input.dateFrom, input.dateTo)) continue;

    const searchable = JSON.stringify({
      activities: row.activities,
      occurrences: row.occurrences,
      comments: row.comments,
      materials: row.materials,
      labor: row.labor,
      equipment: row.equipment,
      checklist: row.checklist,
    });

    if (!matchesTerms(searchable, terms)) continue;

    hits.push({
      id: `rdo:${row.id}`,
      kind: "DIARIO_OBRA",
      sourceType: "DIARIO_OBRA",
      date,
      title: `Diário de Obra ${row.report_number ?? ""}`.trim(),
      detail: snippet(searchable, terms),
      matchedIn: "Diário de Obra",
      href: `/${input.projectId}/integracoes`,
    });
  }

  // ----------------------------------------------------------
  // RELATÓRIO SEMANAL
  // ----------------------------------------------------------

  for (const row of weeklyResult.data ?? []) {
    if (!sourceAllowed("RELATORIO_SEMANAL", input.sources)) continue;

    const date = row.cutoff_date ?? row.created_at ?? "";

    if (!inPeriod(date, input.dateFrom, input.dateTo)) continue;

    const searchable = [
      row.original_sheet_name,
      row.category,
      JSON.stringify(row.data ?? {}),
      JSON.stringify(row.metrics ?? {}),
      JSON.stringify(row.cross_check ?? {}),
      JSON.stringify(row.risk_reasons ?? {}),
      JSON.stringify(row.alerts ?? {}),
    ].join(" ");

    if (!matchesTerms(searchable, terms)) continue;

    hits.push({
      id: `weekly:${row.id}`,
      kind: "RELATORIO_SEMANAL",
      sourceType: "RELATORIO_SEMANAL",
      date,
      title:
        row.original_sheet_name ||
        `Relatório semanal — ${row.category}`,
      detail: snippet(searchable, terms),
      matchedIn: "Relatório Semanal",
      href: `/${input.projectId}/dashboard`,
    });
  }

  // ----------------------------------------------------------
  // EVENTOS
  // ----------------------------------------------------------

  for (const event of events) {
    const sourceType = String(event.source_type ?? "CONTRATO");

    if (!sourceAllowed(sourceType, input.sources)) continue;
    if (!inPeriod(event.occurred_at, input.dateFrom, input.dateTo)) continue;

    const categories =
      categoriesByEventId.get(event.id) ?? [];

    if (
      input.categories.length > 0 &&
      !categories.some((category) =>
        input.categories.includes(category)
      )
    ) {
      continue;
    }

    const searchable = [
      event.title,
      event.description,
      event.status,
      categories.join(" "),
    ].join(" ");

    if (!matchesTerms(searchable, terms)) continue;

    hits.push({
      id: `event:${event.id}`,
      kind: "EVENTO",
      sourceType,
      date: event.occurred_at,
      title: event.title,
      detail: snippet(event.description, terms),
      matchedIn: "Evento consolidado",
      href: `/${input.projectId}/ledger/${event.id}`,
    });
  }

  // ----------------------------------------------------------
  // ANOTAÇÕES DOS EVENTOS
  // ----------------------------------------------------------

  for (const note of notesResult.data ?? []) {
    const event = eventById.get(note.event_id);

    if (!event) continue;

    const sourceType = String(event.source_type ?? "CONTRATO");

    if (!sourceAllowed(sourceType, input.sources)) continue;
    if (!inPeriod(note.created_at, input.dateFrom, input.dateTo)) continue;

    const categories =
      categoriesByEventId.get(event.id) ?? [];

    if (
      input.categories.length > 0 &&
      !categories.some((category) =>
        input.categories.includes(category)
      )
    ) {
      continue;
    }

    const searchable = [
      note.category,
      note.text,
      event.title,
    ].join(" ");

    if (!matchesTerms(searchable, terms)) continue;

    hits.push({
      id: `note:${note.id}`,
      kind: "ANOTACAO",
      sourceType,
      date: note.created_at,
      title: event.title,
      detail: snippet(note.text, terms),
      matchedIn: "Anotação de evento",
      href: `/${input.projectId}/ledger/${event.id}`,
    });
  }

  hits.sort((a, b) =>
    String(a.date).localeCompare(String(b.date))
  );

  const scannedCount =
    (emailsResult.data?.length ?? 0) +
    (attachmentsResult.data?.length ?? 0) +
    documents.length +
    versions.length +
    (extractionResult.data?.length ?? 0) +
    (cmResult.data?.length ?? 0) +
    (rdoResult.data?.length ?? 0) +
    (weeklyResult.data?.length ?? 0) +
    events.length +
    (notesResult.data?.length ?? 0);

  return {
    ok: true,
    hits,
    scannedCount,
    error: null,
  };
}
