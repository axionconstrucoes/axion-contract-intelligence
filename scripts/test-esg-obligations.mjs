// Testes da Comprovação de Obrigações ESG/SSMA: cálculo determinístico de
// risco (puro) + schema real (RLS, impersonação, auditoria, justificativa
// obrigatória, revisão ADMIN). Escopo estritamente contratual — nunca um
// sistema de ESG corporativo.
//
// Cria registros de teste reais contra o projeto de referência (via sessão
// autenticada real, RLS completo), e os remove ao final via service role.
// O registro de auditoria é permanente e legítimo (audit_log_entries é
// append-only por desenho) — não é "poluir produção": os dados
// operacionais em si são removidos. A revisão de teste usa status
// CUMPRIDO deliberadamente para nunca disparar a criação de um
// contract_event real (nenhuma obrigação fictícia deve aparecer no Event
// Ledger do projeto).
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/test-esg-obligations.mjs

import { createClient } from "@supabase/supabase-js";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const { computeObligationRisk } = await import("../apps/web/lib/esg/compute-obligation-risk");

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
console.log("OBRIGAÇÕES ESG/SSMA — TESTES");
console.log("======================================");
console.log("");

// ---------- regras determinísticas (seção 12/13/14) ----------

check("CUMPRIDO + evidência obrigatória presente -> risco LOW (OK)", () => {
  const r = computeObligationRisk({
    status: "CUMPRIDO",
    dueDate: null,
    today: "2026-08-22",
    requiresEvidence: true,
    evidenceCount: 1,
    hasPenaltyDescribed: false,
    previousRiskLevel: null,
  });
  assert(r.riskLevel === "LOW", `esperado LOW, obtido ${r.riskLevel}`);
});

check("CUMPRIDO sem evidência obrigatória -> risco elevado (ATENÇÃO)", () => {
  const r = computeObligationRisk({
    status: "CUMPRIDO",
    dueDate: null,
    today: "2026-08-22",
    requiresEvidence: true,
    evidenceCount: 0,
    hasPenaltyDescribed: false,
    previousRiskLevel: null,
  });
  assert(r.riskLevel !== "LOW", "deveria sinalizar atenção quando falta evidência obrigatória mesmo com CUMPRIDO");
});

check("PENDENTE próximo ao prazo -> ALERTA (risco acima de LOW)", () => {
  const r = computeObligationRisk({
    status: "PENDENTE",
    dueDate: "2026-08-25",
    today: "2026-08-22",
    requiresEvidence: false,
    evidenceCount: 0,
    hasPenaltyDescribed: false,
    previousRiskLevel: null,
  });
  assert(r.riskLevel !== "LOW", "prazo em 3 dias deveria elevar o risco");
});

check("PENDENTE vencido -> ALERTA (HIGH)", () => {
  const r = computeObligationRisk({
    status: "PENDENTE",
    dueDate: "2026-08-10",
    today: "2026-08-22",
    requiresEvidence: false,
    evidenceCount: 0,
    hasPenaltyDescribed: false,
    previousRiskLevel: null,
  });
  assert(r.riskLevel === "HIGH", `esperado HIGH para pendente vencido, obtido ${r.riskLevel}`);
});

check("NAO_CUMPRIDO -> ALERTA (HIGH ou CRITICAL)", () => {
  const r = computeObligationRisk({
    status: "NAO_CUMPRIDO",
    dueDate: null,
    today: "2026-08-22",
    requiresEvidence: false,
    evidenceCount: 0,
    hasPenaltyDescribed: false,
    previousRiskLevel: null,
  });
  assert(r.riskLevel === "HIGH" || r.riskLevel === "CRITICAL", `esperado HIGH/CRITICAL, obtido ${r.riskLevel}`);
});

check("NAO_CUMPRIDO com penalidade conhecida -> CRITICAL", () => {
  const r = computeObligationRisk({
    status: "NAO_CUMPRIDO",
    dueDate: null,
    today: "2026-08-22",
    requiresEvidence: false,
    evidenceCount: 0,
    hasPenaltyDescribed: true,
    previousRiskLevel: null,
  });
  assert(r.riskLevel === "CRITICAL", `esperado CRITICAL, obtido ${r.riskLevel}`);
});

check("prazo vencido em qualquer status ativo -> nunca abaixo de HIGH", () => {
  const r = computeObligationRisk({
    status: "CUMPRIDO_PARCIALMENTE",
    dueDate: "2026-08-01",
    today: "2026-08-22",
    requiresEvidence: false,
    evidenceCount: 1,
    hasPenaltyDescribed: false,
    previousRiskLevel: null,
  });
  assert(r.riskLevel === "HIGH" || r.riskLevel === "CRITICAL", `esperado HIGH/CRITICAL, obtido ${r.riskLevel}`);
});

check("NAO_APLICAVEL/DISPENSADO -> risco LOW (justificativa já é a mitigação)", () => {
  const r1 = computeObligationRisk({
    status: "NAO_APLICAVEL",
    dueDate: "2026-08-01",
    today: "2026-08-22",
    requiresEvidence: true,
    evidenceCount: 0,
    hasPenaltyDescribed: true,
    previousRiskLevel: "CRITICAL",
  });
  const r2 = computeObligationRisk({
    status: "DISPENSADO",
    dueDate: null,
    today: "2026-08-22",
    requiresEvidence: false,
    evidenceCount: 0,
    hasPenaltyDescribed: false,
    previousRiskLevel: null,
  });
  assert(r1.riskLevel === "LOW" && r2.riskLevel === "LOW", "dispensado/não aplicável nunca deveria gerar alerta");
});

check("reincidência: risco anterior CRITICAL eleva um novo registro de baixo risco", () => {
  const r = computeObligationRisk({
    status: "CUMPRIDO",
    dueDate: null,
    today: "2026-08-22",
    requiresEvidence: false,
    evidenceCount: 0,
    hasPenaltyDescribed: false,
    previousRiskLevel: "CRITICAL",
  });
  assert(r.riskLevel !== "LOW", "reincidência de risco crítico anterior deveria evitar queda direta para LOW");
});

check("cada resultado inclui motivos legíveis (nunca uma caixa-preta)", () => {
  const r = computeObligationRisk({
    status: "NAO_CUMPRIDO",
    dueDate: null,
    today: "2026-08-22",
    requiresEvidence: false,
    evidenceCount: 0,
    hasPenaltyDescribed: true,
    previousRiskLevel: null,
  });
  assert(Array.isArray(r.reasons) && r.reasons.length > 0, "reasons não deveria ser vazio");
});

// ---------- teste real: schema, RLS, impersonação, auditoria ----------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !serviceKey || !anonKey) {
  console.log("");
  console.log("SKIP testes reais de obrigações ESG/SSMA — Supabase não configurado.");
} else {
  const REFERENCE_PROJECT_ID = "00000000-0000-4000-8000-000000000001";
  const TEST_AUTHOR_EMAIL = "reynaldo@axion.com.br";

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

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

  let obligationId = null;
  let submissionId = null;
  let secondSubmissionId = null;

  await checkAsync("criação de obrigação (checklist) exige EDITOR/ADMIN e vincula origem contratual (texto livre)", async () => {
    const { data, error } = await authedClient
      .from("esg_obligations")
      .insert({
        project_id: REFERENCE_PROJECT_ID,
        title: "[TESTE AUTOMATIZADO — remover ao final] DDS semanal",
        category: "DDS",
        periodicity: "SEMANAL",
        description: "Obrigação de teste do script automatizado.",
        source_reference: "Anexo SSMA do contrato (teste)",
        required_evidence_description: "Lista de presença + foto",
        penalty_description: null,
        responsible_label: "Técnico de Segurança do Trabalho",
        created_by_user_id: authedUserId,
      })
      .select("id")
      .single();

    if (error) throw error;
    assert(data.id, "deveria retornar o id da obrigação criada");
    obligationId = data.id;
  });

  await checkAsync("ESG_OBLIGATION_CREATED foi registrado em audit_log_entries", async () => {
    const { data, error } = await admin
      .from("audit_log_entries")
      .select("id,action,entity_type,entity_id,actor_user_id")
      .eq("action", "ESG_OBLIGATION_CREATED")
      .eq("entity_id", obligationId)
      .maybeSingle();
    if (error) throw error;
    assert(data !== null, "deveria existir uma entrada de auditoria ESG_OBLIGATION_CREATED");
    assert(data.actor_user_id === authedUserId);
  });

  await checkAsync("submissão (comprovação) autenticada, autoautoria, é aceita (RLS)", async () => {
    const { data, error } = await authedClient
      .from("esg_obligation_submissions")
      .insert({
        project_id: REFERENCE_PROJECT_ID,
        obligation_id: obligationId,
        reference_date: "2026-08-15",
        reference_period_label: "Semana 33 (teste)",
        due_date: "2026-08-16",
        filled_by_user_id: authedUserId,
        status: "CUMPRIDO",
        risk_level: "LOW",
        dds_details: { tema: "Trabalho em altura", publico: "Equipe de estrutura", numeroParticipantes: 12 },
      })
      .select("id")
      .single();
    if (error) throw error;
    submissionId = data.id;
  });

  await checkAsync("múltiplos uploads: duas evidências (foto + documento) vinculadas à mesma submissão", async () => {
    const { error: e1 } = await authedClient.from("esg_obligation_evidence").insert({
      project_id: REFERENCE_PROJECT_ID,
      submission_id: submissionId,
      obligation_id: obligationId,
      evidence_kind: "FOTO",
      storage_bucket: "project-documents",
      file_path: `${REFERENCE_PROJECT_ID}/esg-evidence/${obligationId}/${submissionId}/teste-foto.jpg`,
      original_file_name: "teste-foto.jpg",
      mime_type: "image/jpeg",
      file_size_bytes: 1024,
      uploaded_by_user_id: authedUserId,
    });
    if (e1) throw e1;

    const { error: e2 } = await authedClient.from("esg_obligation_evidence").insert({
      project_id: REFERENCE_PROJECT_ID,
      submission_id: submissionId,
      obligation_id: obligationId,
      evidence_kind: "LISTA_PRESENCA",
      storage_bucket: "project-documents",
      file_path: `${REFERENCE_PROJECT_ID}/esg-evidence/${obligationId}/${submissionId}/teste-lista.pdf`,
      original_file_name: "teste-lista.pdf",
      mime_type: "application/pdf",
      file_size_bytes: 2048,
      uploaded_by_user_id: authedUserId,
    });
    if (e2) throw e2;

    const { data, error } = await admin.from("esg_obligation_evidence").select("id").eq("submission_id", submissionId);
    if (error) throw error;
    assert(data.length === 2, `esperadas 2 evidências, obtidas ${data.length}`);
  });

  await checkAsync("impersonação bloqueada: submissão em nome de outro usuário é rejeitada pela RLS", async () => {
    const FAKE_OTHER_USER = "00000000-0000-0000-0000-000000000001";
    const { data, error } = await authedClient.from("esg_obligation_submissions").insert({
      project_id: REFERENCE_PROJECT_ID,
      obligation_id: obligationId,
      reference_date: "2026-08-15",
      filled_by_user_id: FAKE_OTHER_USER,
      status: "CUMPRIDO",
    });
    assert(error !== null, "RLS deveria rejeitar filled_by_user_id diferente de auth.uid()");
    assert(!data, "nenhum dado deveria ser retornado");
  });

  await checkAsync("justificativa obrigatória: NAO_APLICAVEL sem justificativa é rejeitado pela constraint do banco", async () => {
    const { error } = await authedClient.from("esg_obligation_submissions").insert({
      project_id: REFERENCE_PROJECT_ID,
      obligation_id: obligationId,
      reference_date: "2026-08-16",
      filled_by_user_id: authedUserId,
      status: "NAO_APLICAVEL",
      justification: null,
    });
    assert(error !== null, "NAO_APLICAVEL sem justificativa nunca deveria ser aceito");
  });

  await checkAsync("justificativa obrigatória: DISPENSADO com justificativa preenchida é aceito", async () => {
    const { data, error } = await authedClient
      .from("esg_obligation_submissions")
      .insert({
        project_id: REFERENCE_PROJECT_ID,
        obligation_id: obligationId,
        reference_date: "2026-08-17",
        filled_by_user_id: authedUserId,
        status: "DISPENSADO",
        justification: "Justificativa de teste do script automatizado.",
      })
      .select("id")
      .single();
    if (error) throw error;
    secondSubmissionId = data.id;
  });

  await checkAsync("criação da submissão foi registrada em audit_log_entries (ESG_OBLIGATION_STATUS_UPDATED)", async () => {
    const { data, error } = await admin
      .from("audit_log_entries")
      .select("id,action,entity_id")
      .eq("action", "ESG_OBLIGATION_STATUS_UPDATED")
      .eq("entity_id", submissionId)
      .maybeSingle();
    if (error) throw error;
    assert(data !== null, "deveria existir uma entrada de auditoria ESG_OBLIGATION_STATUS_UPDATED para a criação da submissão");
  });

  await checkAsync("revisão via RPC (ADMIN) atualiza status e audita, sem gerar contract_event para caso rotineiro", async () => {
    const { data: beforeEvents, error: beforeError } = await admin
      .from("contract_events")
      .select("id")
      .eq("project_id", REFERENCE_PROJECT_ID);
    if (beforeError) throw beforeError;
    const beforeCount = beforeEvents.length;

    const { error } = await authedClient.rpc("review_esg_obligation_submission", {
      p_submission_id: submissionId,
      p_new_status: "CUMPRIDO",
      p_review_note: "Revisão de teste do script automatizado.",
    });
    if (error) throw error;

    const { data: afterEvents, error: afterError } = await admin
      .from("contract_events")
      .select("id")
      .eq("project_id", REFERENCE_PROJECT_ID);
    if (afterError) throw afterError;

    assert(
      afterEvents.length === beforeCount,
      "revisão para CUMPRIDO (caso rotineiro, sem risco crítico anterior) não deveria gerar contract_event"
    );
  });

  await checkAsync("ESG_OBLIGATION_REVIEWED foi registrado em audit_log_entries", async () => {
    const { data, error } = await admin
      .from("audit_log_entries")
      .select("id,action,entity_id,actor_user_id")
      .eq("action", "ESG_OBLIGATION_REVIEWED")
      .eq("entity_id", submissionId)
      .maybeSingle();
    if (error) throw error;
    assert(data !== null, "deveria existir uma entrada de auditoria ESG_OBLIGATION_REVIEWED");
    assert(data.actor_user_id === authedUserId);
  });

  await checkAsync("leitura (RLS): membro do projeto vê a obrigação e as submissões criadas", async () => {
    const { data: obligationRow, error: obligationError } = await authedClient
      .from("esg_obligations")
      .select("id,title")
      .eq("id", obligationId)
      .maybeSingle();
    if (obligationError) throw obligationError;
    assert(obligationRow !== null, "obrigação deveria ser legível pelo membro do projeto");

    const { data: submissionRows, error: submissionsError } = await authedClient
      .from("esg_obligation_submissions")
      .select("id")
      .eq("obligation_id", obligationId);
    if (submissionsError) throw submissionsError;
    assert(submissionRows.length === 2, `esperadas 2 submissões visíveis, obtidas ${submissionRows.length}`);
  });

  // ---------- limpeza ----------
  // Ordem respeita FKs: evidência (cascade da submissão) -> submissões ->
  // obrigação. O registro de auditoria permanece (append-only, correto).
  if (submissionId || secondSubmissionId) {
    const ids = [submissionId, secondSubmissionId].filter(Boolean);
    const { error: deleteSubmissionsError } = await admin.from("esg_obligation_submissions").delete().in("id", ids);
    if (deleteSubmissionsError) {
      console.log("AVISO: falha ao limpar submissões de teste:", deleteSubmissionsError.message);
    } else {
      console.log(`Limpeza: ${ids.length} submissão(ões) de teste removida(s).`);
    }
  }
  if (obligationId) {
    const { error: deleteObligationError } = await admin.from("esg_obligations").delete().eq("id", obligationId);
    if (deleteObligationError) {
      console.log("AVISO: falha ao limpar obrigação de teste:", deleteObligationError.message);
    } else {
      console.log(`Limpeza: obrigação de teste removida (id=${obligationId}).`);
    }
  }

  await checkAsync("após limpeza, a obrigação de teste não existe mais", async () => {
    const { data, error } = await admin.from("esg_obligations").select("id").eq("id", obligationId).maybeSingle();
    if (error) throw error;
    assert(data === null, "obrigação de teste deveria ter sido removida");
  });
}

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
