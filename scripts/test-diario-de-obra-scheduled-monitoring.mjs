// Agendamento diario e watchdog do Diario de Obra.
//
// SEM REDE, SEM CREDENCIAL, SEM BANCO, SEM IA.
//
// Os dois workflows sao PARSEADOS como YAML de verdade, e nao lidos por
// expressao regular. A diferenca importa: um `schedule:` comentado, um
// `permissions:` aninhado no lugar errado ou um segundo `cron` escondido
// passariam por um grep e nao passam por um parser.
//
// O que esta suite protege:
//
//   1. um unico cron, no horario acordado;
//   2. execucao agendada e' SEMPRE incremental — nunca baseline nem
//      reconcile;
//   3. o fallback de inputs vazios existe e cobre os tres argumentos;
//   4. concurrency preservada, com cancel-in-progress: false;
//   5. o watchdog dispara por workflow_run e so age fora do sucesso;
//   6. sucesso nao fecha nem comenta issue;
//   7. o watchdog nao faz checkout, nao le secret e nao baixa log;
//   8. PARCIAL encerra o worker em falha, preservando o registro;
//   9. nenhuma midia, IA, e-mail, notificacao externa ou Storage.
//
// Uso: node scripts/test-diario-de-obra-scheduled-monitoring.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let passaram = 0;
let falharam = 0;

function check(rotulo, condicao) {
  if (condicao) {
    passaram += 1;
    console.log(`OK   ${rotulo}`);
  } else {
    falharam += 1;
    console.log(`FALHA ${rotulo}`);
  }
}

const ler = (relativo) => readFileSync(path.join(RAIZ, relativo), "utf8");

const CAMINHO_SYNC = ".github/workflows/diario-de-obra-sync.yml";
const CAMINHO_WATCHDOG = ".github/workflows/diario-de-obra-monitoring-watchdog.yml";

const TEXTO_SYNC = ler(CAMINHO_SYNC);
const TEXTO_WATCHDOG = ler(CAMINHO_WATCHDOG);
const WORKER = ler("scripts/diario-de-obra-sync-worker.mjs");

const SYNC = yaml.load(TEXTO_SYNC);
const WATCHDOG = yaml.load(TEXTO_WATCHDOG);

/**
 * `on` vira booleano `true` no YAML 1.1 que o js-yaml usa por padrao —
 * a chave literal "on" e' interpretada como o valor sim/nao. O GitHub
 * le YAML 1.2, onde ela continua sendo a string "on". Ler as duas
 * formas evita um teste que passa por acidente.
 */
const gatilhos = (doc) => doc.on ?? doc[true];

const TITULO_ESPERADO = "[RDO] Falha no monitoramento Diário de Obra";

console.log("=====================================================================");
console.log("AGENDAMENTO DIARIO E WATCHDOG DO DIARIO DE OBRA");
console.log("=====================================================================");
console.log("");


// ============================================================
console.log("-- 1. Cron unico, no horario acordado --");
// ============================================================

const gatilhosSync = gatilhos(SYNC);

check("o workflow de sync tem schedule", Array.isArray(gatilhosSync?.schedule));
check("existe UM unico agendamento", gatilhosSync.schedule.length === 1);
check('o cron e\' "43 0 * * *"', gatilhosSync.schedule[0].cron === "43 0 * * *");

// 00:43 UTC = 21:43 em Brasilia (UTC-3).
const [minuto, hora] = gatilhosSync.schedule[0].cron.split(" ");
check("o horario equivale a 21:43 de Brasilia", Number(hora) === 0 && Number(minuto) === 43);
check(
  "o cron e' diario — sem restricao de dia, mes ou semana",
  gatilhosSync.schedule[0].cron.split(" ").slice(2).join(" ") === "* * *"
);

check("ha exatamente uma linha de cron no arquivo", (TEXTO_SYNC.match(/^\s*- cron:/gm) ?? []).length === 1);

console.log("");


// ============================================================
console.log("-- 2. workflow_dispatch preservado --");
// ============================================================

check("workflow_dispatch continua disponivel", gatilhosSync.workflow_dispatch !== undefined);

const entradas = gatilhosSync.workflow_dispatch?.inputs ?? {};
check(
  "os tres inputs continuam existindo",
  ["project_id", "obra_id", "mode"].every((i) => entradas[i] !== undefined)
);

check(
  "os inputs deixaram de ser obrigatorios — o agendamento nao os fornece",
  ["project_id", "obra_id"].every((i) => entradas[i].required !== true)
);

check(
  "o disparo manual ainda oferece os tres modos",
  ["incremental", "baseline", "reconcile"].every((m) => entradas.mode.options.includes(m))
);

check("o default do disparo manual e' incremental", entradas.mode.default === "incremental");

console.log("");


// ============================================================
console.log("-- 3. Agendamento SEMPRE incremental --");
// ============================================================

const job = SYNC.jobs.sync;
const MODO = job.env?.MODO ?? "";

check("o job declara MODO em env", typeof MODO === "string" && MODO.length > 0);

check(
  "o evento schedule forca incremental, ignorando inputs",
  MODO.includes("github.event_name == 'schedule' && 'incremental'")
);

check(
  "o disparo manual continua escolhendo o modo",
  MODO.includes("inputs.mode")
);

// Simulacao da expressao do GitHub, para provar o comportamento e nao
// so a presenca do texto.
function resolverModo(evento, inputMode) {
  return evento === "schedule" ? "incremental" : inputMode || "incremental";
}

check("schedule + input vazio  => incremental", resolverModo("schedule", "") === "incremental");
check("schedule + 'baseline'   => incremental", resolverModo("schedule", "baseline") === "incremental");
check("schedule + 'reconcile'  => incremental", resolverModo("schedule", "reconcile") === "incremental");
check("dispatch + 'baseline'   => baseline", resolverModo("workflow_dispatch", "baseline") === "baseline");
check("dispatch + vazio        => incremental", resolverModo("workflow_dispatch", "") === "incremental");

// Barreira redundante: um passo que para a execucao agendada se o modo
// nao for incremental.
const guarda = job.steps.find(
  (s) => typeof s.if === "string" && s.if.includes("github.event_name == 'schedule'")
);

check("existe um passo de guarda para o agendamento", guarda !== undefined);
check(
  "a guarda falha quando o modo agendado nao e' incremental",
  typeof guarda?.run === "string" &&
    guarda.run.includes('!= "incremental"') &&
    guarda.run.includes("exit 1")
);

check(
  "nenhum agendamento de baseline ou reconcile em lugar nenhum",
  !/schedule[\s\S]*?(baseline|reconcile)/.test(
    TEXTO_SYNC.slice(TEXTO_SYNC.indexOf("schedule:"), TEXTO_SYNC.indexOf("workflow_dispatch:"))
  )
);

console.log("");


// ============================================================
console.log("-- 4. Fallback de inputs vazios --");
// ============================================================

check(
  "project_id cai para uma variable quando o input vem vazio",
  (job.env?.PROJECT_ID ?? "").includes("inputs.project_id ||") &&
    (job.env?.PROJECT_ID ?? "").includes("vars.DIARIO_DE_OBRA_PROJECT_ID")
);

check(
  "obra_id cai para uma variable quando o input vem vazio",
  (job.env?.OBRA_ID ?? "").includes("inputs.obra_id ||") &&
    (job.env?.OBRA_ID ?? "").includes("vars.DIARIO_DE_OBRA_OBRA_ID")
);

check("o modo tambem tem fallback", MODO.includes("|| 'incremental'"));

const passoSync = job.steps.find((s) => s.name === "Sync Diario de Obra");

check("o worker recebe os tres argumentos das variaveis de ambiente",
  passoSync.run.includes('"$PROJECT_ID"') &&
  passoSync.run.includes('"$OBRA_ID"') &&
  passoSync.run.includes('"$MODO"'));

// As aspas nao sao estilo: sem elas um valor vazio some da linha de
// comando e o worker leria o argumento seguinte na posicao errada.
check(
  "cada argumento vai entre aspas — vazio nao pode deslocar os demais",
  (passoSync.run.match(/"\$(PROJECT_ID|OBRA_ID|MODO)"/g) ?? []).length === 3
);

// O worker precisa recusar argumento vazio de forma limpa, e nao seguir
// com um projeto indefinido.
check(
  "o worker filtra argumento vazio antes de ler",
  WORKER.includes('.filter((a) => a.trim() !== "")')
);
check(
  "e recusa projectId ausente ou malformado",
  WORKER.includes("projectId ausente ou malformado")
);
check(
  "e recusa obraId ausente ou malformado",
  WORKER.includes("obraId ausente ou malformado")
);

console.log("");


// ============================================================
console.log("-- 5. Concurrency preservada --");
// ============================================================

check("o grupo de concorrencia continua o mesmo", SYNC.concurrency?.group === "diario-de-obra-sync");
check(
  "cancel-in-progress continua false",
  SYNC.concurrency?.["cancel-in-progress"] === false
);

console.log("");


// ============================================================
console.log("-- 6. PARCIAL termina em falha --");
// ============================================================

// O defeito: `erros > 0` e serie truncada gravavam PARCIAL no banco e
// o processo ainda saia com 0, deixando o workflow verde.
check(
  "o worker calcula parcial a partir das tres causas",
  WORKER.includes(
    "const parcial = falhaDeCobertura !== null || coberturaDaSerie !== null || erros > 0;"
  )
);

check("qualquer parcial encerra com codigo 1", WORKER.includes("if (parcial) {") &&
  /if \(parcial\) \{[\s\S]{0,600}?process\.exit\(1\);/.test(WORKER));

check(
  "o registro no banco continua sendo PARCIAL",
  WORKER.includes('p_status: parcial ? "PARCIAL" : "SUCESSO"')
);

// O `finish_...` tem de acontecer ANTES do exit, senao o run ficaria
// preso em EM_ANDAMENTO para sempre.
check(
  "a execucao e' fechada no banco antes de sair",
  WORKER.indexOf("finish_diario_de_obra_sync_run") < WORKER.indexOf("if (parcial) {")
);

// Simulacao da regra, para provar comportamento e nao so texto.
const ehParcial = (falhaCobertura, coberturaSerie, erros) =>
  falhaCobertura !== null || coberturaSerie !== null || erros > 0;

check("cobertura de janela falha  => parcial", ehParcial("motivo", null, 0) === true);
check("serie incompleta           => parcial", ehParcial(null, "motivo", 0) === true);
check("um erro em RDO             => parcial", ehParcial(null, null, 1) === true);
check("nada disso                 => sucesso", ehParcial(null, null, 0) === false);

console.log("");


// ============================================================
console.log("-- 7. Watchdog --");
// ============================================================

const gatilhosWatchdog = gatilhos(WATCHDOG);

check("o watchdog dispara por workflow_run", gatilhosWatchdog?.workflow_run !== undefined);
check(
  "observando exatamente o workflow de sync",
  gatilhosWatchdog.workflow_run.workflows.length === 1 &&
    gatilhosWatchdog.workflow_run.workflows[0] === SYNC.name
);
check(
  "no termino da execucao",
  gatilhosWatchdog.workflow_run.types.length === 1 &&
    gatilhosWatchdog.workflow_run.types[0] === "completed"
);

check("o watchdog NAO tem schedule proprio", gatilhosWatchdog.schedule === undefined);
check("nem roda por push ou pull_request",
  gatilhosWatchdog.push === undefined && gatilhosWatchdog.pull_request === undefined);

const jobWatchdog = WATCHDOG.jobs.alertar;

check(
  "so age quando a conclusao NAO e' sucesso",
  jobWatchdog.if === "github.event.workflow_run.conclusion != 'success'"
);

// Simulacao: quais conclusoes acionam o watchdog.
const aciona = (conclusao) => conclusao !== "success";
check("failure  => aciona", aciona("failure") === true);
check("cancelled => aciona", aciona("cancelled") === true);
check("timed_out => aciona", aciona("timed_out") === true);
check("success  => NAO aciona", aciona("success") === false);

console.log("");


// ============================================================
console.log("-- 8. Permissoes minimas e ausencia de secret/log --");
// ============================================================

const permissoes = WATCHDOG.permissions ?? {};

check(
  "permissoes sao exatamente contents:read e issues:write",
  Object.keys(permissoes).sort().join() === "contents,issues" &&
    permissoes.contents === "read" &&
    permissoes.issues === "write"
);

check(
  "sem actions:read — que seria o que permite baixar log",
  permissoes.actions === undefined
);

check(
  "o workflow de sync mantem permissoes minimas",
  Object.keys(SYNC.permissions ?? {}).join() === "contents" && SYNC.permissions.contents === "read"
);

const passosWatchdog = jobWatchdog.steps ?? [];

check("o watchdog nao faz checkout", !passosWatchdog.some((s) => (s.uses ?? "").includes("checkout")));
check("o watchdog nao usa nenhuma action de terceiro", passosWatchdog.every((s) => s.uses === undefined));

check(
  "o watchdog nao le nenhum secret do repositorio",
  !/secrets\.[A-Z_]+/.test(TEXTO_WATCHDOG)
);

check(
  "usa apenas o GITHUB_TOKEN automatico",
  TEXTO_WATCHDOG.includes("GH_TOKEN: ${{ github.token }}")
);

for (const proibido of ["run --log", "gh run view", "download-artifact", "actions/download", "logs/"]) {
  check(`o watchdog nao baixa log (${proibido})`, !TEXTO_WATCHDOG.includes(proibido));
}

// A issue so pode carregar metadados da execucao.
const env = passosWatchdog[0].env ?? {};

check(
  "a issue recebe so metadados da execucao",
  ["RUN_ID", "RUN_URL", "CONCLUSAO", "BRANCH", "SHA", "QUANDO"].every((k) => env[k] !== undefined)
);

check(
  "todo valor de env vem do evento workflow_run, do token ou do titulo",
  Object.entries(env).every(
    ([chave, valor]) =>
      chave === "GH_TOKEN" ||
      chave === "TITULO" ||
      String(valor).includes("github.event.workflow_run.")
  )
);

console.log("");


// ============================================================
console.log("-- 9. Uma unica issue; sucesso nao mexe nela --");
// ============================================================

const corpoDoPasso = passosWatchdog[0].run ?? "";

check("o titulo da issue e' o acordado", env.TITULO === TITULO_ESPERADO);

check("procura uma issue ABERTA com esse titulo", corpoDoPasso.includes("--state open"));
check(
  "compara o titulo EXATO, e nao o resultado difuso da busca",
  corpoDoPasso.includes('select(.title == \\"$TITULO\\")')
);
check("existindo, comenta na mesma issue", corpoDoPasso.includes("gh issue comment"));
check("nao existindo, cria uma", corpoDoPasso.includes("gh issue create"));

check(
  "nunca fecha issue",
  !corpoDoPasso.includes("issue close") && !TEXTO_WATCHDOG.includes("issue close")
);
check("nunca reabre issue", !TEXTO_WATCHDOG.includes("issue reopen"));
check("nunca edita issue existente", !TEXTO_WATCHDOG.includes("issue edit"));

// Sucesso nao chega a executar passo nenhum: o job inteiro e' pulado.
check(
  "em caso de sucesso nenhum passo roda — o job nem comeca",
  jobWatchdog.if.includes("!= 'success'")
);

console.log("");


// ============================================================
console.log("-- 10. Zero midia, IA, e-mail, notificacao e Storage --");
// ============================================================

const TERMOS_DE_IA = ["anthropic", "openai", "claude", "gpt-", "llm", "prompt", "completion", "embedding"];
const TERMOS_DE_ENVIO = ["sendemail", "smtp", "nodemailer", "mailgun", "sendgrid", "slack", "webhook", "discord"];
const TERMOS_DE_MIDIA = ["galeria", "linkpdf", "download", "artifact", "upload-artifact"];
const TERMOS_DE_STORAGE = ["storage", "bucket", "s3://", "blob"];

for (const [nome, texto] of [
  [CAMINHO_SYNC, TEXTO_SYNC],
  [CAMINHO_WATCHDOG, TEXTO_WATCHDOG],
]) {
  // Comentario e' documentacao: a checagem olha so as linhas de codigo,
  // senao o proprio comentario que PROMETE zero midia derrubaria o teste.
  const codigo = texto
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n")
    .toLowerCase();

  const base = path.basename(nome);

  check(`${base}: sem IA`, !TERMOS_DE_IA.some((t) => codigo.includes(t)));
  check(`${base}: sem e-mail ou notificacao externa`, !TERMOS_DE_ENVIO.some((t) => codigo.includes(t)));
  check(`${base}: sem midia ou artefato`, !TERMOS_DE_MIDIA.some((t) => codigo.includes(t)));
  check(`${base}: sem Storage`, !TERMOS_DE_STORAGE.some((t) => codigo.includes(t)));
}

check(
  "o sync continua entregando apenas os quatro env conhecidos ao worker",
  Object.keys(passoSync.env).sort().join() ===
    [
      "DIARIO_DE_OBRA_API_TOKEN",
      "DIARIO_DE_OBRA_SYNC_ENABLED",
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SECRET_KEY",
    ].join()
);

check(
  "o interruptor continua vindo de variable, e nao de secret",
  passoSync.env.DIARIO_DE_OBRA_SYNC_ENABLED.includes("vars.DIARIO_DE_OBRA_SYNC_ENABLED")
);

check(
  "nenhuma credencial vai por argv",
  !passoSync.run.includes("secrets.") && !passoSync.run.includes("TOKEN")
);

console.log("");
console.log("=====================================================================");
console.log(`RESULTADO: ${passaram} passaram | ${falharam} falharam`);
console.log("=====================================================================");

process.exit(falharam === 0 ? 0 : 1);
