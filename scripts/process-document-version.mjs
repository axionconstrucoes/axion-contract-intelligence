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
import {
  analyzePdfPagesWithOcr,
  formatPageRanges,
  OCR_ENGINE,
  OCR_ENGINE_VERSION,
  OCR_LANGUAGE,
  PENDING_STATUSES,
} from "./lib/pdf-ocr.mjs";

register("./ts-module-resolver.mjs", import.meta.url);

const { detectSourceLanguage } = await import(
  "../apps/web/lib/documents/detect-source-language"
);

// --reprocess: reprocessa uma versão JÁ PROCESSED (ex.: depois de
// habilitar OCR). Cria uma NOVA extração; as anteriores ficam
// preservadas como histórico (consumidores usam sempre a mais recente).
const reprocess =
  process.argv.includes("--reprocess");

const documentVersionId =
  process.argv.slice(2).find((arg) => !arg.startsWith("--"));

// Só vira true depois de confirmado que a versão estava PROCESSED —
// uma falha no reprocessamento devolve a versão a PROCESSED (a extração
// anterior continua válida), nunca a deixa FAILED.
let reprocessArmed = false;
let previousExtractionIds = [];

if (!documentVersionId) {
  console.error("");
  console.error(
    "Uso:"
  );
  console.error(
    "node --env-file=apps/web/.env.local scripts/process-document-version.mjs <document-version-id> [--reprocess]"
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
    .update(
      reprocessArmed
        ? { processing_status: "PROCESSED", processing_error: null }
        : { processing_status: "FAILED", processing_error: message }
    )
    .eq(
      "id",
      documentVersionId
    );

  await writeAudit({
    action:
      reprocessArmed
        ? "DOCUMENT_REPROCESSING_FAILED"
        : "DOCUMENT_PROCESSING_FAILED",
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

  if (reprocess) {
    if (version.processing_status !== "PROCESSED") {
      throw new Error(
        `Reprocessamento exige versao PROCESSED (atual: ${version.processing_status}).`
      );
    }

    const { data: previousExtractions, error: previousError } = await supabase
      .from("document_extractions")
      .select("id")
      .eq("document_version_id", documentVersionId)
      .eq("status", "PROCESSED");

    if (previousError) {
      throw previousError;
    }

    previousExtractionIds = (previousExtractions ?? []).map((row) => row.id);
    reprocessArmed = true;
  } else if (
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

  const isPdfSource = (source) =>
    source.mimeType === "application/pdf" ||
    String(source.fileName ?? "").toLowerCase().endsWith(".pdf");

  // PDF digitalizado pode não ter texto nativo — o OCR (5c) decide.
  if (
    (!result.text ||
      result.text.trim().length === 0) &&
    !isPdfSource({ mimeType: version.mime_type, fileName: version.original_file_name })
  ) {
    throw new Error(
      "O extrator nao encontrou texto utilizavel no documento."
    );
  }

  // Arquivos-fonte da extração, na ordem do texto final (principal e,
  // depois, partes/anexos da mesma versão) — base do OCR (5c).
  const sourceFiles = legacyXlsResult
    ? []
    : [
        {
          fileId: null,
          fileName: version.original_file_name,
          mimeType: version.mime_type,
          buffer,
          pageOffset: 0,
          pageCount: result.pageCount,
          segments: result.segments,
        },
      ];


  // ==========================================================
  // 5b. PARTES / ANEXOS CONTRATUAIS DA MESMA VERSAO
  //
  // Contrato enviado em varios arquivos (ex.: "Parte 1 de 2" como
  // PRINCIPAL + "Parte 2 de 2" como ANEXO_CONTRATUAL da MESMA versao,
  // document_version_files): a analise contratual (detect-clause-
  // candidates.mjs le a ultima extracao da versao, por segment_index)
  // precisa ver o instrumento inteiro. Os arquivos complementares
  // entram NA MESMA extracao, depois do principal, em ordem de envio,
  // com paginas continuando a numeracao (Parte 2 comeca na pagina
  // seguinte a ultima da Parte 1). O locator preserva arquivo e pagina
  // original — rastreabilidade ate a fonte (CLAUDE.md #11).
  // ==========================================================

  const CONTRACTUAL_KINDS = new Set(["CONTRATO_BASE", "ADITIVO"]);
  const contractualFileIds = [];
  let combinedPageCount = result.pageCount;
  let combinedSegments = result.segments;
  let combinedExtractor = result.extractor;

  if (!legacyXlsResult && CONTRACTUAL_KINDS.has(document.kind)) {
    const { data: supplementalFiles, error: supplementalError } = await supabase
      .from("document_version_files")
      .select("id,original_file_name,mime_type,storage_bucket,storage_path,uploaded_at")
      .eq("document_version_id", documentVersionId)
      .eq("file_role", "ANEXO_CONTRATUAL")
      .order("uploaded_at", { ascending: true })
      .order("id", { ascending: true });

    if (supplementalError) {
      throw supplementalError;
    }

    let pageOffset = result.pageCount ?? 0;
    const extractors = new Set([result.extractor]);
    let partSegments = [];

    for (const file of supplementalFiles ?? []) {
      const { data: partBlob, error: partDownloadError } = await supabase.storage
        .from(file.storage_bucket)
        .download(file.storage_path);

      if (partDownloadError || !partBlob) {
        throw new Error(
          `Falha no download do arquivo complementar ${file.original_file_name}: ${partDownloadError?.message ?? "arquivo vazio"}`
        );
      }

      const partBuffer = Buffer.from(await partBlob.arrayBuffer());
      let partResult;
      try {
        partResult = await extractDocument({
          buffer: partBuffer,
          mimeType: file.mime_type,
          fileName: file.original_file_name,
        });
      } catch (partError) {
        // Formato sem extrator de texto (ex.: imagem): o arquivo segue
        // no pacote documental, so nao entra no texto da analise.
        console.warn(`Arquivo complementar sem texto extraivel: ${file.original_file_name} (${partError instanceof Error ? partError.message : partError})`);
        continue;
      }

      const offset = pageOffset;
      const partIsPdf = isPdfSource({ mimeType: file.mime_type, fileName: file.original_file_name });

      if (!partIsPdf && (!partResult.text || partResult.text.trim().length === 0)) {
        console.warn(`Arquivo complementar sem texto utilizavel: ${file.original_file_name}`);
        continue;
      }

      sourceFiles.push({
        fileId: file.id,
        fileName: file.original_file_name,
        mimeType: file.mime_type,
        buffer: partBuffer,
        pageOffset: offset,
        pageCount: partResult.pageCount,
        segments: partResult.segments,
      });
      partSegments = partSegments.concat(
        partResult.segments.map((segment) => ({
          ...segment,
          pageNumber: segment.pageNumber == null ? null : segment.pageNumber + offset,
          locator:
            segment.pageNumber == null
              ? `${file.original_file_name} · ${segment.locator}`
              : `${file.original_file_name} · ${segment.locator} (pagina ${segment.pageNumber + offset} do contrato)`,
        }))
      );

      if (partResult.pageCount != null) {
        pageOffset += partResult.pageCount;
        combinedPageCount = (combinedPageCount ?? 0) + partResult.pageCount;
      }
      extractors.add(partResult.extractor);
      contractualFileIds.push(file.id);
      console.log(`Arquivo complementar incluido: ${file.original_file_name} (${partResult.pageCount ?? "?"} paginas, a partir da pagina ${offset + 1})`);
    }

    // Sem arquivo complementar com texto, a extracao fica identica a
    // anterior (mesmos locators) — nenhuma mudanca para documentos de
    // arquivo unico.
    if (contractualFileIds.length > 0) {
      combinedSegments = result.segments
        .map((segment) => ({
          ...segment,
          locator: `${version.original_file_name} · ${segment.locator}`,
        }))
        .concat(partSegments);
      combinedExtractor = [...extractors].join("+");
    }
  }


  // ==========================================================
  // 5c. OCR LOCAL DAS PÁGINAS SEM TEXTO ÚTIL (scripts/lib/pdf-ocr.mjs)
  //
  // Todas as páginas de todos os PDFs da versão são inventariadas; as
  // que não têm texto útil (carimbos/rodapés repetidos desconsiderados)
  // são renderizadas — inclusive conteúdo vetorial — e lidas por OCR em
  // português. Cada trecho guarda arquivo de origem, página local e
  // página global. O texto nativo nunca é substituído: o OCR só
  // acrescenta o que não existe nele. Páginas não lidas geram um
  // marcador explícito no texto e tornam a cobertura PARCIAL.
  // ==========================================================

  let ocrSummary = null;
  let ocrPagesByKey = new Map();
  const pdfSources = sourceFiles.filter(isPdfSource);

  if (pdfSources.length > 0) {
    const analysis = await analyzePdfPagesWithOcr(
      pdfSources.map(({ fileId, fileName, buffer: fileBuffer, pageOffset }) => ({
        fileId,
        fileName,
        buffer: fileBuffer,
        pageOffset,
      })),
      { log: (message) => console.log(message) }
    );
    ocrSummary = analysis.summary;
    ocrPagesByKey = new Map(analysis.pages.map((page) => [page.globalPage, page]));

    combinedSegments = [];
    for (const source of sourceFiles) {
      if (!isPdfSource(source)) {
        combinedSegments.push(
          ...source.segments.map((segment) => ({
            ...segment,
            locator: `${source.fileName} · ${segment.locator}`,
          }))
        );
        continue;
      }

      const nativeByPage = new Map();
      for (const segment of source.segments) {
        const list = nativeByPage.get(segment.pageNumber) ?? [];
        list.push(segment);
        nativeByPage.set(segment.pageNumber, list);
      }

      const pageTotal = source.pageCount ?? Math.max(0, ...nativeByPage.keys());
      for (let localPage = 1; localPage <= pageTotal; localPage += 1) {
        const globalPage = source.pageOffset + localPage;
        const info = ocrPagesByKey.get(globalPage);
        const base = `${source.fileName} · pág. local ${localPage} · pág. global ${globalPage}`;
        const review = info?.visualReview?.length
          ? ` · REVISAO_VISUAL: ${info.visualReview.join(",")}`
          : "";

        for (const segment of nativeByPage.get(localPage) ?? []) {
          const part = String(segment.locator ?? "").match(/, parte \d+$/)?.[0] ?? "";
          combinedSegments.push({
            ...segment,
            pageNumber: globalPage,
            locator: `${base} · TEXTO_NATIVO${part}${review}`,
          });
        }

        if (info?.ocr?.addedText) {
          combinedSegments.push({
            text: info.ocr.addedText,
            pageNumber: globalPage,
            locator: `${base} · OCR ${OCR_LANGUAGE} (confianca ${info.ocr.confidence}%)${review}`,
          });
        }

        if (info && PENDING_STATUSES.has(info.status)) {
          combinedSegments.push({
            text:
              `[ACC — CONTEUDO NAO LIDO INTEGRALMENTE: pagina global ${globalPage} ` +
              `(arquivo ${source.fileName}, pagina local ${localPage}). Motivo: ${info.status}` +
              (info.ocr?.error ? ` (${info.ocr.error})` : "") +
              `. Consulte a pagina original.]`,
            pageNumber: globalPage,
            locator: `${base} · PENDENTE: ${info.status}${review}`,
          });
        }
      }
    }

    if (ocrSummary.ocrPages.length > 0 || ocrSummary.pendingPages.length > 0) {
      combinedExtractor = `${combinedExtractor}+${OCR_ENGINE}`;
    }

    console.log(
      `Cobertura: ${ocrSummary.totalPages} paginas; OCR ${ocrSummary.ocrPages.length}; ` +
      `pendentes ${ocrSummary.pendingPages.length}; revisao visual ${ocrSummary.visualReviewPages.length}.`
    );
  }

  const coverageError =
    ocrSummary && !ocrSummary.complete
      ? `COBERTURA PARCIAL: ${ocrSummary.pendingPages.length} pagina(s) sem leitura integral ` +
        `(${formatPageRanges(ocrSummary.pendingPages.map((page) => page.globalPage))}). ` +
        `Nao tratar como leitura integral do documento.`
      : null;

  const needsHumanReview =
    Boolean(ocrSummary) &&
    (!ocrSummary.complete || ocrSummary.visualReviewPages.length > 0);


  // ==========================================================
  // 6. SEGMENTS
  // ==========================================================

  const canonicalText =
    combinedSegments
      .map((segment) => segment.text)
      .join("\n\n");

  if (canonicalText.trim().length === 0) {
    throw new Error(
      "O extrator nao encontrou texto utilizavel no documento (nem por OCR)."
    );
  }

  const detectedLanguage =
    detectSourceLanguage(canonicalText);

  let characterCursor = 0;

  const segments =
    combinedSegments.map(
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
        combinedExtractor,
      extractor_version:
        ocrSummary && combinedExtractor.includes(OCR_ENGINE)
          ? `${result.extractorVersion}+ocr-${OCR_LANGUAGE}-${OCR_ENGINE_VERSION}`
          : result.extractorVersion,
      status:
        "PROCESSED",
      text_content:
        canonicalText,
      page_count:
        combinedPageCount,
      character_count:
        canonicalText.length,
      // Sem coluna própria de cobertura no schema atual: a cobertura
      // parcial fica registrada aqui, no marcador do texto e na auditoria.
      error_message:
        coverageError,
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
      ...(needsHumanReview ? { requires_human_review: true } : {}),
    })
    .eq(
      "id",
      documentVersionId
    );

  if (completeVersionError) {
    throw completeVersionError;
  }

  if (contractualFileIds.length > 0) {
    const { error: partsStatusError } = await supabase
      .from("document_version_files")
      .update({ processing_status: "PROCESSED", processing_error: null })
      .in("id", contractualFileIds);

    if (partsStatusError) {
      throw partsStatusError;
    }
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
      `Documento "${document.title}" processado por ${combinedExtractor}. ` +
      `${canonicalText.length} caracteres, ${segments.length} segmentos` +
      (contractualFileIds.length > 0
        ? `, incluindo ${contractualFileIds.length} arquivo(s) complementar(es) da mesma versao (${contractualFileIds.join(", ")}); ${combinedPageCount ?? "?"} paginas no total.`
        : ".") +
      (ocrSummary
        ? ` Cobertura (${ocrSummary.engine}): ${ocrSummary.totalPages} paginas; ` +
          `texto nativo ${ocrSummary.nativePages}; OCR ${ocrSummary.ocrPages.length} (${formatPageRanges(ocrSummary.ocrPages) || "nenhuma"}); ` +
          `sem conteudo adicional ${ocrSummary.noAdditionalContentPages.length}; em branco ${ocrSummary.blankPages.length}; ` +
          `PENDENTES ${ocrSummary.pendingPages.length} (${formatPageRanges(ocrSummary.pendingPages.map((page) => page.globalPage)) || "nenhuma"}); ` +
          `revisao visual ${ocrSummary.visualReviewPages.length} (${formatPageRanges(ocrSummary.visualReviewPages.map((page) => page.globalPage)) || "nenhuma"}). ` +
          (ocrSummary.complete ? "Leitura integral." : "Leitura PARCIAL — nao tratar como integral.")
        : ""),
  });

  if (reprocessArmed) {
    await writeAudit({
      action: "DOCUMENT_REPROCESSED",
      entityId: documentVersionId,
      detail:
        `Versao reprocessada (nova extracao ${extractionId}). ` +
        `Extracoes anteriores preservadas como historico: ${previousExtractionIds.join(", ") || "nenhuma"}. ` +
        `Consumidores usam a extracao PROCESSED mais recente.`,
    });
  }


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
    combinedPageCount ?? "N/A"
  );

  if (ocrSummary) {
    console.log("Coverage:", ocrSummary.complete ? "INTEGRAL" : "PARCIAL");
    if (coverageError) console.log(coverageError);
  }

} catch (error) {
  await failProcessing(
    error
  );
}
