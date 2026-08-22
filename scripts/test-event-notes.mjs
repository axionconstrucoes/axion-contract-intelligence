// Testes de "Anotações do Evento" (event_notes): schema, RLS/permissão,
// autoria correta, auditoria (EVENT_NOTE_CREATED), leitura, distinção
// USER_NOTE != EVIDENCE, e integração no context builder.
//
// Cria UMA anotação de teste real (via sessão autenticada real, RLS
// completo) contra o evento de referência, para provar o fluxo ponta a
// ponta — e a remove ao final via service role (não há policy DELETE
// para authenticated, então a limpeza precisa da service role). O
// registro de auditoria EVENT_NOTE_CREATED gerado é permanente e
// legítimo (audit_log_entries é append-only por desenho) — isso não é
// "poluir produção": a anotação em si é removida, não fica visível na
// UI/ativa no evento.
//
// NÃO toca em event_clause_confrontation_candidates.
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/test-event-notes.mjs

import { createClient } from "@supabase/supabase-js";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const { buildEventAnalysisContext } = await import("../apps/web/lib/ai/context/build-event-context");

let passed = 0;
let failed = 0;

async function checkAsync(name, fn) {
  try {
    await fn();
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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !serviceKey || !anonKey) {
  console.log("SKIP todos os testes — Supabase não configurado.");
  process.exit(0);
}

const REFERENCE_EVENT_ID = "58988a54-092c-442f-a79a-638b53bc088e";
const REFERENCE_PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const TEST_AUTHOR_EMAIL = "reynaldo@axion.com.br";

const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function snapshotCandidates() {
  const { data, error } = await admin
    .from("event_clause_confrontation_candidates")
    .select("id,status,review_note,reviewed_at,updated_at")
    .eq("event_id", REFERENCE_EVENT_ID)
    .order("id", { ascending: true });
  if (error) throw error;
  return JSON.stringify(data);
}

const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email: TEST_AUTHOR_EMAIL,
});
if (linkError) throw linkError;

const anonClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: verifyData, error: verifyError } = await anonClient.auth.verifyOtp({
  type: "magiclink",
  token_hash: linkData.properties.hashed_token,
});
if (verifyError) throw verifyError;

const authedUserId = verifyData.user.id;
const authedClient = createClient(supabaseUrl, anonKey, {
  global: { headers: { Authorization: `Bearer ${verifyData.session.access_token}` } },
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log("");
console.log("======================================");
console.log("ANOTAÇÕES DO EVENTO — TESTES");
console.log("======================================");
console.log("");

const beforeAll = await snapshotCandidates();
let createdNoteId = null;

await checkAsync("INSERT autenticado com EDITOR/ADMIN e autoria própria é aceito (RLS)", async () => {
  const { data, error } = await authedClient
    .from("event_notes")
    .insert({
      event_id: REFERENCE_EVENT_ID,
      author_user_id: authedUserId,
      category: "CONTEXTO_OPERACIONAL",
      text: "[TESTE AUTOMATIZADO — removido ao final] Não temos um contrato assinado, mas o cliente já está medindo os serviços e pagando regularmente.",
    })
    .select("id,event_id,category,text,author_user_id,created_at,updated_at")
    .single();

  if (error) throw error;
  assert(data.id, "deveria retornar id da nota criada");
  assert(data.author_user_id === authedUserId, "author_user_id deveria ser o usuário autenticado");
  createdNoteId = data.id;
});

await checkAsync("tentativa de se passar por outro autor é bloqueada pela RLS (impersonation)", async () => {
  const FAKE_OTHER_AUTHOR = "00000000-0000-0000-0000-000000000001";
  const { data, error } = await authedClient.from("event_notes").insert({
    event_id: REFERENCE_EVENT_ID,
    author_user_id: FAKE_OTHER_AUTHOR,
    category: "OUTROS",
    text: "[TESTE — não deveria ser aceito] tentando se passar por outro autor.",
  });

  assert(error !== null, "RLS deveria rejeitar author_user_id diferente de auth.uid()");
  assert(!data, "nenhum dado deveria ser retornado");
});

await checkAsync("leitura das anotações retorna a anotação criada (autor correto)", async () => {
  const { data, error } = await authedClient
    .from("event_notes")
    .select("id,category,text,author_user_id")
    .eq("event_id", REFERENCE_EVENT_ID)
    .eq("id", createdNoteId)
    .maybeSingle();

  if (error) throw error;
  assert(data !== null, "a anotação criada deveria ser legível");
  assert(data.author_user_id === authedUserId);
  assert(data.category === "CONTEXTO_OPERACIONAL");
});

await checkAsync("EVENT_NOTE_CREATED foi registrado em audit_log_entries", async () => {
  const { data, error } = await admin
    .from("audit_log_entries")
    .select("id,action,entity_type,entity_id,actor_type,actor_user_id")
    .eq("action", "EVENT_NOTE_CREATED")
    .eq("entity_id", createdNoteId)
    .maybeSingle();

  if (error) throw error;
  assert(data !== null, "deveria existir uma entrada de auditoria EVENT_NOTE_CREATED");
  assert(data.entity_type === "EVENT_NOTE");
  assert(data.actor_type === "USER");
  assert(data.actor_user_id === authedUserId);
});

await checkAsync("USER_NOTE != EVIDENCE: a anotação não aparece em event_evidence", async () => {
  const { data, error } = await admin
    .from("event_evidence")
    .select("id")
    .eq("event_id", REFERENCE_EVENT_ID)
    .eq("label", "CONTEXTO_OPERACIONAL");
  if (error) throw error;
  assert(data.length === 0, "anotação de usuário nunca deve ser inserida como evidência");
});

await checkAsync("context builder inclui a anotação como USER_NOTE/DECLARED_CONTEXT, nunca como fato documental", async () => {
  const context = await buildEventAnalysisContext(admin, {
    projectId: REFERENCE_PROJECT_ID,
    eventId: REFERENCE_EVENT_ID,
  });

  assert(Array.isArray(context.eventNotes), "context.eventNotes deveria ser um array");
  const note = context.eventNotes.find((n) => n.id === createdNoteId);
  assert(note !== undefined, "a anotação criada deveria aparecer no contexto");
  assert(note.sourceType === "USER_NOTE", "sourceType deve ser USER_NOTE");
  assert(note.evidentialStatus === "DECLARED_CONTEXT", "evidentialStatus deve ser DECLARED_CONTEXT — nunca fato confirmado");

  // Nunca pode ser confundida com evidência/cláusula/e-mail dentro do
  // mesmo contexto.
  const asEvidence = context.evidence.find((e) => e.id === createdNoteId);
  assert(asEvidence === undefined, "a anotação não pode aparecer como event_evidence no contexto");
});

await checkAsync("candidatos de confrontação permanecem inalterados durante todo o teste", async () => {
  const after = await snapshotCandidates();
  assert(beforeAll === after, "0.71 APPROVED / 0.67 PENDING_REVIEW / 0.66 REJECTED devem permanecer intactos");
});

// ---------- limpeza: remove a anotação de teste (service role) ----------
// event_notes não tem trigger anti-delete (só audit_log_entries tem) —
// isso é seguro e não "viola auditoria": o registro de auditoria
// permanece (correto, é histórico real de uma ação que ocorreu), só a
// anotação ativa é removida para não deixar dado fictício visível.
if (createdNoteId) {
  const { error: deleteError } = await admin.from("event_notes").delete().eq("id", createdNoteId);
  if (deleteError) {
    console.log("AVISO: falha ao limpar anotação de teste:", deleteError.message);
  } else {
    console.log("Limpeza: anotação de teste removida (id=" + createdNoteId + ").");
  }
}

await checkAsync("após limpeza, o evento volta a não ter a anotação de teste", async () => {
  const { data, error } = await admin.from("event_notes").select("id").eq("id", createdNoteId).maybeSingle();
  if (error) throw error;
  assert(data === null, "a anotação de teste deveria ter sido removida");
});

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
