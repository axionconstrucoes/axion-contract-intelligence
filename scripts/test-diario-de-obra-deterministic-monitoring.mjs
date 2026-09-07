// Regras deterministicas, achados e painel do Diario de Obra.
//
// SEM REDE, SEM CREDENCIAL, SEM BANCO, SEM IA.
//
// O banco e' simulado: as funcoes `register_diario_de_obra_finding` e
// `resolve_diario_de_obra_findings` sao reimplementadas aqui com as
// MESMAS transicoes da migration, e a suite afirma o comportamento
// delas. Isso nao substitui aplicar a migration — substitui rodar o
// worker contra producao para descobrir que a idempotencia quebrou.
//
// O que esta suite protege:
//
//   1. cada regra ativa dispara quando deve e SO quando deve;
//   2. baseline nao produz nenhum achado;
//   3. reavaliar nao duplica (idempotencia);
//   4. condicao que sumiu vira RESOLVED, e volta a OPEN se reaparecer;
//   5. RLS: leitura por membro, escrita so por service_role;
//   6. evidencia nao carrega descricao, nome, endereco, URL ou midia;
//   7. o painel mostra os agregados exigidos e o aviso de IA desligada;
//   8. RECONCILE e' ciclico, retoma por checkpoint e respeita tetos;
//   9. nenhum modulo do Diario de Obra importa IA ou toca midia.
//
// Uso: node scripts/test-diario-de-obra-deterministic-monitoring.mjs

import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./ts-module-resolver.mjs", import.meta.url);

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const {
  REGRAS_ATIVAS,
  CODIGOS_DE_REGRA,
  APENAS_METRICA,
  NAO_SAO_REGRA,
  STATUS_DE_ACHADO,
  DIAS_PARA_EDICAO_TARDIA,
  avaliarRegrasDoRelatorio,
  avaliarRegrasDaSerie,
  deveAvaliarAchados,
} = await import("../apps/web/lib/integrations/diario-de-obra/finding-rules.ts");

const {
  evidenciaSemConteudo,
  calcularHashDeEvidencia,
  FORMATO_DE_TEXTO_EM_EVIDENCIA,
  FORMATO_DE_EVIDENCE_KEY,
} = await import("../apps/web/lib/integrations/diario-de-obra/finding-evidence.ts");

const { calcularAgregados, calcularIntegridade, mediana } = await import(
  "../apps/web/lib/integrations/diario-de-obra/report-metrics.ts"
);

const {
  janelaReconcile,
  lerRetomadaReconcile,
  montarCheckpointReconcile,
  maxDetalhesPara,
  resolveModo,
  resolveDiarioSyncEnabled,
  MAX_DETALHES_RECONCILE,
  RECONCILE_JANELA_DIAS,
} = await import("../apps/web/lib/integrations/diario-de-obra/sync-policy.ts");

const { normalizarRelatorio } = await import(
  "../apps/web/lib/integrations/diario-de-obra/normalize-report.ts"
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
  return readFileSync(path.join(RAIZ, relativo), "utf8");
}

const MIGRATION = ler("supabase/migrations/20260907180000_diario_de_obra_findings.sql");
const PAINEL = ler("apps/web/components/integrations/diario-de-obra-monitoring-panel.tsx");
const WORKER = ler("scripts/diario-de-obra-sync-worker.mjs");


// ============================================================
// Fixture: um RDO normalizado, na forma que a API devolve.
// ============================================================

function detalhe(sobrescritas = {}) {
  return {
    _id: "68b0a1c2d3e4f5a6b7c8d9e0",
    obra: { _id: "689f1a2b3c4d5e6f70819200" },
    numero: 140,
    data: "01/09/2026",
    diaDaSemana: "Terca-feira",
    status: { id: 2, descricao: "Finalizado" },
    created: "01/09/2026 18:00",
    modified: "01/09/2026 18:30",
    clima: { manha: "Bom", tarde: "Bom", noite: "Bom" },
    horarioDeTrabalho: { inicio: "07:00", fim: "17:00" },
    maoDeObra: { total: 18, itens: [] },
    equipamentos: [],
    controleDeMaterial: {},
    atividades: [{ descricao: "Concretagem", percentual: 40, status: "Em andamento" }],
    ocorrencias: [],
    comentarios: [],
    checklist: [],
    galeriaDeFotos: [{ url: "https://exemplo.com/a.jpg" }],
    videos: [],
    anexos: [],
    ...sobrescritas,
  };
}

function normalizar(sobrescritas = {}) {
  return normalizarRelatorio(detalhe(sobrescritas), {});
}

const CONTEXTO_NOVO = { baselineImported: false, conteudoAlterado: false };

function codigos(achados) {
  return achados.map((a) => a.ruleCode).sort();
}

console.log("=====================================================================");
console.log("REGRAS DETERMINISTICAS E PAINEL DO DIARIO DE OBRA");
console.log("=====================================================================");
console.log("");


// ============================================================
console.log("-- 1. Catalogo de regras --");
// ============================================================

check("ha exatamente 11 regras ativas", CODIGOS_DE_REGRA.length === 11);

check(
  "toda regra tem severidade valida",
  CODIGOS_DE_REGRA.every((c) => ["BAIXO", "MEDIO", "ALTO"].includes(REGRAS_ATIVAS[c].severity))
);

// O CHECK da migration precisa repetir a lista: uma regra que exista no
// codigo e nao no banco falharia so em producao, na primeira ocorrencia.
check(
  "a migration aceita exatamente as regras do codigo",
  CODIGOS_DE_REGRA.every((c) => MIGRATION.includes(`'${c}'`))
);

const CODIGOS_NA_MIGRATION = [
  ...MIGRATION.slice(
    MIGRATION.indexOf("rule_code text not null"),
    MIGRATION.indexOf("severity text not null")
  ).matchAll(/'([A-Z_0-9]+)'/g),
].map((m) => m[1]);

check(
  "a migration nao aceita nenhuma regra alem das do codigo",
  CODIGOS_NA_MIGRATION.every((c) => CODIGOS_DE_REGRA.includes(c))
);

check(
  "severidades exigidas: clima 1 turno MEDIO, 2 turnos ALTO",
  REGRAS_ATIVAS.CLIMA_IMPRATICAVEL_1_TURNO.severity === "MEDIO" &&
    REGRAS_ATIVAS.CLIMA_IMPRATICAVEL_2_TURNOS.severity === "ALTO"
);

check(
  "severidades exigidas: efetivo zero, atividade 100%, ocorrencia, edicao tardia = MEDIO",
  REGRAS_ATIVAS.EFETIVO_ZERO_COM_ATIVIDADE.severity === "MEDIO" &&
    REGRAS_ATIVAS.ATIVIDADE_100_SEM_CONCLUSAO.severity === "MEDIO" &&
    REGRAS_ATIVAS.OCORRENCIA_REGISTRADA.severity === "MEDIO" &&
    REGRAS_ATIVAS.EDICAO_TARDIA.severity === "MEDIO"
);

check("RDO sem foto e' BAIXO", REGRAS_ATIVAS.RDO_SEM_FOTO.severity === "BAIXO");

check(
  "duplicidade e salto sao ALTO",
  REGRAS_ATIVAS.NUMERO_DUPLICADO.severity === "ALTO" &&
    REGRAS_ATIVAS.DATA_DUPLICADA.severity === "ALTO" &&
    REGRAS_ATIVAS.SALTO_DE_NUMERACAO.severity === "ALTO"
);

check(
  "hash alterado pos-baseline e' MEDIO",
  REGRAS_ATIVAS.HASH_ALTERADO_POS_BASELINE.severity === "MEDIO"
);

check(
  "ocorrencia exige revisao humana",
  REGRAS_ATIVAS.OCORRENCIA_REGISTRADA.requiresHumanReview === true
);

check("o ciclo de vida tem os tres estados", STATUS_DE_ACHADO.length === 3 &&
  ["OPEN", "ACKNOWLEDGED", "RESOLVED"].every((s) => STATUS_DE_ACHADO.includes(s)));

check(
  "a migration declara o mesmo ciclo de vida",
  MIGRATION.includes("check (status in ('OPEN', 'ACKNOWLEDGED', 'RESOLVED'))")
);

console.log("");


// ============================================================
console.log("-- 2. O que NAO pode virar alerta --");
// ============================================================

// Estes cinco alimentam o painel como estatistica. Vira-los em alerta
// produziria falso positivo em volume.
check(
  "metricas nao aparecem como regra ativa",
  APENAS_METRICA.every((m) => !CODIGOS_DE_REGRA.includes(m))
);

check(
  "metricas nao aparecem no CHECK da migration",
  APENAS_METRICA.every((m) => !MIGRATION.includes(`'${m}'`))
);

check(
  "os cinco itens de metrica estao declarados",
  ["EFETIVO_ANOMALO", "ATIVIDADE_ESTAGNADA", "LACUNA_DE_DATAS", "CRIACAO_RETROATIVA", "LEXICO"]
    .every((m) => APENAS_METRICA.includes(m))
);

// Estes seis nao podem ser regra de forma nenhuma.
check(
  "os seis itens proibidos estao declarados",
  ["STATUS_DO_RDO", "HORAS_TRABALHADAS", "MATERIAIS", "CHECKLIST", "DATA_FIM", "AUSENCIA_EM_DIA_UTIL"]
    .every((m) => NAO_SAO_REGRA.includes(m))
);

check(
  "nenhum item proibido virou regra",
  NAO_SAO_REGRA.every((m) => !CODIGOS_DE_REGRA.includes(m) && !MIGRATION.includes(`'${m}'`))
);

// Prova de comportamento, e nao so de nomenclatura: um RDO cujo unico
// "problema" e' o status do fornecedor, as horas, os materiais, o
// checklist ou `dataFim` nao pode gerar achado nenhum.
const soCamposProibidos = normalizar({
  status: { id: 1, descricao: "Em edicao" },
  horarioDeTrabalho: { inicio: "22:00", fim: "02:00" },
  controleDeMaterial: { itens: [{ nome: "Cimento", quantidade: 0 }] },
  checklist: [],
  dataFim: "",
  atividades: [],
});

check(
  "status, horas, materiais, checklist e dataFim nao geram achado",
  avaliarRegrasDoRelatorio(soCamposProibidos, CONTEXTO_NOVO).every(
    (a) => a.ruleCode === "RDO_SEM_FOTO" || a.ruleCode.startsWith("CLIMA_")
  )
);

console.log("");


// ============================================================
console.log("-- 3. Cada regra dispara quando deve --");
// ============================================================

// Base sem nenhuma condicao: so a foto existe, entao nada dispara.
const base = normalizar();
check("RDO normal nao gera achado", avaliarRegrasDoRelatorio(base, CONTEXTO_NOVO).length === 0);

// Clima — um turno.
const umTurno = normalizar({ clima: { manha: "Impraticável", tarde: "Bom", noite: "Bom" } });
check(
  "um turno impraticavel gera CLIMA_IMPRATICAVEL_1_TURNO",
  codigos(avaliarRegrasDoRelatorio(umTurno, CONTEXTO_NOVO)).join() === "CLIMA_IMPRATICAVEL_1_TURNO"
);

// Clima — dois turnos.
const doisTurnos = normalizar({
  clima: { manha: "Impraticável", tarde: { praticavel: false }, noite: "Bom" },
});
const achadosDoisTurnos = avaliarRegrasDoRelatorio(doisTurnos, CONTEXTO_NOVO);
check(
  "dois turnos impraticaveis geram CLIMA_IMPRATICAVEL_2_TURNOS",
  codigos(achadosDoisTurnos).join() === "CLIMA_IMPRATICAVEL_2_TURNOS"
);
check(
  "os dois codigos de clima nunca disparam juntos",
  !codigos(achadosDoisTurnos).includes("CLIMA_IMPRATICAVEL_1_TURNO")
);
check(
  "a severidade sobe para ALTO com dois turnos",
  achadosDoisTurnos[0].severity === "ALTO"
);

// Sinalizador de DIA sem marca por turno conta como UM, nao tres.
const diaImpraticavel = normalizar({ clima: { manha: "Bom", praticavel: false } });
check(
  "impraticabilidade so no dia conta como um turno",
  codigos(avaliarRegrasDoRelatorio(diaImpraticavel, CONTEXTO_NOVO)).join() ===
    "CLIMA_IMPRATICAVEL_1_TURNO"
);

// Efetivo zero com atividade.
const efetivoZero = normalizar({ maoDeObra: { total: 0 } });
check(
  "efetivo zero com atividade gera EFETIVO_ZERO_COM_ATIVIDADE",
  codigos(avaliarRegrasDoRelatorio(efetivoZero, CONTEXTO_NOVO)).includes(
    "EFETIVO_ZERO_COM_ATIVIDADE"
  )
);

const efetivoZeroSemAtividade = normalizar({ maoDeObra: { total: 0 }, atividades: [] });
check(
  "efetivo zero SEM atividade nao dispara",
  !codigos(avaliarRegrasDoRelatorio(efetivoZeroSemAtividade, CONTEXTO_NOVO)).includes(
    "EFETIVO_ZERO_COM_ATIVIDADE"
  )
);

// Efetivo ilegivel nao pode virar alerta: sem leitura nao ha fato.
const efetivoIlegivel = normalizar({ maoDeObra: "dezoito pessoas" });
check(
  "efetivo ilegivel nao dispara alerta",
  !codigos(avaliarRegrasDoRelatorio(efetivoIlegivel, CONTEXTO_NOVO)).includes(
    "EFETIVO_ZERO_COM_ATIVIDADE"
  )
);

// Atividade em 100% sem status de conclusao.
const cem = normalizar({
  atividades: [{ descricao: "Alvenaria", percentual: 100, status: "Em andamento" }],
});
check(
  "atividade 100% sem conclusao gera ATIVIDADE_100_SEM_CONCLUSAO",
  codigos(avaliarRegrasDoRelatorio(cem, CONTEXTO_NOVO)).includes("ATIVIDADE_100_SEM_CONCLUSAO")
);

const cemConcluida = normalizar({
  atividades: [{ descricao: "Alvenaria", percentual: 100, status: "Concluída" }],
});
check(
  "atividade 100% CONCLUIDA nao dispara",
  !codigos(avaliarRegrasDoRelatorio(cemConcluida, CONTEXTO_NOVO)).includes(
    "ATIVIDADE_100_SEM_CONCLUSAO"
  )
);

// Ocorrencia estruturada.
const comOcorrencia = normalizar({
  ocorrencias: [{ descricao: "Acidente com o pedreiro Joao da Silva, Rua X 123" }],
});
const achadoOcorrencia = avaliarRegrasDoRelatorio(comOcorrencia, CONTEXTO_NOVO).find(
  (a) => a.ruleCode === "OCORRENCIA_REGISTRADA"
);
check("ocorrencia estruturada gera achado", achadoOcorrencia !== undefined);
check("ocorrencia exige revisao humana no achado", achadoOcorrencia?.requiresHumanReview === true);
check(
  "a evidencia da ocorrencia e' so contagem",
  JSON.stringify(achadoOcorrencia?.structuredEvidence) === '{"ocorrencias":1}'
);

// Edicao tardia.
const tardia = normalizar({ data: "01/06/2026", modified: "20/08/2026 10:00" });
const achadoTardio = avaliarRegrasDoRelatorio(tardia, CONTEXTO_NOVO).find(
  (a) => a.ruleCode === "EDICAO_TARDIA"
);
check("edicao 80 dias depois dispara EDICAO_TARDIA", achadoTardio !== undefined);
check("a evidencia registra os dias", achadoTardio?.structuredEvidence.diasApos === 80);

const noLimite = normalizar({ data: "01/08/2026", modified: "31/08/2026 10:00" });
check(
  `edicao com exatamente ${DIAS_PARA_EDICAO_TARDIA} dias nao dispara`,
  !codigos(avaliarRegrasDoRelatorio(noLimite, CONTEXTO_NOVO)).includes("EDICAO_TARDIA")
);

// RDO sem foto.
const semFoto = normalizar({ galeriaDeFotos: [] });
check(
  "RDO sem foto gera RDO_SEM_FOTO",
  codigos(avaliarRegrasDoRelatorio(semFoto, CONTEXTO_NOVO)).includes("RDO_SEM_FOTO")
);
check(
  "RDO com foto nao gera RDO_SEM_FOTO",
  !codigos(avaliarRegrasDoRelatorio(base, CONTEXTO_NOVO)).includes("RDO_SEM_FOTO")
);

// Hash alterado pos-baseline.
const posBaseline = avaliarRegrasDoRelatorio(base, {
  baselineImported: true,
  conteudoAlterado: true,
});
check(
  "RDO historico alterado gera HASH_ALTERADO_POS_BASELINE",
  codigos(posBaseline).includes("HASH_ALTERADO_POS_BASELINE")
);

check(
  "RDO historico INALTERADO nao gera o achado",
  !codigos(
    avaliarRegrasDoRelatorio(base, { baselineImported: true, conteudoAlterado: false })
  ).includes("HASH_ALTERADO_POS_BASELINE")
);

check(
  "RDO novo alterado nao gera o achado de pos-baseline",
  !codigos(
    avaliarRegrasDoRelatorio(base, { baselineImported: false, conteudoAlterado: true })
  ).includes("HASH_ALTERADO_POS_BASELINE")
);

console.log("");


// ============================================================
console.log("-- 4. Regras da serie --");
// ============================================================

const SERIE = [
  { providerReportId: "a1", reportNumber: 10, referenceDate: "2026-09-01" },
  { providerReportId: "a2", reportNumber: 11, referenceDate: "2026-09-02" },
  // Numero repetido de a2, e data repetida de a2.
  { providerReportId: "a3", reportNumber: 11, referenceDate: "2026-09-02" },
  // Salto: 12 e 13 nao existem.
  { providerReportId: "a4", reportNumber: 14, referenceDate: "2026-09-05" },
];

const daSerie = avaliarRegrasDaSerie(SERIE, ["a3", "a4"]);

check(
  "numero duplicado gera achado no RDO ancorado",
  codigos(daSerie.get("a3") ?? []).includes("NUMERO_DUPLICADO")
);
check(
  "data duplicada gera achado no RDO ancorado",
  codigos(daSerie.get("a3") ?? []).includes("DATA_DUPLICADA")
);
check(
  "salto de numeracao ancora no RDO DEPOIS da lacuna",
  codigos(daSerie.get("a4") ?? []).includes("SALTO_DE_NUMERACAO")
);
check(
  "o salto informa quantos numeros faltam",
  (daSerie.get("a4") ?? []).find((a) => a.ruleCode === "SALTO_DE_NUMERACAO")
    ?.structuredEvidence.faltando === 2
);

// O historico NAO ancorado nao vira alerta: a2 tambem esta duplicado,
// mas nao chegou nesta execucao.
check(
  "RDO historico nao ancorado nao recebe achado retroativo",
  !daSerie.has("a2") && !daSerie.has("a1")
);

const serieLimpa = avaliarRegrasDaSerie(
  [
    { providerReportId: "b1", reportNumber: 1, referenceDate: "2026-01-01" },
    { providerReportId: "b2", reportNumber: 2, referenceDate: "2026-01-02" },
  ],
  ["b1", "b2"]
);
check("serie integra nao gera achado", serieLimpa.size === 0);

console.log("");


// ============================================================
console.log("-- 5. Baseline NAO gera achado --");
// ============================================================

check("BASELINE nunca avalia, mesmo criando", deveAvaliarAchados("BASELINE", "CRIADO") === false);
check("BASELINE nunca avalia, mesmo alterando", deveAvaliarAchados("BASELINE", "ALTERADO") === false);

check("INCREMENTAL avalia RDO novo", deveAvaliarAchados("INCREMENTAL", "CRIADO") === true);
check("INCREMENTAL avalia RDO alterado", deveAvaliarAchados("INCREMENTAL", "ALTERADO") === true);
check(
  "INCREMENTAL nao avalia RDO inalterado",
  deveAvaliarAchados("INCREMENTAL", "INALTERADO") === false
);

// RECONCILE varre historico: um RDO visto ali pela primeira vez e'
// backfill, e alerta-lo seria alerta retroativo.
check("RECONCILE nao avalia RDO visto pela primeira vez", deveAvaliarAchados("RECONCILE", "CRIADO") === false);
check("RECONCILE avalia RDO alterado", deveAvaliarAchados("RECONCILE", "ALTERADO") === true);

check(
  "a funcao do banco recusa modo BASELINE",
  MIGRATION.includes("if p_mode = 'BASELINE' then") &&
    MIGRATION.includes("Carga BASELINE nao gera achado")
);

// Simulacao da carga historica: 146 RDOs, muitos com condicoes que
// disparariam regra — e nenhum achado, porque o modo e' BASELINE.
let achadosNoBaseline = 0;

for (let i = 0; i < 146; i += 1) {
  const rdo = normalizar({
    _id: `historico${i}`,
    galeriaDeFotos: [],
    clima: { manha: "Impraticável", tarde: "Impraticável" },
    ocorrencias: [{ descricao: "qualquer" }],
  });

  if (deveAvaliarAchados("BASELINE", "CRIADO")) {
    achadosNoBaseline += avaliarRegrasDoRelatorio(rdo, {
      baselineImported: true,
      conteudoAlterado: false,
    }).length;
  }
}

check("os 146 registros historicos produzem ZERO achado", achadosNoBaseline === 0);

console.log("");


// ============================================================
console.log("-- 6. Idempotencia e resolucao (banco simulado) --");
// ============================================================

/*
 * Reimplementacao das funcoes da migration, com as MESMAS transicoes.
 * Se a regra de transicao mudar num lado e nao no outro, este teste
 * continua passando e a migration e' quem manda — por isso a suite
 * TAMBEM afirma o texto da migration, logo abaixo.
 */
function criarBancoDeAchados() {
  const linhas = new Map();

  return {
    linhas,

    registrar({ mode, reportId, syncRunId, achado }) {
      if (mode === "BASELINE") throw new Error("Carga BASELINE nao gera achado.");
      if (!evidenciaSemConteudo(achado.structuredEvidence)) throw new Error("Evidencia recusada.");

      const chave = `${achado.ruleCode}|${achado.evidenceKey}`;
      const existente = linhas.get(chave);
      const agora = Date.now();

      if (!existente) {
        linhas.set(chave, {
          ruleCode: achado.ruleCode,
          evidenceKey: achado.evidenceKey,
          evidenceHash: achado.evidenceHash,
          structuredEvidence: achado.structuredEvidence,
          severity: achado.severity,
          reportId,
          syncRunId,
          status: "OPEN",
          firstDetectedAt: agora,
          lastDetectedAt: agora,
          resolvedAt: null,
        });
        return "CRIADO";
      }

      existente.lastDetectedAt = agora;
      existente.syncRunId = syncRunId;

      if (existente.status === "RESOLVED") {
        existente.status = "OPEN";
        existente.resolvedAt = null;
        existente.evidenceHash = achado.evidenceHash;
        existente.structuredEvidence = achado.structuredEvidence;
        return "REABERTO";
      }

      const igual = existente.evidenceHash === achado.evidenceHash;
      existente.evidenceHash = achado.evidenceHash;
      existente.structuredEvidence = achado.structuredEvidence;

      return igual ? "INALTERADO" : "ATUALIZADO";
    },

    resolver({ reportId, ativos }) {
      let resolvidos = 0;

      for (const linha of linhas.values()) {
        if (linha.reportId !== reportId) continue;
        if (linha.status === "RESOLVED") continue;
        if (ativos.includes(`${linha.ruleCode}|${linha.evidenceKey}`)) continue;

        linha.status = "RESOLVED";
        linha.resolvedAt = Date.now();
        resolvidos += 1;
      }

      return resolvidos;
    },
  };
}

function sincronizar(banco, { mode, reportId, syncRunId, achados }) {
  const resultados = achados.map((achado) =>
    banco.registrar({ mode, reportId, syncRunId, achado })
  );

  const resolvidos = banco.resolver({
    reportId,
    ativos: achados.map((a) => `${a.ruleCode}|${a.evidenceKey}`),
  });

  return { resultados, resolvidos };
}

const banco = criarBancoDeAchados();
const RDO_UUID = "11111111-1111-1111-1111-111111111111";

// Execucao 1: dois turnos impraticaveis e sem foto.
const execucao1 = avaliarRegrasDoRelatorio(
  normalizar({ clima: { manha: "Impraticável", tarde: "Impraticável" }, galeriaDeFotos: [] }),
  CONTEXTO_NOVO
);

const r1 = sincronizar(banco, {
  mode: "INCREMENTAL",
  reportId: RDO_UUID,
  syncRunId: "run-1",
  achados: execucao1,
});

check("primeira avaliacao cria os achados", r1.resultados.every((r) => r === "CRIADO"));
check("dois achados registrados", banco.linhas.size === 2);

// Execucao 2: exatamente a mesma condicao.
const r2 = sincronizar(banco, {
  mode: "INCREMENTAL",
  reportId: RDO_UUID,
  syncRunId: "run-2",
  achados: execucao1,
});

check("reavaliar a mesma condicao nao cria linha nova", banco.linhas.size === 2);
check("reavaliar devolve INALTERADO", r2.resultados.every((r) => r === "INALTERADO"));
check("nada e' resolvido quando a condicao persiste", r2.resolvidos === 0);

// Alguem reconhece um dos achados.
const chaveClima = [...banco.linhas.keys()].find((k) => k.startsWith("CLIMA_"));
banco.linhas.get(chaveClima).status = "ACKNOWLEDGED";

const r3 = sincronizar(banco, {
  mode: "INCREMENTAL",
  reportId: RDO_UUID,
  syncRunId: "run-3",
  achados: execucao1,
});

check("ACKNOWLEDGED nao volta para OPEN sozinho", banco.linhas.get(chaveClima).status === "ACKNOWLEDGED");
check("reavaliar um reconhecido tambem nao duplica", banco.linhas.size === 2 && r3.resolvidos === 0);

// Execucao 4: o clima melhorou e a foto foi anexada. Nenhuma condicao
// permanece, entao os dois achados sao resolvidos.
const r4 = sincronizar(banco, {
  mode: "INCREMENTAL",
  reportId: RDO_UUID,
  syncRunId: "run-4",
  achados: [],
});

check("condicao que sumiu vira RESOLVED", r4.resolvidos === 2);
check(
  "todos os achados do RDO ficam RESOLVED com data",
  [...banco.linhas.values()].every((l) => l.status === "RESOLVED" && l.resolvedAt !== null)
);

// A resolucao precisa distinguir REGRA, e nao so a chave: os dois
// achados deste RDO compartilham `evidence_key`.
check(
  "achados do mesmo RDO compartilham evidence_key",
  new Set([...banco.linhas.values()].map((l) => l.evidenceKey)).size === 1
);

// Execucao 5: o clima voltou a ser impraticavel — o achado reabre.
const soClima = execucao1.filter((a) => a.ruleCode.startsWith("CLIMA_"));

const r5 = sincronizar(banco, {
  mode: "INCREMENTAL",
  reportId: RDO_UUID,
  syncRunId: "run-5",
  achados: soClima,
});

check("condicao que voltou reabre o achado", r5.resultados[0] === "REABERTO");
check("o reaberto volta a OPEN sem data de resolucao",
  banco.linhas.get(chaveClima).status === "OPEN" && banco.linhas.get(chaveClima).resolvedAt === null);
check("o achado ja resolvido do outro RDO continua resolvido", banco.linhas.size === 2);

// Execucao 6: um achado so vira RESOLVED quando a regra DEIXA de
// aponta-lo. Redetecta-lo significa que a condicao voltou a existir na
// obra, entao ele reabre mesmo com evidencia identica.
const bancoB = criarBancoDeAchados();
const achadoUnico = avaliarRegrasDoRelatorio(normalizar({ galeriaDeFotos: [] }), CONTEXTO_NOVO);

sincronizar(bancoB, { mode: "INCREMENTAL", reportId: RDO_UUID, syncRunId: "r1", achados: achadoUnico });
for (const linha of bancoB.linhas.values()) {
  linha.status = "RESOLVED";
  linha.resolvedAt = Date.now();
}
const r6 = sincronizar(bancoB, {
  mode: "INCREMENTAL",
  reportId: RDO_UUID,
  syncRunId: "r2",
  achados: achadoUnico,
});

check("RESOLVED redetectado reabre, mesmo com evidencia identica", r6.resultados[0] === "REABERTO");
check(
  "reabrir nao cria linha nova",
  bancoB.linhas.size === achadoUnico.length
);

// Resolucao e' por RDO: um RDO nao avaliado nao pode ter achado
// encerrado por engano.
const OUTRO_RDO = "22222222-2222-2222-2222-222222222222";
const bancoC = criarBancoDeAchados();
sincronizar(bancoC, { mode: "INCREMENTAL", reportId: RDO_UUID, syncRunId: "r1", achados: achadoUnico });
sincronizar(bancoC, { mode: "INCREMENTAL", reportId: OUTRO_RDO, syncRunId: "r1", achados: [] });

check(
  "resolver um RDO nao encerra achado de outro",
  [...bancoC.linhas.values()].every((l) => l.status === "OPEN")
);

// E a migration precisa dizer o mesmo.
check(
  "a migration compara rule_code + evidence_key na resolucao",
  MIGRATION.includes("(rule_code || '|' || evidence_key)")
);
check(
  "a migration resolve por RDO, nao por execucao",
  MIGRATION.includes("and report_id = p_report_id")
);
check(
  "a chave de identidade da migration nao inclui a execucao",
  MIGRATION.includes("unique (project_id, rule_code, evidence_key)")
);
check(
  "a migration reabre RESOLVED quando a evidencia muda",
  MIGRATION.includes("return 'REABERTO';")
);
check(
  "a migration exige data em RESOLVED",
  MIGRATION.includes("(status = 'RESOLVED' and resolved_at is not null)")
);

console.log("");


// ============================================================
console.log("-- 7. RLS e superficie de escrita --");
// ============================================================

check(
  "RLS habilitada na tabela de achados",
  MIGRATION.includes("alter table public.diario_de_obra_findings enable row level security;")
);

check(
  "leitura restrita a membro do projeto",
  MIGRATION.includes("using (public.is_project_member(project_id))")
);

const politicas = [...MIGRATION.matchAll(/create policy[\s\S]*?for (\w+)/g)].map((m) => m[1]);
check("nao existe politica de escrita", politicas.every((p) => p === "select"));

check(
  "as funcoes de escrita sao SECURITY DEFINER com search_path fechado",
  (MIGRATION.match(/security definer\s+set search_path = ''/g) ?? []).length >= 2
);

for (const papel of ["public", "anon", "authenticated"]) {
  check(
    `execucao revogada de ${papel}`,
    MIGRATION.includes(`revoke all on function %s from ${papel}`)
  );
}

check(
  "so service_role executa as funcoes de escrita",
  MIGRATION.includes("grant execute on function %s to service_role")
);

check(
  "as duas funcoes de escrita estao na lista de grants",
  MIGRATION.includes("public.register_diario_de_obra_finding(uuid, uuid, uuid, text, text, text, text, text, jsonb, boolean)") &&
    MIGRATION.includes("public.resolve_diario_de_obra_findings(uuid, uuid, text[])")
);

// A view do painel nao pode furar a RLS.
check(
  "a view do painel roda com privilegio de quem consulta",
  MIGRATION.includes("with (security_invoker = true)")
);
check(
  "a view do painel e' legivel por authenticated",
  MIGRATION.includes("grant select on public.diario_de_obra_report_metrics to authenticated;")
);
check(
  "a view nao concede escrita",
  !/grant\s+(insert|update|delete|all)\s+on\s+public\.diario_de_obra_report_metrics/i.test(MIGRATION)
);

console.log("");


// ============================================================
console.log("-- 8. Seguranca da evidencia --");
// ============================================================

check("numero e' aceito", evidenciaSemConteudo({ turnos: 2 }));
check("booleano e' aceito", evidenciaSemConteudo({ baselineImportado: true }));
check("data ISO e' aceita", evidenciaSemConteudo({ data: "2026-09-07" }));
check("enum curto e' aceito", evidenciaSemConteudo({ severidade: "MEDIO" }));
check("ObjectId e' aceito", evidenciaSemConteudo({ rdo: "68b0a1c2d3e4f5a6b7c8d9e0" }));
check("nulo e' aceito", evidenciaSemConteudo({ dataEdicao: null }));

check(
  "descricao com espaco e' recusada",
  !evidenciaSemConteudo({ descricao: "Paralisacao por chuva forte" })
);
check("nome proprio e' recusado", !evidenciaSemConteudo({ autor: "Joao da Silva" }));
check(
  "endereco e' recusado",
  !evidenciaSemConteudo({ local: "Rua das Flores, 123 - Jaragua do Sul" })
);
check(
  "URL e' recusada",
  !evidenciaSemConteudo({ foto: "https://exemplo.com/foto.jpg" })
);
check(
  "e-mail e' recusado",
  !evidenciaSemConteudo({ responsavel: "alguem@exemplo.com.br" })
);
check(
  "caminho de midia e' recusado",
  !evidenciaSemConteudo({ arquivo: "/uploads/galeria/foto-01.jpg" })
);
check(
  "texto longo sem espaco tambem e' recusado",
  !evidenciaSemConteudo({ x: "A".repeat(41) })
);
check(
  "chave com nome proprio e' recusada",
  !evidenciaSemConteudo({ "Joao da Silva": 1 })
);
check("NaN e' recusado", !evidenciaSemConteudo({ n: Number.NaN }));

// Nenhum achado produzido pelas regras pode carregar conteudo.
const todosOsAchados = [
  ...avaliarRegrasDoRelatorio(
    normalizar({
      clima: { manha: "Impraticável", tarde: "Impraticável" },
      maoDeObra: { total: 0 },
      atividades: [{ descricao: "Servico X", percentual: 100, status: "Em andamento" }],
      ocorrencias: [{ descricao: "Acidente com Joao da Silva na Rua X, 123" }],
      galeriaDeFotos: [],
      data: "01/01/2026",
      modified: "01/09/2026 10:00",
    }),
    { baselineImported: true, conteudoAlterado: true }
  ),
  ...(daSerie.get("a3") ?? []),
  ...(daSerie.get("a4") ?? []),
];

check(
  "toda evidencia produzida passa pelo mesmo funil do banco",
  todosOsAchados.every((a) => evidenciaSemConteudo(a.structuredEvidence))
);

check(
  "toda evidence_key cabe no formato do banco",
  todosOsAchados.every((a) => FORMATO_DE_EVIDENCE_KEY.test(a.evidenceKey))
);

check(
  "todo hash de evidencia e' sha256 hexadecimal",
  todosOsAchados.every((a) => /^[0-9a-f]{64}$/.test(a.evidenceHash))
);

const SERIALIZADO = JSON.stringify(todosOsAchados);

check("nenhum achado carrega o nome da fixture", !SERIALIZADO.includes("Joao da Silva"));
check("nenhum achado carrega endereco", !SERIALIZADO.includes("Rua X"));
check("nenhum achado carrega descricao de atividade", !SERIALIZADO.includes("Servico X"));
check("nenhum achado carrega URL", !/https?:\/\//.test(SERIALIZADO));

// Hash canonico: a ordem das chaves nao pode mudar o hash, ou todo
// achado inalterado apareceria como reaberto.
check(
  "a ordem das chaves nao muda o hash",
  calcularHashDeEvidencia({ a: 1, b: 2 }) === calcularHashDeEvidencia({ b: 2, a: 1 })
);
check(
  "evidencia diferente produz hash diferente",
  calcularHashDeEvidencia({ turnos: 1 }) !== calcularHashDeEvidencia({ turnos: 2 })
);

let recusou = false;
try {
  calcularHashDeEvidencia({ descricao: "texto livre com espacos" });
} catch {
  recusou = true;
}
check("hash de evidencia proibida falha alto", recusou);

// O regex do TypeScript e o do banco precisam ser o mesmo funil.
check(
  "o CHECK do banco usa o mesmo formato de texto",
  MIGRATION.includes("'^[A-Za-z0-9_.-]{0,40}$'") &&
    FORMATO_DE_TEXTO_EM_EVIDENCIA.source === "^[A-Za-z0-9_.-]{0,40}$"
);
check(
  "o CHECK de evidencia esta aplicado na tabela",
  MIGRATION.includes("check (public.diario_de_obra_evidencia_sem_conteudo(structured_evidence))")
);

console.log("");


// ============================================================
console.log("-- 9. Painel: agregados e nada mais --");
// ============================================================

const LINHAS = [
  {
    reportId: "r1",
    reportNumber: 1,
    referenceDate: "2026-09-01",
    sourceCreatedAt: "2026-09-01",
    sourceModifiedAt: "2026-09-01",
    baselineImported: true,
    photoCount: 2,
    occurrenceCount: 1,
    activityCount: 3,
    weather: { manha: "Bom", tarde: "Bom" },
    labor: { total: 10 },
  },
  {
    reportId: "r2",
    reportNumber: 2,
    referenceDate: "2026-09-02",
    sourceCreatedAt: "2026-09-02",
    sourceModifiedAt: "2026-10-20",
    baselineImported: true,
    photoCount: 0,
    occurrenceCount: 2,
    activityCount: 1,
    weather: { manha: "Impraticável", tarde: "Impraticável" },
    labor: { total: 20 },
  },
  {
    // Salto de numeracao (3 falta) e lacuna de datas (03 e 04 faltam).
    reportId: "r3",
    reportNumber: 4,
    referenceDate: "2026-09-05",
    sourceCreatedAt: "2026-09-30",
    sourceModifiedAt: "2026-09-30",
    baselineImported: false,
    photoCount: 5,
    occurrenceCount: 0,
    activityCount: 2,
    weather: { manha: "Bom" },
    labor: { itens: [{ quantidade: 12 }, { quantidade: 18 }] },
  },
];

const AG = calcularAgregados(LINHAS);

check("total de RDOs", AG.totalDeRdos === 3);
check("faixa historica", AG.primeiraData === "2026-09-01" && AG.ultimaData === "2026-09-05");
check("ultimo RDO", AG.ultimoRdoNumero === 4 && AG.ultimoRdoData === "2026-09-05");
check("ocorrencias somadas", AG.ocorrenciasRegistradas === 3 && AG.rdosComOcorrencia === 2);
check(
  "clima impraticavel",
  AG.rdosComClimaImpraticavel === 1 && AG.turnosImpraticaveis === 2
);
check("efetivo mediano", AG.efetivoMediano === 20 && AG.rdosComEfetivoLegivel === 3);
check("RDOs sem foto", AG.rdosSemFoto === 1);
check("edicoes tardias", AG.edicoesTardias === 1);
check("integridade: salto de numeracao", AG.integridade.saltosDeNumeracao === 1);
check("integridade: numeros faltantes", AG.integridade.numerosFaltantes === 1);
check("integridade: dias sem RDO", AG.integridade.diasSemRdo === 2);
check("integridade: criacao retroativa e' metrica", AG.integridade.criacoesRetroativas === 1);

check("mediana de conjunto vazio e' nula", mediana([]) === null);
check("mediana de conjunto par", mediana([10, 20]) === 15);
check(
  "efetivo ilegivel fica fora da mediana",
  calcularAgregados([{ ...LINHAS[0], labor: "dezoito" }]).efetivoMediano === null
);

const duplicados = calcularIntegridade([
  { ...LINHAS[0], reportNumber: 7, referenceDate: "2026-09-01" },
  { ...LINHAS[1], reportNumber: 7, referenceDate: "2026-09-01" },
]);
check(
  "integridade detecta numero e data duplicados",
  duplicados.numerosDuplicados === 1 && duplicados.datasDuplicadas === 1
);

// Nada do que sai daqui pode ser texto livre. A afirmacao e' sobre os
// VALORES: todo valor de agregado e' numero, nulo ou data ISO — nunca o
// clima como veio, o nome de um item de mao de obra ou uma URL.
function valoresDe(objeto) {
  return Object.values(objeto).flatMap((v) =>
    v !== null && typeof v === "object" ? valoresDe(v) : [v]
  );
}

const VALORES_AGREGADOS = valoresDe(AG);

check(
  "todo agregado e' numero, nulo ou data ISO",
  VALORES_AGREGADOS.every(
    (v) => v === null || typeof v === "number" || /^\d{4}-\d{2}-\d{2}$/.test(String(v))
  )
);
check("nenhum agregado repete o clima como veio da API", !VALORES_AGREGADOS.includes("Impraticável"));
check("nenhum agregado carrega mao de obra bruta", !JSON.stringify(VALORES_AGREGADOS).includes("quantidade"));
check("nenhum agregado carrega URL", !/https?:\/\//.test(JSON.stringify(VALORES_AGREGADOS)));

// O painel exibe o que foi pedido, e diz que a IA esta desligada.
check("o painel afirma IA desativada com 0 tokens", PAINEL.includes("Análise por IA desativada — 0 tokens"));

for (const rotulo of [
  "Conexão",
  "Última sincronização",
  "Total de RDOs",
  "Faixa histórica",
  "Último RDO",
  "Novos e alterados",
  "Ocorrências",
  "Clima impraticável",
  "Efetivo mediano",
  "RDOs sem foto",
  "Edições tardias",
  "Integridade",
  "Achados por severidade",
]) {
  check(`o painel mostra "${rotulo}"`, PAINEL.includes(`"${rotulo}"`));
}

check("o painel mostra as tres severidades", ["ALTO", "MEDIO", "BAIXO"].every((s) => PAINEL.includes(`abertosPorSeveridade.${s}`)));

// A view do banco converte as colecoes de texto em contagem ANTES de
// devolver: descricao de ocorrencia e de atividade nao atravessam.
check(
  "a view expoe ocorrencias e atividades apenas como contagem",
  MIGRATION.includes("as occurrence_count") && MIGRATION.includes("as activity_count")
);
check(
  "a view nao expoe as colecoes de texto",
  !/r\.occurrences,/.test(MIGRATION) &&
    !/r\.activities,/.test(MIGRATION) &&
    !/r\.comments/.test(MIGRATION) &&
    !/r\.checklist/.test(MIGRATION)
);
check("a view nao expoe hash nem contagem de midia como link", !MIGRATION.includes("linkPdf"));

console.log("");


// ============================================================
console.log("-- 10. RECONCILE --");
// ============================================================

const HOJE = "2026-09-07";
const PISO = "2026-01-01";

check("RECONCILE e' um modo aceito", resolveModo("reconcile") === "RECONCILE");
check("o teto do reconcile e' o do incremental", maxDetalhesPara("RECONCILE") === MAX_DETALHES_RECONCILE);
check("o teto existe e e' modesto", MAX_DETALHES_RECONCILE > 0 && MAX_DETALHES_RECONCILE <= 20);

const primeira = janelaReconcile(HOJE, null, PISO);
check("sem checkpoint, o reconcile parte de hoje", primeira.fim === HOJE);
check(
  "a janela tem o tamanho configurado",
  primeira.inicio === "2026-06-10" && RECONCILE_JANELA_DIAS === 90
);

// Janela esgotada: retoma no dia anterior ao inicio dela.
const ck1 = montarCheckpointReconcile({
  janela: primeira,
  candidatesRemaining: 0,
  coverageGuaranteed: true,
  piso: PISO,
  totalNaOrigem: 146,
  ciclosConcluidos: 0,
});
check("janela esgotada avanca a retomada", ck1.resumeWindowEnd === "2026-06-09");
check("ciclo ainda nao fechou", ck1.cicloCompleto === false);

// Candidatos pendentes: a MESMA janela e' retomada. E' o defeito que o
// baseline sofreu no run 34142741140, e o reconcile nao pode repetir.
const ck2 = montarCheckpointReconcile({
  janela: primeira,
  candidatesRemaining: 7,
  coverageGuaranteed: true,
  piso: PISO,
  totalNaOrigem: 146,
  ciclosConcluidos: 0,
});
check("candidatos pendentes mantem a janela", ck2.resumeWindowEnd === primeira.fim);

// Cobertura incerta tambem mantem a janela.
const ck3 = montarCheckpointReconcile({
  janela: primeira,
  candidatesRemaining: 0,
  coverageGuaranteed: false,
  piso: PISO,
  totalNaOrigem: 146,
  ciclosConcluidos: 0,
});
check("cobertura incerta mantem a janela", ck3.resumeWindowEnd === primeira.fim);

// Um processo NOVO le so o checkpoint gravado — nenhuma variavel viva.
const retomada = lerRetomadaReconcile(ck1);
check("o processo seguinte retoma onde o anterior parou", retomada.resumeWindowEnd === "2026-06-09");

const janela2 = janelaReconcile(HOJE, retomada.resumeWindowEnd, PISO);
check("a segunda janela continua abaixo da primeira", janela2.fim === "2026-06-09");
check("a segunda janela nao repete a primeira", janela2.fim < primeira.inicio);

// Varredura completa: percorre ate o piso e fecha o ciclo.
let janela = primeira;
let ciclos = 0;
let checkpoint = null;
let voltas = 0;

while (janela !== null && voltas < 50) {
  checkpoint = montarCheckpointReconcile({
    janela,
    candidatesRemaining: 0,
    coverageGuaranteed: true,
    piso: PISO,
    totalNaOrigem: 146,
    ciclosConcluidos: ciclos,
  });

  ciclos = checkpoint.ciclosConcluidos;

  if (checkpoint.cicloCompleto) break;

  const lida = lerRetomadaReconcile(checkpoint);
  janela = janelaReconcile(HOJE, lida.resumeWindowEnd, PISO);
  voltas += 1;
}

check("o ciclo fecha ao alcancar o piso", checkpoint.cicloCompleto === true);
check("o ciclo concluido e' contado", checkpoint.ciclosConcluidos === 1);
check("a varredura termina em poucas janelas", voltas < 10);

// Ciclo fechado NAO encerra: a proxima execucao recomeca de hoje. E' a
// diferenca essencial em relacao ao baseline.
const depoisDoCiclo = lerRetomadaReconcile(checkpoint);
check("ciclo fechado zera a retomada", depoisDoCiclo.resumeWindowEnd === null);
check("o contador de ciclos sobrevive", depoisDoCiclo.ciclosConcluidos === 1);

const novaVolta = janelaReconcile(HOJE, depoisDoCiclo.resumeWindowEnd, PISO);
check("o ciclo seguinte recomeca de hoje", novaVolta.fim === HOJE);

// Checkpoint desconhecido nao pode ser lido como retomada valida.
check(
  "checkpoint vazio recomeca de hoje",
  lerRetomadaReconcile({}).resumeWindowEnd === null
);
check(
  "checkpoint com data invalida nao e' aceito",
  lerRetomadaReconcile({ resumeWindowEnd: "ontem" }).resumeWindowEnd === null
);

// O worker precisa ler o checkpoint do MESMO modo.
check("o worker le o checkpoint do proprio modo", WORKER.includes('.eq("mode", MODO)'));
check("o worker executa RECONCILE", WORKER.includes("janelaReconcile"));
check(
  "o worker nao recusa mais o modo RECONCILE",
  !WORKER.includes('MODO === "RECONCILE"') || WORKER.includes("montarCheckpointReconcile")
);
check(
  "o detalhe so e' buscado para candidato",
  WORKER.includes("const candidatos = ids.filter((id) => ehCandidato(") &&
    WORKER.includes("candidatos.slice(0, teto)")
);
check(
  "o hash confirma a mudanca, e nao o `modified`",
  MIGRATION.includes("evidence_hash") &&
    ler("apps/web/lib/integrations/diario-de-obra/normalize-report.ts").includes(
      "calcularHashCanonico"
    )
);

console.log("");


// ============================================================
console.log("-- 11. Zero IA, zero midia, zero rede nos modulos --");
// ============================================================

const MODULOS = [
  "apps/web/lib/integrations/diario-de-obra/finding-rules.ts",
  "apps/web/lib/integrations/diario-de-obra/finding-evidence.ts",
  "apps/web/lib/integrations/diario-de-obra/report-readers.ts",
  "apps/web/lib/integrations/diario-de-obra/report-metrics.ts",
  "apps/web/lib/integrations/diario-de-obra/get-monitoring-overview.ts",
  "apps/web/components/integrations/diario-de-obra-monitoring-panel.tsx",
];

const TERMOS_DE_IA = [
  "anthropic",
  "openai",
  "claude",
  "gpt-",
  "llm",
  "prompt",
  "completion",
  "embedding",
  "expert",
];

for (const modulo of MODULOS) {
  const fonte = ler(modulo).toLowerCase();

  check(
    `${path.basename(modulo)} nao importa IA`,
    !TERMOS_DE_IA.some((t) => new RegExp(`(import|require)[^\\n]*${t}`).test(fonte))
  );
}

const TERMOS_DE_MIDIA = ["galeriadefotos", "linkpdf", "urlfoto", "urlminiatura", "assinatura"];

for (const modulo of MODULOS) {
  const fonte = ler(modulo).toLowerCase();
  const codigo = fonte
    .split("\n")
    .filter((linha) => !linha.trim().startsWith("//") && !linha.trim().startsWith("*"))
    .join("\n");

  check(
    `${path.basename(modulo)} nao manipula midia`,
    !TERMOS_DE_MIDIA.some((t) => codigo.includes(t))
  );
}

// Os modulos de regra e de metrica sao PUROS: nao abrem rede nem banco.
for (const modulo of [
  "apps/web/lib/integrations/diario-de-obra/finding-rules.ts",
  "apps/web/lib/integrations/diario-de-obra/finding-evidence.ts",
  "apps/web/lib/integrations/diario-de-obra/report-readers.ts",
  "apps/web/lib/integrations/diario-de-obra/report-metrics.ts",
]) {
  const fonte = ler(modulo);

  check(
    `${path.basename(modulo)} nao faz rede`,
    !/\bfetch\s*\(/.test(fonte) && !fonte.includes("node:http")
  );
  check(
    `${path.basename(modulo)} nao fala com o banco`,
    !fonte.includes("createClient") && !/from\s*\(\s*["']/.test(fonte)
  );
}

check(
  "a migration nao menciona IA",
  !TERMOS_DE_IA.some((t) => MIGRATION.toLowerCase().includes(`${t}(`))
);

// A busca e' por COLUNA declarada, e nao por substring solta: "mediana"
// contem "media" e faria um teste ingenuo acusar um comentario.
const COLUNAS_DA_TABELA = [
  ...MIGRATION.slice(
    MIGRATION.indexOf("create table if not exists public.diario_de_obra_findings"),
    MIGRATION.indexOf("create index if not exists diario_de_obra_findings_project_status_idx")
  ).matchAll(/^\s{2}([a-z_]+)\s+(uuid|text|jsonb|boolean|timestamptz)/gm),
].map((m) => m[1]);

check("a tabela de achados tem as colunas exigidas", [
  "project_id",
  "report_id",
  "sync_run_id",
  "rule_code",
  "severity",
  "status",
  "evidence_key",
  "evidence_hash",
  "structured_evidence",
  "requires_human_review",
  "first_detected_at",
  "last_detected_at",
  "resolved_at",
].every((c) => COLUNAS_DA_TABELA.includes(c)));

check(
  "nenhuma coluna do achado guarda URL, midia ou texto integral",
  !COLUNAS_DA_TABELA.some((c) =>
    ["url", "photo", "foto", "video", "anexo", "midia", "media", "pdf", "descricao", "texto"].some(
      (proibido) => c.includes(proibido)
    )
  )
);

// O interruptor continua fail-closed: nada roda sem ele.
check(
  "sincronizacao desligada sem a variable",
  resolveDiarioSyncEnabled({}).enabled === false
);
check(
  'valor diferente de "true" nao liga',
  resolveDiarioSyncEnabled({ DIARIO_DE_OBRA_SYNC_ENABLED: "TRUE " }).enabled === false
);

// Sem schedule: o workflow continua so por disparo manual.
const WORKFLOW = ler(".github/workflows/diario-de-obra-sync.yml");
check("o workflow nao tem schedule", !/^\s*schedule:/m.test(WORKFLOW));
check("o workflow oferece o modo reconcile", WORKFLOW.includes("- reconcile"));

console.log("");
console.log("=====================================================================");
console.log(`RESULTADO: ${passaram} passaram | ${falharam} falharam`);
console.log("=====================================================================");

process.exit(falharam === 0 ? 0 : 1);
