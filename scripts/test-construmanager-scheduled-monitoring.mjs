// Agendamento do monitoramento Construmanager e watchdog de falha.
//
// Duas metades:
//
//   1. o workflow observado passa a rodar sozinho (cron), continua sem
//      caminho de download e deixa de duplicar a deteccao de vigencia;
//   2. um watchdog transforma falha em issue — porque o Gmail Inbound
//      Sync falhou 8 vezes seguidas por ~25 h sem ninguem perceber.
//
// O script do watchdog vive dentro do YAML. Em vez de confiar em regex
// sobre o texto, esta suite EXTRAI o script e o EXECUTA contra dubles de
// `github`, `context` e `core`. Assim o que se testa e o comportamento,
// nao a aparencia do arquivo.
//
// Sem rede, sem credencial, sem GitHub real.
//
// Uso: node scripts/test-construmanager-scheduled-monitoring.mjs

import { readFileSync } from "node:fs";

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

function ler(rel) {
  return readFileSync(rel, "utf8").replace(/\r\n/g, "\n");
}

const MONITOR = ler(".github/workflows/construmanager-content-ingestion.yml");
const WATCHDOG = ler(".github/workflows/construmanager-monitoring-watchdog.yml");
const WORKER = ler("scripts/construmanager-metadata-worker.mjs");

console.log("=====================================================================");
console.log("AGENDAMENTO + WATCHDOG DE FALHA");
console.log("=====================================================================");
console.log("");

console.log("-- 1. Cron exato e disparo manual preservado --");

check("existe bloco schedule", /^\s{2}schedule:/m.test(MONITOR));
check('cron e exatamente "17 */6 * * *"', /- cron: "17 \*\/6 \* \* \*"/.test(MONITOR));
check("ha um unico cron", (MONITOR.match(/- cron:/g) ?? []).length === 1);
check("workflow_dispatch preservado", /^\s{2}workflow_dispatch:/m.test(MONITOR));
check("input project_id preservado", /project_id:/.test(MONITOR));

check(
  "concurrency preservada com cancel-in-progress: false",
  /group: construmanager-metadata-monitoring/.test(MONITOR) &&
    /cancel-in-progress: false/.test(MONITOR)
);
check("permissions continua contents: read", /permissions:\n\s*contents: read/.test(MONITOR));

// `inputs` so existe em workflow_dispatch. Numa execucao agendada ele vem
// vazio, e "" NAO e ausencia: sem fallback o worker receberia string
// vazia como project id e a sincronizacao agendada quebraria.
check(
  "project_id tem fallback para a execucao agendada",
  /inputs\.project_id \|\| '00000000-0000-4000-8000-000000000001'/.test(MONITOR)
);
check(
  "o worker ignora argumento vazio",
  /arg\.trim\(\) !== ""/.test(WORKER)
);

console.log("");
console.log("-- 2. Nenhum caminho de download --");

// Comentario nao e execucao. O cabecalho EXPLICA que nao existe caminho
// de download, e procurar o termo no arquivo inteiro reprovaria a
// propria explicacao. O que precisa estar limpo e o YAML executavel.
const MONITOR_EXECUTAVEL = MONITOR.split(String.fromCharCode(10))
  .filter((linha) => !/^\s*#/.test(linha))
  .join(String.fromCharCode(10));

check("nenhum step de ingestao de conteudo", !/- name: Ingest Construmanager content/.test(MONITOR_EXECUTAVEL));
check("worker de conteudo nao invocado", !/construmanager-content-worker\.mjs/.test(MONITOR_EXECUTAVEL));
check("interruptor de download nao lido", !/vars\.CONSTRUMANAGER_AUTO_DOWNLOAD_ENABLED/.test(MONITOR_EXECUTAVEL));
check("nenhuma referencia a Objeto/Download", !/Objeto\/Download/.test(MONITOR_EXECUTAVEL));
check("nenhum step alem dos declarados", (MONITOR_EXECUTAVEL.match(/- name:/g) ?? []).length === 4);

console.log("");
console.log("-- 3. Deteccao de vigencia UMA vez por sincronizacao --");

// O worker chama o detector ancorado no sync_run_id que acabou de criar.
check(
  "o worker chama o detector",
  /detect_construmanager_version_transitions/.test(WORKER)
);
check(
  "ancorado no syncRunId recem-criado",
  /p_sync_run_id: syncRunId/.test(WORKER)
);
check(
  "so depois de a sincronizacao ter gravado",
  WORKER.indexOf("const syncRunId") < WORKER.indexOf("detect_construmanager_version_transitions")
);
check(
  "sob interruptor proprio de monitoramento",
  WORKER.indexOf("resolveVersionMonitoringEnabled(process.env)") <
    WORKER.indexOf("detect_construmanager_version_transitions")
);

check(
  "o step independente de vigencia foi removido",
  !/- name: Monitor Construmanager version vigency/.test(MONITOR)
);
check(
  "o version-monitor nao e invocado pelo workflow",
  !/construmanager-version-monitor\.mjs/.test(MONITOR)
);
check(
  "o detector aparece uma unica vez no caminho executado",
  (MONITOR.match(/node scripts\/[a-z-]+\.mjs/g) ?? []).length === 1
);

// Sem chamador, mas preservado: reverter e voltar a chamar.
check(
  "o script version-monitor continua no repositorio",
  ler("scripts/construmanager-version-monitor.mjs").length > 0
);
check(
  "a variable de monitoramento continua tendo dono no worker",
  /CONSTRUMANAGER_VERSION_MONITORING_ENABLED/.test(MONITOR)
);

console.log("");
console.log("-- 4. Watchdog: gatilho, permissoes e isolamento --");

check(
  "gatilho workflow_run pelo nome exato",
  /workflows: \["Construmanager Metadata Monitoring"\]/.test(WATCHDOG)
);
check("apenas conclusoes", /types: \[completed\]/.test(WATCHDOG));
check("sem schedule proprio", !/^\s{2}schedule:/m.test(WATCHDOG));
check("sem workflow_dispatch", !/workflow_dispatch/.test(WATCHDOG));

check(
  "permissoes minimas: contents read + issues write",
  /permissions:\n\s*contents: read\n\s*issues: write/.test(WATCHDOG)
);
check(
  "nenhuma permissao alem dessas duas",
  (WATCHDOG.match(/^\s{2}[a-z-]+: (read|write)$/gm) ?? []).length === 2
);

check("nao faz checkout", !/actions\/checkout/.test(WATCHDOG));
check("nao usa secret algum", !/secrets\./.test(WATCHDOG));
check("nao instala dependencias", !/npm ci|npm install|setup-node/.test(WATCHDOG));
check("nao executa script do repositorio", !/run: node|node scripts\//.test(WATCHDOG));
check("tem timeout explicito", /timeout-minutes:\s*\d+/.test(WATCHDOG));
check("tem concurrency propria", /group: construmanager-monitoring-watchdog/.test(WATCHDOG));

console.log("");
console.log("-- 5. Watchdog: comportamento (script executado com dubles) --");

// Extrai o corpo de `script: |` e desindenta.
function extrairScript(yaml) {
  const linhas = yaml.split("\n");
  const inicio = linhas.findIndex((l) => /^\s*script: \|\s*$/.test(l));
  if (inicio === -1) throw new Error("bloco script nao encontrado");

  const indentacao = linhas[inicio].match(/^(\s*)/)[1].length + 2;
  const corpo = [];

  for (const linha of linhas.slice(inicio + 1)) {
    if (linha.trim() === "") {
      corpo.push("");
      continue;
    }
    const atual = linha.match(/^(\s*)/)[1].length;
    if (atual < indentacao) break;
    corpo.push(linha.slice(indentacao));
  }

  return corpo.join("\n");
}

const SCRIPT = extrairScript(WATCHDOG);
check("o script do watchdog foi extraido", SCRIPT.includes("workflow_run") || SCRIPT.includes("TITULO"));

const TITULO = "[ACC] Falha no monitoramento Construmanager";

function ambiente({ conclusion, nomeWorkflow = "Construmanager Metadata Monitoring", issues = true, abertas = [] }) {
  const acoes = [];

  const github = {
    rest: {
      repos: {
        get: async () => ({ data: { has_issues: issues } }),
      },
      issues: {
        listForRepo: async () => ({ data: abertas }),
        create: async (args) => {
          acoes.push({ tipo: "create", ...args });
          return { data: { number: 42 } };
        },
        createComment: async (args) => {
          acoes.push({ tipo: "comment", ...args });
          return { data: {} };
        },
        update: async (args) => {
          acoes.push({ tipo: "update", ...args });
          return { data: {} };
        },
      },
    },
  };

  const context = {
    repo: { owner: "axionconstrucoes", repo: "axion-contract-intelligence" },
    payload: {
      workflow_run: {
        name: nomeWorkflow,
        conclusion,
        id: 34080870149,
        html_url: "https://github.com/axionconstrucoes/axion-contract-intelligence/actions/runs/34080870149",
        head_branch: "main",
        head_sha: "7a9ca3574ec800017bb2169401e6bf162123378b",
        updated_at: "2026-09-07T03:50:00Z",
      },
    },
  };

  const core = { info: () => {}, warning: () => {} };

  return { github, context, core, acoes };
}

async function rodar(config) {
  const env = ambiente(config);
  const fn = new Function(
    "github",
    "context",
    "core",
    `return (async () => { ${SCRIPT} })();`
  );
  await fn(env.github, env.context, env.core);
  return env.acoes;
}

const issueAberta = { number: 7, title: TITULO, pull_request: undefined };

// (a) outro workflow -> ignora
const outro = await rodar({ conclusion: "failure", nomeWorkflow: "Gmail Inbound Sync" });
check("ignora conclusao de outro workflow", outro.length === 0);

// (b) Issues desabilitado -> nao escreve
const semIssues = await rodar({ conclusion: "failure", issues: false });
check("nao escreve se Issues estiver desabilitado", semIssues.length === 0);

// (c) primeira falha -> cria UMA issue
const primeira = await rodar({ conclusion: "failure" });
check("primeira falha cria issue", primeira.filter((a) => a.tipo === "create").length === 1);
check("cria exatamente uma", primeira.length === 1);
check("titulo exato", primeira[0].title === TITULO);
check("sem assignees", primeira[0].assignees === undefined);

// (d) falha seguinte -> comenta na MESMA, nao cria outra
const seguinte = await rodar({ conclusion: "failure", abertas: [issueAberta] });
check("falha seguinte nao cria issue nova", seguinte.filter((a) => a.tipo === "create").length === 0);
check("falha seguinte comenta na mesma issue", seguinte.some((a) => a.tipo === "comment" && a.issue_number === 7));

// (e) cancelled/timed_out tambem contam como falha
const cancelada = await rodar({ conclusion: "cancelled" });
check("conclusao 'cancelled' tambem registra", cancelada.filter((a) => a.tipo === "create").length === 1);
const expirada = await rodar({ conclusion: "timed_out", abertas: [issueAberta] });
check("conclusao 'timed_out' atualiza a existente", expirada.some((a) => a.tipo === "comment"));

// (f) sucesso com issue aberta -> NAO fecha e NAO comenta
const recuperado = await rodar({ conclusion: "success", abertas: [issueAberta] });

// Um run pode concluir `success` porque a sincronizacao esta DESLIGADA:
// o worker encerra em fail-closed com exit 0 sem tocar em nada. Fechar a
// issue ali afirmaria uma recuperacao que nunca houve. A confirmacao e
// humana.
check("sucesso NAO fecha a issue", !recuperado.some((a) => a.tipo === "update"));
check("sucesso NAO comenta na issue", !recuperado.some((a) => a.tipo === "comment"));
check("sucesso nao cria issue", recuperado.filter((a) => a.tipo === "create").length === 0);
check("sucesso com issue aberta nao faz escrita alguma", recuperado.length === 0);

// (g) sucesso sem issue aberta -> nada
const tranquilo = await rodar({ conclusion: "success" });
check("sucesso sem issue aberta nao faz nada", tranquilo.length === 0);

// (h) pull request nao e confundido com issue
const comPR = await rodar({
  conclusion: "failure",
  abertas: [{ number: 9, title: TITULO, pull_request: { url: "x" } }],
});
check("um PR de mesmo titulo nao e tratado como a issue", comPR.filter((a) => a.tipo === "create").length === 1);

console.log("");
console.log("-- 6. Conteudo da issue: sem log, sem segredo --");

const textos = [...primeira, ...seguinte, ...recuperado]
  .map((a) => `${a.title ?? ""}\n${a.body ?? ""}`)
  .join("\n");

check("inclui a conclusao", /failure|success/.test(textos));
check("inclui o run id", /34080870149/.test(textos));
check("inclui a URL do run", /actions\/runs\/34080870149/.test(textos));
check("inclui branch", /main/.test(textos));
check("inclui o SHA", /7a9ca3574ec800017bb2169401e6bf162123378b/.test(textos));
check("inclui data\/hora", /2026-09-07T03:50:00Z/.test(textos));

// O texto precisa dizer que ninguem fecha por ele.
check(
  "o corpo avisa que a issue nao se fecha sozinha",
  /NAO se fecha sozinha/.test(textos)
);

check("nao copia log do run", !/##\[error\]|Process completed with exit code/.test(textos));
check("nao carrega token opaco", !/[A-Za-z0-9_-]{45,}/.test(textos.replace(/7a9ca3574ec800017bb2169401e6bf162123378b/g, "")));
check("nao carrega sb_secret_", !/sb_secret_[A-Za-z0-9]/.test(textos));
check("nao carrega JWT", !/eyJ[A-Za-z0-9_-]{8,}/.test(textos));
check("nao carrega nome de arquivo", !/\.(dwg|pdf|ifc|xlsx)\b/i.test(textos));
check("nao carrega mensagem de erro da API", !/ListaMestra|Index was outside/i.test(textos));

// O script do watchdog nao le nem repassa o log do run monitorado.
check("o watchdog nao baixa logs", !/listJobsForWorkflowRun|downloadWorkflowRunLogs|logs/i.test(SCRIPT));

console.log("");
console.log("-- 7. Sem loop entre workflows --");

check(
  "o watchdog nao observa a si mesmo",
  !/workflows: \[[^\]]*Watchdog/.test(WATCHDOG)
);
check(
  "o watchdog nao dispara workflow algum",
  !/createWorkflowDispatch|workflow_dispatch|repos\.createDispatchEvent/.test(SCRIPT)
);
check(
  "o workflow monitorado nao observa o watchdog",
  !/workflow_run/.test(MONITOR)
);
check(
  "o watchdog nao faz push nem commit",
  !/git |createOrUpdateFileContents|createCommit/.test(SCRIPT)
);

console.log("");
console.log("=====================================================================");
console.log(`Resultado: ${passaram} passaram, ${falharam} falharam.`);
console.log("=====================================================================");

process.exit(falharam === 0 ? 0 : 1);
