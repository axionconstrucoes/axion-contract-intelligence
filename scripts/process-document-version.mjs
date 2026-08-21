import { createClient } from "@supabase/supabase-js";

import {
  extractDocument,
} from "./document-extractors.mjs";

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
        "Document Processing Worker",
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
      "id,project_id,title"
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
  // 5. EXTRACTION
  // ==========================================================

  const result =
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
    "Pages:",
    result.pageCount ?? "N/A"
  );

} catch (error) {
  await failProcessing(
    error
  );
}
