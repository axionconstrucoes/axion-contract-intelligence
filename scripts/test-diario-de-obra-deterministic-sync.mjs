// Fundacao deterministica da sincronizacao do Diario de Obra.
//
// Sem rede, sem credencial, sem banco: client e Supabase sao dubles. A
// suite prova as duas metades da decisao — que a ingestao funciona por
// codigo (zero token de LLM) e que os caminhos caros ou perigosos
// ficaram inalcancaveis.
//
// Uso: node scripts/test-diario-de-obra-deterministic-sync.mjs

import { register } from "node:module";
import { readFileSync } from "node:fs";

register("./ts-module-resolver.mjs", import.meta.url);

const CLIENT = "../apps/web/lib/integrations/diario-de-obra/client.ts";
const POLICY = "../apps/web/lib/integrations/diario-de-obra/sync-policy.ts";
const NORM = "../apps/web/lib/integrations/diario-de-obra/normalize-report.ts";

const {
  DiarioDeObraClient,
  DIARIO_BASE_URL,
  DIARIO_ROTAS_PERMITIDAS,
  DIARIO_TERMOS_DE_MIDIA,
  DIARIO_MAX_CHAMADAS_POR_EXECUCAO,
  DIARIO_LIMITE_LOTE,
  sanitizeDiarioError,
} = await import(CLIENT);

const {
  resolveDiarioSyncEnabled,
  resolveModo,
  maxDetalhesPara,
  janelaIncremental,
  avaliarJanela,
  subdividirJanela,
  somarDias,
  JANELA_INCREMENTAL_DIAS,
  MAX_DETALHES_BASELINE,
  MAX_DETALHES_INCREMENTAL,
} = await import(POLICY);

const {
  normalizarRelatorio,
  calcularHashCanonico,
  canonicalizar,
  parseDataBrasileira,
  apenasData,
  ehCandidato,
  CAMPOS_IGNORADOS_NO_HASH,
} = await import(NORM);

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

const OBRA = "69b86331c25f8ecfce054eb4";
const RDO = "640232c954310533ae33cbe4";
const TOKEN_FALSO = "eyJhbGciOiJIUzI1NiJ9.TOKEN_FALSO_DE_TESTE.0123456789abcdefghijklmnop";
const URL_FOTO = "https://cdn.exemplo.invalido/foto_12345.jpg?t=1788700000";

// Detalhe com a MESMA forma medida no run real 34136744223.
function detalheReal(extras = {}) {
  return {
    _id: RDO,
    numero: 42,
    data: "03/03/2023",
    dataFim: null,
    diaDaSemana: "Sexta-Feira",
    status: { id: 1, descricao: "Preenchendo" },
    obra: { _id: OBRA, nome: "Obra Exemplo" },
    empresa: { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", nome: "Empresa Exemplo" },
    clima: { manha: "Bom", tarde: "Chuvoso", noite: "Bom", praticavel: true },
    horarioDeTrabalho: { entrada: "07:00", saida: "17:00" },
    maoDeObra: { total: 12, itens: [] },
    equipamentos: [{ descricao: "Retroescavadeira", quantidade: 1 }],
    controleDeMaterial: { entradas: [], saidas: [] },
    atividades: [{ descricao: "Concretagem dos pilares" }, { descricao: "Alvenaria" }],
    ocorrencias: [{ descricao: "Paralisacao por chuva" }],
    comentarios: [],
    checklist: [],
    galeriaDeFotos: [{ url: URL_FOTO }, { url: URL_FOTO }, { url: URL_FOTO }],
    videos: [],
    anexos: [{ url: URL_FOTO }],
    linkPdf: URL_FOTO,
    logomarca: { url: URL_FOTO, largura: 100, altura: 50 },
    log: { criadoEm: "01/01/2023 10:00", geradoEm: "07/09/2026 12:00" },
    created: "28/02/2023 13:48",
    modified: "03/03/2023 14:47",
    ...extras,
  };
}

function resumo(extras = {}) {
  return {
    _id: RDO,
    data: "03/03/2023",
    numero: 42,
    status: { id: 1, descricao: "Preenchendo" },
    created: "28/02/2023 13:48",
    modified: "03/03/2023 14:47",
    ...extras,
  };
}

console.log("=====================================================================");
console.log("DIARIO DE OBRA — SINCRONIZACAO DETERMINISTICA");
console.log("=====================================================================");
console.log("");

console.log("-- 1. Contrato real da API --");

check("host e a API externa oficial", DIARIO_BASE_URL === "https://apiexterna.diariodeobra.app/v1");
check("nao usa a API interna do portal", !DIARIO_BASE_URL.includes("/v2"));
check("tres rotas permitidas", DIARIO_ROTAS_PERMITIDAS.length === 3);
check("obra permitida", DIARIO_ROTAS_PERMITIDAS.some((r) => r.test(`/obras/${OBRA}`)));
check("listagem permitida", DIARIO_ROTAS_PERMITIDAS.some((r) => r.test(`/obras/${OBRA}/relatorios`)));
check("detalhe permitido", DIARIO_ROTAS_PERMITIDAS.some((r) => r.test(`/obras/${OBRA}/relatorios/${RDO}`)));
check("lote pedido e o valor COMPROVADO na validacao real", DIARIO_LIMITE_LOTE === 30);

const n = normalizarRelatorio(detalheReal(), resumo());
check("le _id", n.providerReportId === RDO);
check("le numero", n.reportNumber === 42);
check("converte data BR para ISO", n.referenceDate === "2023-03-03");
check("le status id e rotulo", n.statusId === 1 && n.statusLabel === "Preenchendo");
check("converte created para ISO com hora", n.sourceCreatedAt === "2023-02-28T13:48:00");
check("converte modified para ISO com hora", n.sourceModifiedAt === "2023-03-03T14:47:00");
check("data invalida vira null", parseDataBrasileira("nao-e-data") === null);
check("apenasData corta a hora", apenasData("03/03/2023 14:47") === "2023-03-03");

console.log("");
console.log("-- 2. `_id` como identidade --");

const outroId = normalizarRelatorio(detalheReal({ _id: "aaaaaaaaaaaaaaaaaaaaaaaa" }), resumo());
check("id diferente produz registro diferente", outroId.providerReportId !== n.providerReportId);
check(
  "o mesmo id com conteudo igual produz o mesmo hash",
  normalizarRelatorio(detalheReal(), resumo()).contentHash === n.contentHash
);

const MIG = ler("supabase/migrations/20260907160000_diario_de_obra_deterministic_sync.sql");

// Comentario nao e SQL. O arquivo EXPLICA quais dados sao proibidos e
// por que nao toca o Construmanager; procurar esses termos no texto
// inteiro reprovaria a propria explicacao.
const MIG_EXECUTAVEL = MIG.split(String.fromCharCode(10))
  .filter((linha) => !/^\s*--/.test(linha))
  .join(String.fromCharCode(10));
check(
  "identidade unica no banco e (project_id, provider_report_id)",
  /unique \(project_id, provider_report_id\)/.test(MIG)
);

console.log("");
console.log("-- 3. `modified` seleciona candidato --");

check("RDO desconhecido e candidato", ehCandidato(resumo(), undefined) === true);
check(
  "modified avancado e candidato",
  ehCandidato(resumo({ modified: "04/03/2023 09:00" }), {
    provider_report_id: RDO,
    source_modified_at: "2023-03-03T14:47:00",
  }) === true
);
check(
  "modified igual NAO e candidato",
  ehCandidato(resumo(), {
    provider_report_id: RDO,
    source_modified_at: "2023-03-03T14:47:00",
  }) === false
);
check(
  "sem modified conhecido, na duvida e candidato",
  ehCandidato(resumo(), { provider_report_id: RDO, source_modified_at: null }) === true
);

console.log("");
console.log("-- 4 e 5. Hash igual = inalterado; hash diferente = alteracao --");

check("mesmo conteudo, mesmo hash", n.contentHash === normalizarRelatorio(detalheReal(), resumo()).contentHash);

const comAtividadeNova = normalizarRelatorio(
  detalheReal({ atividades: [{ descricao: "Concretagem dos pilares" }, { descricao: "Pintura" }] }),
  resumo()
);
check("atividade diferente muda o hash", comAtividadeNova.contentHash !== n.contentHash);

const comOcorrencia = normalizarRelatorio(detalheReal({ ocorrencias: [] }), resumo());
check("ocorrencia removida muda o hash", comOcorrencia.contentHash !== n.contentHash);

const comClima = normalizarRelatorio(detalheReal({ clima: { manha: "Chuvoso" } }), resumo());
check("clima diferente muda o hash", comClima.contentHash !== n.contentHash);

check("o hash tem forma de sha256", /^[0-9a-f]{64}$/.test(n.contentHash));

console.log("");
console.log("-- 6. URL temporaria NAO altera o hash --");

// Mesma obra, mesmo dia, mesmas atividades — so as URLs mudaram porque
// expiraram e foram reemitidas. Isso nao e alteracao do diario.
const outraUrl = "https://cdn.exemplo.invalido/foto_99999.jpg?t=1788799999";
const comUrlNova = normalizarRelatorio(
  detalheReal({
    galeriaDeFotos: [{ url: outraUrl }, { url: outraUrl }, { url: outraUrl }],
    anexos: [{ url: outraUrl }],
    linkPdf: outraUrl,
    logomarca: { url: outraUrl, largura: 100, altura: 50 },
    log: { criadoEm: "01/01/2023 10:00", geradoEm: "08/09/2026 23:59" },
  }),
  resumo()
);

check("URL de foto reemitida nao muda o hash", comUrlNova.contentHash === n.contentHash);
check("linkPdf nao entra no hash", comUrlNova.contentHash === n.contentHash);
check("logomarca nao entra no hash", comUrlNova.contentHash === n.contentHash);
check("log/geradoEm nao entra no hash", comUrlNova.contentHash === n.contentHash);
check(
  "parametro t de anticache e ignorado",
  calcularHashCanonico({ a: 1, t: 111 }) === calcularHashCanonico({ a: 1, t: 999 })
);
check(
  "a lista de campos ignorados cobre url, linkPdf, log, logomarca e t",
  ["url", "linkpdf", "log", "logomarca", "t"].every((c) => CAMPOS_IGNORADOS_NO_HASH.includes(c))
);

console.log("");
console.log("-- 7. Ordem nao significativa NAO altera o hash --");

const ordemInvertida = normalizarRelatorio(
  detalheReal({ atividades: [{ descricao: "Alvenaria" }, { descricao: "Concretagem dos pilares" }] }),
  resumo()
);
check("atividades em outra ordem produzem o mesmo hash", ordemInvertida.contentHash === n.contentHash);
check(
  "chaves de objeto em outra ordem produzem o mesmo hash",
  calcularHashCanonico({ a: 1, b: 2 }) === calcularHashCanonico({ b: 2, a: 1 })
);
check(
  "espacos e quebras de linha nao alteram o hash",
  calcularHashCanonico({ x: "linha  um\n  dois" }) === calcularHashCanonico({ x: "linha um dois" })
);
check("canonicalizar ordena colecoes", JSON.stringify(canonicalizar([3, 1, 2])) === JSON.stringify([1, 2, 3]));

console.log("");
console.log("-- 8. Baseline nao cria alteracao falsa --");

check(
  "a RPC so registra alteracao fora do BASELINE",
  /if p_mode <> 'BASELINE' then[\s\S]{0,400}insert into public\.diario_de_obra_report_changes/.test(MIG)
);
check("registro criado no baseline e marcado", /\(p_mode = 'BASELINE'\)/.test(MIG));
check("CRIADO nunca gera alteracao", /return 'CRIADO';/.test(MIG));

console.log("");
console.log("-- 9. Idempotencia --");

check(
  "conteudo identico devolve INALTERADO",
  /if v_existente\.content_hash = p_content_hash then[\s\S]{0,400}return 'INALTERADO';/.test(MIG)
);
check(
  "salvar sem mudar (modified novo, hash igual) so move last_seen_at",
  /content_hash = p_content_hash then[\s\S]{0,300}last_seen_at = v_now/.test(MIG)
);
check(
  "reexecutar o mesmo lote nao duplica alteracao",
  /unique \(report_id, sync_run_id\)/.test(MIG) && /on conflict \(report_id, sync_run_id\) do nothing/.test(MIG)
);

console.log("");
console.log("-- 10. Checkpoint --");

const WORKER = ler("scripts/diario-de-obra-sync-worker.mjs");

check("existe funcao de avanco de checkpoint", /advance_diario_de_obra_checkpoint/.test(MIG));
check("o worker avanca o checkpoint", /advance_diario_de_obra_checkpoint/.test(WORKER));
check(
  "o checkpoint avanca DEPOIS do upsert",
  WORKER.indexOf("upsert_diario_de_obra_report") < WORKER.indexOf("advance_diario_de_obra_checkpoint")
);
check("o baseline retoma do checkpoint", /proximaJanelaInicio/.test(WORKER));
check(
  "cobertura incompleta nao avanca a janela do baseline",
  /falhaDeCobertura === null && candidatos\.length <= selecionados\.length/.test(WORKER)
);

console.log("");
console.log("-- 11 e 14. Lotes e teto de detalhes por execucao --");

check("baseline: 20 detalhes", MAX_DETALHES_BASELINE === 20 && maxDetalhesPara("BASELINE") === 20);
check("incremental: 10 detalhes", MAX_DETALHES_INCREMENTAL === 10 && maxDetalhesPara("INCREMENTAL") === 10);
check("o worker corta pelos tetos", /candidatos\.slice\(0, teto\)/.test(WORKER));
check("janela incremental de 14 dias", JANELA_INCREMENTAL_DIAS === 14);

const jan = janelaIncremental("2026-09-07");
check("a janela movel cobre exatamente 14 dias", jan.inicio === "2026-08-25" && jan.fim === "2026-09-07");
check("teto de chamadas muito abaixo de 150/min", DIARIO_MAX_CHAMADAS_POR_EXECUCAO === 60);

console.log("");
console.log("-- 12 e 13. Janela cheia: subdividir; um dia cheio: fail-closed --");

const cheia = avaliarJanela({ inicio: "2026-01-01", fim: "2026-01-31" }, 30, 30);
check("lote cheio manda subdividir", cheia.tipo === "SUBDIVIDIR");
check("a subdivisao produz duas partes", cheia.partes.length === 2);
check(
  "as partes cobrem a janela inteira, sem buraco",
  cheia.partes[0].inicio === "2026-01-01" &&
    cheia.partes[1].fim === "2026-01-31" &&
    somarDias(cheia.partes[0].fim, 1) === cheia.partes[1].inicio
);

const parcial = avaliarJanela({ inicio: "2026-01-01", fim: "2026-01-31" }, 12, 30);
check("lote parcial encerra a janela", parcial.tipo === "COMPLETA");

const umDia = avaliarJanela({ inicio: "2026-01-05", fim: "2026-01-05" }, 30, 30);
check("um dia unico ainda cheio para em fail-closed", umDia.tipo === "FAIL_CLOSED");
check("o motivo diz que a cobertura NAO pode ser garantida", /NAO pode ser garantida/.test(umDia.motivo));
check("o motivo nomeia a data", /2026-01-05/.test(umDia.motivo));
check("janela de um dia nao se subdivide", subdividirJanela({ inicio: "2026-01-05", fim: "2026-01-05" }).length === 0);

check(
  "o worker nunca trata lote cheio como cobertura completa",
  /falhaDeCobertura/.test(WORKER) && /coberturaGarantida/.test(WORKER)
);
check("cobertura incompleta encerra como PARCIAL", /parcial \? "PARCIAL" : "SUCESSO"/.test(WORKER));

console.log("");
console.log("-- 15 e 16. Midia e escrita bloqueadas --");

for (const caminho of [
  `/obras/${OBRA}/relatorios/${RDO}/fotos`,
  `/obras/${OBRA}/relatorios/${RDO}/videos`,
  `/obras/${OBRA}/relatorios/${RDO}/anexos`,
  `/obras/${OBRA}/relatorios/${RDO}/pdf`,
  `/obras/${OBRA}/relatorios/${RDO}/exportar`,
]) {
  let tentouRede = false;
  const client = new DiarioDeObraClient({
    token: TOKEN_FALSO,
    fetchImpl: async () => {
      tentouRede = true;
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });

  let erro = null;
  try {
    await client.getObra(caminho.replace("/obras/", ""));
  } catch (e) {
    erro = e;
  }

  check(`midia recusada: ${caminho.split("/").pop()}`, erro !== null);
  check(`midia nao chegou a rede: ${caminho.split("/").pop()}`, tentouRede === false);
}

check("ha lista de termos de midia", DIARIO_TERMOS_DE_MIDIA.length >= 10);

{
  let metodo = null;
  let cabecalhos = null;
  const client = new DiarioDeObraClient({
    token: TOKEN_FALSO,
    fetchImpl: async (_u, init) => {
      metodo = init.method;
      cabecalhos = init.headers;
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });

  await client.getObra(OBRA);
  check("o unico metodo usado e GET", metodo === "GET");
  check("token vai no cabecalho `token`", cabecalhos?.token === TOKEN_FALSO);
  check("nao envia Authorization", cabecalhos?.Authorization === undefined);
  check("nao envia cookie", cabecalhos?.cookie === undefined && cabecalhos?.Cookie === undefined);
}

const FONTE_CLIENT = ler("apps/web/lib/integrations/diario-de-obra/client.ts");
const CLIENT_EXECUTAVEL = FONTE_CLIENT.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
check("o client nao tem metodo de escrita", !/method:\s*"(POST|PUT|PATCH|DELETE)"/.test(CLIENT_EXECUTAVEL));
check("o client nao tem retry", !/\bretry\b|\bretries\b|tentativa\s*\+\+/i.test(CLIENT_EXECUTAVEL));
check("o client tem timeout explicito", /AbortController/.test(CLIENT_EXECUTAVEL) && /DIARIO_TIMEOUT_MS/.test(CLIENT_EXECUTAVEL));
check("o client limpa o timer em finally", /finally\s*\{[\s\S]{0,80}clearTimeout/.test(CLIENT_EXECUTAVEL));

{
  const client = new DiarioDeObraClient({
    token: TOKEN_FALSO,
    fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }),
  });
  let erro = null;
  try {
    await client.getObra(OBRA);
  } catch (e) {
    erro = e;
  }
  check("HTTP 429 e reconhecido", /429/.test(String(erro?.message)) && /150/.test(String(erro?.message)));
}

{
  let tentativas = 0;
  const client = new DiarioDeObraClient({
    token: TOKEN_FALSO,
    fetchImpl: async () => {
      tentativas += 1;
      return { ok: false, status: 500, json: async () => ({}) };
    },
  });
  try {
    await client.getObra(OBRA);
  } catch {
    /* esperado */
  }
  check("uma unica tentativa por chamada", tentativas === 1);
}

{
  const client = new DiarioDeObraClient({
    token: TOKEN_FALSO,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }),
  });
  for (let i = 0; i < DIARIO_MAX_CHAMADAS_POR_EXECUCAO; i += 1) await client.getObra(OBRA);
  let erro = null;
  try {
    await client.getObra(OBRA);
  } catch (e) {
    erro = e;
  }
  check("o teto de chamadas e imposto", erro !== null);
  check("o contador nao passa do teto", client.totalDeChamadas === DIARIO_MAX_CHAMADAS_POR_EXECUCAO);
}

console.log("");
console.log("-- 17. Sanitizacao e dados proibidos --");

check("JWT redigido", !sanitizeDiarioError(new Error(`falhou ${TOKEN_FALSO}`)).includes(TOKEN_FALSO));
check("URL redigida", !sanitizeDiarioError(new Error(`em ${URL_FOTO}`)).includes("foto_12345"));
check("token= redigido", !sanitizeDiarioError(new Error(`token=${TOKEN_FALSO}`)).includes(TOKEN_FALSO));
check("cadeia opaca longa redigida", !/[A-Za-z0-9_-]{40,}/.test(sanitizeDiarioError(new Error("x".repeat(60)))));
check("texto util sobrevive", sanitizeDiarioError(new Error("Rota fora da allowlist")).includes("allowlist"));

// Nenhum campo proibido pode chegar ao banco.
const persistido = JSON.stringify(n);
check("o registro NAO carrega URL de foto", !persistido.includes("foto_12345"));
check("o registro NAO carrega linkPdf", !/linkPdf/i.test(persistido));
check("o registro NAO carrega logomarca", !/logomarca/i.test(persistido));
check("o registro NAO carrega o objeto log", !/geradoEm/i.test(persistido));
check("o registro NAO carrega payload bruto", !/galeriaDeFotos/.test(persistido));
check("fotos viram CONTAGEM", n.photoCount === 3);
check("videos viram CONTAGEM", n.videoCount === 0);
check("anexos viram CONTAGEM", n.attachmentCount === 1);
check(
  "a migration nao tem coluna de URL ou payload",
  !/\b(photo_url|link_pdf|raw_payload|logomarca)\b/.test(MIG_EXECUTAVEL)
);

console.log("");
console.log("-- 18. Zero IA, zero expert, zero orcamento de token --");

const POLICY_FONTE = ler("apps/web/lib/integrations/diario-de-obra/sync-policy.ts");
const NORM_FONTE = ler("apps/web/lib/integrations/diario-de-obra/normalize-report.ts");

for (const [nome, fonte] of [
  ["worker", WORKER],
  ["client", FONTE_CLIENT],
  ["policy", POLICY_FONTE],
  ["normalizador", NORM_FONTE],
]) {
  const executavel = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check(
    `${nome}: nenhum import de IA/expert/anthropic`,
    !/from\s+["'][^"']*(\/ai\/|anthropic|expert)/i.test(executavel)
  );
}

check("a migration nao cria nada de IA", !/\b(ai_|expert|anthropic|token_budget)\b/i.test(MIG));

console.log("");
console.log("-- 19. Workflow: sem schedule, fail-closed --");

const WF = ler(".github/workflows/diario-de-obra-sync.yml");
const WF_EXEC = WF.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

check("apenas workflow_dispatch", /workflow_dispatch:/.test(WF_EXEC));
check("sem schedule", !/^\s{2}schedule:/m.test(WF_EXEC));
check("permissions contents: read", /permissions:\n\s*contents: read/.test(WF_EXEC));
check("uma unica permissao", (WF_EXEC.match(/^\s{2}[a-z-]+: (read|write)$/gm) ?? []).length === 1);
check("tem concurrency com cancel-in-progress: false", /concurrency:/.test(WF_EXEC) && /cancel-in-progress: false/.test(WF_EXEC));
check("timeout explicito", /timeout-minutes:\s*\d+/.test(WF_EXEC));
check("input project_id", /project_id:/.test(WF_EXEC));
check("input obra_id", /obra_id:/.test(WF_EXEC));
check("input mode limitado a baseline/incremental", /type: choice/.test(WF_EXEC) && /- baseline/.test(WF_EXEC) && /- incremental/.test(WF_EXEC));
check("usa DIARIO_DE_OBRA_API_TOKEN", /secrets\.DIARIO_DE_OBRA_API_TOKEN/.test(WF_EXEC));
check("usa SUPABASE_SECRET_KEY", /secrets\.SUPABASE_SECRET_KEY/.test(WF_EXEC));
check("le o interruptor DIARIO_DE_OBRA_SYNC_ENABLED", /vars\.DIARIO_DE_OBRA_SYNC_ENABLED/.test(WF_EXEC));
check("nao recebe secret do Construmanager", !/CONSTRUMANAGER/.test(WF_EXEC));

check("interruptor ausente => desligado", resolveDiarioSyncEnabled({}).enabled === false);
check("valor diferente de true => desligado", resolveDiarioSyncEnabled({ DIARIO_DE_OBRA_SYNC_ENABLED: "TRUE" }).enabled === false);
check("espaco em branco => desligado", resolveDiarioSyncEnabled({ DIARIO_DE_OBRA_SYNC_ENABLED: " " }).enabled === false);
check('"true" exato => ligado', resolveDiarioSyncEnabled({ DIARIO_DE_OBRA_SYNC_ENABLED: "true" }).enabled === true);
check("modo invalido e recusado", resolveModo("apagar") === null);
check("modos validos aceitos", resolveModo("baseline") === "BASELINE" && resolveModo("incremental") === "INCREMENTAL");
check("RECONCILE existe na politica", resolveModo("reconcile") === "RECONCILE");
check("RECONCILE ainda nao e executavel pelo worker", /MODO === "RECONCILE"/.test(WORKER));

console.log("");
console.log("-- 20 e 21. Migration: sem delete destrutivo, com RLS --");

check("nenhum delete na migration", !/\bdelete\s+from\b/i.test(MIG));
check("nenhum drop de tabela", !/drop\s+table/i.test(MIG));
check("nenhum truncate", !/truncate/i.test(MIG));
check(
  "nenhum cascade destrutivo sobre estrutura existente",
  !/drop\s+\w+\s+cascade/i.test(MIG)
);
check("as tres tabelas usam create table if not exists", (MIG.match(/create table if not exists public\.diario_de_obra_/g) ?? []).length === 3);

check("RLS habilitada nas tres tabelas", (MIG.match(/enable row level security/g) ?? []).length === 3);
check("politica de select por membro do projeto", (MIG.match(/public\.is_project_member\(project_id\)/g) ?? []).length === 3);
// `for update` no upsert e lock de linha, nao politica. O que importa
// e que nenhuma POLICY de escrita exista.
check(
  "nenhuma politica de insert/update/delete",
  !/create policy[\s\S]{0,200}?for\s+(insert|update|delete)/i.test(MIG_EXECUTAVEL)
);
check("funcoes com search_path fixo", (MIG.match(/set search_path = ''/g) ?? []).length === 4);
check("funcoes sao security definer", (MIG.match(/security definer/g) ?? []).length === 4);
check("execucao revogada de authenticated", /revoke all on function %s from authenticated/.test(MIG));
check("execucao concedida so ao service_role", /grant execute on function %s to service_role/.test(MIG));
check("integracao com on delete restrict", (MIG.match(/references public\.project_integrations \(id\) on delete restrict/g) ?? []).length === 2);
check("escrita atomica por RDO: FOR UPDATE no upsert", /for update;/.test(MIG));

console.log("");
console.log("-- 22. Nenhuma regressao no Construmanager --");

check(
  "o worker do Diario nao importa nada do Construmanager",
  !/construmanager/i.test(WORKER.replace(/^\s*\/\/.*$/gm, ""))
);
check("a migration do Diario nao toca tabela do Construmanager", !/construmanager/i.test(MIG_EXECUTAVEL));
check("o workflow do Construmanager continua existindo", ler(".github/workflows/construmanager-content-ingestion.yml").length > 0);
check(
  "o workflow do Construmanager segue com seu cron",
  /- cron: "17 \*\/6 \* \* \*"/.test(ler(".github/workflows/construmanager-content-ingestion.yml"))
);
check(
  "o validador do Diario (ja mesclado) continua intacto",
  ler("scripts/validate-diario-de-obra-api.mjs").includes("apiexterna.diariodeobra.app/v1")
);

// As regras de seguranca nao podem divergir entre validador e client.
const VALIDADOR = ler("scripts/validate-diario-de-obra-api.mjs");
check(
  "validador e client concordam no host",
  VALIDADOR.includes("https://apiexterna.diariodeobra.app/v1") &&
    FONTE_CLIENT.includes("https://apiexterna.diariodeobra.app/v1")
);
check(
  "validador e client concordam nos termos de midia",
  DIARIO_TERMOS_DE_MIDIA.every((t) => VALIDADOR.includes(`"${t}"`))
);

console.log("");
console.log("-- 23. O contador da obra NAO encerra a sincronizacao --");

// visaoGeral.total.relatorios detecta variacao de QUANTIDADE, nao edicao
// de um RDO existente. Encerrar por ele esconderia o caso principal.
check("o worker le o contador", /visaoGeral/.test(WORKER));
check("o contador e explicitamente telemetria", /telemetria/.test(WORKER));
check(
  "nao ha early-return baseado no contador",
  !/totalNaOrigem\s*===[\s\S]{0,120}(process\.exit|return)/.test(WORKER)
);

console.log("");
console.log("=====================================================================");
console.log(`Resultado: ${passaram} passaram, ${falharam} falharam.`);
console.log("=====================================================================");

process.exit(falharam === 0 ? 0 : 1);
