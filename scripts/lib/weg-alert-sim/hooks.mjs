// Hooks de resolução de módulos SOMENTE para a simulação local dos alertas
// (scripts/test-weg-alert-simulation.mjs):
//  - "server-only" vira módulo vazio (o pacote real lança fora do Next.js);
//  - "@axion/db/admin" vira um stub que LANÇA ao criar o cliente: qualquer
//    caminho que tente falar com o Supabase real falha alto em vez de executar.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: "data:text/javascript,export default {};", shortCircuit: true };
  }
  if (specifier === "@axion/db/admin") {
    return {
      url: "data:text/javascript,export function createSupabaseAdminClient(){throw new Error('BLOQUEADO: cliente Supabase admin indisponivel na simulacao local');}",
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
