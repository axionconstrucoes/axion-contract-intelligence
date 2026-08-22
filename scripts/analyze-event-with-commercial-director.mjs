// Harness somente-leitura para o Diretor Comercial IA
// (commercial-director). Monta o EventAnalysisContext de um evento real
// (reutilizando o context builder genérico, sem duplicação) e executa o
// Expert (provider fake/determinístico nesta fase).
//
// NUNCA grava nada: não cria/atualiza candidato, não cria
// cross-reference, não insere audit_log_entries, não envia comunicação
// alguma. Apenas SELECT + análise em memória + impressão no console.
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/analyze-event-with-commercial-director.mjs <event-id> [candidate-id]

import { createClient } from "@supabase/supabase-js";
import { register } from "node:module";

// Registra o loader ANTES de qualquer import dinâmico dos módulos TS —
// ver scripts/ts-module-resolver.mjs.
register("./ts-module-resolver.mjs", import.meta.url);

const { buildEventAnalysisContext } = await import("../apps/web/lib/ai/context/build-event-context");
const { runCommercialDirectorExpert } = await import("../apps/web/lib/ai/experts/commercial-director/index");

const eventId = process.argv[2];
const candidateId = process.argv[3];
const projectId = process.argv[4] ?? "00000000-0000-4000-8000-000000000001";

if (!eventId) {
  console.error("");
  console.error("Uso:");
  console.error(
    "node --env-file=apps/web/.env.local scripts/analyze-event-with-commercial-director.mjs <event-id> [candidate-id] [project-id]"
  );
  console.error("");
  process.exit(2);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !serviceKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SECRET_KEY são obrigatórios.");
}

// Somente leitura: este harness nunca precisa de sessão de usuário — usa a
// service role apenas para montar o contexto via SELECT, igual aos demais
// scripts de análise já existentes (ex.: analyze-event-confrontation.mjs).
const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log("");
console.log("======================================");
console.log("DIRETOR COMERCIAL IA — HARNESS (somente leitura)");
console.log("======================================");
console.log("Projeto:", projectId);
console.log("Evento:", eventId);
console.log("Candidato (opcional):", candidateId ?? "(nenhum — contexto completo do evento)");

const context = await buildEventAnalysisContext(supabase, {
  projectId,
  eventId,
  candidateId: candidateId || undefined,
});

console.log("");
console.log("--- Contexto montado (somente leitura, context builder reutilizado) ---");
console.log("Evento:", context.event.title, `(status ${context.event.status})`);
console.log("Evidências:", context.evidence.length);
console.log("Cláusulas relacionadas:", context.relatedClauses.length);
console.log("E-mails relacionados:", context.relatedEmails.length);
console.log("Candidatos de confrontação no contexto:", context.confrontationCandidates.length);

const result = await runCommercialDirectorExpert(context);

console.log("");
console.log("--- CommercialDirectorAssessment (validado) ---");
console.log(JSON.stringify(result.assessment, null, 2));

console.log("");
console.log("--- Metadata de auditoria (desenho — nada foi gravado) ---");
console.log(JSON.stringify(result.audit, null, 2));

console.log("");
console.log("======================================");
console.log("HARNESS OK — nenhum dado foi criado, alterado, apagado ou enviado.");
console.log("======================================");
