// Regressao do defeito que quebrou a primeira sincronizacao headless de
// metadados (run 34049828023).
//
// O QUE ACONTECEU
//
//   collectConstrumanagerMetadata(client, companyId, workId)  <- 3 params
//
// era chamado pelo worker headless com QUATRO argumentos:
//
//   collectConstrumanagerMetadata(client, token.access_token, companyId, workId)
//
// Tudo deslocava uma posicao: `companyId` recebia o access token,
// `workId` recebia o companyId e o workId real era descartado. A
// checagem `auth.user.companyId !== companyId` passava a comparar numero
// com string — sempre verdadeira — e lancava um erro que INTERPOLAVA o
// valor recebido. Como esse valor era o access token, ele foi gravado em
// texto claro no log do GitHub Actions.
//
// JavaScript aceita argumentos extras em silencio e o .mjs nao passa
// pelo tsc: lint, build e as demais suites passaram sem ver o defeito.
// Este teste existe exatamente para fechar essa lacuna.
//
// Nao usa credencial real e nao toca a rede: o client e' um duble.
//
// Uso: node scripts/test-construmanager-headless-metadata-auth.mjs

import { register } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.join(here, "..");

const { collectConstrumanagerMetadata } = await import(
  "../apps/web/lib/integrations/construmanager/collect-metadata.ts"
);

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

function ler(relativo) {
  return fs.readFileSync(path.join(raiz, relativo), "utf8").replace(/\r\n/g, "\n");
}

// Valor inteiramente ficticio, com a forma opaca de um access token real.
// Se ele aparecer em qualquer mensagem de erro, houve vazamento.
const TOKEN_FALSO =
  "TOKEN_FALSO_DE_TESTE_nUnCa_dEvE_aPaReCeR_eM_mEnSaGeM_de_erro_0123456789abcdef";

const COMPANY_ID = 4242;
const WORK_ID = 7777;

function criarClienteDuble() {
  const chamadas = [];

  return {
    chamadas,

    async authenticate() {
      chamadas.push({ metodo: "authenticate", args: [] });
      return {
        user: {
          id: 11,
          type: 3,
          companyId: COMPANY_ID,
          token: "token-intermediario-falso",
        },
      };
    },

    async getAccessToken(intermediario) {
      chamadas.push({ metodo: "getAccessToken", args: [intermediario] });
      return { access_token: TOKEN_FALSO, token_type: "bearer", expires_in: 86400 };
    },

    async listWorks(accessToken, companyId) {
      chamadas.push({ metodo: "listWorks", args: [accessToken, companyId] });
      return { listWork: [{ id: WORK_ID, name: "Obra de teste" }] };
    },

    async listFolders(accessToken, companyId, workId) {
      chamadas.push({ metodo: "listFolders", args: [accessToken, companyId, workId] });
      return {
        listFolder: [
          { id: 1, parentId: 0, name: "Raiz", path: "/Raiz", level: 0 },
        ],
      };
    },

    async listMasterList(accessToken, companyId, workId, userId, userType, folderIds) {
      chamadas.push({
        metodo: "listMasterList",
        args: [accessToken, companyId, workId, userId, userType, folderIds],
      });
      return { listaMestra: [] };
    },

    async listFiles(accessToken, companyId, workId) {
      chamadas.push({ metodo: "listFiles", args: [accessToken, companyId, workId] });
      return { listFile: [] };
    },
  };
}

console.log("=====================================================================");
console.log("REGRESSAO — ASSINATURA DE collectConstrumanagerMetadata (headless)");
console.log("=====================================================================");
console.log("");

console.log("-- A. Assinatura CORRETA (client, companyId, workId) --");

const clienteOk = criarClienteDuble();
let resultadoOk = null;
let erroOk = null;

try {
  resultadoOk = await collectConstrumanagerMetadata(clienteOk, COMPANY_ID, WORK_ID);
} catch (erro) {
  erroOk = erro;
}

check("a chamada com 3 argumentos NAO lanca", erroOk === null);
check("devolve um resultado", resultadoOk !== null);
check(
  "companyId devolvido e o configurado",
  resultadoOk?.companyId === COMPANY_ID
);
check("workId devolvido e o configurado", resultadoOk?.workId === WORK_ID);
check(
  "a obra configurada foi resolvida pelo workId correto",
  resultadoOk?.workName === "Obra de teste"
);

const chamadaWorks = clienteOk.chamadas.find((c) => c.metodo === "listWorks");
check("listWorks foi chamado", chamadaWorks !== undefined);
check(
  "listWorks recebeu o ACCESS TOKEN na 1a posicao",
  chamadaWorks?.args[0] === TOKEN_FALSO
);
check(
  "listWorks recebeu o COMPANY ID numerico na 2a posicao",
  chamadaWorks?.args[1] === COMPANY_ID
);

const chamadaPastas = clienteOk.chamadas.find((c) => c.metodo === "listFolders");
check(
  "listFolders recebeu (token, companyId, workId) sem deslocamento",
  chamadaPastas?.args[0] === TOKEN_FALSO &&
    chamadaPastas?.args[1] === COMPANY_ID &&
    chamadaPastas?.args[2] === WORK_ID
);

check(
  "o token e obtido DENTRO da funcao (getAccessToken chamado)",
  clienteOk.chamadas.some((c) => c.metodo === "getAccessToken")
);

console.log("");
console.log("-- B. Assinatura ANTIGA de 4 argumentos: precisa falhar --");

const clienteRuim = criarClienteDuble();
let erroRuim = null;

try {
  // Exatamente a chamada defeituosa que quebrou o run 34049828023.
  await collectConstrumanagerMetadata(clienteRuim, TOKEN_FALSO, COMPANY_ID, WORK_ID);
} catch (erro) {
  erroRuim = erro;
}

check("a chamada com 4 argumentos LANCA", erroRuim !== null);
check(
  "falha na checagem de empresa (o token caiu no lugar do companyId)",
  String(erroRuim?.message ?? "").includes("conta configurada")
);
check(
  "nao chega a listar obras — falha antes de qualquer leitura",
  !clienteRuim.chamadas.some((c) => c.metodo === "listWorks")
);

console.log("");
console.log("-- C. A mensagem de erro NAO pode vazar o valor recebido --");

const mensagemRuim = String(erroRuim?.message ?? "");

check(
  "a mensagem NAO contem o access token recebido",
  !mensagemRuim.includes(TOKEN_FALSO)
);
check(
  "a mensagem NAO contem nenhuma cadeia opaca longa",
  !/[A-Za-z0-9_-]{40,}/.test(mensagemRuim)
);
check(
  "a mensagem NAO interpola o companyId entre parenteses",
  !/conta configurada\s*\(/.test(mensagemRuim)
);
check(
  "a mensagem ainda diz QUAL invariante quebrou",
  mensagemRuim.includes("não corresponde à empresa retornada pela API")
);

console.log("");
console.log("-- D. Codigo-fonte: nenhuma interpolacao nessa mensagem --");

const ARQUIVOS_COM_A_MENSAGEM = [
  "apps/web/lib/integrations/construmanager/collect-metadata.ts",
  "apps/web/app/[projectId]/integracoes/actions.ts",
];

for (const relativo of ARQUIVOS_COM_A_MENSAGEM) {
  const fonte = ler(relativo);
  check(
    `${relativo}: mensagem sem interpolacao de valor`,
    !/A conta configurada \(\$\{/.test(fonte)
  );
}

console.log("");
console.log("-- E. Todos os chamadores respeitam a assinatura de 3 argumentos --");

// Varre o repositorio (fora de node_modules) atras de qualquer chamada e
// conta os argumentos de topo. Um chamador novo com 4 argumentos reprova
// aqui, mesmo que esteja num arquivo que ainda nao existe hoje.
function listarFontes(dir, acumulado = []) {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entrada.name === "node_modules" || entrada.name === ".git") continue;
    if (entrada.name === ".next" || entrada.name === "dist") continue;

    const completo = path.join(dir, entrada.name);

    if (entrada.isDirectory()) {
      listarFontes(completo, acumulado);
    } else if (/\.(ts|tsx|mjs|js)$/.test(entrada.name)) {
      acumulado.push(completo);
    }
  }

  return acumulado;
}

function contarArgumentosDeTopo(texto) {
  let profundidade = 0;
  let argumentos = 1;

  for (const caractere of texto) {
    if ("([{".includes(caractere)) profundidade += 1;
    else if (")]}".includes(caractere)) profundidade -= 1;
    else if (caractere === "," && profundidade === 0) argumentos += 1;
  }

  return argumentos;
}

const chamadores = [];

for (const arquivo of listarFontes(raiz)) {
  const fonte = fs.readFileSync(arquivo, "utf8").replace(/\r\n/g, "\n");
  const alvo = "collectConstrumanagerMetadata(";
  let indice = fonte.indexOf(alvo);

  while (indice !== -1) {
    const antes = fonte.slice(Math.max(0, indice - 20), indice);

    // Ignora a propria declaracao da funcao.
    if (!/function\s+$/.test(antes)) {
      let profundidade = 1;
      let fim = indice + alvo.length;

      while (fim < fonte.length && profundidade > 0) {
        if (fonte[fim] === "(") profundidade += 1;
        else if (fonte[fim] === ")") profundidade -= 1;
        fim += 1;
      }

      const argumentos = fonte.slice(indice + alvo.length, fim - 1);

      chamadores.push({
        arquivo: path.relative(raiz, arquivo).replace(/\\/g, "/"),
        argumentos: contarArgumentosDeTopo(argumentos),
      });
    }

    indice = fonte.indexOf(alvo, indice + 1);
  }
}

// O proprio arquivo de teste chama a funcao de proposito com 4
// argumentos (cenario B); ele nao entra na conferencia.
const chamadoresDeProducao = chamadores.filter(
  (c) => !c.arquivo.startsWith("scripts/test-")
);

check(
  "ha pelo menos dois chamadores de producao (UI e worker headless)",
  chamadoresDeProducao.length >= 2
);

check(
  "o worker headless esta entre os chamadores",
  chamadoresDeProducao.some(
    (c) => c.arquivo === "scripts/construmanager-metadata-worker.mjs"
  )
);

for (const chamador of chamadoresDeProducao) {
  check(
    `${chamador.arquivo}: passa exatamente 3 argumentos (recebeu ${chamador.argumentos})`,
    chamador.argumentos === 3
  );
}

console.log("");
console.log("-- F. O worker nao obtem mais um token que nao usa --");

const workerFonte = ler("scripts/construmanager-metadata-worker.mjs");

check(
  "worker nao passa token.access_token para a coleta",
  !/collectConstrumanagerMetadata\([^)]*access_token/s.test(workerFonte)
);
check(
  "worker nao guarda um access token em variavel local",
  !/const\s+token\s*=\s*await\s+client\.getAccessToken/.test(workerFonte)
);
check(
  "worker mantem a conferencia de empresa antes de coletar",
  /auth\.user\.companyId\s*!==\s*companyId/.test(workerFonte)
);

console.log("");
console.log("=====================================================================");
console.log(`Resultado: ${passaram} passaram, ${falharam} falharam.`);
console.log("=====================================================================");

process.exit(falharam === 0 ? 0 : 1);
