// Validacao isolada da API EXTERNA do APP Diario de Obra.
//
// FONTE INDEPENDENTE DO CONSTRUMANAGER
//
// O Diario de Obras NAO vem do Construmanager. E outra plataforma, com
// outro host, outra credencial e outro contrato. Este script nao importa
// nada do modulo Construmanager e nao le nenhum secret dele.
//
// API OFICIAL, NAO A DO PORTAL
//
// O portal web usa internamente https://api.diariodeobra.app/v2/... com
// a sessao do navegador. NAO e' isso que usamos aqui: o fornecedor
// publica uma API EXTERNA propria, documentada em
// https://api.diariodeobra.app/documentacao/, cuja introducao diz que
// ela existe justamente para "exportar os dados inseridos no sistema
// (em formato JSON)".
//
//   base ....... https://apiexterna.diariodeobra.app/v1
//   auth ....... cabecalho `token` (JWT), gerado pelo proprio cliente em
//                Cadastros > Empresa > Gerar token
//   limite ..... 150 requisicoes por minuto, HTTP 429 ao exceder
//
// Imitar a sessao do navegador seria possivel e seria errado: existe um
// caminho oficial, e usar o nao-oficial quebraria no primeiro deploy do
// fornecedor alem de contrariar o contrato de uso.
//
// O QUE ESTE SCRIPT PROVA
//
// Que o token funciona, que a obra responde, que o primeiro lote de RDOs
// chega, e QUAL e' a forma dos dados — nomes e tipos de campo, presenca
// e tamanho das colecoes. Nada do conteudo.
//
// GARANTIAS ESTRUTURAIS
//
//   - somente GET, em 3 rotas de uma allowlist por expressao exata;
//   - qualquer outro metodo e' recusado ANTES da rede;
//   - midia (foto, video, anexo, impressao, exportacao, PDF) e'
//     inalcancavel: nao ha rota para ela e ha guarda explicita;
//   - teto rigido de 5 chamadas;
//   - nenhum retry;
//   - token so por env, nunca por argv;
//   - o relatorio impresso e' montado campo a campo — nenhum valor de
//     texto, nome, endereco ou URL atravessa para o log.
//
// Uso (credenciais vem do ambiente, nunca da linha de comando):
//   node scripts/validate-diario-de-obra-api.mjs

export const BASE_URL = "https://apiexterna.diariodeobra.app/v1";

// Rotas permitidas, por expressao EXATA. Um id e' uma cadeia hexadecimal
// de 24 caracteres (ObjectId do MongoDB, conforme os exemplos oficiais).
const ID = "[a-f0-9]{24}";

export const ROTAS_PERMITIDAS = Object.freeze([
  new RegExp(`^/obras/${ID}$`),
  new RegExp(`^/obras/${ID}/relatorios$`),
  new RegExp(`^/obras/${ID}/relatorios/${ID}$`),
]);

// Nada aqui existe como rota nesta allowlist. A guarda e' redundante de
// proposito: se um dia alguem ampliar a allowlist sem pensar, isto
// continua barrando midia.
export const TERMOS_DE_MIDIA_PROIBIDOS = Object.freeze([
  "foto",
  "fotos",
  "galeria",
  "video",
  "videos",
  "anexo",
  "anexos",
  "impressao",
  "imprimir",
  "exportar",
  "download",
  "pdf",
  "assinatura",
]);

export const MAX_CHAMADAS = 5;
export const TIMEOUT_MS = 30_000;
export const LIMITE_PRIMEIRO_LOTE = 30;

/*
 * Sanitizacao. O token e' um JWT; um JWT vazado num log e' acesso
 * completo ate expirar. Alem dos rotulos obvios, qualquer cadeia opaca
 * longa cai — foi exatamente uma cadeia sem rotulo que vazou no log de
 * outro modulo deste projeto.
 */
export function sanitizar(texto) {
  return String(texto ?? "")
    .replace(/eyJ[A-Za-z0-9_.-]+/g, "[JWT REDIGIDO]")
    .replace(/(token|cookie|senha|password|login|authorization|apikey)\s*[:=]\s*\S+/gi, "$1=[REDIGIDO]")
    .replace(/https?:\/\/\S+/g, "[URL REDIGIDA]")
    .replace(/[A-Za-z0-9_-]{40,}/g, "[REDIGIDO]")
    .replace(/\s+/g, " ")
    .slice(0, 300)
    .trim();
}

export function tipoDe(valor) {
  if (valor === null) return "null";
  if (Array.isArray(valor)) return "array";
  return typeof valor;
}

/*
 * Descreve a FORMA de um objeto: nome e tipo de cada campo de topo, e
 * o tamanho das colecoes. Nunca um valor.
 */
export function descreverForma(objeto) {
  if (objeto === null || typeof objeto !== "object" || Array.isArray(objeto)) {
    return [];
  }

  return Object.keys(objeto)
    .sort()
    .map((campo) => {
      const valor = objeto[campo];
      const tipo = tipoDe(valor);

      if (tipo === "array") {
        return { campo, tipo, itens: valor.length };
      }

      if (tipo === "object") {
        return { campo, tipo, subcampos: Object.keys(valor).length };
      }

      return { campo, tipo };
    });
}

/*
 * Camada de chamada. Allowlist, guarda de midia, contador e teto vivem
 * aqui — nao ha caminho que os contorne.
 */
export function criarChamador({ token, fetchImpl = fetch } = {}) {
  let chamadas = 0;
  const rotas = [];

  async function get(caminho, { method = "GET", query = {} } = {}) {
    if (method !== "GET") {
      throw new Error(`Metodo nao permitido nesta validacao: ${method}.`);
    }

    const minusculo = caminho.toLowerCase();

    for (const termo of TERMOS_DE_MIDIA_PROIBIDOS) {
      if (minusculo.includes(termo)) {
        throw new Error(
          `Caminho recusado por conter termo de midia (${termo}): esta validacao nao transfere byte de midia.`
        );
      }
    }

    if (!ROTAS_PERMITIDAS.some((padrao) => padrao.test(caminho))) {
      throw new Error(`Rota fora da allowlist: ${caminho}`);
    }

    if (chamadas >= MAX_CHAMADAS) {
      throw new Error(`Teto de ${MAX_CHAMADAS} chamadas atingido.`);
    }

    chamadas += 1;
    rotas.push(caminho);

    const parametros = new URLSearchParams(query);
    const sufixo = parametros.toString() ? `?${parametros}` : "";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      // Uma tentativa por rota. Sem retry: repetir mascararia
      // instabilidade e consumiria o limite de 150/min do fornecedor.
      const resposta = await fetchImpl(`${BASE_URL}${caminho}${sufixo}`, {
        method: "GET",
        headers: { "Content-Type": "application/json", token },
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
      });

      if (resposta.status === 429) {
        throw new Error(
          "HTTP 429: limite de 150 requisicoes por minuto atingido para esta empresa."
        );
      }

      if (!resposta.ok) {
        throw new Error(`${caminho} respondeu HTTP ${resposta.status}.`);
      }

      return await resposta.json();
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    get,
    get total() {
      return chamadas;
    },
    get rotas() {
      return [...rotas];
    },
  };
}

/*
 * Paginacao: a documentacao oficial descreve APENAS `limite` para
 * /obras/{id}/relatorios — nao ha `pagina`, `offset`, `skip` nem cursor.
 * O sinal de que existe mais e' o lote vir cheio.
 */
export function avaliarPaginacao(recebidos, limite) {
  return {
    recebidos,
    limite,
    loteCheio: recebidos === limite,
    provavelMais: recebidos === limite,
    mecanismo: "somente `limite`; sem pagina/offset/cursor documentado",
  };
}

function dizer(mensagem) {
  console.log(`[validate-diario] ${mensagem}`);
}

export async function executar(env, fetchImpl = fetch) {
  const token = String(env.DIARIO_DE_OBRA_API_TOKEN ?? "").trim();
  const obraId = String(env.DIARIO_DE_OBRA_OBRA_ID ?? "").trim();

  if (!token || !obraId) {
    dizer("Variaveis de ambiente ausentes. Nada foi chamado.");
    return { veredito: "INCONCLUSIVO", exitCode: 2, chamadas: 0 };
  }

  if (!/^[a-f0-9]{24}$/.test(obraId)) {
    dizer("DIARIO_DE_OBRA_OBRA_ID nao tem a forma esperada. Nada foi chamado.");
    return { veredito: "INCONCLUSIVO", exitCode: 2, chamadas: 0 };
  }

  const api = criarChamador({ token, fetchImpl });

  // 1) A obra. Confirma que o token e' valido e alcanca esta obra.
  const obra = await api.get(`/obras/${obraId}`);

  const formaObra = descreverForma(obra);
  const visaoGeral = obra?.visaoGeral?.total ?? null;

  // 2) Primeiro lote de RDOs, o mais recente primeiro.
  const relatorios = await api.get(`/obras/${obraId}/relatorios`, {
    query: { limite: String(LIMITE_PRIMEIRO_LOTE), ordem: "desc" },
  });

  if (!Array.isArray(relatorios)) {
    dizer("A listagem de relatorios nao devolveu um array.");
    return { veredito: "NAO CONFERE", exitCode: 1, chamadas: api.total };
  }

  const paginacao = avaliarPaginacao(relatorios.length, LIMITE_PRIMEIRO_LOTE);
  const primeiro = relatorios[0] ?? null;

  const identidade = {
    temId: typeof primeiro?._id === "string" && primeiro._id.length > 0,
    temData: typeof primeiro?.data === "string" && primeiro.data.length > 0,
    temNumero: Number.isFinite(Number(primeiro?.numero)),
    temStatus: primeiro?.status !== undefined && primeiro?.status !== null,
    // A documentacao NAO descreve data de alteracao no relatorio. Se
    // faltar mesmo, a deteccao de mudanca tera de vir de hash canonico.
    temDataAlteracao:
      primeiro?.modified !== undefined || primeiro?.dataAlteracao !== undefined,
  };

  let formaDetalhe = [];
  let colecoes = [];

  // 3) UM detalhe, escolhido como o primeiro do lote.
  if (identidade.temId) {
    const detalhe = await api.get(`/obras/${obraId}/relatorios/${primeiro._id}`);
    formaDetalhe = descreverForma(detalhe);
    colecoes = formaDetalhe
      .filter((c) => c.tipo === "array")
      .map((c) => ({ colecao: c.campo, itens: c.itens }));
  }

  const conferiu =
    identidade.temId && identidade.temData && identidade.temNumero && identidade.temStatus;

  // --- Relatorio: SOMENTE estrutura, contagem e tipo. ---
  dizer(`chamadas               : ${api.total} (teto ${MAX_CHAMADAS})`);
  dizer(`rotas                  : ${api.rotas.map((r) => r.replace(/[a-f0-9]{24}/g, "{id}")).join(", ")}`);
  dizer(`bytes de midia         : 0 (nenhuma rota de midia e alcancavel)`);
  dizer("");
  dizer(`obra: ${formaObra.length} campo(s) de topo`);
  formaObra.forEach((c) =>
    dizer(`  ${c.campo}: ${c.tipo}${c.itens !== undefined ? ` [${c.itens}]` : ""}${c.subcampos !== undefined ? ` {${c.subcampos}}` : ""}`)
  );

  if (visaoGeral) {
    dizer("");
    dizer("visaoGeral.total (contadores da obra):");
    Object.keys(visaoGeral)
      .sort()
      .forEach((k) => dizer(`  ${k}: ${Number(visaoGeral[k])}`));
  }

  dizer("");
  dizer(`relatorios recebidos   : ${paginacao.recebidos} (limite ${paginacao.limite})`);
  dizer(`lote cheio             : ${paginacao.loteCheio}`);
  dizer(`paginacao              : ${paginacao.mecanismo}`);
  dizer("");
  dizer("relatorio (item da lista): campos e tipos");
  descreverForma(primeiro).forEach((c) =>
    dizer(`  ${c.campo}: ${c.tipo}${c.itens !== undefined ? ` [${c.itens}]` : ""}${c.subcampos !== undefined ? ` {${c.subcampos}}` : ""}`)
  );

  dizer("");
  dizer(`identidade: id=${identidade.temId} data=${identidade.temData} numero=${identidade.temNumero} status=${identidade.temStatus}`);
  dizer(`data de alteracao no relatorio: ${identidade.temDataAlteracao}`);

  if (formaDetalhe.length > 0) {
    dizer("");
    dizer(`detalhe do RDO: ${formaDetalhe.length} campo(s) de topo`);
    formaDetalhe.forEach((c) =>
      dizer(`  ${c.campo}: ${c.tipo}${c.itens !== undefined ? ` [${c.itens}]` : ""}${c.subcampos !== undefined ? ` {${c.subcampos}}` : ""}`)
    );
    dizer("");
    dizer(`colecoes presentes: ${colecoes.length}`);
    colecoes.forEach((c) => dizer(`  ${c.colecao}: ${c.itens} item(ns)`));
  }

  dizer("");
  dizer(`veredito: ${conferiu ? "CONFERE" : "NAO CONFERE"}`);

  return {
    veredito: conferiu ? "CONFERE" : "NAO CONFERE",
    exitCode: conferiu ? 0 : 1,
    chamadas: api.total,
    paginacao,
    identidade,
  };
}

const executadoDiretamente =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (executadoDiretamente) {
  try {
    const relatorio = await executar(process.env);
    process.exit(relatorio.exitCode);
  } catch (erro) {
    dizer(`FALHA: ${sanitizar(erro?.message)}`);
    process.exit(2);
  }
}
