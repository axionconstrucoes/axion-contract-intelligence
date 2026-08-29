// Bloco 6 (MVP controlado) — prioridade de vínculo entre e-mail e
// document_version (id interno > Message-ID/thread > hash > assunto,
// nunca automático no último nível). Testes reais da função pura.
//
// Uso:
//   node scripts/test-client-response-link-resolution.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
function readSource(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`OK   ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`FAIL ${name}`);
    console.log(`     ${error.message}`);
    failed += 1;
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message ?? "assertion failed");
}

console.log("");
console.log("======================================");
console.log("RESPOSTA DO CLIENTE — prioridade de vínculo à versão (Bloco 6)");
console.log("======================================");
console.log("");

const { resolveDocumentVersionLinkCandidate } = await import(
  "../apps/web/lib/documents/client-responses/resolve-document-version-link-candidate.ts"
);

function email(overrides) {
  return {
    emailId: "email-1",
    providerThreadId: null,
    messageIdHeader: null,
    attachmentSha256Hashes: [],
    subject: "Re: Diário de Obra",
    ...overrides,
  };
}

check("nível 1 — identificador interno explícito sempre decide, mesmo com outros candidatos ambíguos por perto", () => {
  const result = resolveDocumentVersionLinkCandidate(
    email(),
    [
      { documentVersionId: "v1", originatingThreadId: null, fileSha256Hashes: [], documentTitle: "Diário de Obra 20/08" },
      { documentVersionId: "v2", originatingThreadId: null, fileSha256Hashes: [], documentTitle: "Diário de Obra 21/08" },
    ],
    { explicitDocumentVersionId: "v2" }
  );
  assert(result.status === "AUTOMATIC");
  assert(result.linkMethod === "INTERNAL_VERSION_ID");
  assert(result.documentVersionId === "v2");
});

check("nível 3 — thread do envio original resolve quando exatamente 1 versão bate", () => {
  const result = resolveDocumentVersionLinkCandidate(
    email({ providerThreadId: "thread-abc" }),
    [
      { documentVersionId: "v1", originatingThreadId: "thread-abc", fileSha256Hashes: [], documentTitle: "Diário de Obra" },
      { documentVersionId: "v2", originatingThreadId: "thread-xyz", fileSha256Hashes: [], documentTitle: "Ata de Reunião" },
    ]
  );
  assert(result.status === "AUTOMATIC");
  assert(result.linkMethod === "THREAD");
  assert(result.documentVersionId === "v1");
});

check("nível 3 — thread ambígua (2 versões na mesma thread) NUNCA resolve automaticamente, cai para candidato", () => {
  const result = resolveDocumentVersionLinkCandidate(
    email({ providerThreadId: "thread-abc" }),
    [
      { documentVersionId: "v1", originatingThreadId: "thread-abc", fileSha256Hashes: [], documentTitle: "Diário de Obra" },
      { documentVersionId: "v2", originatingThreadId: "thread-abc", fileSha256Hashes: [], documentTitle: "Diário de Obra (retificação)" },
    ]
  );
  assert(result.status === "AMBIGUOUS_NEEDS_HUMAN_CHOICE", "2 versões na mesma thread é ambíguo, nunca escolhido sozinho");
});

check("nível 4 — hash do anexo resolve quando exatamente 1 versão bate (sem thread disponível)", () => {
  const result = resolveDocumentVersionLinkCandidate(
    email({ attachmentSha256Hashes: ["hash-123"] }),
    [
      { documentVersionId: "v1", originatingThreadId: null, fileSha256Hashes: ["hash-123"], documentTitle: "Relatório Semanal" },
      { documentVersionId: "v2", originatingThreadId: null, fileSha256Hashes: ["hash-999"], documentTitle: "Ata de Reunião" },
    ]
  );
  assert(result.status === "AUTOMATIC");
  assert(result.linkMethod === "ATTACHMENT_HASH");
  assert(result.documentVersionId === "v1");
});

check("nível 5 — sem id/thread/hash decisivos: SEMPRE cai para candidato por assunto, NUNCA automático mesmo com 1 candidato só", () => {
  const result = resolveDocumentVersionLinkCandidate(
    email({ subject: "Re: Diário de Obra 20/08" }),
    [{ documentVersionId: "v1", originatingThreadId: null, fileSha256Hashes: [], documentTitle: "Diário de Obra 20/08" }]
  );
  assert(result.status === "AMBIGUOUS_NEEDS_HUMAN_CHOICE", "assunto NUNCA decide sozinho, mesmo com 1 candidato só");
  assert(result.linkMethod === "SUBJECT_CANDIDATE");
  assert(result.documentVersionId === null, "nunca preenche a versão automaticamente neste nível");
  assert(result.candidates.length === 1);
});

check("nível 2 (Message-ID/In-Reply-To/References) NUNCA resolve nesta fase — limitação real documentada, nunca forjada", () => {
  const source = readSource("apps/web/lib/documents/client-responses/resolve-document-version-link-candidate.ts");
  assert(source.includes("LIMITAÇÃO REAL"), "a limitação real deveria estar documentada no código, não escondida");
  assert(!/messageIdHeader/.test(source.replace(/\/\/.*$/gm, "")), "não deveria haver nenhuma lógica de match usando messageIdHeader (dado que não temos In-Reply-To/References ainda)");
});

check("migration real: document_version_client_responses.link_method=SUBJECT_CANDIDATE exige created_by_type='USER' (nunca SYSTEM decide sozinho por semelhança de assunto)", () => {
  const migrationSource = readSource("supabase/migrations/20260829190000_document_version_client_responses.sql");
  assert(migrationSource.includes("check (link_method <> 'SUBJECT_CANDIDATE' or created_by_type = 'USER')"));
});

check("migration real: relation_type cobre exatamente RESPONDE/DISCORDA/CORRIGE/RESSALVA/COMPLEMENTA — nenhum a mais, nenhum a menos", () => {
  const migrationSource = readSource("supabase/migrations/20260829190000_document_version_client_responses.sql");
  assert(/relation_type in \('RESPONDE', 'DISCORDA', 'CORRIGE', 'RESSALVA', 'COMPLEMENTA'\)/.test(migrationSource));
});

check("migration real: nunca reescreve document_versions/document_version_files — só INSERT numa tabela lateral nova", () => {
  const migrationSource = readSource("supabase/migrations/20260829190000_document_version_client_responses.sql");
  assert(!/update public\.document_versions|update public\.document_version_files/.test(migrationSource), "o documento original nunca deveria ser alterado por este vínculo");
});

check("migration real: sem UPDATE/DELETE em document_version_client_responses (imutável por design, mesma rastreabilidade dos outros vínculos)", () => {
  const migrationSource = readSource("supabase/migrations/20260829190000_document_version_client_responses.sql");
  assert(!/for update|for delete/i.test(migrationSource));
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");
if (failed > 0) process.exitCode = 1;
