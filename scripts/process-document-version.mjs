import { createClient } from "@supabase/supabase-js";
import { register } from "node:module";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  extractDocument,
} from "./document-extractors.mjs";

register("./ts-module-resolver.mjs", import.meta.url);

const { detectSourceLanguage } = await import(
  "../apps/web/lib/documents/detect-source-language"
);

const documentVersionId =
  process.argv[2];

if (!documentVersionId) {
  console.error("");
  console.error(
    "Uso:"
  );
  console.error(
    "node --env-file=apps/web/.env.local scripts/process-document-version.mjs <document-version-id>"
  );
  console.error("");

  process.exit(2);
}

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL;

const serviceKey =
  process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !serviceKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SECRET_KEY sao obrigatorios."
  );
}

const supabase = createClient(
  supabaseUrl,
  serviceKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

let extractionId = null;
let projectId = null;

async function writeAudit({
  action,
  entityId,
  detail,
}) {
  if (!projectId) {
    return;
  }

  const {
    error,
  } = await supabase
    .from("audit_log_entries")
    .insert({
      project_id: projectId,
      actor_type: "SYSTEM",
      actor_user_id: null,
      actor_label:
        null,
      action,
      entity_type:
        "DOCUMENT_VERSION",
      entity_id: entityId,
      detail,
    });

  if (error) {
    console.error(
      "Aviso: falha ao registrar auditoria:",
      error.message
    );
  }
}

async function failProcessing(
  error
) {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  if (extractionId) {
    await supabase
      .from("document_text_segments")
      .delete()
      .eq(
        "extraction_id",
        extractionId
      );

    await supabase
      .from("document_extractions")
      .update({
        status: "FAILED",
        text_content: null,
        page_count: null,
        character_count: null,
        error_message: message,
        completed_at:
          new Date().toISOString(),
      })
      .eq(
        "id",
        extractionId
      );
  }

  await supabase
    .from("document_versions")
    .update({
      processing_status: "FAILED",
      processing_error: message,
    })
    .eq(
      "id",
      documentVersionId
    );

  await writeAudit({
    action:
      "DOCUMENT_PROCESSING_FAILED",
    entityId:
      documentVersionId,
    detail:
      `Processamento documental falhou: ${message}`,
  });

  console.error("");
  console.error(
    "DOCUMENT PROCESSING: FAILED"
  );
  console.error(message);

  process.exit(1);
}

try {
  // ==========================================================
  // 1. DOCUMENT VERSION
  // ==========================================================

  const {
    data: version,
    error: versionError,
  } = await supabase
    .from("document_versions")
    .select(
      "id,document_id,file_path,storage_bucket,original_file_name,mime_type,processing_status"
    )
    .eq(
      "id",
      documentVersionId
    )
    .maybeSingle();

  if (versionError) {
    throw versionError;
  }

  if (!version) {
    throw new Error(
      "Document version nao encontrada."
    );
  }

  if (
    !version.file_path ||
    !version.storage_bucket ||
    !version.original_file_name
  ) {
    throw new Error(
      "Document version nao possui arquivo registrado."
    );
  }

  if (
    version.processing_status ===
    "PROCESSED"
  ) {
    console.log("");
    console.log(
      "DOCUMENT PROCESSING: ALREADY PROCESSED"
    );
    console.log(
      "Document version:",
      documentVersionId
    );
    process.exit(0);
  }


  // ==========================================================
  // 2. PROJECT
  // ==========================================================

  const {
    data: document,
    error: documentError,
  } = await supabase
    .from("documents")
    .select(
      "id,project_id,title,kind"
    )
    .eq(
      "id",
      version.document_id
    )
    .maybeSingle();

  if (documentError) {
    throw documentError;
  }

  if (!document) {
    throw new Error(
      "Documento pai nao encontrado."
    );
  }

  projectId =
    document.project_id;


  // ==========================================================
  // 3. START EXTRACTION
  // ==========================================================

  const {
    data: extraction,
    error: extractionError,
  } = await supabase
    .from("document_extractions")
    .insert({
      document_version_id:
        documentVersionId,
      extractor:
        "pending",
      extractor_version:
        "1",
      status:
        "PROCESSING",
    })
    .select("id")
    .single();

  if (extractionError) {
    throw extractionError;
  }

  extractionId =
    extraction.id;

  const {
    error: processingUpdateError,
  } = await supabase
    .from("document_versions")
    .update({
      processing_status:
        "PROCESSING",
      processing_error:
        null,
    })
    .eq(
      "id",
      documentVersionId
    );

  if (processingUpdateError) {
    throw processingUpdateError;
  }


  // ==========================================================
  // 4. DOWNLOAD PRIVATE FILE
  // ==========================================================

  console.log("");
  console.log(
    `Processando: ${version.original_file_name}`
  );

  const {
    data: fileBlob,
    error: downloadError,
  } = await supabase.storage
    .from(
      version.storage_bucket
    )
    .download(
      version.file_path
    );

  if (downloadError) {
    throw new Error(
      `Falha no download: ${downloadError.message}`
    );
  }

  if (!fileBlob) {
    throw new Error(
      "Storage retornou arquivo vazio."
    );
  }

  const arrayBuffer =
    await fileBlob.arrayBuffer();

  const buffer =
    Buffer.from(arrayBuffer);


  // ==========================================================
  // LEGACY_XLS_EXTRACTION
  // ==========================================================

  const isLegacyXls =
    version.mime_type === "application/vnd.ms-excel" ||
    version.original_file_name.toLowerCase().endsWith(".xls");

  let legacyXlsResult = null;

  if (isLegacyXls) {
    let tempDir = null;

    try {
      tempDir = mkdtempSync(join(tmpdir(), "acc-xls-"));

      const inputPath = join(tempDir, "source.xls");
      const outputPath = join(tempDir, "extracted.json");

      writeFileSync(inputPath, buffer);

      const extractorPath = join(process.cwd(), "scripts", "extract-xls.py");
      const python = spawnSync(
        "python",
        [extractorPath, inputPath, outputPath],
        {
          encoding: "utf8",
          windowsHide: true,
        }
      );

      if (python.error || python.status !== 0) {
        throw new Error(
          "Falha no extrator XLS: " +
          (
            python.stderr ||
            python.stdout ||
            python.error?.message ||
            "erro desconhecido"
          ).trim()
        );
      }

      legacyXlsResult = JSON.parse(readFileSync(outputPath, "utf8"));

      if (!legacyXlsResult.text || !Array.isArray(legacyXlsResult.segments)) {
        throw new Error("Extrator XLS retornou estrutura inválida.");
      }
    } finally {
      if (tempDir) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
  }


  // ==========================================================
  // ACC_MPP_STRUCTURED_EXTRACTION
  // ==========================================================

  const isMpp =
    version.mime_type ===
      "application/vnd.ms-project" ||
    version.original_file_name
      .toLowerCase()
      .endsWith(".mpp");

  if (isMpp) {
    let scheduleVersionId = null;
    let tempDir = null;

    try {
      tempDir =
        mkdtempSync(
          join(
            tmpdir(),
            "acc-mpp-"
          )
        );

      const inputPath =
        join(tempDir, "source.mpp");

      const outputPath =
        join(tempDir, "schedule.json");

      writeFileSync(
        inputPath,
        buffer
      );

      const extractorPath =
        join(
          process.cwd(),
          "scripts",
          "extract-mpp.py"
        );

      const python =
        spawnSync(
          "python",
          [
            extractorPath,
            inputPath,
            outputPath,
          ],
          {
            encoding: "utf8",
            windowsHide: true,
          }
        );

      if (
        python.error ||
        python.status !== 0
      ) {
        throw new Error(
          "Falha no extrator MPP: " +
          (
            python.stderr ||
            python.stdout ||
            python.error?.message ||
            "erro desconhecido"
          ).trim()
        );
      }

      const schedule =
        JSON.parse(
          readFileSync(
            outputPath,
            "utf8"
          )
        );

      if (
        !Array.isArray(
          schedule.activities
        ) ||
        !Array.isArray(
          schedule.relations
        )
      ) {
        throw new Error(
          "Extrator MPP retornou estrutura invalida."
        );
      }

      if (
        schedule.activities.length === 0
      ) {
        throw new Error(
          "MPP nao possui atividades utilizaveis."
        );
      }

      const relationTypes =
        new Set([
          "FS",
          "SS",
          "FF",
          "SF",
        ]);

      const uidSet =
        new Set(
          schedule.activities.map(
            (activity) =>
              activity.unique_id
          )
        );

      if (
        uidSet.size !==
        schedule.activities.length
      ) {
        throw new Error(
          "MPP contem unique_id duplicado."
        );
      }

      for (
        const activity
        of schedule.activities
      ) {
        if (
          activity.parent_unique_id !==
            null &&
          !uidSet.has(
            activity.parent_unique_id
          )
        ) {
          throw new Error(
            `Parent UID invalido: ${activity.parent_unique_id}`
          );
        }

        if (
          !activity.planned_start ||
          !activity.planned_end
        ) {
          throw new Error(
            `Atividade sem datas: ${activity.unique_id}`
          );
        }
      }

      for (
        const relation
        of schedule.relations
      ) {
        if (
          !uidSet.has(
            relation.predecessor_unique_id
          ) ||
          !uidSet.has(
            relation.successor_unique_id
          )
        ) {
          throw new Error(
            "Relacao MPP referencia tarefa inexistente."
          );
        }

        if (
          !relationTypes.has(
            relation.relation_type
          )
        ) {
          throw new Error(
            `Tipo de relacao MPP invalido: ${relation.relation_type}`
          );
        }

        if (
          relation.lag_value === null ||
          !relation.lag_unit
        ) {
          throw new Error(
            "Relacao MPP possui lag invalido."
          );
        }
      }

      const {
        error: deletePreviousError,
      } = await supabase
        .from("schedule_versions")
        .delete()
        .eq(
          "document_version_id",
          documentVersionId
        );

      if (deletePreviousError) {
        throw deletePreviousError;
      }

      scheduleVersionId =
        randomUUID();

      const scheduleVersionType =
        document.kind ===
          "CRONOGRAMA_REVISAO"
          ? "UPDATE"
          : "BASELINE";

      const {
        error: scheduleVersionError,
      } = await supabase
        .from("schedule_versions")
        .insert({
          id:
            scheduleVersionId,
          document_version_id:
            documentVersionId,
          version_type:
            scheduleVersionType,
          extraction_status:
            "PENDING",
          extraction_error:
            null,
          extracted_at:
            null,
        });

      if (scheduleVersionError) {
        throw scheduleVersionError;
      }

      const activityIds =
        new Map();

      for (
        const activity
        of schedule.activities
      ) {
        activityIds.set(
          activity.unique_id,
          randomUUID()
        );
      }

      const dateOnly =
        (value) =>
          String(value).slice(0, 10);

      const activityRows =
        schedule.activities.map(
          (activity) => ({
            id:
              activityIds.get(
                activity.unique_id
              ),

            schedule_version_id:
              scheduleVersionId,

            name:
              activity.name,

            baseline_start:
              dateOnly(
                activity.planned_start
              ),

            baseline_end:
              dateOnly(
                activity.planned_end
              ),

            planned_start:
              dateOnly(
                activity.planned_start
              ),

            planned_end:
              dateOnly(
                activity.planned_end
              ),

            status:
              Number(
                activity.percent_complete ??
                0
              ) >= 100
                ? "CONCLUIDA"
                : "NO_PRAZO",

            external_task_id:
              activity.external_task_id,

            unique_id:
              activity.unique_id,

            wbs:
              activity.wbs,

            outline_level:
              activity.outline_level,

            parent_task_id:
              activity.parent_unique_id
                ? activityIds.get(
                    activity.parent_unique_id
                  )
                : null,

            duration_value:
              activity.duration_value,

            duration_unit:
              activity.duration_unit,

            percent_complete:
              activity.percent_complete,

            is_milestone:
              activity.is_milestone,

            is_summary_task:
              activity.is_summary_task,

            is_critical:
              activity.is_critical,
          })
        );

      const {
        error: activitiesError,
      } = await supabase
        .from("schedule_activities")
        .insert(activityRows);

      if (activitiesError) {
        throw activitiesError;
      }

      const relationRows =
        schedule.relations.map(
          (relation) => ({
            schedule_version_id:
              scheduleVersionId,

            predecessor_task_id:
              activityIds.get(
                relation.predecessor_unique_id
              ),

            successor_task_id:
              activityIds.get(
                relation.successor_unique_id
              ),

            relation_type:
              relation.relation_type,

            lag_value:
              relation.lag_value,

            lag_unit:
              relation.lag_unit,
          })
        );

      if (
        relationRows.length > 0
      ) {
        const {
          error: relationsError,
        } = await supabase
          .from(
            "schedule_task_relations"
          )
          .insert(relationRows);

        if (relationsError) {
          throw relationsError;
        }
      }

      const completedAt =
        new Date().toISOString();

      const {
        error: scheduleCompleteError,
      } = await supabase
        .from("schedule_versions")
        .update({
          extraction_status:
            "EXTRACTED",
          extraction_error:
            null,
          extracted_at:
            completedAt,
        })
        .eq(
          "id",
          scheduleVersionId
        );

      if (scheduleCompleteError) {
        throw scheduleCompleteError;
      }

      const {
        error: extractionCompleteError,
      } = await supabase
        .from("document_extractions")
        .update({
          extractor:
            "mpxj",
          extractor_version:
            "16.7.0",
          status:
            "PROCESSED",
          text_content:
            null,
          page_count:
            null,
          character_count:
            null,
          error_message:
            null,
          completed_at:
            completedAt,
        })
        .eq(
          "id",
          extractionId
        );

      if (extractionCompleteError) {
        throw extractionCompleteError;
      }

      const {
        error: versionCompleteError,
      } = await supabase
        .from("document_versions")
        .update({
          processing_status:
            "PROCESSED",
          processing_error:
            null,
        })
        .eq(
          "id",
          documentVersionId
        );

      if (versionCompleteError) {
        throw versionCompleteError;
      }

      await writeAudit({
        action:
          "DOCUMENT_PROCESSING_COMPLETED",

        entityId:
          documentVersionId,

        detail:
          `Cronograma MPP "${document.title}" processado por MPXJ. ` +
          `${schedule.activities.length} atividades e ` +
          `${schedule.relations.length} relacoes extraidas.`,
      });

      console.log("");
      console.log(
        "================================"
      );
      console.log(
        "MPP PROCESSING: OK"
      );
      console.log(
        "================================"
      );
      console.log(
        "Document version:",
        documentVersionId
      );
      console.log(
        "Activities:",
        schedule.activities.length
      );
      console.log(
        "Relations:",
        schedule.relations.length
      );
      console.log(
        "Schedule version:",
        scheduleVersionId
      );

      rmSync(
        tempDir,
        {
          recursive: true,
          force: true,
        }
      );

      process.exit(0);

    } catch (mppError) {
      if (
        scheduleVersionId
      ) {
        await supabase
          .from(
            "schedule_versions"
          )
          .delete()
          .eq(
            "id",
            scheduleVersionId
          );
      }

      if (tempDir) {
        rmSync(
          tempDir,
          {
            recursive: true,
            force: true,
          }
        );
      }

      throw mppError;
    }
  }


  // ==========================================================
  // 5. EXTRACTION
  // ==========================================================

  const result =
    legacyXlsResult ??
    await extractDocument({
      buffer,
      mimeType:
        version.mime_type,
      fileName:
        version.original_file_name,
    });

  if (
    !result.text ||
    result.text.trim().length === 0
  ) {
    throw new Error(
      "O extrator nao encontrou texto utilizavel no documento."
    );
  }


  // ==========================================================
  // 6. SEGMENTS
  // ==========================================================

  const canonicalText =
    result.segments
      .map((segment) => segment.text)
      .join("\n\n");

  const detectedLanguage =
    detectSourceLanguage(canonicalText);

  let characterCursor = 0;

  const segments =
    result.segments.map(
      (
        segment,
        index
      ) => {
        const text =
          segment.text;

        const characterStart =
          characterCursor;

        const characterEnd =
          characterStart +
          text.length;

        characterCursor =
          characterEnd + 2;

        return {
          extraction_id:
            extractionId,
          segment_index:
            index,
          page_number:
            segment.pageNumber,
          locator:
            segment.locator,
          text_content:
            text,
          character_start:
            characterStart,
          character_end:
            characterEnd,
        };
      }
    );

  if (
    segments.length === 0
  ) {
    throw new Error(
      "Nenhum segmento textual foi produzido."
    );
  }

  const BATCH_SIZE = 200;

  for (
    let offset = 0;
    offset < segments.length;
    offset += BATCH_SIZE
  ) {
    const batch =
      segments.slice(
        offset,
        offset + BATCH_SIZE
      );

    const {
      error: segmentError,
    } = await supabase
      .from(
        "document_text_segments"
      )
      .insert(batch);

    if (segmentError) {
      throw segmentError;
    }
  }


  // ==========================================================
  // 7. COMPLETE EXTRACTION
  // ==========================================================

  const completedAt =
    new Date().toISOString();

  const {
    error: completeExtractionError,
  } = await supabase
    .from("document_extractions")
    .update({
      extractor:
        result.extractor,
      extractor_version:
        result.extractorVersion,
      status:
        "PROCESSED",
      text_content:
        canonicalText,
      page_count:
        result.pageCount,
      character_count:
        canonicalText.length,
      error_message:
        null,
      completed_at:
        completedAt,
    })
    .eq(
      "id",
      extractionId
    );

  if (completeExtractionError) {
    throw completeExtractionError;
  }

  const {
    error: completeVersionError,
  } = await supabase
    .from("document_versions")
    .update({
      processing_status:
        "PROCESSED",
      processing_error:
        null,
      source_language:
        detectedLanguage.code,
    })
    .eq(
      "id",
      documentVersionId
    );

  if (completeVersionError) {
    throw completeVersionError;
  }


  // ==========================================================
  // 8. AUDIT
  // ==========================================================

  await writeAudit({
    action:
      "DOCUMENT_PROCESSING_COMPLETED",
    entityId:
      documentVersionId,
    detail:
      `Documento "${document.title}" processado por ${result.extractor}. ` +
      `${canonicalText.length} caracteres, ${segments.length} segmentos.`,
  });


  // ==========================================================
  // 9. RESULT
  // ==========================================================

  console.log("");
  console.log(
    "================================"
  );
  console.log(
    "DOCUMENT PROCESSING: OK"
  );
  console.log(
    "================================"
  );

  console.log(
    "Document version:",
    documentVersionId
  );

  console.log(
    "Extractor:",
    result.extractor
  );

  console.log(
    "Characters:",
    canonicalText.length
  );

  console.log(
    "Segments:",
    segments.length
  );

  console.log(
    "Source language:",
    detectedLanguage.code ??
      `indeterminado (detector: ${detectedLanguage.detectorCode})`
  );

  console.log(
    "Pages:",
    result.pageCount ?? "N/A"
  );

} catch (error) {
  await failProcessing(
    error
  );
}
