import { createClient } from "@supabase/supabase-js";

import { register } from "node:module";
import {
  detectClauseCandidates,
} from "./clause-structure-detector.mjs";

register("./ts-module-resolver.mjs", import.meta.url);

// Camada normalizada (codificação de fonte corrigida) — a detecção roda
// sobre ela; o vínculo com o segmento original (sourceSegmentId) e o
// texto armazenado permanecem intactos.
const { normalizeSegmentText } = await import(
  "../apps/web/lib/documents/extraction/repair-font-encoding.ts"
);

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
    "id,document_id,project_id,version_label,processing_status"
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
    "id,extractor,extractor_version,completed_at,error_message"
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

// Cobertura parcial (OCR): a análise de cláusulas NUNCA é apresentada
// como análise do documento inteiro.
const partialCoverage =
  String(extraction.error_message ?? "").startsWith("COBERTURA PARCIAL");

if (partialCoverage) {
  console.warn("");
  console.warn("ATENCAO: extracao com cobertura parcial — clausulas em paginas pendentes nao serao detectadas.");
  console.warn(extraction.error_message);
}

let normalizationRepairs = 0;

const segments =
  segmentRows
    // Marcadores de página não lida não são texto do documento.
    .filter((segment) => !/· PENDENTE:/.test(segment.locator ?? ""))
    .map(
      (segment) => {
        const normalized = normalizeSegmentText(segment.text_content, segment.locator);
        normalizationRepairs += normalized.repairs.length;
        return {
          id:
            segment.id,
          segmentIndex:
            segment.segment_index,
          pageNumber:
            segment.page_number,
          locator:
            segment.locator,
          textContent:
            normalized.text,
        };
      }
    );

if (normalizationRepairs > 0) {
  console.log(`Camada normalizada: ${normalizationRepairs} correcoes de codificacao de fonte aplicadas a deteccao (texto armazenado inalterado).`);
}


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

async function writeDetectionAudit(action, detail) {
  const { error } = await supabase.from("audit_log_entries").insert({
    project_id: version.project_id,
    actor_type: "SYSTEM",
    actor_user_id: null,
    actor_label: null,
    action,
    entity_type: "DOCUMENT_VERSION",
    entity_id: documentVersionId,
    detail,
  });
  if (error) console.error("Aviso: falha ao registrar auditoria:", error.message);
}

// Zero candidatos é FALHA DE DETECÇÃO — nunca conclusão de que o
// documento não tem cláusulas (nem de que não tem riscos).
if (candidates.length === 0) {
  const message =
    "FALHA DE DETECCAO: nenhum candidato a clausula foi reconhecido. Isto NAO significa que o documento " +
    "nao tenha clausulas ou riscos — o formato pode nao ser suportado pelo detector" +
    (partialCoverage ? " e a extracao tem cobertura parcial" : "") +
    ". Revisao humana do documento original e obrigatoria.";
  console.error("");
  console.error(message);
  await writeDetectionAudit("CLAUSE_DETECTION_NO_CANDIDATES", `${message} Extracao ${extraction.id}.`);
  process.exit(3);
}

// Fila existente ANTES do registro — a RPC faz upsert por
// (versao, detector, versao do detector, candidate_key) e nunca altera
// candidato ja revisado (APPROVED/REJECTED): reexecutar nao duplica.
const { data: queueBefore, error: queueBeforeError } = await supabase
  .from("clause_extraction_candidates")
  .select("id,status,detector,detector_version,candidate_key")
  .eq("document_version_id", documentVersionId);

if (queueBeforeError) {
  throw queueBeforeError;
}

const existingKeys = new Set(
  (queueBefore ?? []).map((row) => `${row.detector}|${row.detector_version}|${row.candidate_key}`)
);
const flaggedCandidates = candidates.filter((candidate) => candidate.flags?.length);


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
  // Detector que realmente rodou (formato "CLÁUSULA" ou decimal).
  .eq(
    "detector",
    candidates[0].detector
  )
  .eq(
    "detector_version",
    candidates[0].detectorVersion
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
console.log(`Fila: ${queue?.length ?? 0} candidatos (detalhe omitido; consulte a tela de revisao de clausulas).`);

const newCandidates = candidates.filter(
  (candidate) => !existingKeys.has(`${candidate.detector}|${candidate.detectorVersion}|${candidate.candidateKey}`)
).length;

await writeDetectionAudit(
  "CLAUSE_DETECTION_COMPLETED",
  `Deteccao de clausulas (${candidates[0].detector} ${candidates[0].detectorVersion}) na extracao ${extraction.id}: ` +
    `${candidates.length} candidatos (${newCandidates} novos, ${candidates.length - newCandidates} ja existentes atualizados/preservados), ` +
    `todos PENDING_REVIEW — nenhuma clausula aprovada automaticamente. ` +
    (flaggedCandidates.length
      ? `${flaggedCandidates.length} sinalizados para revisao: ${flaggedCandidates.map((candidate) => candidate.proposedClauseNumber).join(", ")}. `
      : "") +
    (partialCoverage
      ? `COBERTURA PARCIAL da extracao: clausulas em paginas nao lidas nao foram detectadas; nao e analise integral do contrato.`
      : `Nao e conclusao de analise integral: candidatos dependem de revisao humana.`)
);

console.log("");
console.log("=======================================");
console.log("CLAUSE CANDIDATE REGISTRATION: OK");
console.log("=======================================");
console.log("Novos nesta execucao:", newCandidates);
console.log("Sinalizados para revisao:", flaggedCandidates.length);
if (partialCoverage) {
  console.log("ATENCAO: cobertura parcial — nao e analise integral do contrato.");
}
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
