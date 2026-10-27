// Consulta ao especialista de SSMA no contexto de um registro de campo: isolamento por obra,
// somente leitura e provedor SIMULADO (nenhuma chamada paga, nenhuma rede, nenhum banco).
//
// Uso: node scripts/test-ssma-record-consult.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);
const core = await import("../apps/web/lib/ssma/field-records/run-record-consult.ts");
const { consultSsmaSpecialistForRecord } = await import("../apps/web/lib/ai/alert-consult/ssma-consult.ts");
const { createFakeAiProvider } = await import("../apps/web/lib/ai/providers/fake-provider.ts");
const spec = await import("../apps/web/lib/ai/alert-consult/specialties.ts");

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
const REC = "44444444-4444-4444-8444-444444444444";

function stubSupabase() {
  const rows = [{ id: P1, name: "Obra A", code: "A", client: "C", status: "ACTIVE" }];
  const from = () => {
    const q = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "maybeSingle" || prop === "single") return async () => ({ data: rows[0], error: null });
          if (prop === "then") return (resolve) => resolve({ data: rows, error: null, count: rows.length });
          return () => q;
        },
      }
    );
    return q;
  };
  return { from };
}

const record = {
  id: REC, kind: "OCORRENCIA", category: "Condição insegura", description: "Andaime sem guarda-corpo no 3º pavimento",
  location: "Bloco A", occurredAt: "2027-03-01T10:00:00Z", clientCreatedAt: "2027-03-01T10:01:00Z", receivedAt: "2027-03-01T12:00:00Z",
  risk: "ALTA", reportedById: "u1", reportedByName: "Ana", responsibleId: "u2", responsibleName: "Bruno", dueDate: "2027-03-05",
  photoCount: 2, evidenceCount: 0, photos: [],
  action: { id: "a1", status: "EM_ANDAMENTO", dueDate: "2027-03-05", concludedAt: null },
};

let consulted = [];
function makeDeps({ permission = "COLABORADOR", records = { [P1]: [record] } } = {}) {
  consulted = [];
  return {
    getPermission: async (projectId) => (projectId === P1 ? permission : null),
    loadRecord: async (projectId, recordId) => (records[projectId] ?? []).find((r) => r.id === recordId) ?? null,
    consult: async ({ projectId, recordContext, question }) => {
      consulted.push({ projectId, recordContext, question });
      return consultSsmaSpecialistForRecord(stubSupabase(), { projectId, recordContext, question, provider: createFakeAiProvider() });
    },
  };
}

console.log("\n======================================");
console.log("SSMA — CONSULTA AO ESPECIALISTA NO REGISTRO");
console.log("======================================\n");

await check("responde com o especialista de SSMA e provedor simulado; usa a pergunta padrão quando vazia", async () => {
  const out = await core.runSsmaRecordConsult(makeDeps(), { projectId: P1, recordId: REC, question: "" });
  assert.equal(out.ok, true);
  assert.equal(out.response.expertId, "esg-director");
  assert.equal(out.meta.isRealProvider, false);
  assert.equal(out.question, spec.DEFAULT_ALERT_CONSULT_QUESTION);
  assert.equal(out.response.requiresHumanReview, true);
});

await check("o contexto enviado traz só fatos registrados e deixa explícito que a ação NÃO está concluída", async () => {
  await core.runSsmaRecordConsult(makeDeps(), { projectId: P1, recordId: REC, question: "Como tratar?" });
  const ctx = consulted[0].recordContext;
  assert.match(ctx, /Andaime sem guarda-corpo/);
  assert.match(ctx, /Bloco A/);
  assert.match(ctx, /NÃO está concluída/);
  assert.match(ctx, /relato, não classificação contratual/);
});

await check("isolamento: sem vínculo com a obra, registro de outra obra e ids inválidos NÃO chegam ao especialista", async () => {
  const outsider = await core.runSsmaRecordConsult(makeDeps(), { projectId: P2, recordId: REC, question: "x" });
  assert.equal(outsider.ok, false);
  const other = await core.runSsmaRecordConsult(makeDeps({ records: { [P1]: [] } }), { projectId: P1, recordId: REC, question: "x" });
  assert.equal(other.ok, false);
  assert.match(other.error, /inexistente ou sem acesso/);
  const bad = await core.runSsmaRecordConsult(makeDeps(), { projectId: "x", recordId: REC, question: "x" });
  assert.equal(bad.ok, false);
  assert.equal(consulted.length, 0, "nenhuma consulta foi feita");
});

await check("perfil LEITURA pode consultar (somente leitura); o núcleo e a action não gravam nada", async () => {
  const out = await core.runSsmaRecordConsult(makeDeps({ permission: "LEITURA" }), { projectId: P1, recordId: REC, question: "x" });
  assert.equal(out.ok, true);
  for (const file of ["apps/web/lib/ssma/field-records/run-record-consult.ts", "apps/web/app/ssma/consult-actions.ts"]) {
    assert.ok(!/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|revalidate/.test(src(file)), file);
  }
});

await check("erro do especialista chega sem vazar chave/SQL", async () => {
  const deps = makeDeps();
  deps.consult = async () => ({ ok: false, error: "Falha ao consultar o especialista de SSMA." });
  const out = await core.runSsmaRecordConsult(deps, { projectId: P1, recordId: REC, question: "x" });
  assert.deepEqual(out, { ok: false, error: "Falha ao consultar o especialista de SSMA." });
});

console.log("");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
if (failed > 0) process.exit(1);
