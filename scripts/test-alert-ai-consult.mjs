// CONSULTAR IA nos alertas — especialidades, pré-seleção por área, isolamento por obra,
// somente leitura e provedor SIMULADO (nenhuma chamada paga, nenhuma rede, nenhum banco).
//
// Uso: node scripts/test-alert-ai-consult.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);
const spec = await import("../apps/web/lib/ai/alert-consult/specialties.ts");
const orchestrator = await import("../apps/web/lib/ai/alert-consult/run-alert-consult.ts");
const link = await import("../apps/web/lib/alerts/ai-consult-link.ts");
const { createFakeAiProvider } = await import("../apps/web/lib/ai/providers/fake-provider.ts");

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(path.join(here, "..", p), "utf8").replace(/\r\n/g, "\n");

let passed = 0;
let failed = 0;
async function check(name, fn) {
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

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const EV = "33333333-3333-4333-8333-333333333333";
const form = (o) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const valid = { projectId: P1, subject: "evento", id: EV, specialty: "ssma", question: "Como mitigar?" };

console.log("\n======================================");
console.log("CONSULTAR IA — ALERTAS");
console.log("======================================\n");

await check("cinco especialidades pedidas + Geral, com os rótulos exatos", () => {
  assert.deepEqual(
    spec.ALERT_CONSULT_SPECIALTIES.map((s) => s.label),
    ["Contratual/Jurídico", "Engenharia", "Planejamento e Prazo", "SSMA", "Documentação e Entrega", "Geral"]
  );
});

await check("cada especialidade usa um Expert EXISTENTE (sem arquitetura paralela)", () => {
  const byId = Object.fromEntries(spec.ALERT_CONSULT_SPECIALTIES.map((s) => [s.id, s.expertId]));
  assert.deepEqual(byId, {
    juridico: "legal-consultant",
    engenharia: "planning-director",
    planejamento: "planning-director",
    ssma: "esg-director",
    documentacao: "legal-consultant",
    geral: "legal-consultant",
  });
});

await check("pergunta padrão exata", () => {
  assert.equal(
    spec.DEFAULT_ALERT_CONSULT_QUESTION,
    "Como tratar ou mitigar esta situação de risco? Apresente opções práticas de acordo com sua especialidade."
  );
});

await check("pré-seleção pela área cadastrada; sem área ou sem correspondência = Geral", () => {
  assert.equal(spec.preselectSpecialtyForArea("ENGENHARIA"), "engenharia");
  assert.equal(spec.preselectSpecialtyForArea("PLANEJAMENTO"), "planejamento");
  assert.equal(spec.preselectSpecialtyForArea("SSMA/ESG"), "ssma");
  assert.equal(spec.preselectSpecialtyForArea("JURÍDICO"), "juridico");
  assert.equal(spec.preselectSpecialtyForArea(null), "geral");
  assert.equal(spec.preselectSpecialtyForArea(undefined), "geral");
  for (const area of ["DIRETORIA", "ADMINISTRATIVO", "COMERCIAL", "FINANCEIRO", "ORÇAMENTO", "COMPRAS", "qualquer"]) {
    assert.equal(spec.preselectSpecialtyForArea(area), "geral", area);
  }
});

await check("formulário: contexto, especialidade e pergunta validados no servidor (fail-closed)", () => {
  assert.equal(spec.parseAlertConsultForm(form(valid)).ok, true);
  for (const bad of [
    { projectId: "x" },
    { id: "../etc" },
    { subject: "documento" },
    { subject: "" },
  ]) {
    const r = spec.parseAlertConsultForm(form({ ...valid, ...bad }));
    assert.equal(r.ok, false);
    assert.equal(r.error, spec.CONSULT_INVALID_CONTEXT_MESSAGE);
  }
  assert.equal(spec.parseAlertConsultForm(form({ ...valid, specialty: "ceo" })).ok, false);
  assert.equal(spec.parseAlertConsultForm(form({ ...valid, question: "   " })).error, "Digite uma pergunta.");
  assert.equal(spec.parseAlertConsultForm(form({ ...valid, question: "x".repeat(2001) })).ok, false);
});

await check("pergunta composta: foco da especialidade, contexto do registro, pergunta e regras (sem executar/concluir)", () => {
  const s = spec.getAlertConsultSpecialty("planejamento");
  const text = spec.composeSpecialtyQuestion(s, " Qual a saída? ", "Providência: As-built");
  assert.match(text, /\[Especialidade: Planejamento e Prazo\]/);
  assert.match(text, /Providência: As-built/);
  assert.match(text, /Pergunta do usuário: Qual a saída\?/);
  assert.match(text, /NÃO executa ações nem altera o alerta/);
  assert.match(text, /não afirme que uma providência foi concluída sem registro/);
  assert.ok(!spec.composeSpecialtyQuestion(s, "q", null).includes("Contexto do alerta"));
});

await check("link do e-mail: caminho no ACC, sem token/credencial", () => {
  const url = link.buildAiConsultUrl({ baseUrl: "https://acc.example.test/", projectId: P1, subject: "evento", id: EV });
  assert.equal(url, `https://acc.example.test/alertas/consulta-ia/${P1}/evento/${EV}`);
  assert.ok(!/token|secret|key|\?/.test(url));
});

// ---- orquestração com dependências simuladas -----------------------------------------------
function makeDeps(overrides = {}) {
  const calls = { permission: 0, load: [], run: [] };
  const deps = {
    async getPermission(projectId) {
      calls.permission += 1;
      return projectId === P1 ? "COLABORADOR" : null;
    },
    async loadSubject(projectId, subject, id) {
      calls.load.push({ projectId, subject, id });
      if (projectId !== P1) return null;
      return {
        projectId,
        subject,
        id,
        title: "Atraso na entrega",
        projectName: "Obra A",
        scope: subject === "evento" ? "EVENT" : "PROJECT",
        contextText: subject === "evento" ? null : "Providência: As-built",
        sources: [{ kind: "EVENTO", label: "Atraso na entrega", href: `/${projectId}/ledger/${id}` }],
      };
    },
    async runExpert(expertId, request, userQuestion) {
      calls.run.push({ expertId, request, userQuestion });
      return {
        response: {
          expertId,
          expertName: "Fake",
          expertVersion: "v0",
          scope: request.scope,
          question: request.question,
          fatosDocumentados: [],
          contextoInternoDeclarado: [],
          baseContratual: [],
          baseLegal: [],
          praticasNegociais: [],
          interpretacao: "x",
          riscos: [],
          severity: "LOW",
          recomendacoes: ["opção 1"],
          acoesSugeridas: [],
          informacoesFaltantes: ["falta X"],
          rascunhoSugerido: null,
          confidence: 0.5,
          requiresHumanReview: true,
        },
        audit: { providerId: "fake", model: null },
      };
    },
    ...overrides,
  };
  return { deps, calls };
}
const input = { projectId: P1, subject: "evento", id: EV, specialtyId: "ssma", question: " Como mitigar? " };

await check("consulta de evento: scope EVENT, Expert mapeado, pergunta do usuário preservada, fontes e provedor de TESTE", async () => {
  const { deps, calls } = makeDeps();
  const out = await orchestrator.runAlertConsult(deps, input);
  assert.equal(out.ok, true);
  assert.equal(calls.run.length, 1);
  assert.equal(calls.run[0].expertId, "esg-director");
  assert.equal(calls.run[0].request.scope, "EVENT");
  assert.equal(calls.run[0].request.eventId, EV);
  assert.equal(calls.run[0].request.projectId, P1);
  assert.equal(calls.run[0].userQuestion, "Como mitigar?");
  assert.equal(out.response.question, "Como mitigar?");
  assert.equal(out.specialtyLabel, "SSMA");
  assert.equal(out.meta.isRealProvider, false);
  assert.equal(out.sources.length, 1);
  assert.equal(out.response.requiresHumanReview, true);
});

await check("consulta de providência: scope PROJECT sem eventId e com o registro no contexto", async () => {
  const { deps, calls } = makeDeps();
  const out = await orchestrator.runAlertConsult(deps, { ...input, subject: "providencia", specialtyId: "documentacao" });
  assert.equal(out.ok, true);
  assert.equal(calls.run[0].expertId, "legal-consultant");
  assert.equal(calls.run[0].request.scope, "PROJECT");
  assert.equal(calls.run[0].request.eventId, undefined);
  assert.match(calls.run[0].request.question, /Providência: As-built/);
});

await check("isolamento: sem vínculo com a obra nada é carregado nem consultado", async () => {
  const { deps, calls } = makeDeps();
  const out = await orchestrator.runAlertConsult(deps, { ...input, projectId: P2 });
  assert.deepEqual(out, { ok: false, error: orchestrator.CONSULT_NO_ACCESS_MESSAGE });
  assert.equal(calls.load.length, 0);
  assert.equal(calls.run.length, 0);
});

await check("isolamento: alerta de outra obra (loader devolve null) não chega ao Expert", async () => {
  const { deps, calls } = makeDeps({ async loadSubject() { return null; } });
  const out = await orchestrator.runAlertConsult(deps, input);
  assert.deepEqual(out, { ok: false, error: orchestrator.CONSULT_NOT_FOUND_MESSAGE });
  assert.equal(calls.run.length, 0);
});

await check("defesa em profundidade: loader que devolve alerta de outra obra/id é recusado", async () => {
  for (const wrong of [{ projectId: P2 }, { id: "99999999-9999-4999-8999-999999999999" }]) {
    const { deps, calls } = makeDeps({
      async loadSubject(projectId, subject, id) {
        return { projectId, subject, id, title: "t", projectName: "p", scope: "EVENT", contextText: null, sources: [], ...wrong };
      },
    });
    const out = await orchestrator.runAlertConsult(deps, input);
    assert.equal(out.ok, false);
    assert.equal(calls.run.length, 0);
  }
});

await check("falha do provedor: mensagem genérica, sem vazar detalhe interno (chave, SQL, rede)", async () => {
  const { deps } = makeDeps({
    async runExpert() {
      throw new Error("401 invalid x-api-key sk-ant-SEGREDO relation \"contract_events\" does not exist");
    },
  });
  const out = await orchestrator.runAlertConsult(deps, input);
  assert.equal(out.ok, false);
  assert.ok(!/sk-ant|api-key|relation|contract_events/.test(out.error), out.error);
});

await check("bloqueio de prazo (mensagem redigida para a tela) é exibido; o resto não", async () => {
  const { ExpertQuerySafeError } = await import("../apps/web/lib/ai/expert-query-request.ts");
  const { deps } = makeDeps({
    async runExpert() {
      throw new ExpertQuerySafeError("Análise formal de prazo indisponível — cronograma ausente.");
    },
  });
  const out = await orchestrator.runAlertConsult(deps, { ...input, specialtyId: "planejamento" });
  assert.equal(out.ok, false);
  assert.match(out.error, /Análise formal de prazo indisponível/);
});

await check("a orquestração não possui capacidade de gravação: dependências só leem/consultam", () => {
  const code = src("apps/web/lib/ai/alert-consult/run-alert-consult.ts");
  assert.ok(!/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|revalidate/.test(code));
  assert.deepEqual(Object.keys(makeDeps().deps).sort(), ["getPermission", "loadSubject", "runExpert"]);
});

// ---- Expert real com provedor SIMULADO (fake), sem rede e sem banco -------------------------
function stubSupabase(tables) {
  const from = (table) => {
    const rows = tables[table] ?? [];
    const q = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "maybeSingle" || prop === "single") return async () => ({ data: rows[0] ?? null, error: null });
          if (prop === "then") return (resolve) => resolve({ data: rows, error: null, count: rows.length });
          return () => q;
        },
      }
    );
    return q;
  };
  return { from };
}

await check("Expert real + provedor fake: SSMA e Jurídico respondem sem chamada externa", async () => {
  const { runAlertConsultExpert } = await import("../apps/web/lib/ai/alert-consult/alert-consult-experts.ts");
  const supabase = stubSupabase({
    projects: [{ id: P1, name: "Obra A", code: "A", client: "C", status: "ACTIVE" }],
  });
  for (const expertId of ["esg-director", "legal-consultant"]) {
    const run = await runAlertConsultExpert(
      supabase,
      expertId,
      { scope: "PROJECT", projectId: P1, question: spec.composeSpecialtyQuestion(spec.getAlertConsultSpecialty("geral"), "Como mitigar?", "Registro X") },
      "Como mitigar?",
      createFakeAiProvider()
    );
    assert.equal(run.audit.providerId, "fake", expertId);
    assert.equal(run.response.requiresHumanReview, true);
    assert.ok(run.response.informacoesFaltantes.length > 0, "informa que nenhuma análise real foi feita");
  }
});

await check("Planejamento: a pergunta padrão (com texto de apoio) NÃO aciona o bloqueio de prazo; pedir impacto no prazo sem .mpp é bloqueado com mensagem segura", async () => {
  const { runAlertConsultExpert } = await import("../apps/web/lib/ai/alert-consult/alert-consult-experts.ts");
  const { ExpertQuerySafeError } = await import("../apps/web/lib/ai/expert-query-request.ts");
  const supabase = stubSupabase({ projects: [{ id: P1, name: "Obra A", code: "A", client: "C", status: "ACTIVE" }] });
  const s = spec.getAlertConsultSpecialty("planejamento");
  const ok = await runAlertConsultExpert(
    supabase,
    "planning-director",
    { scope: "PROJECT", projectId: P1, question: spec.composeSpecialtyQuestion(s, spec.DEFAULT_ALERT_CONSULT_QUESTION, "Prazo: 2027-01-01\nRisco registrado: ALTA") },
    spec.DEFAULT_ALERT_CONSULT_QUESTION,
    createFakeAiProvider()
  );
  assert.equal(ok.audit.providerId, "fake");
  await assert.rejects(
    runAlertConsultExpert(
      supabase,
      "planning-director",
      { scope: "PROJECT", projectId: P1, question: spec.composeSpecialtyQuestion(s, "Qual o impacto no prazo?", null) },
      "Qual o impacto no prazo?",
      createFakeAiProvider()
    ),
    (error) => error instanceof ExpertQuerySafeError && /\.mpp/.test(error.message)
  );
});

await check("adapter do SSMA: usa o especialista de SSMA, pergunta padrão e erro seguro", async () => {
  const { consultSsmaSpecialistForRecord } = await import("../apps/web/lib/ai/alert-consult/ssma-consult.ts");
  const supabase = stubSupabase({ projects: [{ id: P1, name: "Obra A", code: "A", client: "C", status: "ACTIVE" }] });
  const out = await consultSsmaSpecialistForRecord(supabase, { projectId: P1, recordContext: "Ocorrência: queda de material", provider: createFakeAiProvider() });
  assert.equal(out.ok, true);
  assert.equal(out.question, spec.DEFAULT_ALERT_CONSULT_QUESTION);
  assert.equal(out.response.expertId, "esg-director");
  assert.equal(out.meta.isRealProvider, false);
  const tooLong = await consultSsmaSpecialistForRecord(supabase, { projectId: P1, recordContext: "x", question: "y".repeat(2001) });
  assert.equal(tooLong.ok, false);
});

// ---- estrutura (segurança) ---------------------------------------------------------------
const PAGE_DIR = "apps/web/app/alertas/consulta-ia/[projectId]/[subject]/[id]";

await check("página (GET) não grava, não consulta o modelo e exige permissão na obra", () => {
  const page = src(`${PAGE_DIR}/page.tsx`);
  assert.ok(!/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|runAlertConsult|answer\w+Query/.test(page));
  assert.match(page, /getCurrentProjectPermission/);
  assert.match(page, /preselectSpecialtyForArea/);
});

await check("action: valida no servidor, usa permissão + loader por obra e não grava nada", () => {
  const action = src(`${PAGE_DIR}/actions.ts`);
  assert.match(action, /parseAlertConsultForm/);
  assert.match(action, /getCurrentProjectPermission/);
  assert.match(action, /loadAlertConsultSubject/);
  assert.ok(!/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|revalidatePath/.test(action));
});

await check("loader: sempre filtra por obra e usa o cliente do usuário (RLS), nunca service role", () => {
  const loader = src("apps/web/lib/ai/alert-consult/load-alert-consult-subject.ts");
  assert.ok((loader.match(/\.eq\("project_id", projectId\)/g) ?? []).length >= 2);
  assert.ok(!/service_role|createSupabaseAdmin|SERVICE_ROLE/.test(loader));
  assert.ok(!/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/.test(loader));
});

await check("nenhum segredo/provedor no cliente: painel não importa provedores nem lê variáveis de ambiente", () => {
  const panel = src(`${PAGE_DIR}/alert-consult-panel.tsx`);
  assert.ok(!/process\.env|ANTHROPIC|anthropic-provider|providers\//.test(panel));
  assert.match(panel, /A consulta não altera o alerta/);
  assert.match(panel, /Fontes utilizadas/);
  assert.match(panel, /DEFAULT_ALERT_CONSULT_QUESTION/);
});

await check("guard de prazo inspeciona só a pergunta do usuário (texto de apoio não bloqueia sozinho)", () => {
  const q = src("apps/web/lib/ai/experts/planning-director/query.ts");
  assert.match(q, /isFormalScheduleAssessmentQuestion\(options\.guardQuestion \?\? question\)/);
  const d = src("apps/web/lib/ai/alert-consult/alert-consult-experts.ts");
  assert.match(d, /guardQuestion: userQuestion/);
});

console.log("");
console.log(`Resultado: ${passed} passaram, ${failed} falharam.`);
if (failed > 0) process.exit(1);
