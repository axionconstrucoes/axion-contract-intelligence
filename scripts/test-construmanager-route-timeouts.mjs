// Timeout por categoria de rota no client do Construmanager.
//
// POR QUE EXISTE
//
// A confirmacao do run 34082823463 morreu com "/Arquivo/List timed out
// after 15000 ms" — numa chamada que minutos antes cabia num ciclo
// completo de 11 s. O teto era unico para todas as rotas.
//
// Autenticar e trocar token sao operacoes curtas: se demoram, algo esta
// errado e esperar mais so atrasa o diagnostico. As listagens varrem o
// acervo da obra (192 documentos, 25 pastas) e a latencia do fornecedor
// varia. Por isso o teto agora e por rota — e alargar TUDO para 60 s
// seria o caminho preguicoso, que tornaria uma falha de autenticacao
// quatro vezes mais lenta de perceber sem ganho nenhum.
//
// Os testes nao esperam de verdade: o fetch e um duble que so resolve
// quando o AbortController for acionado, e o relogio e substituido para
// medir QUAL prazo foi armado. Sem rede, sem credencial.
//
// Uso: node scripts/test-construmanager-route-timeouts.mjs

import { register } from "node:module";
import { readFileSync } from "node:fs";

register("./ts-module-resolver.mjs", import.meta.url);

const { ConstrumanagerClient } = await import(
  "../apps/web/lib/integrations/construmanager/client.ts"
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

const TOKEN_FALSO = "TOKEN_FALSO_DE_TESTE_nunca_deve_vazar_0123456789abcdefghij";
const SENHA_FALSA = "SENHA_FALSA_DE_TESTE";

// SEM `timeoutMs`: ausencia significa "use o padrao da rota". Preencher
// 15000 aqui seria um override explicito e todas as rotas expirariam em
// 15 s — inclusive as listagens que precisam de 60 s.
const CONFIG = {
  baseUrl: "https://exemplo.invalido",
  login: "LOGIN_FALSO",
  password: SENHA_FALSA,
  companyId: 1645,
  workId: 34164,
};

/*
 * Substitui setTimeout/clearTimeout para observar o prazo armado e
 * disparar o abort na hora, sem esperar de verdade.
 */
function comRelogioFalso(executar) {
  const setReal = globalThis.setTimeout;
  const clearReal = globalThis.clearTimeout;

  const armados = [];
  const limpos = [];
  let proximoId = 1;

  globalThis.setTimeout = (fn, ms) => {
    const id = proximoId++;
    armados.push({ id, ms, fn });
    return id;
  };

  globalThis.clearTimeout = (id) => {
    limpos.push(id);
  };

  const restaurar = () => {
    globalThis.setTimeout = setReal;
    globalThis.clearTimeout = clearReal;
  };

  return { armados, limpos, restaurar, executar };
}

/*
 * Cenario de TIMEOUT: o fetch nunca resolve sozinho. Ele so termina
 * quando o abort e acionado — exatamente como uma rota lenta.
 */
async function medirTimeout(chamar) {
  const relogio = comRelogioFalso();
  const fetchReal = globalThis.fetch;
  let chamadasDeRede = 0;

  globalThis.fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      chamadasDeRede += 1;

      // Dispara o prazo armado imediatamente: o abort acontece "agora".
      const armado = relogio.armados[relogio.armados.length - 1];
      if (armado) armado.fn();

      if (init?.signal?.aborted) {
        const erro = new Error("The operation was aborted.");
        erro.name = "AbortError";
        reject(erro);
      }
    });

  let erro = null;
  try {
    await chamar();
  } catch (e) {
    erro = e;
  } finally {
    globalThis.fetch = fetchReal;
    relogio.restaurar();
  }

  return {
    erro,
    prazos: relogio.armados.map((a) => a.ms),
    limpos: relogio.limpos.length,
    chamadasDeRede,
  };
}

const client = new ConstrumanagerClient(CONFIG);

console.log("=====================================================================");
console.log("TIMEOUT POR ROTA — CONSTRUMANAGER");
console.log("=====================================================================");
console.log("");

console.log("-- 1. Autenticacao: 15 segundos --");

const auth = await medirTimeout(() => client.authenticate());
check("/Login/Auth arma 15000 ms", auth.prazos.includes(15000));
check("/Login/Auth nao arma 60000 ms", !auth.prazos.includes(60000));
check("/Login/Auth expira com erro", auth.erro !== null);
check("mensagem cita a rota e o limite", /\/Login\/Auth timed out after 15000 ms/.test(String(auth.erro?.message)));

const tokenGet = await medirTimeout(() => client.getAccessToken("token-intermediario-falso"));
check("/Login/Token/Get arma 15000 ms", tokenGet.prazos.includes(15000));
check("/Login/Token/Get nao arma 60000 ms", !tokenGet.prazos.includes(60000));
check("mensagem cita a rota e o limite", /\/Login\/Token\/Get timed out after 15000 ms/.test(String(tokenGet.erro?.message)));

console.log("");
console.log("-- 2. Listagens: 60 segundos --");

const rotas = [
  ["/Obra/List", () => client.listWorks(TOKEN_FALSO, CONFIG.companyId)],
  ["/Pasta/List", () => client.listFolders(TOKEN_FALSO, CONFIG.companyId, CONFIG.workId)],
  ["/Arquivo/List", () => client.listFiles(TOKEN_FALSO, CONFIG.companyId, CONFIG.workId)],
];

for (const [rota, chamar] of rotas) {
  const r = await medirTimeout(chamar);
  check(`${rota} arma 60000 ms`, r.prazos.includes(60000));
  check(`${rota} NAO usa os 15000 ms antigos`, !r.prazos.includes(15000));
  check(
    `${rota} expira com mensagem citando 60000 ms`,
    new RegExp(`${rota.replace(/\//g, "\\/")} timed out after 60000 ms`).test(String(r.erro?.message))
  );
}

console.log("");
console.log("-- 2b. Override explicito vence o padrao da rota --");

// Quem informa `timeoutMs` esta dizendo algo que a tabela nao sabe: um
// ambiente que precisa expirar em 50 ms, ou uma rede especifica. Por isso
// o override vem PRIMEIRO na precedencia — e por isso `timeoutMs` e
// opcional: ausencia significa "use o padrao da rota", nunca 15000.
const clienteComOverride = new ConstrumanagerClient({ ...CONFIG, timeoutMs: 50 });

const overrideAuth = await medirTimeout(() => clienteComOverride.authenticate());
check("override vale em rota de autenticacao", overrideAuth.prazos.includes(50));
check("override afasta o padrao de 15 s", !overrideAuth.prazos.includes(15000));
check(
  "mensagem cita o valor sobreposto",
  /\/Login\/Auth timed out after 50 ms/.test(String(overrideAuth.erro?.message))
);

const overrideLista = await medirTimeout(() =>
  clienteComOverride.listFiles(TOKEN_FALSO, CONFIG.companyId, CONFIG.workId)
);
check("override vale em rota de listagem", overrideLista.prazos.includes(50));
check("override afasta o padrao de 60 s", !overrideLista.prazos.includes(60000));
check(
  "mensagem cita o valor sobreposto",
  /\/Arquivo\/List timed out after 50 ms/.test(String(overrideLista.erro?.message))
);
check("override tambem nao repete a chamada", overrideLista.chamadasDeRede === 1);
check("override tambem limpa o timer", overrideLista.limpos >= 1);

// Rota fora da tabela e sem override: cai no minimo, nunca no maior.
const clienteSemOverride = new ConstrumanagerClient(CONFIG);
const desconhecida = await medirTimeout(() =>
  clienteSemOverride.listMasterList(TOKEN_FALSO, CONFIG.companyId, CONFIG.workId, 11, 3, [900])
);
check("rota fora da tabela usa 15000 ms", desconhecida.prazos.includes(15000));
check("rota fora da tabela NAO herda 60000 ms", !desconhecida.prazos.includes(60000));

console.log("");
console.log("-- 3. Abort, limpeza de timer e ausencia de retry --");

const arquivo = await medirTimeout(() => client.listFiles(TOKEN_FALSO, CONFIG.companyId, CONFIG.workId));

check("o AbortController foi acionado", arquivo.erro !== null);
check("erro de abort vira mensagem de timeout", /timed out after/.test(String(arquivo.erro?.message)));
check("uma unica chamada de rede: sem retry", arquivo.chamadasDeRede === 1);
check("um unico prazo armado por chamada", arquivo.prazos.length === 1);
check("o timer foi limpo", arquivo.limpos >= 1);

// Caminho de SUCESSO tambem precisa limpar: um timer pendente manteria o
// processo vivo depois de a resposta ter chegado.
const relogioOk = comRelogioFalso();
const fetchReal = globalThis.fetch;
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ status: { id: 0 }, listFile: [] }),
});

let respostaOk = null;
try {
  respostaOk = await client.listFiles(TOKEN_FALSO, CONFIG.companyId, CONFIG.workId);
} finally {
  globalThis.fetch = fetchReal;
  relogioOk.restaurar();
}

check("resposta valida retorna normalmente", Array.isArray(respostaOk?.listFile));
check("o timer e limpo tambem no sucesso", relogioOk.limpos.length === 1);
check("o prazo de sucesso tambem e 60000 ms", relogioOk.armados[0]?.ms === 60000);

console.log("");
console.log("-- 4. Erros sanitizados: nada de credencial --");

const mensagens = [
  auth.erro?.message,
  tokenGet.erro?.message,
  arquivo.erro?.message,
]
  .map(String)
  .join(" | ");

check("nenhuma mensagem carrega o token", !mensagens.includes(TOKEN_FALSO));
check("nenhuma mensagem carrega a senha", !mensagens.includes(SENHA_FALSA));
check("nenhuma mensagem carrega o login", !mensagens.includes("LOGIN_FALSO"));
check("nenhuma cadeia opaca longa", !/[A-Za-z0-9_-]{40,}/.test(mensagens));
check("nenhum cabecalho na mensagem", !/authorization|bearer|apikey/i.test(mensagens));
check("nenhum corpo de requisicao na mensagem", !/grant_type|empresaId|obraId|senha/i.test(mensagens));

console.log("");
console.log("-- 5. Codigo-fonte: contrato do timeout --");

const FONTE = readFileSync(
  "apps/web/lib/integrations/construmanager/client.ts",
  "utf8"
).replace(/\r\n/g, "\n");

check("existe tabela de timeout por rota", /TIMEOUTS_POR_ROTA/.test(FONTE));
check("autenticacao continua em 15 s", /"\/Login\/Auth": 15_000/.test(FONTE) && /"\/Login\/Token\/Get": 15_000/.test(FONTE));
check(
  "as tres listagens em 60 s",
  /"\/Obra\/List": 60_000/.test(FONTE) &&
    /"\/Pasta\/List": 60_000/.test(FONTE) &&
    /"\/Arquivo\/List": 60_000/.test(FONTE)
);
check(
  "o timeout global de autenticacao NAO virou 60 s",
  /const DEFAULT_TIMEOUT_MS = 15000;/.test(
    readFileSync("apps/web/lib/integrations/construmanager/config.ts", "utf8")
  )
);
check(
  "override explicito tem precedencia sobre o padrao da rota",
  /this\.config\.timeoutMs \?\?/.test(FONTE) &&
    FONTE.indexOf("this.config.timeoutMs ??") <
      FONTE.indexOf("ConstrumanagerClient.TIMEOUTS_POR_ROTA[path] ??")
);

check(
  "rota desconhecida cai no DEFAULT_TIMEOUT_MS",
  FONTE.includes("DEFAULT_TIMEOUT_MS") &&
    FONTE.indexOf("ConstrumanagerClient.TIMEOUTS_POR_ROTA[path] ??") <
      FONTE.lastIndexOf("DEFAULT_TIMEOUT_MS")
);

check(
  "a configuracao de producao NAO preenche timeoutMs",
  !/timeoutMs: DEFAULT_TIMEOUT_MS/.test(
    readFileSync("apps/web/lib/integrations/construmanager/config.ts", "utf8")
  )
);
check("AbortController preservado", /new AbortController\(\)/.test(FONTE));
check("clearTimeout em finally", /finally \{\n\s*\/\/[\s\S]{0,200}clearTimeout\(timeout\);|finally \{\n\s*clearTimeout\(timeout\);/.test(FONTE));
// Comentario nao e codigo. O client EXPLICA que nao ha retry, e
// procurar a palavra no arquivo inteiro reprovaria a explicacao.
const FONTE_EXECUTAVEL = FONTE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

check(
  "nenhum retry no codigo executavel do client",
  !/for \(let tentativa|retry|retries|attempt/i.test(FONTE_EXECUTAVEL)
);

check(
  "uma unica chamada a fetch por requisicao",
  (FONTE_EXECUTAVEL.match(/await fetch\(/g) ?? []).length === 2
);
check(
  "endpoints e corpos inalterados",
  /"\/Login\/Auth"/.test(FONTE) &&
    /"\/Obra\/List"/.test(FONTE) &&
    /"\/Pasta\/List"/.test(FONTE) &&
    /"\/Arquivo\/List"/.test(FONTE) &&
    /empresaId: companyId, obraId: workId/.test(FONTE)
);

console.log("");
console.log("=====================================================================");
console.log(`Resultado: ${passaram} passaram, ${falharam} falharam.`);
console.log("=====================================================================");

process.exit(falharam === 0 ? 0 : 1);
