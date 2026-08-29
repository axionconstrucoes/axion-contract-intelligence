// Emenda de review_note em candidatos de confrontação Evento x Cláusula
// JÁ revisados (APPROVED/REJECTED) — migration
// 20260828150000_event_clause_confrontation_review_note_amendment.sql,
// NÃO aplicada nesta etapa (sem supabase db push, sem banco tocado).
//
// Estrutural: sem stack Supabase local disponível (sem Docker) para
// rodar a RPC de verdade. O que É verificável sem banco (a migration NÃO
// foi aplicada em nenhum ambiente real) é checado ao vivo, só leitura,
// quando NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SECRET_KEY estão configurados
// — mesmo padrão de scripts/test-acc-email-branding.mjs.
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/test-confrontation-review-note-amendment.mjs

import { createClient } from "@supabase/supabase-js";
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

console.log("");
console.log("======================================");
console.log("EMENDA DE JUSTIFICATIVA — RPC amend_event_clause_confrontation_review_note (migration NÃO aplicada)");
console.log("======================================");
console.log("");

const MIGRATION_PATH = "supabase/migrations/20260828150000_event_clause_confrontation_review_note_amendment.sql";
const migrationSource = readSource(MIGRATION_PATH);

const { validateConfrontationJustification } = await import(
  "../apps/web/lib/ledger/confrontation-justification-validation.ts"
);

// ---------- migration: estrutura da RPC ----------

check("migration cria a RPC amend_event_clause_confrontation_review_note", () => {
  assert(migrationSource.includes("public.amend_event_clause_confrontation_review_note("));
});

check("RPC exige usuário autenticado (auth.uid() not null)", () => {
  assert(migrationSource.includes("v_user_id := auth.uid();"));
  assert(migrationSource.includes("'Authentication required'"));
});

check("RPC recusa candidato PENDING_REVIEW — só aceita APPROVED ou REJECTED", () => {
  assert(migrationSource.includes("if v_candidate.status = 'PENDING_REVIEW' then"));
  assert(migrationSource.includes("must already be APPROVED or REJECTED"));
});

check("RPC exige permissão ADMINISTRADOR via has_project_permission (já embute pm.status = 'ACTIVE' e escopo por projeto)", () => {
  assert(migrationSource.includes("public.has_project_permission(\n    v_project_id,\n    'ADMINISTRADOR'\n  )"));
});

check("RPC valida a relação evento -> projeto (não confia em v_project_id externo)", () => {
  assert(migrationSource.includes("select ce.project_id"));
  assert(migrationSource.includes("from public.contract_events ce"));
  assert(migrationSource.includes("where ce.id = v_candidate.event_id;"));
});

check("RPC recusa justificativa vazia/curta (rede de segurança em SQL, além da validação completa em TS)", () => {
  assert(migrationSource.includes("v_new_note := nullif(trim(p_new_review_note), '');"));
  assert(migrationSource.includes("length(v_new_note) < 20"));
});

check("RPC altera EXCLUSIVAMENTE review_note + as 2 colunas de autoria da emenda — nunca status/aprovador/data original", () => {
  const updateBlockMatch = migrationSource.match(/update\s+public\.event_clause_confrontation_candidates\s+set([\s\S]*?)where id = p_candidate_id;/);
  assert(updateBlockMatch, "bloco UPDATE não encontrado");
  const setClause = updateBlockMatch[1];
  assert(setClause.includes("review_note = v_new_note"));
  assert(setClause.includes("review_note_amended_by_user_id = v_user_id"));
  assert(setClause.includes("review_note_amended_at = now()"));
  for (const forbidden of ["status =", "reviewed_by_user_id =", "reviewed_at =", "event_id =", "clause_id =", "severity =", "confidence =", "cross_reference_id ="]) {
    assert(!setClause.includes(forbidden), `UPDATE não pode tocar em "${forbidden}" — preservação de status/autoria original violada`);
  }
});

check("RPC nunca torna quem emendou o 'aprovador original' — reviewed_by_user_id/reviewed_at continuam intocados, só review_note_amended_* muda", () => {
  assert(!migrationSource.includes("reviewed_by_user_id = v_user_id"), "quem emendou não pode virar reviewed_by_user_id");
});

check("colunas novas (review_note_amended_by_user_id/at) só podem ser preenchidas para candidato já revisado — constraint estrutural", () => {
  assert(migrationSource.includes("event_clause_confrontation_candidates_amendment_consistency_check"));
  assert(migrationSource.includes("status in ('APPROVED', 'REJECTED')"));
});

check("RPC registra auditoria: projeto, evento (via candidato), candidato, usuário, texto anterior, texto novo, ação específica", () => {
  assert(migrationSource.includes("'CONFRONTATION_REVIEW_NOTE_AMENDED'"));
  assert(migrationSource.includes("'EVENT_CLAUSE_CONFRONTATION_CANDIDATE'"));
  assert(migrationSource.includes("actor_user_id,"));
  assert(migrationSource.includes("v_previous_note"));
  assert(migrationSource.includes("v_new_note"));
  assert(migrationSource.includes("p_candidate_id::text"));
});

check("RPC é SECURITY DEFINER com search_path seguro, revogada de public/anon e concedida só a authenticated", () => {
  assert(/security definer\s+set search_path = public/.test(migrationSource));
  assert(migrationSource.includes("revoke all\non function\npublic.amend_event_clause_confrontation_review_note(\n  uuid,\n  text\n)\nfrom public;"));
  assert(migrationSource.includes("from anon;"));
  assert(migrationSource.includes("to authenticated;"));
});

check("migration é puramente aditiva (ALTER TABLE ADD COLUMN + CREATE OR REPLACE FUNCTION) — nenhum DROP", () => {
  assert(!/drop\s+(table|column|function)/i.test(migrationSource), "migration de emenda não deveria remover nada");
});

// ---------- validação compartilhada (mesma usada em aprovar/rejeitar) ----------

check("emenda usa a MESMA validação compartilhada e determinística — texto genérico/vazio recusado, específico aceito", () => {
  assert(validateConfrontationJustification("").valid === false);
  assert(validateConfrontationJustification("Aprovado.").valid === false);
  assert(
    validateConfrontationJustification(
      "Complementando: o prazo de pagamento proposto no evento diverge do prazo contratual da cláusula 5.2."
    ).valid === true
  );
});

// ---------- app: server action + RPC ----------

const actionsSource = readSource("apps/web/app/[projectId]/ledger/[eventId]/actions.ts");

check("amendConfrontationReviewNoteAction valida com validateConfrontationJustification ANTES de chamar a RPC", () => {
  assert(actionsSource.includes("export async function amendConfrontationReviewNoteAction("));
  const fnIndex = actionsSource.indexOf("export async function amendConfrontationReviewNoteAction(");
  const fnBody = actionsSource.slice(fnIndex);
  const validateIndex = fnBody.indexOf("validateConfrontationJustification(newReviewNote)");
  const rpcIndex = fnBody.indexOf('"amend_event_clause_confrontation_review_note"');
  assert(validateIndex !== -1 && rpcIndex !== -1 && validateIndex < rpcIndex, "validação precisa ocorrer antes da chamada à RPC");
});

check("Server Action trata migration-não-aplicada (PGRST202/42883) com mensagem clara, nunca um erro genérico", () => {
  assert(actionsSource.includes('error.code === "PGRST202" || error.code === "42883"'));
  assert(actionsSource.includes("ainda não está disponível neste ambiente"));
});

check("usuário sem permissão é recusado pela mesma RPC/permissão central (has_project_permission) — nenhum bypass no Server Action", () => {
  assert(!/service_role|createSupabaseAdminClient/.test(actionsSource), "actions.ts não pode usar admin client para contornar RLS/permissão");
  assert(actionsSource.includes("createSupabaseServerClient()"), "deveria continuar usando o client de sessão (RLS real)");
});

// ---------- UI: aprovador original, data, quem complementou, quando ----------

const pageSource = readSource("apps/web/app/[projectId]/ledger/[eventId]/page.tsx");

check("página mostra aprovador/revisor ORIGINAL (nome resolvido via getUser) e data original", () => {
  assert(pageSource.includes("reviewerNameById.get(candidate.reviewedByUserId)"));
  assert(pageSource.includes("candidate.reviewedAt"));
});

check("página mostra quem complementou a justificativa e quando, só quando a emenda existe", () => {
  assert(pageSource.includes("candidate.reviewNoteAmendedAt"));
  assert(pageSource.includes("reviewerNameById.get(candidate.reviewNoteAmendedByUserId)"));
  assert(pageSource.includes("Justificativa complementada"));
});

check("formulário de emenda só é renderizado para canReview (ADMINISTRADOR) — demais usuários só veem leitura", () => {
  assert(/\{canReview \? \(\s*<ConfrontationReviewNoteAmendForm/.test(pageSource));
});

check("lib/event-clause-confrontation-review.ts: 42703 (coluna ainda não existe) cai para as colunas antigas — nunca quebra a tela por causa da migration não aplicada", () => {
  const source = readSource("apps/web/lib/event-clause-confrontation-review.ts");
  assert(source.includes('fullResult.error?.code === "42703"'));
  assert(source.includes("BASE_COLUMNS"));
});

// ---------- migration NÃO aplicada (verificação ao vivo, só leitura, quando configurado) ----------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !serviceKey) {
  console.log("");
  console.log("SKIP verificação ao vivo de 'migration não aplicada' — Supabase não configurado neste shell.");
} else {
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  await checkAsync("confirmação ao vivo: a coluna review_note_amended_by_user_id AINDA NÃO existe no banco real (migration não aplicada)", async () => {
    const { error } = await admin.from("event_clause_confrontation_candidates").select("review_note_amended_by_user_id").limit(1);
    assert(error !== null, "a coluna não deveria existir ainda — se este teste falhar, a migration foi aplicada em algum ambiente");
    assert(
      error.code === "42703" || /column .* does not exist/i.test(error.message),
      `erro inesperado (esperado 'undefined_column'): ${error.message}`
    );
  });

  await checkAsync("confirmação ao vivo: a função amend_event_clause_confrontation_review_note AINDA NÃO existe no banco real", async () => {
    const { error } = await admin.rpc("amend_event_clause_confrontation_review_note", {
      p_candidate_id: "00000000-0000-0000-0000-000000000000",
      p_new_review_note: "sonda de existência da função — nunca deveria ter efeito",
    });
    assert(error !== null, "a função não deveria existir ainda");
    assert(
      error.code === "PGRST202" || /Could not find the function/i.test(error.message),
      `erro inesperado (esperado 'function not found'): ${error.message}`
    );
  });
}

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exitCode = 1;
}
