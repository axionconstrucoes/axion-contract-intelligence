// Loader ESM mínimo: quando um specifier relativo sem extensão não
// resolve, tenta de novo com ".ts". Existe só para permitir que scripts
// Node standalone importem os módulos TypeScript de apps/web/lib/ai/**
// usando exatamente os mesmos imports extensionless que o bundler do
// Next.js já usa em todo o resto do projeto — sem precisar adicionar
// ".ts" nos imports do código-fonte nem mudar tsconfig.json.
//
// Uso, no topo do script (antes de qualquer import dinâmico dos módulos
// TS): ver scripts/analyze-event-with-commercial-director.mjs.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
    const hasExtension = /\.[a-zA-Z0-9]+$/.test(specifier);
    if (isRelative && !hasExtension) {
      return nextResolve(`${specifier}.ts`, context);
    }
    throw error;
  }
}
