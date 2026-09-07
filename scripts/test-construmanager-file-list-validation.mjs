// Testes da validacao isolada de Arquivo/List.
//
// Nenhuma rede, nenhuma credencial real: o fetch e' um duble e as
// credenciais sao valores inteiramente ficticios. O objetivo e' provar
// que as GARANTIAS do script sao estruturais — que uma rota proibida,
// uma escrita no Supabase ou um retry nao dependem de disciplina de quem
// chama, mas sao recusados pelo proprio codigo.
//
// Uso: node scripts/test-construmanager-file-list-validation.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.join(here, "..");

const mod = await import("./validate-construmanager-file-list.mjs");

const {
  ENDPOINTS_PERMITIDOS,
  ENDPOINTS_PROIBIDOS,
  MAX_CHAMADAS_CONSTRUMANAGER,
  sanitizar,
  normalizarRevisao,
  criarChamadorConstrumanager,
  criarLeitorSupabase,
  validarRegistro,
  compararInventarios,
  avaliar,
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

// Valor ficticio com forma de token. Se vazar para algum log, os testes
// abaixo pegam.
const TOKEN_FALSO = "TOKEN_FALSO_DE_TESTE_nunca_deve_vazar_0123456789abcdefghijklmno";
const SENHA_FALSA = "SENHA_FALSA_DE_TESTE";

function pasta(id) {
  return { id, parentId: 0, name: `Pasta ${id}`, level: 1, path: `/Pasta ${id}` };
}

function arquivo(id, review, extras = {}) {
  return {
    id,
    parentId: 900,
    name: `arquivo-${id}.dwg`,
    review,
    extension: "dwg",
    upload: "Pessoa Ficticia",
    dataUpload: "2026-08-21T13:35:00",
    sizeNumber: 1234,
    hasVersion: false,
    ...extras,
  };
}

function doc(id, revision) {
  return { construmanager_object_id: id, revision };
}

const PASTAS = [pasta(900)];

console.log("=====================================================================");
console.log("VALIDACAO ISOLADA DE Arquivo/List — TESTES SEM REDE");
console.log("=====================================================================");
console.log("");

console.log("-- A. 192 ids coincidentes, o cenario esperado --");

const arquivos192 = [];
const docs192 = [];
for (let i = 0; i < 192; i += 1) {
  arquivos192.push(arquivo(37000000 + i, String(i % 10).padStart(2, "0")));
  docs192.push(doc(37000000 + i, String(i % 10).padStart(2, "0")));
}

const m192 = compararInventarios({
  arquivos: arquivos192,
  documentos: docs192,
  pastas: PASTAS,
});

check("Arquivo/List devolveu 192", m192.totalArquivoList === 192);
check("192 validos", m192.totalValidos === 192);
check("192 no banco", m192.totalNoBanco === 192);
check("192 presentes nas duas fontes", m192.emAmbos === 192);
check("nenhum novo", m192.novosNoConstrumanager.length === 0);
check("nenhum ausente", m192.ausentesNoConstrumanager.length === 0);
check("192 revisoes iguais", m192.revisoesIguais === 192);
check("nenhuma divergencia", m192.revisoesDivergentes.length === 0);
check("nenhum duplicado", m192.duplicados.length === 0);
check("nenhum invalido", m192.invalidos.length === 0);
check("veredito COBERTURA COMPLETA", avaliar(m192).veredito === "COBERTURA COMPLETA");
check("exit 0 na cobertura completa", avaliar(m192).exitCode === 0);

console.log("");
console.log("-- B. Arquivo novo no Construmanager --");

const mNovo = compararInventarios({
  arquivos: [arquivo(1, "00"), arquivo(2, "01"), arquivo(3, "00")],
  documentos: [doc(1, "00"), doc(2, "01")],
  pastas: PASTAS,
});

check("detecta 1 id novo", mNovo.novosNoConstrumanager.length === 1);
check("o id novo e o correto", mNovo.novosNoConstrumanager[0] === 3);
check("novo nao conta como ausente", mNovo.ausentesNoConstrumanager.length === 0);
check("arquivo novo nao reprova a cobertura", avaliar(mNovo).veredito === "COBERTURA COMPLETA");

console.log("");
console.log("-- C. Arquivo ausente no Construmanager --");

const mAusente = compararInventarios({
  arquivos: [arquivo(1, "00")],
  documentos: [doc(1, "00"), doc(2, "01")],
  pastas: PASTAS,
});

check("detecta 1 id ausente", mAusente.ausentesNoConstrumanager.length === 1);
check("o id ausente e o correto", mAusente.ausentesNoConstrumanager[0] === 2);
check("ausencia reprova a cobertura", avaliar(mAusente).veredito === "COBERTURA INCOMPLETA");
check("exit 1 na cobertura incompleta", avaliar(mAusente).exitCode === 1);

console.log("");
console.log("-- D. Revisao divergente --");

const mRev = compararInventarios({
  arquivos: [arquivo(1, "05")],
  documentos: [doc(1, "04")],
  pastas: PASTAS,
});

check("detecta 1 divergencia", mRev.revisoesDivergentes.length === 1);
check("registra api e banco", mRev.revisoesDivergentes[0].api === "05" && mRev.revisoesDivergentes[0].banco === "04");
check("nao conta como igual", mRev.revisoesIguais === 0);
check("divergencia vira ressalva", avaliar(mRev).veredito === "COBERTURA COM RESSALVAS");

check("normalizacao trata 1 e 01 como iguais", normalizarRevisao("1") === normalizarRevisao("01"));
const mRevNorm = compararInventarios({
  arquivos: [arquivo(1, "1")],
  documentos: [doc(1, "01")],
  pastas: PASTAS,
});
check("1 x 01 nao e divergencia", mRevNorm.revisoesDivergentes.length === 0);

console.log("");
console.log("-- E. Id duplicado --");

const mDup = compararInventarios({
  arquivos: [arquivo(1, "00"), arquivo(1, "00")],
  documentos: [doc(1, "00")],
  pastas: PASTAS,
});

check("detecta duplicidade", mDup.duplicados.length === 1);
check("conta o id uma unica vez", mDup.totalValidos === 1);
check("duplicidade vira ressalva", avaliar(mDup).veredito === "COBERTURA COM RESSALVAS");

console.log("");
console.log("-- F. Campo obrigatorio ausente ou invalido --");

const casos = [
  ["id", arquivo(0, "00")],
  ["revisao", arquivo(5, "  ")],
  ["pasta", arquivo(6, "00", { parentId: 999999 })],
  ["dataUpload", arquivo(7, "00", { dataUpload: "nao-e-data" })],
];

for (const [campo, registro] of casos) {
  const problemas = validarRegistro(registro, new Set([900]));
  check(`campo invalido detectado: ${campo}`, problemas.includes(campo));
}

const mInv = compararInventarios({
  arquivos: [arquivo(1, "00"), arquivo(2, "00", { dataUpload: "x" })],
  documentos: [doc(1, "00")],
  pastas: PASTAS,
});

check("invalido nao entra na comparacao", mInv.totalValidos === 1);
check("invalido e' contado e reportado", mInv.invalidos.length === 1);
check("invalido vira ressalva", avaliar(mInv).veredito === "COBERTURA COM RESSALVAS");
check("registro sem pasta conhecida e' invalido", validarRegistro(arquivo(8, "00", { parentId: 1 }), new Set([900])).includes("pasta"));

console.log("");
console.log("-- G. Rotas proibidas sao recusadas ANTES da rede --");

for (const rota of ["/ListaMestra/List", "/Objeto/Download", "/Arquivo/Status/List"]) {
  let tentouRede = false;
  const cm = criarChamadorConstrumanager({
    baseUrl: "https://exemplo.invalido",
    fetchImpl: async () => {
      tentouRede = true;
      return { ok: true, json: async () => ({}) };
    },
  });

  let erro = null;
  try {
    await cm.chamar(rota, { body: "{}" });
  } catch (e) {
    erro = e;
  }

  check(`${rota} recusada`, erro !== null);
  check(`${rota} nao chegou a rede`, tentouRede === false);
  check(`${rota} nao contou como chamada`, cm.total === 0);
}

check("ListaMestra/List esta na lista de proibidos", ENDPOINTS_PROIBIDOS.includes("/ListaMestra/List"));
check("Objeto/Download esta na lista de proibidos", ENDPOINTS_PROIBIDOS.includes("/Objeto/Download"));
check("nenhuma rota proibida esta na allowlist", ENDPOINTS_PROIBIDOS.every((r) => !ENDPOINTS_PERMITIDOS.includes(r)));
check("allowlist tem exatamente 5 rotas", ENDPOINTS_PERMITIDOS.length === 5);

{
  const cm = criarChamadorConstrumanager({ baseUrl: "https://exemplo.invalido", fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  let erro = null;
  try {
    await cm.chamar("/Rota/Inventada", { body: "{}" });
  } catch (e) {
    erro = e;
  }
  check("rota fora da allowlist recusada", erro !== null);
}

console.log("");
console.log("-- H. Supabase: escrita bloqueada, GET permitido --");

for (const metodo of ["POST", "PATCH", "PUT", "DELETE"]) {
  let tentouRede = false;
  const sb = criarLeitorSupabase({
    url: "https://exemplo.invalido",
    chave: "chave-falsa",
    fetchImpl: async () => {
      tentouRede = true;
      return { ok: true, json: async () => [] };
    },
  });

  let erro = null;
  try {
    await sb.get("tabela", { method: metodo });
  } catch (e) {
    erro = e;
  }

  check(`${metodo} no Supabase recusado`, erro !== null);
  check(`${metodo} nao chegou a rede`, tentouRede === false);
}

{
  let metodoUsado = null;
  const sb = criarLeitorSupabase({
    url: "https://exemplo.invalido",
    chave: "chave-falsa",
    fetchImpl: async (_url, init) => {
      metodoUsado = init.method;
      return { ok: true, json: async () => [doc(1, "00")] };
    },
  });

  const linhas = await sb.get("construmanager_documents?select=x");
  check("GET no Supabase funciona", Array.isArray(linhas) && linhas.length === 1);
  check("GET usa mesmo o metodo GET", metodoUsado === "GET");
  check("GET conta como leitura", sb.total === 1);
}

console.log("");
console.log("-- I. Teto de chamadas e ausencia de retry --");

{
  const cm = criarChamadorConstrumanager({
    baseUrl: "https://exemplo.invalido",
    fetchImpl: async () => ({ ok: true, json: async () => ({ status: { id: 0 } }) }),
  });

  for (let i = 0; i < MAX_CHAMADAS_CONSTRUMANAGER; i += 1) {
    await cm.chamar("/Obra/List", { body: "{}" });
  }

  check(`${MAX_CHAMADAS_CONSTRUMANAGER} chamadas permitidas`, cm.total === MAX_CHAMADAS_CONSTRUMANAGER);

  let erro = null;
  try {
    await cm.chamar("/Obra/List", { body: "{}" });
  } catch (e) {
    erro = e;
  }

  check("a chamada seguinte ao teto e recusada", erro !== null);
  check("o contador nao passa do teto", cm.total === MAX_CHAMADAS_CONSTRUMANAGER);
  check("teto e 6", MAX_CHAMADAS_CONSTRUMANAGER === 6);
}

{
  let tentativas = 0;
  const cm = criarChamadorConstrumanager({
    baseUrl: "https://exemplo.invalido",
    fetchImpl: async () => {
      tentativas += 1;
      return { ok: false, status: 500, json: async () => ({}) };
    },
  });

  let erro = null;
  try {
    await cm.chamar("/Arquivo/List", { body: "{}" });
  } catch (e) {
    erro = e;
  }

  check("falha HTTP vira erro", erro !== null);
  check("uma unica tentativa: sem retry", tentativas === 1);
}

console.log("");
console.log("-- J. Sanitizacao: nenhum segredo em log ou erro --");

check("Bearer e redigido", !sanitizar(`Authorization: Bearer ${TOKEN_FALSO}`).includes(TOKEN_FALSO));
check("token= e redigido", !sanitizar(`token=${TOKEN_FALSO}`).includes(TOKEN_FALSO));
check("senha= e redigida", !sanitizar(`senha=${SENHA_FALSA}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`).includes(SENHA_FALSA));
check("cadeia opaca longa e redigida", !sanitizar(`falhou com ${TOKEN_FALSO}`).includes(TOKEN_FALSO));
check("nenhuma cadeia longa sobrevive", !/[A-Za-z0-9_-]{40,}/.test(sanitizar(`x ${TOKEN_FALSO} y`)));
check("texto util e preservado", sanitizar("Arquivo/List recusou: Index was outside").includes("Index was outside"));
check("saida sanitizada e limitada", sanitizar("a".repeat(5000)).length <= 300);

console.log("");
console.log("-- K. Falha da API chega sanitizada --");

{
  // Erro real do fornecedor, com stack trace e um identificador opaco.
  const descricao =
    "An error occurred while executing the command definition. => System.Data.SqlClient.SqlException " +
    TOKEN_FALSO;

  const cm = criarChamadorConstrumanager({
    baseUrl: "https://exemplo.invalido",
    fetchImpl: async () => ({ ok: true, json: async () => ({ status: { id: -999, description: descricao } }) }),
  });

  const resposta = await cm.chamar("/Arquivo/List", { body: "{}" });
  const mensagem = sanitizar(`Arquivo/List recusou: ${resposta.status.description}`);

  check("a mensagem sanitizada nao carrega o valor opaco", !mensagem.includes(TOKEN_FALSO));
  check("a mensagem preserva a causa legivel", mensagem.includes("An error occurred"));
}

console.log("");
console.log("-- L. Sem credenciais: nada e chamado --");

{
  let tentouRede = false;
  const relatorio = await executar({}, async () => {
    tentouRede = true;
    return { ok: true, json: async () => ({}) };
  });

  check("sem env, veredito INCONCLUSIVO", relatorio.veredito === "INCONCLUSIVO");
  check("sem env, exit 2", relatorio.exitCode === 2);
  check("sem env, zero chamadas", relatorio.chamadas === 0);
  check("sem env, nenhuma rede", tentouRede === false);
}

console.log("");
console.log("-- M. Auditoria estrutural do script e do workflow --");

const fonte = fs.readFileSync(path.join(raiz, "scripts/validate-construmanager-file-list.mjs"), "utf8").replace(/\r\n/g, "\n");

check("le segredos de process.env", /process\.env/.test(fonte));
check("nao le segredos de argv", !/process\.argv\.slice\(2\)/.test(fonte));
check("nao importa o worker de sincronizacao", !/construmanager-metadata-worker|collect-metadata/.test(fonte));
check("nao usa o SDK do Supabase", !/@supabase\/supabase-js/.test(fonte));
check("nao contem nenhum segredo literal", !/sb_secret_[A-Za-z0-9]/.test(fonte));
check("importar o modulo nao dispara execucao", /executadoDiretamente/.test(fonte));
check("nao ha caminho de escrita no Supabase", !/method:\s*"(POST|PUT|PATCH|DELETE)"/.test(fonte.split("criarLeitorSupabase")[1] ?? ""));

const wf = fs.readFileSync(path.join(raiz, ".github/workflows/construmanager-file-list-validation.yml"), "utf8").replace(/\r\n/g, "\n");

check("workflow tem workflow_dispatch", /workflow_dispatch:/.test(wf));
check("workflow nao tem schedule ativo", !/^\s{2}schedule:/m.test(wf));
check("workflow tem permissions contents: read", /permissions:\s*\n\s*contents:\s*read/.test(wf));
check("workflow tem timeout de no maximo 10 minutos", /timeout-minutes:\s*(10|[1-9])\b/.test(wf));
check("workflow chama somente o script de validacao", (wf.match(/node scripts\/[a-z-]+\.mjs/g) ?? []).length === 1);
check("workflow nao invoca os workers operacionais", !/metadata-worker|content-worker|version-monitor/.test(wf));
// Nao basta procurar "supabase": o workflow legitimamente passa
// SUPABASE_SECRET_KEY por env. O que precisa ser impossivel e' INVOCAR
// a CLI ou aplicar migration.
check("workflow nao invoca a CLI do supabase", !/(npx\s+)?supabase\s+(db|migration|link|start)/i.test(wf));
check("workflow nao aplica migration", !/db\s+push|migration\s+(up|repair|apply)|db\s+reset/i.test(wf));
check("workflow nao referencia arquivos de migration", !/supabase\/migrations/i.test(wf));
check("workflow nao recebe interruptores de automacao", !/CONSTRUMANAGER_AUTO_|METADATA_SYNC_ENABLED|VERSION_MONITORING_ENABLED/.test(wf));

console.log("");
console.log("=====================================================================");
console.log(`Resultado: ${passaram} passaram, ${falharam} falharam.`);
console.log("=====================================================================");

process.exit(falharam === 0 ? 0 : 1);
