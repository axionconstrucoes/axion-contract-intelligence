// Testes da validacao da API EXTERNA do Diario de Obra.
//
// Sem rede e sem credencial real: o fetch e um duble e o token e um
// valor ficticio. O objetivo e provar que as garantias sao ESTRUTURAIS —
// que uma rota de midia, um metodo de escrita ou um retry sao recusados
// pelo proprio codigo, nao pela disciplina de quem chama.
//
// Uso: node scripts/test-diario-de-obra-api-validation.mjs

import { readFileSync } from "node:fs";

const mod = await import("./validate-diario-de-obra-api.mjs");

const {
  BASE_URL,
  ROTAS_PERMITIDAS,
  TERMOS_DE_MIDIA_PROIBIDOS,
  MAX_CHAMADAS,
  LIMITE_PRIMEIRO_LOTE,
  sanitizar,
  tipoDe,
  descreverForma,
  criarChamador,
  avaliarPaginacao,
  executar,
} = mod;

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

// Valores inteiramente ficticios.
const TOKEN_FALSO =
  "eyJhbGciOiJIUzI1NiJ9.TOKEN_FALSO_DE_TESTE_nunca_deve_vazar.0123456789abcdefghijklmno";
const OBRA = "5cb071d833e3823aab41e333";
const RDO = "640232c954310533ae33cbe4";

// Nomes e textos que NUNCA podem sair no log.
const NOME_PESSOA = "Ana Laura";
const NOME_OBRA = "Escola estadual";
const TEXTO_ATIVIDADE = "Concretagem dos pilares do bloco B";
const URL_FOTO = "https://cdn.exemplo.invalido/foto_12345.jpg";

function relatorioLista(extras = {}) {
  return {
    _id: RDO,
    data: "03/03/2023",
    dataFim: null,
    diaDaSemana: "Sexta-Feira",
    numero: 1,
    status: { id: 1, descricao: "Preenchendo" },
    obra: { _id: OBRA, nome: NOME_OBRA },
    modeloDeRelatorioGlobal: { _id: "640232b7a3af4f638f04e463", descricao: "RDO" },
    criadoPor: {
      appIss: "app-web",
      dataHora: "03/03/2023 14:47",
      usuario: { _id: "548626e279da9e4c1200002a", nome: NOME_PESSOA, cargo: "Fiscal", email: "x@y.z" },
    },
    ...extras,
  };
}

function detalheRdo({ comColecoes = true } = {}) {
  const base = {
    _id: RDO,
    numero: 1,
    data: "03/03/2023",
    dataFim: null,
    diaDaSemana: "Sexta-Feira",
    status: { id: 1, descricao: "Preenchendo" },
    obra: { _id: OBRA, nome: NOME_OBRA },
    clima: { manha: "Bom", tarde: "Chuvoso" },
    link: URL_FOTO,
  };

  if (!comColecoes) return base;

  return {
    ...base,
    atividades: [{ descricao: TEXTO_ATIVIDADE }],
    ocorrencias: [{ descricao: "Paralisacao por chuva" }],
    maoDeObra: [],
    equipamentos: [{ descricao: "Retroescavadeira" }],
    comentarios: [{ texto: "comentario" }],
    galeriaDeFotos: [{ url: URL_FOTO }, { url: URL_FOTO }],
    videos: [],
    anexos: [{ url: URL_FOTO }],
    checklist: [],
  };
}

function obraDetalhe() {
  return {
    _id: OBRA,
    nome: NOME_OBRA,
    endereco: "Rua Exemplo, 100",
    cliente: NOME_PESSOA,
    fotoUrl: URL_FOTO,
    status: { id: 3, descricao: "Em Andamento" },
    visaoGeral: {
      total: { relatorios: 146, fotos: 23, atividades: 91, ocorrencias: 16 },
      ultimasFotos: [{ url: URL_FOTO }],
    },
    created: "29/09/2022 00:00:00",
    modified: "14/06/2023 00:00:00",
  };
}

console.log("=====================================================================");
console.log("VALIDACAO DA API EXTERNA DO DIARIO DE OBRA — TESTES SEM REDE");
console.log("=====================================================================");
console.log("");

console.log("-- A. Contrato: host oficial e allowlist --");

check(
  "usa a API EXTERNA oficial, nao a do portal",
  BASE_URL === "https://apiexterna.diariodeobra.app/v1"
);
check("nao aponta para o host interno do portal", !BASE_URL.includes("/v2"));
check("exatamente 3 rotas permitidas", ROTAS_PERMITIDAS.length === 3);
check("obra e permitida", ROTAS_PERMITIDAS.some((r) => r.test(`/obras/${OBRA}`)));
check(
  "listagem de relatorios e permitida",
  ROTAS_PERMITIDAS.some((r) => r.test(`/obras/${OBRA}/relatorios`))
);
check(
  "detalhe de relatorio e permitido",
  ROTAS_PERMITIDAS.some((r) => r.test(`/obras/${OBRA}/relatorios/${RDO}`))
);
check(
  "id malformado nao casa com rota alguma",
  !ROTAS_PERMITIDAS.some((r) => r.test("/obras/NAO-E-UM-ID"))
);

console.log("");
console.log("-- B. Metodos de escrita recusados ANTES da rede --");

for (const metodo of ["POST", "PUT", "PATCH", "DELETE"]) {
  let tentouRede = false;
  const api = criarChamador({
    token: TOKEN_FALSO,
    fetchImpl: async () => {
      tentouRede = true;
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });

  let erro = null;
  try {
    await api.get(`/obras/${OBRA}`, { method: metodo });
  } catch (e) {
    erro = e;
  }

  check(`${metodo} recusado`, erro !== null);
  check(`${metodo} nao chegou a rede`, tentouRede === false);
  check(`${metodo} nao contou como chamada`, api.total === 0);
}

console.log("");
console.log("-- C. Midia inalcancavel --");

check("ha lista de termos de midia proibidos", TERMOS_DE_MIDIA_PROIBIDOS.length >= 10);

for (const caminho of [
  `/obras/${OBRA}/relatorios/${RDO}/fotos`,
  `/obras/${OBRA}/relatorios/${RDO}/anexos`,
  `/obras/${OBRA}/relatorios/${RDO}/videos`,
  `/obras/${OBRA}/relatorios/${RDO}/impressao`,
  `/obras/${OBRA}/relatorios/${RDO}/exportar`,
  `/obras/${OBRA}/relatorios/${RDO}/pdf`,
]) {
  let tentouRede = false;
  const api = criarChamador({
    token: TOKEN_FALSO,
    fetchImpl: async () => {
      tentouRede = true;
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });

  let erro = null;
  try {
    await api.get(caminho);
  } catch (e) {
    erro = e;
  }

  const rotulo = caminho.split("/").pop();
  check(`midia recusada: ${rotulo}`, erro !== null);
  check(`midia nao chegou a rede: ${rotulo}`, tentouRede === false);
}

{
  let erro = null;
  const api = criarChamador({ token: TOKEN_FALSO, fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  try {
    await api.get("/obras");
  } catch (e) {
    erro = e;
  }
  check("rota fora da allowlist recusada", erro !== null);
}

console.log("");
console.log("-- D. Teto de chamadas, ausencia de retry e timeout --");

{
  const api = criarChamador({
    token: TOKEN_FALSO,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }),
  });

  for (let i = 0; i < MAX_CHAMADAS; i += 1) {
    await api.get(`/obras/${OBRA}`);
  }

  check(`${MAX_CHAMADAS} chamadas permitidas`, api.total === MAX_CHAMADAS);

  let erro = null;
  try {
    await api.get(`/obras/${OBRA}`);
  } catch (e) {
    erro = e;
  }

  check("a chamada seguinte ao teto e recusada", erro !== null);
  check("o contador nao passa do teto", api.total === MAX_CHAMADAS);
  check("teto e 5", MAX_CHAMADAS === 5);
}

{
  let tentativas = 0;
  const api = criarChamador({
    token: TOKEN_FALSO,
    fetchImpl: async () => {
      tentativas += 1;
      return { ok: false, status: 500, json: async () => ({}) };
    },
  });

  let erro = null;
  try {
    await api.get(`/obras/${OBRA}`);
  } catch (e) {
    erro = e;
  }

  check("falha HTTP vira erro", erro !== null);
  check("uma unica tentativa: sem retry", tentativas === 1);
}

{
  const api = criarChamador({
    token: TOKEN_FALSO,
    fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }),
  });

  let erro = null;
  try {
    await api.get(`/obras/${OBRA}`);
  } catch (e) {
    erro = e;
  }

  check("HTTP 429 e reconhecido como limite do fornecedor", /429/.test(String(erro?.message)));
  check("a mensagem cita 150 por minuto", /150/.test(String(erro?.message)));
}

{
  let sinal = null;
  const api = criarChamador({
    token: TOKEN_FALSO,
    fetchImpl: async (_u, init) => {
      sinal = init.signal;
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });

  await api.get(`/obras/${OBRA}`);
  check("a requisicao carrega AbortSignal (timeout armado)", sinal !== null);
}

{
  let cabecalhos = null;
  let metodo = null;
  const api = criarChamador({
    token: TOKEN_FALSO,
    fetchImpl: async (_u, init) => {
      cabecalhos = init.headers;
      metodo = init.method;
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });

  await api.get(`/obras/${OBRA}`);
  check("o metodo enviado e GET", metodo === "GET");
  check("o token vai no cabecalho `token`", cabecalhos?.token === TOKEN_FALSO);
  check("nao envia Authorization", cabecalhos?.Authorization === undefined);
  check("nao envia cookie", cabecalhos?.Cookie === undefined && cabecalhos?.cookie === undefined);
}

console.log("");
console.log("-- E. Forma dos dados: nomes e tipos, nunca valores --");

const formaRdo = descreverForma(detalheRdo());
const nomes = formaRdo.map((c) => c.campo);

check("descreve os campos de topo", nomes.includes("atividades") && nomes.includes("clima"));
check("classifica array corretamente", formaRdo.find((c) => c.campo === "atividades")?.tipo === "array");
check("conta itens da colecao", formaRdo.find((c) => c.campo === "galeriaDeFotos")?.itens === 2);
check("colecao vazia continua visivel", formaRdo.find((c) => c.campo === "maoDeObra")?.itens === 0);
check("classifica objeto e conta subcampos", formaRdo.find((c) => c.campo === "status")?.subcampos === 2);
check("null e distinguido de objeto", tipoDe(null) === "null");

const serializada = JSON.stringify(formaRdo);
check("a forma NAO carrega texto de atividade", !serializada.includes(TEXTO_ATIVIDADE));
check("a forma NAO carrega nome de pessoa", !serializada.includes(NOME_PESSOA));
check("a forma NAO carrega nome de obra", !serializada.includes(NOME_OBRA));
check("a forma NAO carrega URL de foto", !serializada.includes(URL_FOTO));
check("a forma NAO carrega o token", !serializada.includes(TOKEN_FALSO));

check("RDO sem colecoes opcionais nao quebra", descreverForma(detalheRdo({ comColecoes: false })).length > 0);
check("objeto vazio produz forma vazia", descreverForma({}).length === 0);
check("array no topo produz forma vazia", descreverForma([]).length === 0);
check("null produz forma vazia", descreverForma(null).length === 0);

console.log("");
console.log("-- F. Paginacao --");

const cheio = avaliarPaginacao(30, 30);
check("lote cheio sugere que ha mais", cheio.loteCheio === true && cheio.provavelMais === true);

const parcial = avaliarPaginacao(12, 30);
check("lote parcial indica fim", parcial.loteCheio === false);
check(
  "o mecanismo registrado e apenas `limite`",
  /somente `limite`/.test(cheio.mecanismo) && /sem pagina\/offset\/cursor/.test(cheio.mecanismo)
);
check("o primeiro lote pedido e 30", LIMITE_PRIMEIRO_LOTE === 30);

console.log("");
console.log("-- G. Sanitizacao --");

check("JWT e redigido", !sanitizar(`falhou com ${TOKEN_FALSO}`).includes(TOKEN_FALSO));
check("nenhum eyJ sobrevive", !/eyJ[A-Za-z0-9_.-]{5,}/.test(sanitizar(TOKEN_FALSO)));
check("token= e redigido", !sanitizar(`token=${TOKEN_FALSO}`).includes(TOKEN_FALSO));
check("cookie= e redigido", !sanitizar("cookie=sessao_muito_secreta_1234567890").includes("sessao_muito_secreta"));
check("URL e redigida", !sanitizar(`foto em ${URL_FOTO}`).includes("foto_12345"));
check("cadeia opaca longa e redigida", !/[A-Za-z0-9_-]{40,}/.test(sanitizar("x".repeat(60))));
check("texto util sobrevive", sanitizar("Rota fora da allowlist: /obras").includes("allowlist"));
check("saida e limitada", sanitizar("a".repeat(5000)).length <= 300);

console.log("");
console.log("-- H. Execucao completa com duble --");

{
  const chamadas = [];
  const relatorio = await executar(
    { DIARIO_DE_OBRA_API_TOKEN: TOKEN_FALSO, DIARIO_DE_OBRA_OBRA_ID: OBRA },
    async (url) => {
      chamadas.push(String(url));
      const caminho = String(url);

      if (/\/relatorios\/[a-f0-9]{24}/.test(caminho)) {
        return { ok: true, status: 200, json: async () => detalheRdo() };
      }
      if (/\/relatorios\?/.test(caminho)) {
        return { ok: true, status: 200, json: async () => [relatorioLista(), relatorioLista()] };
      }
      return { ok: true, status: 200, json: async () => obraDetalhe() };
    }
  );

  check("veredito CONFERE com resposta valida", relatorio.veredito === "CONFERE");
  check("exit 0", relatorio.exitCode === 0);
  check("exatamente 3 chamadas", relatorio.chamadas === 3);
  check("nenhuma chamada de midia", !chamadas.some((u) => /foto|video|anexo|pdf/i.test(u)));
  check("todas as chamadas no host oficial", chamadas.every((u) => u.startsWith(BASE_URL)));
  check("a listagem pediu limite=30 e ordem=desc", chamadas.some((u) => /limite=30/.test(u) && /ordem=desc/.test(u)));
  check("identidade detectada", relatorio.identidade.temId && relatorio.identidade.temData);
  check(
    "ausencia de data de alteracao e reportada, nao inventada",
    relatorio.identidade.temDataAlteracao === false
  );
}

{
  // Resposta sem id: nao ha como buscar detalhe, e o veredito reprova.
  const relatorio = await executar(
    { DIARIO_DE_OBRA_API_TOKEN: TOKEN_FALSO, DIARIO_DE_OBRA_OBRA_ID: OBRA },
    async (url) => {
      if (/\/relatorios\?/.test(String(url))) {
        return { ok: true, status: 200, json: async () => [{ data: "01/01/2026" }] };
      }
      return { ok: true, status: 200, json: async () => obraDetalhe() };
    }
  );

  check("relatorio sem _id reprova", relatorio.veredito === "NAO CONFERE");
  check("sem id, o detalhe nao e buscado", relatorio.chamadas === 2);
}

{
  // Lista vazia: valida, mas sem identidade a confirmar.
  const relatorio = await executar(
    { DIARIO_DE_OBRA_API_TOKEN: TOKEN_FALSO, DIARIO_DE_OBRA_OBRA_ID: OBRA },
    async (url) =>
      /\/relatorios\?/.test(String(url))
        ? { ok: true, status: 200, json: async () => [] }
        : { ok: true, status: 200, json: async () => obraDetalhe() }
  );

  check("lista vazia nao quebra", relatorio.veredito === "NAO CONFERE");
  check("lista vazia nao busca detalhe", relatorio.chamadas === 2);
}

{
  // Listagem que nao e array: contrato quebrado.
  const relatorio = await executar(
    { DIARIO_DE_OBRA_API_TOKEN: TOKEN_FALSO, DIARIO_DE_OBRA_OBRA_ID: OBRA },
    async (url) =>
      /\/relatorios\?/.test(String(url))
        ? { ok: true, status: 200, json: async () => ({ erro: "inesperado" }) }
        : { ok: true, status: 200, json: async () => obraDetalhe() }
  );

  check("listagem fora do contrato reprova", relatorio.veredito === "NAO CONFERE");
}

console.log("");
console.log("-- I. Sem credencial: nada e chamado --");

{
  let tentouRede = false;
  const semNada = await executar({}, async () => {
    tentouRede = true;
    return { ok: true, json: async () => ({}) };
  });

  check("sem env, INCONCLUSIVO", semNada.veredito === "INCONCLUSIVO");
  check("sem env, exit 2", semNada.exitCode === 2);
  check("sem env, zero chamadas", semNada.chamadas === 0);
  check("sem env, nenhuma rede", tentouRede === false);

  const idRuim = await executar(
    { DIARIO_DE_OBRA_API_TOKEN: TOKEN_FALSO, DIARIO_DE_OBRA_OBRA_ID: "nao-e-id" },
    async () => {
      tentouRede = true;
      return { ok: true, json: async () => ({}) };
    }
  );

  check("obra id malformado bloqueia antes da rede", idRuim.chamadas === 0);
  check("obra id malformado e INCONCLUSIVO", idRuim.veredito === "INCONCLUSIVO");
}

console.log("");
console.log("-- J. Auditoria estrutural do script e do workflow --");

const FONTE = readFileSync("scripts/validate-diario-de-obra-api.mjs", "utf8").replace(/\r\n/g, "\n");
const FONTE_EXECUTAVEL = FONTE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const WF = readFileSync(".github/workflows/diario-de-obra-api-validation.yml", "utf8").replace(/\r\n/g, "\n");
const WF_EXECUTAVEL = WF.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

check("le o token de process.env", /process\.env/.test(FONTE));
check("nao le credencial de argv", !/process\.argv\.slice\(2\)/.test(FONTE_EXECUTAVEL));
check("nao usa o SDK do Supabase", !/@supabase\/supabase-js/.test(FONTE));
check("nao importa nada do Construmanager", !/construmanager/i.test(FONTE_EXECUTAVEL));
check("nenhum token literal no script", !/eyJ[A-Za-z0-9]{10,}/.test(FONTE));
check("importar o modulo nao dispara execucao", /executadoDiretamente/.test(FONTE));
check("nenhum metodo de escrita no codigo", !/method:\s*"(POST|PUT|PATCH|DELETE)"/.test(FONTE_EXECUTAVEL));

check("workflow tem apenas workflow_dispatch", /workflow_dispatch:/.test(WF_EXECUTAVEL));
check("workflow nao tem schedule", !/^\s{2}schedule:/m.test(WF_EXECUTAVEL));
check("permissions contents: read", /permissions:\n\s*contents: read/.test(WF_EXECUTAVEL));
check("uma unica permissao declarada", (WF_EXECUTAVEL.match(/^\s{2}[a-z-]+: (read|write)$/gm) ?? []).length === 1);
check("timeout de 10 minutos", /timeout-minutes:\s*10/.test(WF_EXECUTAVEL));
check("chama apenas o validador", (WF_EXECUTAVEL.match(/node scripts\/[a-z-]+\.mjs/g) ?? []).length === 1);
check("nao recebe secret do Construmanager", !/CONSTRUMANAGER/.test(WF_EXECUTAVEL));
check("nao recebe secret do Supabase", !/SUPABASE/.test(WF_EXECUTAVEL));
check("nao invoca worker algum do Construmanager", !/construmanager/i.test(WF_EXECUTAVEL));
check("token so por secrets", /secrets\.DIARIO_DE_OBRA_API_TOKEN/.test(WF_EXECUTAVEL));
check("obra id por input", /inputs\.obra_id/.test(WF_EXECUTAVEL));

console.log("");
console.log("=====================================================================");
console.log(`Resultado: ${passaram} passaram, ${falharam} falharam.`);
console.log("=====================================================================");

process.exit(falharam === 0 ? 0 : 1);
