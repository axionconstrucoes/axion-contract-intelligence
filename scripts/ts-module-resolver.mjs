// Loader ESM mínimo: quando um specifier relativo sem extensão não
// resolve, tenta de novo com ".ts". Também traduz o alias "@/..." usado
// em todo apps/web (tsconfig "paths": {"@/*": ["./*"]}) para um caminho
// absoluto dentro de apps/web — sem isso, nenhum módulo puro que importe
// outro módulo de apps/web/lib via "@/..." (padrão usado em todo o
// projeto) seria importável por um script Node standalone. Existe só
// para permitir que scripts Node standalone importem os módulos
// TypeScript de apps/web/lib/** usando exatamente os mesmos imports que
// o bundler do Next.js já usa em todo o resto do projeto — sem precisar
// adicionar ".ts" nos imports do código-fonte nem mudar tsconfig.json.
//
// Uso, no topo do script (antes de qualquer import dinâmico dos módulos
// TS): ver scripts/analyze-event-with-commercial-director.mjs.

import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const appsWebRoot = path.resolve(here, "..", "apps", "web");

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const aliased = pathToFileURL(path.join(appsWebRoot, specifier.slice(2))).href;
    return resolve(aliased, context, nextResolve);
  }

  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("file://");
    const hasExtension = /\.[a-zA-Z0-9]+$/.test(specifier);
    if (isRelative && !hasExtension) {
      return nextResolve(`${specifier}.ts`, context);
    }
    throw error;
  }
}
