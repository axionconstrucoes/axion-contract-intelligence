import { createClient } from "@supabase/supabase-js";

import {
  detectClauseCandidates,
} from "./clause-structure-detector.mjs";

const documentVersionId =
  process.argv[2];

if (!documentVersionId) {
  console.error("");
  console.error("Uso:");
  console.error(
    "node --env-file=apps/web/.env.local scripts/detect-clause-candidates.mjs <document-version-id>"
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


// ============================================================
// 1. DOCUMENT VERSION
// ============================================================

const {
  data: version,
  error: versionError,
} = await supabase
  .from("document_versions")
  .select(
    "id,document_id,version_label,processing_status"
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
  version.processing_status !==
  "PROCESSED"
) {
  throw new Error(
    `Document version precisa estar PROCESSED. Status atual: ${version.processing_status}`
  );
}


// ============================================================
// 2. LATEST SUCCESSFUL EXTRACTION
// ============================================================

const {
  data: extractions,
  error: extractionError,
} = await supabase
  .from("document_extractions")
  .select(
    "id,extractor,extractor_version,completed_at"
  )
  .eq(
    "document_version_id",
    documentVersionId
  )
  .eq(
    "status",
    "PROCESSED"
  )
  .order(
    "completed_at",
    {
      ascending: false,
    }
  )
  .limit(1);

if (extractionError) {
  throw extractionError;
}

const extraction =
  extractions?.[0];

if (!extraction) {
  throw new Error(
    "Nenhuma extracao PROCESSED encontrada."
  );
}


// ============================================================
// 3. SEGMENTS
// ============================================================

const {
  data: segmentRows,
  error: segmentError,
} = await supabase
  .from("document_text_segments")
  .select(
    "id,segment_index,page_number,locator,text_content"
  )
  .eq(
    "extraction_id",
    extraction.id
  )
  .order(
    "segment_index",
    {
      ascending: true,
    }
  );

if (segmentError) {
  throw segmentError;
}

if (!segmentRows?.length) {
  throw new Error(
    "Extracao nao possui segmentos."
  );
}

const segments =
  segmentRows.map(
    (segment) => ({
      id:
        segment.id,
      segmentIndex:
        segment.segment_index,
      pageNumber:
        segment.page_number,
      locator:
        segment.locator,
      textContent:
        segment.text_content,
    })
  );


// ============================================================
// 4. DETECT
// ============================================================

const candidates =
  detectClauseCandidates(
    segments
  );

console.log("");
console.log(
  `Candidatos detectados: ${candidates.length}`
);

if (candidates.length === 0) {
  console.log(
    "Nenhuma estrutura de clausula detectada."
  );
  process.exit(0);
}


// ============================================================
// 5. REGISTER PENDING_REVIEW
// ============================================================

let registered = 0;

for (const candidate of candidates) {
  const {
    data: candidateId,
    error,
  } = await supabase.rpc(
    "register_clause_extraction_candidate",
    {
      p_document_version_id:
        documentVersionId,

      p_source_segment_id:
        candidate.sourceSegmentId,

      p_detector:
        candidate.detector,

      p_detector_version:
        candidate.detectorVersion,

      p_candidate_key:
        candidate.candidateKey,

      p_confidence:
        candidate.confidence,

      p_proposed_clause_number:
        candidate.proposedClauseNumber,

      p_proposed_title:
        candidate.proposedTitle,

      p_proposed_text:
        candidate.proposedText,

      p_page_number:
        candidate.pageNumber,

      p_locator:
        candidate.locator,
    }
  );

  if (error) {
    console.error("");
    console.error(
      `Falha ao registrar clausula ${candidate.proposedClauseNumber}:`
    );
    console.dir(
      error,
      { depth: null }
    );
    process.exit(1);
  }

  registered += 1;

  console.log(
    `${candidate.proposedClauseNumber} | ${candidate.proposedTitle} | ${candidate.confidence} | ${candidateId}`
  );
}


// ============================================================
// 6. VALIDATE QUEUE
// ============================================================

const {
  data: queue,
  error: queueError,
} = await supabase
  .from("clause_extraction_candidates")
  .select(
    "id,status,proposed_clause_number,proposed_title,confidence,page_number,locator"
  )
  .eq(
    "document_version_id",
    documentVersionId
  )
  .eq(
    "detector",
    "clause-structure"
  )
  .eq(
    "detector_version",
    "2"
  )
  .order(
    "created_at",
    {
      ascending: true,
    }
  );

if (queueError) {
  throw queueError;
}

console.log("");
console.table(queue ?? []);

console.log("");
console.log("=======================================");
console.log("CLAUSE CANDIDATE REGISTRATION: OK");
console.log("=======================================");
console.log(
  "Detectados:",
  candidates.length
);
console.log(
  "Registrados nesta execucao:",
  registered
);
console.log(
  "Fila total:",
  queue?.length ?? 0
);
