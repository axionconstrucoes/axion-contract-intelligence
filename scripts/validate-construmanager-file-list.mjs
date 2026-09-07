// Validacao isolada: Arquivo/List cobre os documentos vigentes sozinho?
//
// POR QUE ESTE SCRIPT EXISTE
//
// A decisao de escopo tirou o download do Construmanager do caminho: o
// ACC passa a apenas DETECTAR e INFORMAR novos arquivos e novas revisoes.
// Nesse recorte, ListaMestra/List — hoje quebrada com "Index was outside
// the bounds of the array" — deixa de ser obrigatoria, porque Arquivo/List
// entrega a mesma identidade (id == cad_objects_id) e a mesma revisao
// (review == cad_objects_versoes, que concordaram 192/192 na obra real).
//
// Falta UM fato: Arquivo/List, sozinho, devolve os 192 documentos?
// Este script responde isso e nada mais.
//
// DE PROPOSITO NAO REUTILIZA O CLIENT COMPARTILHADO
//
// O client de producao sabe chamar ListaMestra/List e Objeto/Download.
// Aqui as duas rotas precisam ser IMPOSSIVEIS, nao apenas evitadas — e
// impossibilidade se demonstra melhor com uma camada propria, pequena e
// auditavel, que carrega a lista de rotas permitidas, o contador e o
// teto. Mesmo padrao de validate-github-supabase-secret.mjs.
//
// GARANTIAS ESTRUTURAIS
//
//   - somente 5 rotas do Construmanager, em allowlist explicita;
//   - ListaMestra/List, Objeto/Download e Arquivo/Status/List sao
//     recusados ANTES de qualquer rede, com erro;
//   - teto rigido de 6 chamadas ao Construmanager, autenticacao inclusa;
//   - Supabase somente GET — qualquer outro metodo e' recusado;
//   - nenhum retry;
//   - segredos so por process.env, nunca por argv;
//   - nada e' impresso sem passar pelo sanitizador.
//
// Uso (as credenciais vem do ambiente, nunca da linha de comando):
//   node scripts/validate-construmanager-file-list.mjs

const EMPRESA_ESPERADA = 1645;
const OBRA_ESPERADA = 34164;

export const PROJECT_ID_PADRAO = "00000000-0000-4000-8000-000000000001";

export const ENDPOINTS_PERMITIDOS = Object.freeze([
  "/Login/Auth",
  "/Login/Token/Get",
  "/Obra/List",
  "/Pasta/List",
  "/Arquivo/List",
]);

// Explicitos por nome. Um `includes` na allowlist ja bastaria, mas uma
// rota proibida merece uma mensagem que diga POR QUE foi barrada — quem
// ler o log de um run precisa entender na hora.
export const ENDPOINTS_PROIBIDOS = Object.freeze([
  "/ListaMestra/List",
  "/Objeto/Download",
  "/Arquivo/Status/List",
]);

// 2 de autenticacao + 3 de listagem = 5. O sexto e' folga para nada.
export const MAX_CHAMADAS_CONSTRUMANAGER = 6;

export const TIMEOUT_MS = 60_000;

export const EMPRESA = EMPRESA_ESPERADA;
export const OBRA = OBRA_ESPERADA;

/*
 * Sanitizacao. Mais rigorosa que a de producao: alem de Bearer e
 * token=, remove QUALQUER cadeia opaca longa. Foi exatamente uma cadeia
 * dessas — um access token interpolado numa mensagem de erro — que
 * acabou gravada em texto claro no log do run 34049828023.
 */
export function sanitizar(texto) {
  return String(texto ?? "")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDIGIDO]")
    .replace(/(token|senha|password|apikey|authorization)\s*[:=]\s*\S+/gi, "$1=[REDIGIDO]")
    .replace(/[A-Za-z0-9_-]{40,}/g, "[REDIGIDO]")
    .replace(/\s+/g, " ")
    .slice(0, 300)
    .trim();
}

/*
 * Mesma normalizacao de revisao do projeto (normalize-metadata.ts). Se
 * este script comparasse revisao de outro jeito, uma divergencia aqui
 * nao significaria nada la.
 */
export function normalizarRevisao(revisao) {
  if (typeof revisao !== "string") return "";
  const limpo = revisao.trim();
  if (!limpo) return "";
  return /^\d+$/.test(limpo) ? String(Number(limpo)).padStart(2, "0") : limpo;
}

/*
 * Camada de chamada do Construmanager. Allowlist, contador e teto vivem
 * aqui — nao ha caminho que os contorne.
 */
export function criarChamadorConstrumanager({ baseUrl, fetchImpl = fetch } = {}) {
  let chamadas = 0;
  const rotasUsadas = [];

  async function chamar(caminho, { method = "POST", headers = {}, body } = {}) {
    if (ENDPOINTS_PROIBIDOS.includes(caminho)) {
      throw new Error(
        `Rota proibida neste teste: ${caminho}. ` +
          "Esta validacao existe justamente para provar que ela nao e' necessaria."
      );
    }

    if (!ENDPOINTS_PERMITIDOS.includes(caminho)) {
      throw new Error(`Rota fora da allowlist: ${caminho}.`);
    }

    if (method !== "POST") {
      throw new Error(`Metodo nao permitido no Construmanager: ${method}.`);
    }

    if (chamadas >= MAX_CHAMADAS_CONSTRUMANAGER) {
      throw new Error(
        `Teto de ${MAX_CHAMADAS_CONSTRUMANAGER} chamadas ao Construmanager atingido.`
      );
    }

    chamadas += 1;
    rotasUsadas.push(caminho);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      // Sem retry: uma tentativa por rota. Repetir mascararia
      // instabilidade justamente no teste feito para medi-la.
      const resposta = await fetchImpl(`${baseUrl}${caminho}`, {
        method,
        headers,
        body,
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
      });

      if (!resposta.ok) {
        throw new Error(`${caminho} respondeu HTTP ${resposta.status}.`);
      }

      return await resposta.json();
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    chamar,
    get total() {
      return chamadas;
    },
    get rotas() {
      return [...rotasUsadas];
    },
  };
}

/*
 * Leitor do Supabase. GET e' o unico metodo aceito — a garantia de
 * "nenhuma escrita" nao pode depender de disciplina do chamador.
 */
export function criarLeitorSupabase({ url, chave, fetchImpl = fetch } = {}) {
  let chamadas = 0;

  async function get(caminho, { method = "GET" } = {}) {
    if (method !== "GET") {
      throw new Error(
        `Somente GET e' permitido no Supabase nesta validacao (recebido: ${method}).`
      );
    }

    chamadas += 1;

    const resposta = await fetchImpl(`${url}/rest/v1/${caminho}`, {
      method: "GET",
      headers: { apikey: chave, Authorization: `Bearer ${chave}` },
      redirect: "error",
      cache: "no-store",
    });

    if (!resposta.ok) {
      throw new Error(`Supabase respondeu HTTP ${resposta.status}.`);
    }

    return await resposta.json();
  }

  return {
    get,
    get total() {
      return chamadas;
    },
  };
}

/*
 * Um registro so entra na comparacao se os campos que o novo escopo
 * promete informar estiverem utilizaveis. Registro invalido nao e'
 * descartado em silencio: ele e' contado e o motivo, reportado.
 */
export function validarRegistro(arquivo, idsDePasta) {
  const problemas = [];
  const id = Number(arquivo?.id);

  if (!Number.isInteger(id) || id <= 0) problemas.push("id");
  if (normalizarRevisao(arquivo?.review) === "") problemas.push("revisao");

  const pasta = Number(arquivo?.parentId);
  if (!Number.isInteger(pasta) || pasta <= 0 || !idsDePasta.has(pasta)) {
    problemas.push("pasta");
  }

  const data = Date.parse(String(arquivo?.dataUpload ?? ""));
  if (!Number.isFinite(data)) problemas.push("dataUpload");

  return problemas;
}

/*
 * O calculo central. Puro: recebe as duas listas ja carregadas e devolve
 * as metricas. E' assim que os testes cobrem 192 coincidentes, arquivo
 * novo, arquivo ausente, revisao divergente e id duplicado sem rede.
 */
export function compararInventarios({ arquivos, documentos, pastas }) {
  const idsDePasta = new Set((pastas ?? []).map((p) => Number(p.id)));

  const invalidos = [];
  const vistos = new Set();
  const duplicados = [];
  const porId = new Map();

  for (const arquivo of arquivos ?? []) {
    const problemas = validarRegistro(arquivo, idsDePasta);
    const id = Number(arquivo?.id);

    if (problemas.length > 0) {
      invalidos.push({ id: Number.isFinite(id) ? id : null, campos: problemas });
      continue;
    }

    if (vistos.has(id)) {
      duplicados.push(id);
      continue;
    }

    vistos.add(id);
    porId.set(id, arquivo);
  }

  const noBanco = new Map(
    (documentos ?? []).map((d) => [Number(d.construmanager_object_id), d])
  );

  const emAmbos = [];
  const novosNoConstrumanager = [];

  for (const id of porId.keys()) {
    if (noBanco.has(id)) emAmbos.push(id);
    else novosNoConstrumanager.push(id);
  }

  const ausentesNoConstrumanager = [];
  for (const id of noBanco.keys()) {
    if (!porId.has(id)) ausentesNoConstrumanager.push(id);
  }

  const revisoesIguais = [];
  const revisoesDivergentes = [];

  for (const id of emAmbos) {
    const daApi = normalizarRevisao(porId.get(id).review);
    const doBanco = normalizarRevisao(noBanco.get(id).revision);

    if (daApi === doBanco) revisoesIguais.push(id);
    else revisoesDivergentes.push({ id, api: daApi, banco: doBanco });
  }

  return {
    totalArquivoList: (arquivos ?? []).length,
    totalValidos: porId.size,
    totalNoBanco: noBanco.size,
    totalPastas: (pastas ?? []).length,
    emAmbos: emAmbos.length,
    novosNoConstrumanager,
    ausentesNoConstrumanager,
    revisoesIguais: revisoesIguais.length,
    revisoesDivergentes,
    duplicados,
    invalidos,
  };
}

/*
 * Veredito. Cobertura completa e' o que responde a pergunta que motivou
 * o script; divergencia de revisao ou registro invalido nao reprova a
 * hipotese, mas precisa aparecer.
 */
export function avaliar(metricas) {
  if (metricas.totalArquivoList === 0) {
    return { veredito: "INCONCLUSIVO", exitCode: 2 };
  }

  if (
    metricas.ausentesNoConstrumanager.length === 0 &&
    metricas.revisoesDivergentes.length === 0 &&
    metricas.duplicados.length === 0 &&
    metricas.invalidos.length === 0
  ) {
    return { veredito: "COBERTURA COMPLETA", exitCode: 0 };
  }

  if (metricas.ausentesNoConstrumanager.length > 0) {
    return { veredito: "COBERTURA INCOMPLETA", exitCode: 1 };
  }

  return { veredito: "COBERTURA COM RESSALVAS", exitCode: 1 };
}

function dizer(mensagem) {
  console.log(`[validate-file-list] ${mensagem}`);
}

export async function executar(env, fetchImpl = fetch) {
  const baseUrl = String(env.CONSTRUMANAGER_BASE_URL ?? "").trim().replace(/\/$/, "");
  const login = String(env.CONSTRUMANAGER_LOGIN ?? "").trim();
  const senha = String(env.CONSTRUMANAGER_PASSWORD ?? "").trim();
  const supabaseUrl = String(env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/$/, "");
  const supabaseKey = String(env.SUPABASE_SECRET_KEY ?? "").trim();
  const projectId = String(env.ACC_PROJECT_ID ?? PROJECT_ID_PADRAO).trim();

  if (!baseUrl || !login || !senha || !supabaseUrl || !supabaseKey) {
    dizer("Variaveis de ambiente ausentes. Nada foi chamado.");
    return { veredito: "INCONCLUSIVO", exitCode: 2, chamadas: 0 };
  }

  const cm = criarChamadorConstrumanager({ baseUrl, fetchImpl });
  const sb = criarLeitorSupabase({ url: supabaseUrl, chave: supabaseKey, fetchImpl });

  // 1) Autenticacao. Credenciais so daqui, nunca de argv.
  const auth = await cm.chamar("/Login/Auth", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login, senha }),
  });

  if (auth?.status?.id !== 1) {
    throw new Error(`Login/Auth recusou: ${sanitizar(auth?.status?.description)}`);
  }

  const empresa = Number(auth?.user?.companyId);

  if (empresa !== EMPRESA_ESPERADA) {
    throw new Error("A empresa autenticada nao e' a esperada para esta validacao.");
  }

  const token = await cm.chamar("/Login/Token/Get", {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      token: String(auth.user.token),
    }),
  });

  const acesso = String(token?.access_token ?? "");

  if (acesso.length < 10) {
    throw new Error("Token/Get nao devolveu um access token utilizavel.");
  }

  const autorizado = {
    Authorization: `Bearer ${acesso}`,
    "Content-Type": "application/json",
  };

  // 2) Obra — confere escopo antes de listar qualquer coisa.
  const obras = await cm.chamar("/Obra/List", {
    headers: autorizado,
    body: JSON.stringify({ empresaId: empresa }),
  });

  if (obras?.status?.id !== 0) {
    throw new Error(`Obra/List recusou: ${sanitizar(obras?.status?.description)}`);
  }

  const obra = (obras.listWork ?? []).find((o) => Number(o.id) === OBRA_ESPERADA);

  if (!obra) {
    throw new Error("A obra desta validacao nao esta disponivel para o usuario.");
  }

  // 3) Pastas — unica fonte do caminho legivel.
  const pastas = await cm.chamar("/Pasta/List", {
    headers: autorizado,
    body: JSON.stringify({ empresaId: empresa, obraId: OBRA_ESPERADA }),
  });

  if (pastas?.status?.id !== 0) {
    throw new Error(`Pasta/List recusou: ${sanitizar(pastas?.status?.description)}`);
  }

  // 4) Arquivos — o objeto do teste. Sem lista mestra.
  const arquivosResposta = await cm.chamar("/Arquivo/List", {
    headers: autorizado,
    body: JSON.stringify({ empresaId: empresa, obraId: OBRA_ESPERADA }),
  });

  if (arquivosResposta?.status?.id !== 0) {
    throw new Error(
      `Arquivo/List recusou: ${sanitizar(arquivosResposta?.status?.description)}`
    );
  }

  // 5) Inventario atual, somente leitura.
  const documentos = await sb.get(
    "construmanager_documents" +
      "?select=construmanager_object_id,revision" +
      `&project_id=eq.${encodeURIComponent(projectId)}`
  );

  const metricas = compararInventarios({
    arquivos: arquivosResposta.listFile ?? [],
    documentos,
    pastas: pastas.listFolder ?? [],
  });

  const { veredito, exitCode } = avaliar(metricas);

  // Somente numeros e ids. Nunca nome de arquivo, nome de pessoa,
  // payload bruto, cabecalho ou token.
  dizer(`chamadas ao Construmanager : ${cm.total} (teto ${MAX_CHAMADAS_CONSTRUMANAGER})`);
  dizer(`rotas usadas               : ${cm.rotas.join(", ")}`);
  dizer(`leituras GET no Supabase   : ${sb.total}`);
  dizer(`pastas                     : ${metricas.totalPastas}`);
  dizer(`Arquivo/List devolveu      : ${metricas.totalArquivoList}`);
  dizer(`registros validos          : ${metricas.totalValidos}`);
  dizer(`documentos no banco        : ${metricas.totalNoBanco}`);
  dizer(`presentes nas duas fontes  : ${metricas.emAmbos}`);
  dizer(`novos no Construmanager    : ${metricas.novosNoConstrumanager.length}`);
  dizer(`ausentes no Construmanager : ${metricas.ausentesNoConstrumanager.length}`);
  dizer(`revisoes iguais            : ${metricas.revisoesIguais}`);
  dizer(`revisoes divergentes       : ${metricas.revisoesDivergentes.length}`);
  dizer(`ids duplicados             : ${metricas.duplicados.length}`);
  dizer(`registros invalidos        : ${metricas.invalidos.length}`);

  if (metricas.novosNoConstrumanager.length > 0) {
    dizer(`ids novos      : ${metricas.novosNoConstrumanager.slice(0, 50).join(", ")}`);
  }

  if (metricas.ausentesNoConstrumanager.length > 0) {
    dizer(`ids ausentes   : ${metricas.ausentesNoConstrumanager.slice(0, 50).join(", ")}`);
  }

  for (const d of metricas.revisoesDivergentes.slice(0, 50)) {
    dizer(`divergencia    : id=${d.id} api=${d.api} banco=${d.banco}`);
  }

  for (const i of metricas.invalidos.slice(0, 50)) {
    dizer(`invalido       : id=${i.id ?? "?"} campos=${i.campos.join("+")}`);
  }

  dizer("nenhum conteudo fisico foi solicitado: Objeto/Download nao e' alcancavel por este script.");
  dizer(`veredito: ${veredito}`);

  return { veredito, exitCode, chamadas: cm.total, metricas };
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
