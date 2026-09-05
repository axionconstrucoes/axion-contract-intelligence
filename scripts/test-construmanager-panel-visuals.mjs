// Painel Construmanager — destaques magenta do campo de busca e do
// botão Baixar, e prova de que os badges de status NÃO foram tocados.
//
// Nenhuma chamada real, nenhum Supabase, nenhuma rede: só o código
// fonte e as constantes de estilo.
//
// Uso: node scripts/test-construmanager-panel-visuals.mjs

import { register } from "node:module";
import { readFileSync } from "node:fs";

register("./ts-module-resolver.mjs", import.meta.url);

const {
  CONSTRUMANAGER_MAGENTA,
  CONSTRUMANAGER_MAGENTA_HOVER,
  CONSTRUMANAGER_SEARCH_INPUT_CLASS,
  CONSTRUMANAGER_DOWNLOAD_BUTTON_CLASS,
  CONSTRUMANAGER_DOWNLOADING_LABEL,
} = await import("../apps/web/components/integrations/construmanager-panel-styles.ts");

let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) {
    console.log(`OK   ${name}`);
    passed += 1;
  } else {
    console.log(`FAIL ${name}`);
    failed += 1;
  }
}

const componentSource = readFileSync(
  "apps/web/components/integrations/construmanager-content-download.tsx",
  "utf8"
);

const badgeSource = readFileSync(
  "apps/web/components/integrations/construmanager-status-badge.tsx",
  "utf8"
);

console.log("");
console.log("PAINEL CONSTRUMANAGER — DESTAQUES MAGENTA");
console.log("=========================================");
console.log("");
console.log("-- 1. campo de pesquisa --");

check("fundo branco", /\bbg-white\b/.test(CONSTRUMANAGER_SEARCH_INPUT_CLASS));
check("texto preto", /\btext-black\b/.test(CONSTRUMANAGER_SEARCH_INPUT_CLASS));
check(
  "borda de 2 px",
  /\bborder-2\b/.test(CONSTRUMANAGER_SEARCH_INPUT_CLASS)
);
check(
  `borda na cor ${CONSTRUMANAGER_MAGENTA}`,
  CONSTRUMANAGER_SEARCH_INPUT_CLASS.includes("border-[#C2185B]")
);
check(
  "foco em magenta (anel + borda)",
  CONSTRUMANAGER_SEARCH_INPUT_CLASS.includes("focus-visible:ring-[#C2185B]") &&
    CONSTRUMANAGER_SEARCH_INPUT_CLASS.includes("focus-visible:border-[#C2185B]")
);
check(
  "placeholder legível sobre branco (não usa token de tema)",
  /placeholder:text-neutral-500/.test(CONSTRUMANAGER_SEARCH_INPUT_CLASS)
);
check(
  "o campo de busca do painel aplica o estilo",
  /className=\{`h-7 text-xs \$\{CONSTRUMANAGER_SEARCH_INPUT_CLASS\}`\}/.test(
    componentSource
  )
);

console.log("");
console.log("-- 2. botão Baixar por item --");

check(
  `fundo ${CONSTRUMANAGER_MAGENTA}`,
  CONSTRUMANAGER_DOWNLOAD_BUTTON_CLASS.includes("bg-[#C2185B]")
);
check("texto branco", /\btext-white\b/.test(CONSTRUMANAGER_DOWNLOAD_BUTTON_CLASS));
check("fonte em negrito", /\bfont-bold\b/.test(CONSTRUMANAGER_DOWNLOAD_BUTTON_CLASS));
check(
  `hover ${CONSTRUMANAGER_MAGENTA_HOVER}`,
  CONSTRUMANAGER_DOWNLOAD_BUTTON_CLASS.includes("hover:bg-[#9D174D]")
);
check(
  "desabilitado em cinza real (opacidade anulada)",
  CONSTRUMANAGER_DOWNLOAD_BUTTON_CLASS.includes("disabled:bg-neutral-400") &&
    CONSTRUMANAGER_DOWNLOAD_BUTTON_CLASS.includes("disabled:opacity-100")
);
check(
  "hover não é anulado pela opacidade da variante padrão",
  CONSTRUMANAGER_DOWNLOAD_BUTTON_CLASS.includes("hover:opacity-100")
);
check(
  'rótulo em execução é "Baixando..."',
  CONSTRUMANAGER_DOWNLOADING_LABEL === "Baixando..."
);
check(
  "o botão do item aplica o estilo",
  /className=\{`h-6 px-2 text-xs \$\{CONSTRUMANAGER_DOWNLOAD_BUTTON_CLASS\}`\}/.test(
    componentSource
  )
);
check(
  "o botão mostra o rótulo de execução só na linha clicada",
  /pending && activeLinkId === item\.linkId\s*\?\s*CONSTRUMANAGER_DOWNLOADING_LABEL\s*:\s*"Baixar"/.test(
    componentSource
  )
);
check(
  "o botão do item não usa mais a variante outline",
  !/variant="outline"[\s\S]{0,200}CONSTRUMANAGER_DOWNLOAD_BUTTON_CLASS/.test(
    componentSource
  )
);

console.log("");
console.log("-- 3. o que NÃO pode ter mudado --");

check(
  "PENDENTE segue amarelo/preto/negrito",
  /PENDENTE: "[^"]*bg-yellow-400[^"]*text-black[^"]*font-bold/.test(badgeSource)
);
check(
  "ATIVO (CONECTADO) segue verde/branco/negrito",
  /CONECTADO: "[^"]*bg-green-600[^"]*text-white[^"]*font-bold/.test(badgeSource)
);
check(
  "ARMAZENADO segue verde/branco/negrito",
  /ARMAZENADO: "[^"]*bg-green-600[^"]*text-white[^"]*font-bold/.test(badgeSource)
);
check(
  "ERRO segue vermelho/branco/negrito",
  /ERRO: "[^"]*bg-red-600[^"]*text-white[^"]*font-bold/.test(badgeSource)
);
check(
  "nenhum magenta vazou para os badges de status",
  !/C2185B|9D174D/.test(badgeSource)
);
check(
  "download em lote continua oculto",
  /const SHOW_BATCH_DOWNLOAD = false;/.test(componentSource) &&
    /\{SHOW_BATCH_DOWNLOAD \?/.test(componentSource)
);
check(
  "o botão de preparação NÃO recebeu o estilo do botão Baixar",
  (() => {
    const start = componentSource.indexOf("action={prepareAction}");
    const form = componentSource.slice(
      start,
      componentSource.indexOf("</form>", start)
    );
    return !form.includes("CONSTRUMANAGER_DOWNLOAD_BUTTON_CLASS");
  })()
);

console.log("");
console.log("-- 4. escopo: primitivos compartilhados intactos --");

check(
  "components/ui/button.tsx não foi tocado",
  !/C2185B|9D174D/.test(readFileSync("apps/web/components/ui/button.tsx", "utf8"))
);
check(
  "components/ui/input.tsx não foi tocado",
  !/C2185B|9D174D/.test(readFileSync("apps/web/components/ui/input.tsx", "utf8"))
);
check(
  "components/shared/badges.tsx não foi tocado",
  !/C2185B|9D174D/.test(
    readFileSync("apps/web/components/shared/badges.tsx", "utf8")
  )
);

console.log("");
console.log("=====================================================================");
console.log(`Resultado: ${passed} passaram, ${failed} falharam.`);

process.exit(failed === 0 ? 0 : 1);
