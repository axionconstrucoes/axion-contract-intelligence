// Harness somente-leitura para a consulta conversacional "Perguntar ao
// Diretor Comercial IA" — demonstra escopo PROJECT e EVENT com o
// provider fake/determinístico. NUNCA grava nada.
//
// Uso:
//   node --env-file=apps/web/.env.local scripts/query-commercial-director.mjs "<pergunta>" [event-id]
//
// Sem event-id: consulta escopo PROJECT.
// Com event-id: consulta escopo EVENT.

import { createClient } from "@supabase/supabase-js";
import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const { answerCommercialDirectorQuery } = await import("../apps/web/lib/ai/experts/commercial-director/query");

const question = process.argv[2] ?? "Quais são os principais riscos comerciais deste projeto?";
const eventId = process.argv[3];
const projectId = process.argv[4] ?? "00000000-0000-4000-8000-000000000001";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !serviceKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SECRET_KEY são obrigatórios.");
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log("");
console.log("======================================");
console.log("PERGUNTAR AO DIRETOR COMERCIAL IA — HARNESS (somente leitura)");
console.log("======================================");
console.log("Escopo:", eventId ? "EVENT" : "PROJECT");
console.log("Projeto:", projectId);
if (eventId) console.log("Evento:", eventId);
console.log("Pergunta:", question);

const result = await answerCommercialDirectorQuery(supabase, {
  scope: eventId ? "EVENT" : "PROJECT",
  projectId,
  eventId,
  question,
});

console.log("");
console.log("--- ExpertQueryResponse (validado) ---");
console.log(JSON.stringify(result.response, null, 2));

console.log("");
console.log("--- Metadata de auditoria (desenho — nada foi gravado) ---");
console.log(JSON.stringify(result.audit, null, 2));

console.log("");
console.log("======================================");
console.log("HARNESS OK — nenhum dado foi criado, alterado, apagado ou enviado.");
console.log("======================================");
