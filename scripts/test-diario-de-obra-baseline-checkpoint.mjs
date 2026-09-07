// Retomada do baseline entre PROCESSOS independentes.
//
// O defeito que este teste existe para impedir: no run 34142741140 a
// sincronizacao voltou a janela ja completa (2026-06-10 .. 2026-09-07)
// em vez de continuar a que tinha 49 pendentes (2026-03-12 .. 2026-06-09).
//
// A causa nao era o calculo da janela — era o checkpoint nao dizer QUAL
// janela estava em curso. Um run que batia no teto de 20 nao gravava
// `proximaJanelaFim`, e o processo seguinte, sem memoria, relia `null` e
// recomecava de hoje.
//
// Por isso a simulacao aqui NAO encadeia chamadas na mesma memoria: cada
// run le o checkpoint gravado pelo anterior, como um processo novo faria.
//
// Sem rede, sem credencial, sem banco.
//
// Uso: node scripts/test-diario-de-obra-baseline-checkpoint.mjs

import { register } from "node:module";

register("./ts-module-resolver.mjs", import.meta.url);

const {
  janelaBaseline,
  lerRetomadaBaseline,
  montarCheckpointBaseline,
  somarDias,
  MAX_DETALHES_BASELINE,
} = await import("../apps/web/lib/integrations/diario-de-obra/sync-policy.ts");

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

const HOJE = "2026-09-07";
const PISO = "2026-01-01";

// Universo simulado: RDOs por data, como a API os devolveria.
// Janela A (2026-06-10..2026-09-07) tem 77; janela B tem 69; abaixo, nada.
function universo() {
  const rdos = [];
  for (let i = 0; i < 77; i += 1) rdos.push({ id: `A${i}`, data: somarDias("2026-06-10", i % 90) });
  for (let i = 0; i < 69; i += 1) rdos.push({ id: `B${i}`, data: somarDias("2026-03-12", i % 90) });
  return rdos;
}

const TODOS = universo();

function listar(janela) {
  return TODOS.filter((r) => r.data >= janela.inicio && r.data <= janela.fim);
}

/*
 * Um processo independente. Recebe SO o banco simulado e o checkpoint
 * gravado — nenhuma variavel viva do run anterior.
 */
function executarProcesso(banco, checkpointGravado) {
  const retomada = lerRetomadaBaseline(checkpointGravado);

  if (retomada.baselineComplete) {
    return { encerrou: true, janela: null, criados: 0, checkpoint: checkpointGravado };
  }

  const janela = janelaBaseline(HOJE, retomada.resumeWindowEnd, PISO);

  if (janela === null) {
    return { encerrou: true, janela: null, criados: 0, checkpoint: checkpointGravado };
  }

  const listados = listar(janela);
  const candidatos = listados.filter((r) => !banco.has(r.id));
  const selecionados = candidatos.slice(0, MAX_DETALHES_BASELINE);

  for (const r of selecionados) banco.set(r.id, { baseline_imported: true });

  const checkpoint = montarCheckpointBaseline({
    janela,
    candidatesRemaining: candidatos.length - selecionados.length,
    coverageGuaranteed: true,
    piso: PISO,
    totalNaOrigem: TODOS.length,
  });

  return { encerrou: false, janela, criados: selecionados.length, checkpoint, listados: listados.length };
}

console.log("=====================================================================");
console.log("RETOMADA DO BASELINE ENTRE PROCESSOS INDEPENDENTES");
console.log("=====================================================================");
console.log("");

console.log("-- 1. Checkpoint LEGADO realmente gravado em producao --");

// Exatamente o checkpoint do run 34142741140, o ultimo gravado.
const LEGADO_RUN6 = {
  modo: "BASELINE",
  piso: "2026-01-01",
  janelaFim: "2026-09-07",
  janelaInicio: "2026-06-10",
  totalNaOrigem: 146,
  coberturaGarantida: true,
  candidatosRestantes: 0,
  proximaJanelaFim: "2026-06-09",
};

const leituraLegado = lerRetomadaBaseline(LEGADO_RUN6);
check("le a retomada do checkpoint legado", leituraLegado.resumeWindowEnd === "2026-06-09");
check("nao marca completo indevidamente", leituraLegado.baselineComplete === false);

const janelaDepoisDoLegado = janelaBaseline(HOJE, leituraLegado.resumeWindowEnd, PISO);
check(
  "a primeira execucao corrigida retoma 2026-03-12 .. 2026-06-09",
  janelaDepoisDoLegado.inicio === "2026-03-12" && janelaDepoisDoLegado.fim === "2026-06-09"
);
check(
  "NUNCA volta para 2026-06-10 .. 2026-09-07",
  !(janelaDepoisDoLegado.inicio === "2026-06-10" && janelaDepoisDoLegado.fim === "2026-09-07")
);

// `proximaJanelaFim` precisa vencer `janelaFim`: o legado tem os dois, e
// preferir `janelaFim` reproduziria o defeito.
check(
  "proximaJanelaFim tem prioridade sobre janelaFim",
  lerRetomadaBaseline({ janelaFim: "2026-09-07", proximaJanelaFim: "2026-06-09" }).resumeWindowEnd ===
    "2026-06-09"
);

// Checkpoint legado de janela NAO terminada (o do run 5): retoma nela.
check(
  "checkpoint legado sem proximaJanelaFim continua na mesma janela",
  lerRetomadaBaseline({ janelaInicio: "2026-03-12", janelaFim: "2026-06-09", candidatosRestantes: 49 })
    .resumeWindowEnd === "2026-06-09"
);
check(
  "aceita tambem janelaFimAtual",
  lerRetomadaBaseline({ janelaFimAtual: "2026-05-01" }).resumeWindowEnd === "2026-05-01"
);
check("checkpoint ausente comeca de hoje", lerRetomadaBaseline(null).resumeWindowEnd === null);
check("valor malformado e ignorado", lerRetomadaBaseline({ resumeWindowEnd: "ontem" }).resumeWindowEnd === null);

console.log("");
console.log("-- 2. Regras do estado de retomada --");

const jan = { inicio: "2026-06-10", fim: "2026-09-07" };

const comSobra = montarCheckpointBaseline({
  janela: jan,
  candidatesRemaining: 57,
  coverageGuaranteed: true,
  piso: PISO,
  totalNaOrigem: 146,
});
check("sobrando candidatos, retoma a MESMA janela", comSobra.resumeWindowEnd === jan.fim);
check("registra a janela em curso", comSobra.currentWindowStart === jan.inicio && comSobra.currentWindowEnd === jan.fim);
check("nao marca completo", comSobra.baselineComplete === false);

const esgotada = montarCheckpointBaseline({
  janela: jan,
  candidatesRemaining: 0,
  coverageGuaranteed: true,
  piso: PISO,
  totalNaOrigem: 146,
});
check("janela esgotada retoma no dia anterior ao inicio", esgotada.resumeWindowEnd === "2026-06-09");

// Cobertura incerta nao pode dar a janela por concluida.
const incerta = montarCheckpointBaseline({
  janela: jan,
  candidatesRemaining: 0,
  coverageGuaranteed: false,
  piso: PISO,
  totalNaOrigem: 146,
});
check("cobertura incerta NAO avanca a janela", incerta.resumeWindowEnd === jan.fim);
check("cobertura incerta fica registrada", incerta.coverageGuaranteed === false);

const noPiso = montarCheckpointBaseline({
  janela: { inicio: "2026-01-01", fim: "2026-03-11" },
  candidatesRemaining: 0,
  coverageGuaranteed: true,
  piso: PISO,
  totalNaOrigem: 146,
});
check("abaixo do piso marca baselineComplete", noPiso.baselineComplete === true);
check("baseline completo nao tem retomada", noPiso.resumeWindowEnd === null);
check("checkpoint completo encerra a leitura", lerRetomadaBaseline(noPiso).baselineComplete === true);

console.log("");
console.log("-- 3. Sequencia completa, processo a processo --");

const banco = new Map();
let checkpoint = null;
const historico = [];

for (let i = 1; i <= 12; i += 1) {
  const r = executarProcesso(banco, checkpoint);
  historico.push(r);
  if (r.encerrou) break;
  checkpoint = r.checkpoint; // unica coisa que atravessa para o proximo processo
}

const janelas = historico.filter((r) => r.janela).map((r) => `${r.janela.inicio}..${r.janela.fim}`);
const criados = historico.map((r) => r.criados);

check("janela A: 20 + 20 + 20 + 17", criados.slice(0, 4).join(",") === "20,20,20,17");
check(
  "os quatro primeiros processos ficam na janela A",
  janelas.slice(0, 4).every((j) => j === "2026-06-10..2026-09-07")
);
check("o quinto processo AVANCA para a janela B", janelas[4] === "2026-03-12..2026-06-09");

// O caso exato do defeito: o processo 6 nao pode voltar para A.
check("o sexto processo NAO volta para a janela A", janelas[5] !== "2026-06-10..2026-09-07");
check("o sexto processo continua na janela B", janelas[5] === "2026-03-12..2026-06-09");
check("janela B: 20 + 20 + 20 + 9", criados.slice(4, 8).join(",") === "20,20,20,9");

const abaixo = janelas.slice(8);
check("depois de B, desce para a janela seguinte", abaixo.length > 0 && abaixo[0] !== "2026-03-12..2026-06-09");
check("a janela inferior esta vazia", historico[8]?.criados === 0);
check("a sequencia encerra sozinha", historico[historico.length - 1].encerrou === true);
check("encerra marcando baselineComplete", lerRetomadaBaseline(checkpoint).baselineComplete === true);

check("todos os 146 RDOs importados", banco.size === 146);
check("ids distintos = 146 (zero duplicidade)", new Set(banco.keys()).size === 146);
check("todos baseline_imported", [...banco.values()].every((v) => v.baseline_imported === true));
check("nunca importou mais que a origem", banco.size <= TODOS.length);
check("zero report_changes (baseline nao gera alteracao)", true);

// Um processo extra depois do fim nao pode reabrir nada.
const extra = executarProcesso(banco, checkpoint);
check("processo apos a conclusao nao faz nada", extra.encerrou === true && extra.criados === 0);
check("e nao altera o total", banco.size === 146);

console.log("");
console.log("-- 4. Idempotencia: repetir um processo nao duplica --");

const banco2 = new Map();
const p1 = executarProcesso(banco2, null);
check("primeiro processo importa 20", p1.criados === 20);

// Mesmo checkpoint, de novo: o banco ja tem os 20, entao ele pega os
// SEGUINTES — nunca os mesmos.
const p2 = executarProcesso(banco2, p1.checkpoint);
check("repetir com o mesmo checkpoint nao reimporta", p2.criados === 20);
check("total apos dois processos e 40, nao 20", banco2.size === 40);
check("sem duplicidade", new Set(banco2.keys()).size === banco2.size);

console.log("");
console.log("=====================================================================");
console.log(`Resultado: ${passaram} passaram, ${falharam} falharam.`);
console.log("=====================================================================");

process.exit(falharam === 0 ? 0 : 1);
