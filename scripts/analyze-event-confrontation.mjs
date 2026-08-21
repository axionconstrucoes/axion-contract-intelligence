import { createClient } from "@supabase/supabase-js";

import {
  analyzeEventAgainstClauses,
} from "./event-clause-confrontation-analyzer.mjs";


const eventId =
  process.argv[2];

const dryRun =
  process.argv.includes(
    "--dry-run"
  );


if (!eventId) {
  console.error("");
  console.error("Uso:");
  console.error(
    "node --env-file=apps/web/.env.local scripts/analyze-event-confrontation.mjs <event-id> [--dry-run]"
  );
  console.error("");
  process.exit(2);
}


const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL;

const serviceKey =
  process.env.SUPABASE_SECRET_KEY;


if (
  !supabaseUrl ||
  !serviceKey
) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SECRET_KEY sao obrigatorios."
  );
}


const supabase =
  createClient(
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
// 1. EVENTO
// ============================================================

const {
  data: event,
  error: eventError,
} = await supabase
  .from("contract_events")
  .select(
    "id,project_id,title,description,occurred_at,status,source_type"
  )
  .eq(
    "id",
    eventId
  )
  .maybeSingle();


if (eventError) {
  throw eventError;
}


if (!event) {
  throw new Error(
    "Evento nao encontrado."
  );
}


console.log("");
console.log(
  "Evento:",
  event.title
);

console.log(
  "Projeto:",
  event.project_id
);


// ============================================================
// 2. DOCUMENTOS DO PROJETO
// ============================================================

const {
  data: documents,
  error: documentError,
} = await supabase
  .from("documents")
  .select("id")
  .eq(
    "project_id",
    event.project_id
  );


if (documentError) {
  throw documentError;
}


if (!documents?.length) {
  console.log("");
  console.log(
    "Nenhum documento contratual disponivel para confronto."
  );

  process.exit(0);
}


// ============================================================
// 3. VERSOES
// ============================================================

const {
  data: versions,
  error: versionError,
} = await supabase
  .from("document_versions")
  .select(
    "id,document_id,version_label"
  )
  .in(
    "document_id",
    documents.map(
      (document) =>
        document.id
    )
  );


if (versionError) {
  throw versionError;
}


if (!versions?.length) {
  console.log("");
  console.log(
    "Nenhuma versao documental disponivel para confronto."
  );

  process.exit(0);
}


// ============================================================
// 4. CLAUSULAS APROVADAS
//
// public.clauses representa a base validada por humano.
// ============================================================

const {
  data: clauseRows,
  error: clauseError,
} = await supabase
  .from("clauses")
  .select(
    "id,document_version_id,clause_number,title,text"
  )
  .in(
    "document_version_id",
    versions.map(
      (version) =>
        version.id
    )
  );


if (clauseError) {
  throw clauseError;
}


if (!clauseRows?.length) {
  console.log("");
  console.log(
    "Nenhuma clausula aprovada disponivel para confronto."
  );

  process.exit(0);
}


// ============================================================
// 5. CROSS-REFERENCES JA APROVADOS
// ============================================================

const {
  data: existingRefs,
  error: refError,
} = await supabase
  .from(
    "event_cross_references"
  )
  .select(
    "clause_id"
  )
  .eq(
    "event_id",
    eventId
  )
  .not(
    "clause_id",
    "is",
    null
  );


if (refError) {
  throw refError;
}


const alreadyLinked =
  new Set(
    (existingRefs ?? [])
      .map(
        (reference) =>
          reference.clause_id
      )
      .filter(Boolean)
  );


const clauses =
  clauseRows
    .filter(
      (clause) =>
        !alreadyLinked.has(
          clause.id
        )
    )
    .map(
      (clause) => ({
        id:
          clause.id,

        clauseNumber:
          clause.clause_number,

        title:
          clause.title,

        text:
          clause.text,
      })
    );


if (!clauses.length) {
  console.log("");
  console.log(
    "Todas as clausulas relevantes ja possuem referencia aprovada para este evento."
  );

  process.exit(0);
}


// ============================================================
// 5B. EVIDENCIA DO EMAIL DE ORIGEM
// ============================================================

let eventEvidenceText = "";

if (event.source_type === "EMAIL") {
  const {
    data: sourceCandidates,
    error: sourceCandidateError,
  } = await supabase
    .from("email_thread_event_candidates")
    .select("id")
    .eq("event_id", eventId)
    .limit(1);

  if (sourceCandidateError) {
    throw sourceCandidateError;
  }

  const sourceCandidate =
    sourceCandidates?.[0];

  if (sourceCandidate) {
    const {
      data: emailLinks,
      error: emailLinkError,
    } = await supabase
      .from("email_thread_event_candidate_emails")
      .select("email_id")
      .eq(
        "candidate_id",
        sourceCandidate.id
      );

    if (emailLinkError) {
      throw emailLinkError;
    }

    const emailIds =
      (emailLinks ?? [])
        .map(
          row => row.email_id
        )
        .filter(Boolean);

    if (emailIds.length) {
      const {
        data: sourceEmails,
        error: sourceEmailError,
      } = await supabase
        .from("emails")
        .select(
          "subject,snippet,sent_at"
        )
        .in(
          "id",
          emailIds
        )
        .order(
          "sent_at",
          { ascending: true }
        );

      if (sourceEmailError) {
        throw sourceEmailError;
      }

      eventEvidenceText =
        (sourceEmails ?? [])
          .map(
            email =>
              [
                email.subject ?? "",
                email.snippet ?? "",
              ]
                .filter(Boolean)
                .join("\n")
          )
          .join("\n\n");

      console.log(
        "Evidencias de email incorporadas:",
        sourceEmails?.length ?? 0
      );
    }
  }
}

// ============================================================
// 6. ANALISE DETERMINISTICA
// ============================================================

const candidates =
  analyzeEventAgainstClauses({
    event: {
      id:
        event.id,

      title:
        event.title,

      description:
        [
          event.description,
          eventEvidenceText
        ]
          .filter(Boolean)
          .join("\n\n"),
    },

    clauses,
  });


console.log("");
console.log(
  "Clausulas analisadas:",
  clauses.length
);

console.log(
  "Candidatos encontrados:",
  candidates.length
);


console.table(
  candidates.map(
    (candidate) => ({
      clause:
        candidate.clauseId,

      finding:
        candidate.findingType,

      severity:
        candidate.severity,

      confidence:
        candidate.confidence,

      categories:
        candidate.categories.join(
          ", "
        ),
    })
  )
);


// ============================================================
// 7. DRY RUN
// ============================================================

if (dryRun) {
  console.log("");
  console.log(
    "DRY RUN: nenhum candidato foi gravado."
  );

  process.exit(0);
}


// ============================================================
// 8. REGISTRAR PENDING_REVIEW
// ============================================================

let registered = 0;


for (
  const candidate of candidates
) {
  const {
    data: candidateId,
    error,
  } = await supabase.rpc(
    "register_event_clause_confrontation_candidate",
    {
      p_event_id:
        candidate.eventId,

      p_clause_id:
        candidate.clauseId,

      p_analyzer:
        candidate.analyzer,

      p_analyzer_version:
        candidate.analyzerVersion,

      p_candidate_key:
        candidate.candidateKey,

      p_finding_type:
        candidate.findingType,

      p_severity:
        candidate.severity,

      p_confidence:
        candidate.confidence,

      p_summary:
        candidate.summary,

      p_event_basis:
        candidate.eventBasis,

      p_clause_basis:
        candidate.clauseBasis,
    }
  );


  if (error) {
    console.error("");
    console.error(
      "Falha ao registrar candidato:"
    );

    console.dir(
      error,
      {
        depth: null,
      }
    );

    process.exit(1);
  }


  registered += 1;

  console.log(
    `Registrado: ${candidate.clauseId} -> ${candidateId}`
  );
}


// ============================================================
// 9. FILA RESULTANTE
// ============================================================

const {
  data: queue,
  error: queueError,
} = await supabase
  .from(
    "event_clause_confrontation_candidates"
  )
  .select(
    "id,clause_id,status,finding_type,severity,confidence,summary"
  )
  .eq(
    "event_id",
    eventId
  )
  .eq(
    "status",
    "PENDING_REVIEW"
  )
  .order(
    "confidence",
    {
      ascending: false,
    }
  );


if (queueError) {
  throw queueError;
}


console.log("");
console.table(
  queue ?? []
);


console.log("");
console.log(
  "======================================"
);

console.log(
  "EVENT x CLAUSE REGISTRATION: OK"
);

console.log(
  "======================================"
);

console.log(
  "Registrados nesta execucao:",
  registered
);
