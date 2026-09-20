import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ContextScheduleActivity,
  ContextScheduleContext,
  ContextScheduleRelation,
  ContextScheduleVersion,
} from "../../context/types";
import { withActiveDocumentFilter } from "../../../documents/active-document-filter";

type DocumentRow = {
  id: string;
  title: string;
  kind: string;
};

type DocumentVersionRow = {
  id: string;
  document_id: string;
  original_file_name: string | null;
  version_label: string | null;
  version_index: number;
  processing_status: string | null;
};

type ScheduleVersionRow = {
  id: string;
  document_version_id: string;
  version_type: string;
  extraction_status: string;
  extracted_at: string | null;
  status_date: string | null;
};

type ScheduleActivityRow = {
  id: string;
  schedule_version_id: string;
  name: string;
  baseline_start: string | null;
  baseline_end: string | null;
  planned_start: string | null;
  planned_end: string | null;
  status: string;
  external_task_id: string | null;
  unique_id: string | null;
  wbs: string | null;
  outline_level: number | null;
  parent_task_id: string | null;
  duration_value: number | string | null;
  duration_unit: string | null;
  total_float_value: number | string | null;
  total_float_unit: string | null;
  is_milestone: boolean | null;
  is_summary_task: boolean | null;
  is_critical: boolean | null;
  percent_complete: number | string | null;
  calendar_name: string | null;
};

type ScheduleRelationRow = {
  schedule_version_id: string;
  predecessor_task_id: string;
  successor_task_id: string;
  relation_type: string;
  lag_value: number | string;
  lag_unit: string;
};

function isMpp(fileName: string | null): boolean {
  return Boolean(fileName?.trim().toLowerCase().endsWith(".mpp"));
}

export async function loadExtractedScheduleContext(
  supabase: SupabaseClient,
  projectId: string
): Promise<ContextScheduleContext | null> {
  const { data: documentData, error: documentError } =
    await withActiveDocumentFilter((filterActive) => {
      let query = supabase
        .from("documents")
        .select("id,title,kind")
        .eq("project_id", projectId);

      if (filterActive) query = query.is("deleted_at", null);
      return query;
    });

  if (documentError) {
    throw new Error(
      `Falha ao carregar documentos de cronograma: ${documentError.message}`
    );
  }

  const documents = (documentData ?? []) as unknown as DocumentRow[];

  if (documents.length === 0) {
    return null;
  }

  const documentById = new Map(
    documents.map((document) => [document.id, document])
  );

  const { data: versionData, error: versionError } = await supabase
    .from("document_versions")
    .select(
      "id,document_id,original_file_name,version_label,version_index,processing_status"
    )
    .in(
      "document_id",
      documents.map((document) => document.id)
    )
    .order("version_index", { ascending: false });

  if (versionError) {
    throw new Error(
      `Falha ao carregar versoes de cronograma: ${versionError.message}`
    );
  }

  const versions = (versionData ?? []) as unknown as DocumentVersionRow[];

  const currentByDocumentId = new Map<string, DocumentVersionRow>();

  for (const version of versions) {
    if (!currentByDocumentId.has(version.document_id)) {
      currentByDocumentId.set(version.document_id, version);
    }
  }

  const currentMppVersions = Array.from(currentByDocumentId.values()).filter(
    (version) =>
      isMpp(version.original_file_name) &&
      version.processing_status === "PROCESSED"
  );

  if (currentMppVersions.length === 0) {
    return null;
  }

  const versionById = new Map(
    currentMppVersions.map((version) => [version.id, version])
  );

  const { data: scheduleData, error: scheduleError } = await supabase
    .from("schedule_versions")
    .select(
      "id,document_version_id,version_type,extraction_status,extracted_at,status_date"
    )
    .in(
      "document_version_id",
      currentMppVersions.map((version) => version.id)
    )
    .eq("extraction_status", "EXTRACTED");

  if (scheduleError) {
    throw new Error(
      `Falha ao carregar cronograma estruturado: ${scheduleError.message}`
    );
  }

  const scheduleVersions =
    (scheduleData ?? []) as unknown as ScheduleVersionRow[];

  if (scheduleVersions.length === 0) {
    return null;
  }

  const scheduleVersionIds = scheduleVersions.map((row) => row.id);

  const [activitiesResult, relationsResult] = await Promise.all([
    supabase
      .from("schedule_activities")
      .select(
        "id,schedule_version_id,name,baseline_start,baseline_end,planned_start,planned_end,status,external_task_id,unique_id,wbs,outline_level,parent_task_id,duration_value,duration_unit,total_float_value,total_float_unit,is_milestone,is_summary_task,is_critical,percent_complete,calendar_name"
      )
      .in("schedule_version_id", scheduleVersionIds),

    supabase
      .from("schedule_task_relations")
      .select(
        "schedule_version_id,predecessor_task_id,successor_task_id,relation_type,lag_value,lag_unit"
      )
      .in("schedule_version_id", scheduleVersionIds),
  ]);

  if (activitiesResult.error) {
    throw new Error(
      `Falha ao carregar atividades do cronograma: ${activitiesResult.error.message}`
    );
  }

  if (relationsResult.error) {
    throw new Error(
      `Falha ao carregar vinculos do cronograma: ${relationsResult.error.message}`
    );
  }

  const activities =
    (activitiesResult.data ?? []) as unknown as ScheduleActivityRow[];

  const relations =
    (relationsResult.data ?? []) as unknown as ScheduleRelationRow[];

  const activityById = new Map(activities.map((row) => [row.id, row]));

  const resultVersions: ContextScheduleVersion[] = scheduleVersions.map(
    (scheduleVersion) => {
      const documentVersion = versionById.get(
        scheduleVersion.document_version_id
      );

      if (!documentVersion) {
        throw new Error(
          `Document version ausente para schedule ${scheduleVersion.id}.`
        );
      }

      const document = documentById.get(documentVersion.document_id);

      if (!document) {
        throw new Error(
          `Documento ausente para schedule ${scheduleVersion.id}.`
        );
      }

      const versionActivities: ContextScheduleActivity[] = activities
        .filter(
          (activity) =>
            activity.schedule_version_id === scheduleVersion.id
        )
        .map((activity) => ({
          id: activity.id,
          externalTaskId: activity.external_task_id,
          uniqueId: activity.unique_id,
          wbs: activity.wbs,
          outlineLevel: activity.outline_level,
          parentTaskId: activity.parent_task_id,
          name: activity.name,
          baselineStart: activity.baseline_start,
          baselineEnd: activity.baseline_end,
          plannedStart: activity.planned_start,
          plannedEnd: activity.planned_end,
          durationValue: activity.duration_value,
          durationUnit: activity.duration_unit,
          totalFloatValue: activity.total_float_value,
          totalFloatUnit: activity.total_float_unit,
          percentComplete: activity.percent_complete,
          isMilestone: activity.is_milestone,
          isSummaryTask: activity.is_summary_task,
          isCritical: activity.is_critical,
          calendarName: activity.calendar_name,
          status: activity.status,
        }));

      const versionRelations: ContextScheduleRelation[] = relations
        .filter(
          (relation) =>
            relation.schedule_version_id === scheduleVersion.id
        )
        .map((relation) => {
          const predecessor = activityById.get(
            relation.predecessor_task_id
          );
          const successor = activityById.get(
            relation.successor_task_id
          );

          return {
            predecessorTaskId: relation.predecessor_task_id,
            predecessorUniqueId: predecessor?.unique_id ?? null,
            predecessorName: predecessor?.name ?? null,
            successorTaskId: relation.successor_task_id,
            successorUniqueId: successor?.unique_id ?? null,
            successorName: successor?.name ?? null,
            relationType: relation.relation_type,
            lagValue: relation.lag_value,
            lagUnit: relation.lag_unit,
          };
        });

      return {
        scheduleVersionId: scheduleVersion.id,
        documentId: document.id,
        documentTitle: document.title,
        documentKind: document.kind,
        documentVersionId: documentVersion.id,
        documentVersionLabel: documentVersion.version_label,
        fileName: documentVersion.original_file_name ?? "",
        versionType: scheduleVersion.version_type,
        extractedAt: scheduleVersion.extracted_at,
        statusDate: scheduleVersion.status_date,
        activities: versionActivities,
        relations: versionRelations,
      };
    }
  );

  return {
    sourceType: "MPP_STRUCTURED",
    versions: resultVersions,
  };
}
