import type {
  AiAssessment,
  AiFindingType,
  AlertSeverity,
  ContractEvent,
  CrossReference,
  CrossReferenceKind,
  CrossReferenceType,
  EventStatus,
  EvidenceRef,
  ImplicationCategory,
  SourceType,
} from "@axion/types";

export type ContractEventRow = {
  id: string;
  project_id: string;
  occurred_at: string;
  title: string;
  description: string;
  source_type: SourceType;
  status: EventStatus;
  created_by_type: "SYSTEM" | "USER" | "LEGACY";
  created_by_user_id: string | null;
  created_by_label: string | null;
  created_at: string;
};

export type EventCategoryRow = {
  event_id: string;
  category: ImplicationCategory;
};

export type EventEvidenceRow = {
  id: string;
  event_id: string;
  source_type: SourceType;
  label: string;
  locator: string;
  document_version_id: string | null;
  email_id: string | null;
  created_at: string;
};

export type EventAiAssessmentRow = {
  id: string;
  event_id: string;
  finding_type: AiFindingType;
  severity: AlertSeverity;
  summary: string;
  confidence: number;
  requires_human_review: boolean;
  created_at: string;
};

export type EventCrossReferenceRow = {
  id: string;
  event_id: string;
  kind: CrossReferenceKind;
  document_id: string | null;
  clause_id: string | null;
  schedule_activity_id: string | null;
  email_id: string | null;
  note: string;
  created_at: string;
};

function resolveCreatedBy(row: ContractEventRow): {
  createdBy: string;
  createdByType: "SYSTEM" | "USER" | "LEGACY";
} {
  if (row.created_by_type === "SYSTEM") {
    if (row.created_by_user_id !== null || row.created_by_label !== null) {
      throw new Error(
        `Inconsistência estrutural: contract_event (id=${row.id}) created_by_type=SYSTEM mas possui created_by_user_id/created_by_label preenchido.`
      );
    }
    return { createdBy: "sistema", createdByType: "SYSTEM" };
  }

  if (row.created_by_type === "USER") {
    if (!row.created_by_user_id || row.created_by_label !== null) {
      throw new Error(
        `Inconsistência estrutural: contract_event (id=${row.id}) created_by_type=USER requer created_by_user_id preenchido e created_by_label nulo.`
      );
    }
    return { createdBy: row.created_by_user_id, createdByType: "USER" };
  }

  if (row.created_by_type === "LEGACY") {
    if (!row.created_by_label || row.created_by_user_id !== null) {
      throw new Error(
        `Inconsistência estrutural: contract_event (id=${row.id}) created_by_type=LEGACY requer created_by_label preenchido e created_by_user_id nulo.`
      );
    }
    return { createdBy: row.created_by_label, createdByType: "LEGACY" };
  }

  throw new Error(
    `Inconsistência estrutural: contract_event (id=${row.id}) possui created_by_type desconhecido: ${row.created_by_type}.`
  );
}

function mapEvidence(rows: EventEvidenceRow[]): EvidenceRef[] {
  // Ordenação determinística: created_at ASC e, em empate, id ASC. documentId
  // nunca é preenchido a partir de document_version_id — permanece somente
  // como campo de compatibilidade dos mocks antigos (ver EvidenceRef).
  const sorted = [...rows].sort((a, b) => {
    const byCreatedAt = a.created_at.localeCompare(b.created_at);
    return byCreatedAt !== 0 ? byCreatedAt : a.id.localeCompare(b.id);
  });

  return sorted.map((row) => {
    const evidence: EvidenceRef = {
      id: row.id,
      sourceType: row.source_type,
      label: row.label,
      locator: row.locator,
    };
    if (row.document_version_id) {
      evidence.documentVersionId = row.document_version_id;
    }
    if (row.email_id) {
      evidence.emailId = row.email_id;
    }
    return evidence;
  });
}

function mapAiAssessment(rows: EventAiAssessmentRow[], eventId: string): AiAssessment | null {
  if (rows.length === 0) {
    return null;
  }
  if (rows.length > 1) {
    throw new Error(
      `Inconsistência estrutural: contract_event (id=${eventId}) possui ${rows.length} event_ai_assessments; esperado no máximo 1.`
    );
  }
  const row = rows[0];
  return {
    findingType: row.finding_type,
    severity: row.severity,
    summary: row.summary,
    confidence: row.confidence,
    requiresHumanReview: true,
  };
}

function mapCrossReferences(rows: EventCrossReferenceRow[]): CrossReference[] {
  return rows.map((row) => {
    const candidates: { refType: CrossReferenceType; refId: string | null }[] = [
      { refType: "DOCUMENT", refId: row.document_id },
      { refType: "CLAUSE", refId: row.clause_id },
      { refType: "SCHEDULE_ACTIVITY", refId: row.schedule_activity_id },
      { refType: "EMAIL", refId: row.email_id },
    ];
    const filled = candidates.filter((c): c is { refType: CrossReferenceType; refId: string } => c.refId !== null);

    if (filled.length !== 1) {
      throw new Error(
        `Inconsistência estrutural: event_cross_reference (id=${row.id}) possui ${filled.length} FKs preenchidas; esperado exatamente 1.`
      );
    }

    return {
      kind: row.kind,
      refType: filled[0].refType,
      refId: filled[0].refId,
      note: row.note,
    };
  });
}

export function mapContractEventRow(
  row: ContractEventRow,
  categoryRows: EventCategoryRow[],
  evidenceRows: EventEvidenceRow[],
  aiAssessmentRows: EventAiAssessmentRow[],
  crossReferenceRows: EventCrossReferenceRow[]
): ContractEvent {
  const { createdBy, createdByType } = resolveCreatedBy(row);

  return {
    id: row.id,
    projectId: row.project_id,
    timestamp: row.occurred_at,
    title: row.title,
    description: row.description,
    sourceType: row.source_type,
    evidence: mapEvidence(evidenceRows),
    categories: categoryRows.map((c) => c.category),
    status: row.status,
    crossReferences: mapCrossReferences(crossReferenceRows),
    aiAssessment: mapAiAssessment(aiAssessmentRows, row.id),
    createdBy,
    createdByType,
  };
}
