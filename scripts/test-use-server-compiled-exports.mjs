// Guard COMPLEMENTAR a scripts/test-use-server-exports.mjs: aquele lê
// código-fonte (heurística sobre `export ...` literal); este lê o
// OUTPUT REALMENTE COMPILADO por `next build` (.next/server/chunks) e
// verifica, para cada chamada gerada pelo próprio compilador do Next.js
// (`ensureServerEntryExports([...])` — ver
// node_modules/next/dist/build/webpack/loaders/next-flight-loader/action-validate.js),
// que todo argumento é um identificador simples (uma referência a uma
// função declarada no módulo) — nunca uma expressão de objeto/array/
// string/encadeamento de propriedade.
//
// Por que isso importa além da varredura de código-fonte: um export
// runtime problemático pode chegar até um módulo "use server" por um
// caminho que a varredura de código-fonte (por arquivo, isolado) não
// enxerga sozinha — reexport indireto, barrel, `export * from`, ou
// qualquer outra composição entre módulos. O compilador do Next.js já
// resolveu tudo isso quando gera esta chamada; ler o resultado é mais
// confiável do que tentar reimplementar a resolução de módulos aqui.
//
// Requer um build de produção existente (`next build` em apps/web) —
// nunca compila por conta própria (evita duplicar/definir de novo a
// configuração de build do projeto).
//
// Uso:
//   cd apps/web && npx next build && cd .. && node scripts/test-use-server-compiled-exports.mjs

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const chunksDir = path.join(repoRoot, "apps", "web", ".next", "server", "chunks");

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

function assert(condition, message) {
  if (!condition) throw new Error(message ?? "assertion failed");
}

function findJsFiles(startDir) {
  const results = [];
  for (const entry of readdirSync(startDir)) {
    const full = path.join(startDir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      results.push(...findJsFiles(full));
    } else if (entry.endsWith(".js") && !entry.endsWith(".map")) {
      results.push(full);
    }
  }
  return results;
}

console.log("");
console.log("======================================");
console.log('"USE SERVER" COMPILED OUTPUT — TESTES');
console.log("======================================");
console.log("");

check(`.next/server/chunks existe (build de produção já rodou — ver instrução de uso no topo do arquivo)`, () => {
  assert(
    existsSync(chunksDir),
    `${path.relative(repoRoot, chunksDir)} não existe — rode "cd apps/web && npx next build" antes deste teste`
  );
});

if (existsSync(chunksDir)) {
  const jsFiles = findJsFiles(chunksDir);

  check(`ao menos um chunk compilado foi encontrado em ${jsFiles.length > 0 ? jsFiles.length : "0"} arquivo(s)`, () => {
    assert(jsFiles.length > 0, "nenhum arquivo .js encontrado em .next/server/chunks — build parece incompleto");
  });

  check(
    "todo argumento passado para ensureServerEntryExports(...) no output compilado é um identificador simples (referência a função), nunca um literal de objeto/array/string",
    () => {
      const callSitePattern = /ensureServerEntryExports\)\(\[([^\]]*)\]\)/g;
      let totalCalls = 0;
      const offenders = [];

      for (const file of jsFiles) {
        const source = readFileSync(file, "utf8");
        let match;
        while ((match = callSitePattern.exec(source)) !== null) {
          totalCalls += 1;
          const argsRaw = match[1].trim();
          const args = argsRaw.length === 0 ? [] : argsRaw.split(",").map((s) => s.trim());
          for (const arg of args) {
            const isSimpleIdentifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(arg);
            if (!isSimpleIdentifier) {
              offenders.push(`${path.relative(repoRoot, file)}: argumento suspeito "${arg}" em ensureServerEntryExports([${argsRaw}])`);
            }
          }
        }
      }

      assert(totalCalls > 0, "nenhuma chamada a ensureServerEntryExports foi encontrada — build parece não conter Server Actions, algo está errado com o build ou com este teste");
      assert(offenders.length === 0, `argumento(s) suspeito(s): ${offenders.join(" | ")}`);
    }
  );
}

console.log("");
console.log("======================================");
console.log(`RESULTADO: ${passed} passaram, ${failed} falharam`);
console.log("======================================");

if (failed > 0) {
  process.exit(1);
}
