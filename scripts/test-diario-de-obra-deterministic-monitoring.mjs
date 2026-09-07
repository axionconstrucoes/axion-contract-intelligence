// Regras deterministicas, taxonomia, achados e painel do Diario de Obra.
//
// SEM REDE, SEM CREDENCIAL, SEM BANCO, SEM IA.
//
// O banco e' simulado: `register_diario_de_obra_finding`,
// `resolve_diario_de_obra_findings` e
// `resolve_diario_de_obra_series_findings` sao reimplementadas aqui com
// as MESMAS transicoes da migration, e a suite afirma o comportamento
// delas. A suite TAMBEM afirma o texto da migration, para que as duas
// nao divirjam em silencio.
//
// O que esta suite protege:
//
//    1. catalogo de regras e severidades;
//    2. taxonomia estruturada de ocorrencias — as 24 categorias;
//    3. normalizacao tolerante a caixa, acento, espaco e pontuacao;
//    4. categoria desconhecida vira UNKNOWN, MEDIO e revisao humana;
//    5. evidencia com schema FECHADO: JWT, UUID, sk-, URL e payload caem;
//    6. baseline e primeira observacao do reconcile sem findings;
//    7. idempotencia, resolucao e reabertura;
//    8. lifecycle dos achados de SERIE, escopo de projeto;
//    9. leitura paginada e completa da serie; truncamento nao acusa;
//   10. RLS, service_role e integridade no banco;
//   11. painel so com agregado, e o aviso de IA desligada;
//   12. RECONCILE ciclico com checkpoint;
//   13. nenhum modulo importa IA ou toca midia.
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
  REGRAS_DE_SERIE,
  REGRAS_DE_RELATORIO,
  APENAS_METRICA,
  NAO_SAO_REGRA,
  STATUS_DE_ACHADO,
  avaliarRegrasDoRelatorio,
  avaliarRegrasDaSerie,
  deveAvaliarAchados,
  chaveDeResolucao,
} = await import("../apps/web/lib/integrations/diario-de-obra/finding-rules.ts");

const {
  evidenciaSemConteudo,
  validarEvidencia,
  calcularHashDeEvidencia,
  ESQUEMA_POR_REGRA,
  TIPO_POR_CHAVE,
  FORMATO_DE_EVIDENCE_KEY,
} = await import("../apps/web/lib/integrations/diario-de-obra/finding-evidence.ts");

const {
  CATEGORIAS_DE_OCORRENCIA,
  CODIGOS_DE_CATEGORIA,
  CATEGORIA_DESCONHECIDA,
  normalizarRotuloDeCategoria,
  resolverCategoria,
  agruparOcorrenciasPorCategoria,
} = await import("../apps/web/lib/integrations/diario-de-obra/occurrence-taxonomy.ts");

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

const N = (sobrescritas = {}) => normalizarRelatorio(detalhe(sobrescritas), {});

const CONTEXTO_NOVO = { baselineImported: false, conteudoAlterado: false };

const codigos = (achados) => achados.map((a) => a.ruleCode).sort();

const avaliar = (relatorio, contexto = CONTEXTO_NOVO) =>
  avaliarRegrasDoRelatorio(relatorio, contexto);

const ocorrenciaDe = (achados) => achados.find((a) => a.ruleCode === "OCORRENCIA_REGISTRADA");

console.log("=====================================================================");
console.log("REGRAS DETERMINISTICAS, TAXONOMIA E PAINEL DO DIARIO DE OBRA");
console.log("=====================================================================");
console.log("");


// ============================================================
console.log("-- 1. Catalogo de regras --");
// ============================================================

check("ha exatamente 11 regras ativas", CODIGOS_DE_REGRA.length === 11);

check(
  "a migration aceita exatamente as regras do codigo",
  CODIGOS_DE_REGRA.every((c) => MIGRATION.includes(`'${c}'`))
);

const CODIGOS_NA_MIGRATION = [
  ...MIGRATION.slice(
    MIGRATION.indexOf("rule_code text not null"),
    MIGRATION.indexOf("-- Categoria estruturada da ocorrencia")
  ).matchAll(/'([A-Z_0-9]+)'/g),
].map((m) => m[1]);

check(
  "a migration nao aceita nenhuma regra alem das do codigo",
  CODIGOS_NA_MIGRATION.length === 11 &&
    CODIGOS_NA_MIGRATION.every((c) => CODIGOS_DE_REGRA.includes(c))
);

check(
  "severidades fixas: clima 1 turno MEDIO, 2 turnos ALTO",
  REGRAS_ATIVAS.CLIMA_IMPRATICAVEL_1_TURNO.severity === "MEDIO" &&
    REGRAS_ATIVAS.CLIMA_IMPRATICAVEL_2_TURNOS.severity === "ALTO"
);

check(
  "efetivo zero, atividade 100% e edicao tardia sao MEDIO",
  REGRAS_ATIVAS.EFETIVO_ZERO_COM_ATIVIDADE.severity === "MEDIO" &&
    REGRAS_ATIVAS.ATIVIDADE_100_SEM_CONCLUSAO.severity === "MEDIO" &&
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
  "a severidade da ocorrencia e' DERIVADA, nao fixa",
  REGRAS_ATIVAS.OCORRENCIA_REGISTRADA.severity === null
);

check(
  "as tres regras de serie estao marcadas como tal",
  REGRAS_DE_SERIE.length === 3 &&
    ["NUMERO_DUPLICADO", "DATA_DUPLICADA", "SALTO_DE_NUMERACAO"].every((c) =>
      REGRAS_DE_SERIE.includes(c)
    )
);

check("as demais sao regras de RDO", REGRAS_DE_RELATORIO.length === 8);

check(
  "a migration conhece as mesmas regras de serie",
  MIGRATION.includes("select array['NUMERO_DUPLICADO', 'DATA_DUPLICADA', 'SALTO_DE_NUMERACAO']")
);

check(
  "o ciclo de vida tem os tres estados",
  STATUS_DE_ACHADO.length === 3 &&
    MIGRATION.includes("check (status in ('OPEN', 'ACKNOWLEDGED', 'RESOLVED'))")
);

console.log("");


// ============================================================
console.log("-- 2. O que NAO pode virar alerta --");
// ============================================================

check(
  "metricas nao aparecem como regra nem no CHECK",
  APENAS_METRICA.every((m) => !CODIGOS_DE_REGRA.includes(m) && !MIGRATION.includes(`'${m}'`))
);

check(
  "nenhum item proibido virou regra",
  NAO_SAO_REGRA.every((m) => !CODIGOS_DE_REGRA.includes(m) && !MIGRATION.includes(`'${m}'`))
);

// Prova de COMPORTAMENTO: um RDO cujo unico "problema" e' o status do
// fornecedor, as horas, os materiais, o checklist ou `dataFim`.
const soCamposProibidos = N({
  status: { id: 1, descricao: "Em edicao" },
  horarioDeTrabalho: { inicio: "22:00", fim: "02:00" },
  controleDeMaterial: { itens: [{ nome: "Cimento", quantidade: 0 }] },
  checklist: [],
  dataFim: "",
  atividades: [],
});

check(
  "status, horas, materiais, checklist e dataFim nao geram achado",
  avaliar(soCamposProibidos).length === 0
);

console.log("");


// ============================================================
console.log("-- 3. Taxonomia estruturada de ocorrencias --");
// ============================================================

check("a taxonomia tem 24 categorias", CATEGORIAS_DE_OCORRENCIA.length === 24);

check(
  "os codigos sao unicos",
  new Set(CATEGORIAS_DE_OCORRENCIA.map((c) => c.code)).size === 24
);

check("UNKNOWN esta na lista de codigos aceitos", CODIGOS_DE_CATEGORIA.includes("UNKNOWN"));

check(
  "nenhuma categoria produz CRITICO",
  CATEGORIAS_DE_OCORRENCIA.every((c) => ["BAIXO", "MEDIO", "ALTO"].includes(c.severity)) &&
    !MIGRATION.includes("'CRITICO'")
);

// Toda categoria, com a severidade exigida — pelo ROTULO do formulario.
const ESPERADO = [
  ["Aditivos", "ALTO"],
  ["Alteração de projeto", "ALTO"],
  ["Dano em estrutura existente - não mapeada", "ALTO"],
  ["Dano em estrutura nova", "ALTO"],
  ["Dia parado", "ALTO"],
  ["Fiscalização trabalhista/meio ambiente", "ALTO"],
  ["Solicitação fora do escopo", "ALTO"],
  ["Taludes danificado devido fortes chuvas", "ALTO"],
  ["Agentes Externos", "MEDIO"],
  ["Cronograma", "MEDIO"],
  ["Falha mecânica de Equipamento - Atraso e/ou Parada de Serviço", "MEDIO"],
  ["Falta de equipamento", "MEDIO"],
  ["Falta de material", "MEDIO"],
  ["Falta de mão de obra", "MEDIO"],
  ["Identificação de erro de projeto", "MEDIO"],
  ["Incompatibilidade de projetos", "MEDIO"],
  ["Retrabalho", "MEDIO"],
  ["Solicitações do cliente", "MEDIO"],
  ["Visita do Fiscal", "MEDIO"],
  ["Visita seguradora", "MEDIO"],
  ["Dia Chuvoso", "BAIXO"],
  ["Liberação de Medição", "BAIXO"],
  ["Reunião", "BAIXO"],
  ["Visita do projetista", "BAIXO"],
];

check("os 24 rotulos exigidos estao cobertos", ESPERADO.length === 24);

for (const [rotulo, severidade] of ESPERADO) {
  const achados = avaliar(N({ ocorrencias: [{ tipo: { descricao: rotulo } }] }));
  const achado = ocorrenciaDe(achados);

  check(
    `"${rotulo}" => ${severidade}`,
    achado !== undefined && achado.severity === severidade
  );

  // E o banco precisa concordar, pelo CODIGO.
  const codigo = achado?.categoryCode;
  const trecho = MIGRATION.slice(
    MIGRATION.indexOf("diario_de_obra_severidade_da_categoria"),
    MIGRATION.indexOf("A.2 Severidade ESPERADA")
  );
  const bloco = trecho.slice(0, trecho.indexOf(`then '${severidade}'`));

  check(
    `a migration classifica ${codigo} como ${severidade}`,
    codigo !== undefined && bloco.includes(`'${codigo}'`)
  );
}

console.log("");


// ============================================================
console.log("-- 4. Normalizacao: caixa, acento, espaco e pontuacao --");
// ============================================================

const VARIACOES = [
  ["  dia  PARADO ", "DIA_PARADO", "ALTO"],
  ["DIA PARADO", "DIA_PARADO", "ALTO"],
  ["Dia Parado.", "DIA_PARADO", "ALTO"],
  ["reuniao", "REUNIAO", "BAIXO"],
  ["REUNIÃO", "REUNIAO", "BAIXO"],
  ["Fiscalizacao trabalhista / meio ambiente", "FISCALIZACAO_TRABALHISTA_AMBIENTAL", "ALTO"],
  ["FISCALIZAÇÃO TRABALHISTA/MEIO AMBIENTE", "FISCALIZACAO_TRABALHISTA_AMBIENTAL", "ALTO"],
  ["Falta de MÃO DE OBRA", "FALTA_DE_MAO_DE_OBRA", "MEDIO"],
  ["falta-de-material", "FALTA_DE_MATERIAL", "MEDIO"],
  ["Alteracao   de   Projeto", "ALTERACAO_DE_PROJETO", "ALTO"],
  ["Taludes danificado devido fortes chuvas!", "TALUDE_DANIFICADO_POR_CHUVA", "ALTO"],
];

for (const [rotulo, codigo, severidade] of VARIACOES) {
  const achado = ocorrenciaDe(avaliar(N({ ocorrencias: [{ tipo: { descricao: rotulo } }] })));

  check(
    `"${rotulo}" => ${codigo} (${severidade})`,
    achado?.categoryCode === codigo && achado?.severity === severidade
  );
}

check(
  "a normalizacao condensa espacos e remove pontuacao",
  normalizarRotuloDeCategoria("  Fiscalização   trabalhista/meio  ambiente  ") ===
    "fiscalizacao trabalhista meio ambiente"
);

// O tipo pode chegar como string direta, e nao como objeto.
check(
  "tipo como string direta tambem e' resolvido",
  ocorrenciaDe(avaliar(N({ ocorrencias: [{ tipo: "Retrabalho" }] })))?.categoryCode ===
    "RETRABALHO"
);

// E o proprio codigo canonico precisa ser reconhecido.
check(
  "o codigo canonico tambem e' reconhecido",
  resolverCategoria({ tipo: "FALTA_DE_EQUIPAMENTO" }).code === "FALTA_DE_EQUIPAMENTO"
);

console.log("");


// ============================================================
console.log("-- 5. Categoria desconhecida --");
// ============================================================

const desconhecida = ocorrenciaDe(
  avaliar(N({ ocorrencias: [{ tipo: { descricao: "Categoria que nao existe" } }] }))
);

check("categoria fora da tabela vira UNKNOWN", desconhecida?.categoryCode === CATEGORIA_DESCONHECIDA);
check("desconhecida e' MEDIO", desconhecida?.severity === "MEDIO");
check("desconhecida exige revisao humana", desconhecida?.requiresHumanReview === true);
check(
  "o rotulo livre desconhecido NAO e' armazenado",
  !JSON.stringify(desconhecida?.structuredEvidence).includes("nao existe")
);

// Ocorrencia sem campo de tipo nenhum tambem e' desconhecida — e a
// descricao NAO e' consultada para adivinhar a categoria.
const semTipo = ocorrenciaDe(
  avaliar(N({ ocorrencias: [{ descricao: "Dia parado por falta de material" }] }))
);

check("ocorrencia sem tipo estruturado vira UNKNOWN", semTipo?.categoryCode === CATEGORIA_DESCONHECIDA);
check(
  "a descricao NAO e' lida para adivinhar a categoria",
  semTipo?.severity === "MEDIO" && semTipo?.requiresHumanReview === true
);
check(
  "a descricao nao vaza na evidencia",
  !JSON.stringify(semTipo?.structuredEvidence).includes("falta de material")
);

check(
  "a migration tambem trata UNKNOWN como MEDIO",
  MIGRATION.includes("when p_code = 'UNKNOWN' then 'MEDIO'")
);
check(
  "a migration exige revisao humana em UNKNOWN",
  MIGRATION.includes("check (category_code is distinct from 'UNKNOWN' or requires_human_review)")
);

console.log("");


// ============================================================
console.log("-- 6. Um achado por CATEGORIA, contagem por repeticao --");
// ============================================================

const duasCategorias = avaliar(
  N({
    ocorrencias: [
      { tipo: { descricao: "Dia parado" } },
      { tipo: { descricao: "Reunião" } },
    ],
  })
).filter((a) => a.ruleCode === "OCORRENCIA_REGISTRADA");

check("duas categorias no mesmo RDO geram dois achados", duasCategorias.length === 2);
check(
  "cada um mantem a propria severidade — nao colapsa na maior",
  duasCategorias.some((a) => a.severity === "ALTO") &&
    duasCategorias.some((a) => a.severity === "BAIXO")
);
check(
  "as identidades sao distintas",
  new Set(duasCategorias.map((a) => a.evidenceKey)).size === 2
);

const mesmaCategoria = avaliar(
  N({
    ocorrencias: [
      { tipo: { descricao: "Falta de material" } },
      { tipo: { descricao: "falta de MATERIAL" } },
    ],
  })
).filter((a) => a.ruleCode === "OCORRENCIA_REGISTRADA");

check("duas ocorrencias da MESMA categoria geram um achado", mesmaCategoria.length === 1);
check("a evidencia traz so a contagem", mesmaCategoria[0].structuredEvidence.ocorrencias === 2);
check(
  "a evidencia nao traz nada alem de categoria e contagem",
  Object.keys(mesmaCategoria[0].structuredEvidence).sort().join() === "categoria,ocorrencias"
);

// Identificador estruturado do tipo entra na identidade.
const comId = ocorrenciaDe(
  avaliar(N({ ocorrencias: [{ tipo: { id: 7, descricao: "Dia parado" } }] }))
);

check("o identificador estruturado e' preservado", comId?.structuredEvidence.tipoId === 7);
check("e entra na identidade do achado", comId?.evidenceKey.endsWith(":DIA_PARADO:7"));

const comObjectId = ocorrenciaDe(
  avaliar(
    N({
      ocorrencias: [
        { tipo: { _id: "68b0a1c2d3e4f5a6b7c8d9ff", descricao: "Categoria nova do fornecedor" } },
      ],
    })
  )
);

check(
  "ObjectId do tipo e' preservado mesmo em categoria desconhecida",
  comObjectId?.structuredEvidence.tipoRef === "68b0a1c2d3e4f5a6b7c8d9ff"
);
check("e continua UNKNOWN com revisao humana", comObjectId?.requiresHumanReview === true);

check(
  "toda evidence_key cabe no formato do banco",
  [...duasCategorias, ...mesmaCategoria, comId, comObjectId].every((a) =>
    FORMATO_DE_EVIDENCE_KEY.test(a.evidenceKey)
  )
);

console.log("");


// ============================================================
console.log("-- 7. Regras de UM RDO --");
// ============================================================

check("RDO normal nao gera achado", avaliar(N()).length === 0);

check(
  "um turno impraticavel => CLIMA_IMPRATICAVEL_1_TURNO",
  codigos(avaliar(N({ clima: { manha: "Impraticável", tarde: "Bom", noite: "Bom" } }))).join() ===
    "CLIMA_IMPRATICAVEL_1_TURNO"
);

const doisTurnos = avaliar(
  N({ clima: { manha: "Impraticável", tarde: { praticavel: false }, noite: "Bom" } })
);

check(
  "dois turnos => CLIMA_IMPRATICAVEL_2_TURNOS, severidade ALTO",
  codigos(doisTurnos).join() === "CLIMA_IMPRATICAVEL_2_TURNOS" && doisTurnos[0].severity === "ALTO"
);

check(
  "impraticabilidade so no dia conta como UM turno",
  codigos(avaliar(N({ clima: { manha: "Bom", praticavel: false } }))).join() ===
    "CLIMA_IMPRATICAVEL_1_TURNO"
);

check(
  "efetivo zero com atividade dispara",
  codigos(avaliar(N({ maoDeObra: { total: 0 } }))).includes("EFETIVO_ZERO_COM_ATIVIDADE")
);

check(
  "efetivo zero SEM atividade nao dispara",
  !codigos(avaliar(N({ maoDeObra: { total: 0 }, atividades: [] }))).includes(
    "EFETIVO_ZERO_COM_ATIVIDADE"
  )
);

check(
  "efetivo ilegivel nao dispara alerta",
  !codigos(avaliar(N({ maoDeObra: "dezoito pessoas" }))).includes("EFETIVO_ZERO_COM_ATIVIDADE")
);

check(
  "atividade 100% sem conclusao dispara",
  codigos(
    avaliar(N({ atividades: [{ descricao: "Alvenaria", percentual: 100, status: "Em andamento" }] }))
  ).includes("ATIVIDADE_100_SEM_CONCLUSAO")
);

check(
  "atividade 100% CONCLUIDA nao dispara",
  !codigos(
    avaliar(N({ atividades: [{ descricao: "Alvenaria", percentual: 100, status: "Concluída" }] }))
  ).includes("ATIVIDADE_100_SEM_CONCLUSAO")
);

const tardia = avaliar(N({ data: "01/06/2026", modified: "20/08/2026 10:00" })).find(
  (a) => a.ruleCode === "EDICAO_TARDIA"
);

check("edicao 80 dias depois dispara", tardia !== undefined);
check("a evidencia registra os dias", tardia?.structuredEvidence.diasApos === 80);

check(
  "edicao com exatamente 30 dias nao dispara",
  !codigos(avaliar(N({ data: "01/08/2026", modified: "31/08/2026 10:00" }))).includes(
    "EDICAO_TARDIA"
  )
);

check(
  "RDO sem foto dispara BAIXO usando so o contador",
  avaliar(N({ galeriaDeFotos: [] })).some(
    (a) =>
      a.ruleCode === "RDO_SEM_FOTO" &&
      a.severity === "BAIXO" &&
      JSON.stringify(a.structuredEvidence) === '{"fotos":0}'
  )
);

check("RDO com foto nao dispara", !codigos(avaliar(N())).includes("RDO_SEM_FOTO"));

check(
  "RDO historico alterado => HASH_ALTERADO_POS_BASELINE",
  codigos(avaliar(N(), { baselineImported: true, conteudoAlterado: true })).includes(
    "HASH_ALTERADO_POS_BASELINE"
  )
);

check(
  "RDO historico INALTERADO nao dispara",
  !codigos(avaliar(N(), { baselineImported: true, conteudoAlterado: false })).includes(
    "HASH_ALTERADO_POS_BASELINE"
  )
);

check(
  "RDO novo alterado nao dispara pos-baseline",
  !codigos(avaliar(N(), { baselineImported: false, conteudoAlterado: true })).includes(
    "HASH_ALTERADO_POS_BASELINE"
  )
);

console.log("");


// ============================================================
console.log("-- 8. Evidencia: schema FECHADO --");
// ============================================================

check(
  "toda regra tem esquema declarado",
  CODIGOS_DE_REGRA.every((c) => ESQUEMA_POR_REGRA[c] !== undefined)
);

check(
  "a migration declara as mesmas chaves por regra",
  CODIGOS_DE_REGRA.every((regra) => {
    const trecho = MIGRATION.slice(
      MIGRATION.indexOf("diario_de_obra_chaves_da_regra"),
      MIGRATION.indexOf("diario_de_obra_chaves_obrigatorias")
    );
    const linha = trecho.split("\n").find((l) => l.includes(`when '${regra}' then`));
    if (!linha) return false;
    return Object.keys(ESQUEMA_POR_REGRA[regra]).every((chave) => linha.includes(`'${chave}'`));
  })
);

check(
  "a migration conhece o tipo de toda chave",
  Object.keys(TIPO_POR_CHAVE).every((chave) => MIGRATION.includes(`when '${chave}' then`))
);

// Credenciais e afins: TODAS recusadas, em qualquer regra.
const CADEIAS_PROIBIDAS = [
  ["JWT truncado em 40", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc"],
  ["JWT completo", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.dozjgNryP4J3jVmNHl0w5N_XgL0"],
  ["UUID de sessao", "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"],
  ["chave hex de 32", "a1b2c3d4e5f60718293a4b5c6d7e8f90"],
  ["sk- style", "sk-abcdefghijklmnopqrstuvwxyz0123456789"],
  ["cookie", "session=abc123"],
  ["Authorization", "Bearer abc123"],
  ["URL", "https://api.diariodeobra.app/uploads/f.jpg"],
  ["descricao livre", "Paralisacao por chuva forte na frente 3"],
  ["nome de pessoa", "Joao da Silva"],
  ["endereco", "Rua das Flores 123"],
];

for (const [rotulo, valor] of CADEIAS_PROIBIDAS) {
  // Tentada em TODO campo de TODA regra.
  const aceitaEmAlgum = CODIGOS_DE_REGRA.some((regra) =>
    Object.keys(ESQUEMA_POR_REGRA[regra]).some(
      (chave) => validarEvidencia(regra, { [chave]: valor }).valida
    )
  );

  check(`${rotulo} e' recusado em qualquer campo de qualquer regra`, !aceitaEmAlgum);
}

check(
  "chave extra e' recusada",
  !evidenciaSemConteudo("RDO_SEM_FOTO", { fotos: 0, payload: 1 })
);
check(
  "chave obrigatoria ausente e' recusada",
  !evidenciaSemConteudo("EDICAO_TARDIA", { diasApos: 40 })
);
check(
  "regra desconhecida nao tem evidencia valida",
  !evidenciaSemConteudo("REGRA_INVENTADA", { fotos: 0 })
);
check("payload aninhado e' recusado", !evidenciaSemConteudo("RDO_SEM_FOTO", { fotos: { n: 0 } }));
check("array e' recusado", !evidenciaSemConteudo("RDO_SEM_FOTO", { fotos: [0] }));
check("NaN e' recusado", !evidenciaSemConteudo("RDO_SEM_FOTO", { fotos: Number.NaN }));
check("negativo e' recusado onde o tipo e' nao negativo", !evidenciaSemConteudo("RDO_SEM_FOTO", { fotos: -1 }));
check("fracionario e' recusado onde o tipo e' inteiro", !evidenciaSemConteudo("RDO_SEM_FOTO", { fotos: 0.5 }));

// ObjectId: valido SO no campo apropriado.
const OBJECT_ID = "68b0a1c2d3e4f5a6b7c8d9ff";

check(
  "ObjectId e' aceito em tipoRef",
  evidenciaSemConteudo("OCORRENCIA_REGISTRADA", {
    categoria: "DIA_PARADO",
    ocorrencias: 1,
    tipoRef: OBJECT_ID,
  })
);

check(
  "ObjectId e' recusado em qualquer outro campo",
  !CODIGOS_DE_REGRA.some((regra) =>
    Object.keys(ESQUEMA_POR_REGRA[regra]).some(
      (chave) => chave !== "tipoRef" && validarEvidencia(regra, { [chave]: OBJECT_ID }).valida
    )
  )
);

check(
  "categoria fora da taxonomia e' recusada",
  !evidenciaSemConteudo("OCORRENCIA_REGISTRADA", { categoria: "INVENTADA", ocorrencias: 1 })
);

// Todo achado produzido pelas regras passa pelo funil.
const TODOS_OS_ACHADOS = [
  ...avaliar(
    N({
      clima: { manha: "Impraticável", tarde: "Impraticável" },
      maoDeObra: { total: 0 },
      atividades: [{ descricao: "Servico X", percentual: 100, status: "Em andamento" }],
      ocorrencias: [
        { tipo: { id: 3, descricao: "Dia parado" }, descricao: "Acidente com Joao da Silva, Rua X 123" },
        { tipo: { descricao: "Reunião" } },
      ],
      galeriaDeFotos: [],
      data: "01/01/2026",
      modified: "01/09/2026 10:00",
    }),
    { baselineImported: true, conteudoAlterado: true }
  ),
  ...avaliarRegrasDaSerie([
    { providerReportId: "a1", reportNumber: 10, referenceDate: "2026-09-01" },
    { providerReportId: "a2", reportNumber: 10, referenceDate: "2026-09-01" },
    { providerReportId: "a4", reportNumber: 14, referenceDate: "2026-09-05" },
  ]),
];

check(
  "toda evidencia produzida passa pelo funil da propria regra",
  TODOS_OS_ACHADOS.every((a) => evidenciaSemConteudo(a.ruleCode, a.structuredEvidence))
);

check(
  "todo hash e' sha256 hexadecimal",
  TODOS_OS_ACHADOS.every((a) => /^[0-9a-f]{64}$/.test(a.evidenceHash))
);

const SERIALIZADO = JSON.stringify(TODOS_OS_ACHADOS.map((a) => a.structuredEvidence));

check("nenhuma evidencia carrega nome", !SERIALIZADO.includes("Joao da Silva"));
check("nenhuma evidencia carrega endereco", !SERIALIZADO.includes("Rua X"));
check("nenhuma evidencia carrega descricao de atividade", !SERIALIZADO.includes("Servico X"));
check("nenhuma evidencia carrega URL", !/https?:\/\//.test(SERIALIZADO));

check(
  "a ordem das chaves nao muda o hash",
  calcularHashDeEvidencia("EFETIVO_ZERO_COM_ATIVIDADE", { efetivo: 0, atividades: 2 }) ===
    calcularHashDeEvidencia("EFETIVO_ZERO_COM_ATIVIDADE", { atividades: 2, efetivo: 0 })
);

check(
  "evidencia diferente produz hash diferente",
  calcularHashDeEvidencia("RDO_SEM_FOTO", { fotos: 0 }) !==
    calcularHashDeEvidencia("ATIVIDADE_100_SEM_CONCLUSAO", { atividades: 0 })
);

let recusou = false;
try {
  calcularHashDeEvidencia("RDO_SEM_FOTO", { descricao: "texto livre" });
} catch {
  recusou = true;
}
check("hash de evidencia proibida falha alto", recusou);

console.log("");


// ============================================================
console.log("-- 9. Banco simulado: idempotencia, resolucao, integridade --");
// ============================================================

/*
 * Reimplementacao das funcoes da migration, com as MESMAS transicoes e
 * as MESMAS validacoes. O texto da migration e' afirmado logo abaixo,
 * para que as duas nao divirjam em silencio.
 */
const SEVERIDADE_DA_CATEGORIA = new Map(
  CATEGORIAS_DE_OCORRENCIA.map((c) => [c.code, c.severity])
);
SEVERIDADE_DA_CATEGORIA.set("UNKNOWN", "MEDIO");

function severidadeEsperada(ruleCode, categoryCode) {
  if (ruleCode === "OCORRENCIA_REGISTRADA") {
    return SEVERIDADE_DA_CATEGORIA.get(categoryCode) ?? null;
  }
  return REGRAS_ATIVAS[ruleCode]?.severity ?? null;
}

function criarBanco() {
  const linhas = new Map();
  const relatorios = new Map();

  return {
    linhas,
    relatorios,

    registrarRelatorio(reportId, projectId) {
      relatorios.set(reportId, projectId);
    },

    registrar({ mode, projectId, reportId, syncRunId, achado }) {
      if (mode === "BASELINE") throw new Error("BASELINE recusado");
      if (!["INCREMENTAL", "RECONCILE"].includes(mode)) throw new Error("modo invalido");

      const esperada = severidadeEsperada(achado.ruleCode, achado.categoryCode);
      if (esperada === null) throw new Error("regra ou categoria desconhecida");
      if (achado.severity !== esperada) throw new Error("severidade incompativel");

      if (!evidenciaSemConteudo(achado.ruleCode, achado.structuredEvidence)) {
        throw new Error("evidencia recusada");
      }

      if (relatorios.get(reportId) !== projectId) {
        throw new Error("RDO ancora inexistente ou de outro projeto");
      }

      const revisao = achado.requiresHumanReview || achado.categoryCode === "UNKNOWN";
      const k = `${projectId}|${achado.ruleCode}|${achado.evidenceKey}`;
      const e = linhas.get(k);

      if (!e) {
        linhas.set(k, {
          projectId,
          reportId,
          ruleCode: achado.ruleCode,
          categoryCode: achado.categoryCode ?? null,
          evidenceKey: achado.evidenceKey,
          evidenceHash: achado.evidenceHash,
          severity: esperada,
          requiresHumanReview: revisao,
          status: "OPEN",
          resolvedAt: null,
          syncRunId,
        });
        return "CRIADO";
      }

      e.syncRunId = syncRunId;
      e.reportId = reportId;

      if (e.status === "RESOLVED") {
        e.status = "OPEN";
        e.resolvedAt = null;
        e.evidenceHash = achado.evidenceHash;
        return "REABERTO";
      }

      const igual = e.evidenceHash === achado.evidenceHash;
      e.evidenceHash = achado.evidenceHash;
      return igual ? "INALTERADO" : "ATUALIZADO";
    },

    resolverDoRelatorio({ projectId, reportId, ativos }) {
      let n = 0;
      for (const l of linhas.values()) {
        if (l.projectId !== projectId || l.reportId !== reportId) continue;
        if (l.status === "RESOLVED") continue;
        if (REGRAS_DE_SERIE.includes(l.ruleCode)) continue;
        if (ativos.includes(chaveDeResolucao(l))) continue;
        l.status = "RESOLVED";
        l.resolvedAt = Date.now();
        n += 1;
      }
      return n;
    },

    resolverDaSerie({ projectId, ativos }) {
      let n = 0;
      for (const l of linhas.values()) {
        if (l.projectId !== projectId) continue;
        if (l.status === "RESOLVED") continue;
        if (!REGRAS_DE_SERIE.includes(l.ruleCode)) continue;
        if (ativos.includes(chaveDeResolucao(l))) continue;
        l.status = "RESOLVED";
        l.resolvedAt = Date.now();
        n += 1;
      }
      return n;
    },
  };
}

const PRJ = "proj-1";

/** Reproduz a etapa de achados do worker. */
function executarWorker(banco, { mode, upserts, serie, serieCompleta = true }) {
  const avaliados = upserts.filter((u) => deveAvaliarAchados(mode, u.resultado));

  let registrados = 0;
  let resolvidos = 0;

  if (avaliados.length === 0) return { registrados, resolvidos, avaliados: 0 };

  for (const item of avaliados) {
    const achados = avaliarRegrasDoRelatorio(item.normalizado, {
      baselineImported: item.baselineImported === true,
      conteudoAlterado: item.resultado === "ALTERADO",
    });

    for (const a of achados) {
      banco.registrar({ mode, projectId: PRJ, reportId: item.reportId, syncRunId: "run", achado: a });
      registrados += 1;
    }

    resolvidos += banco.resolverDoRelatorio({
      projectId: PRJ,
      reportId: item.reportId,
      ativos: achados.map((a) => chaveDeResolucao(a)),
    });
  }

  // Serie: so com leitura completa.
  if (serieCompleta) {
    const daSerie = avaliarRegrasDaSerie(serie ?? []);
    const ativos = [];

    for (const a of daSerie) {
      const reportId = `uuid-${a.ancoraProviderReportId}`;
      banco.registrar({ mode, projectId: PRJ, reportId, syncRunId: "run", achado: a });
      registrados += 1;
      ativos.push(chaveDeResolucao(a));
    }

    resolvidos += banco.resolverDaSerie({ projectId: PRJ, ativos });
  }

  return { registrados, resolvidos, avaliados: avaliados.length };
}

function comRelatorios(banco, ids) {
  for (const id of ids) banco.registrarRelatorio(`uuid-${id}`, PRJ);
  return banco;
}

// --- 9.1 Incremental vazio ---
{
  const b = comRelatorios(criarBanco(), ["A"]);

  executarWorker(b, {
    mode: "INCREMENTAL",
    upserts: [
      { providerReportId: "A", reportId: "uuid-A", resultado: "CRIADO", normalizado: N({ _id: "A", galeriaDeFotos: [] }) },
    ],
    serie: [{ providerReportId: "A", reportNumber: 1, referenceDate: "2026-09-01" }],
  });

  const antes = b.linhas.size;

  const vazio = executarWorker(b, { mode: "INCREMENTAL", upserts: [], serie: [] });

  check("incremental vazio nao registra nada", vazio.registrados === 0);
  check("incremental vazio nao resolve nada", vazio.resolvidos === 0);
  check("nenhuma linha muda de estado", b.linhas.size === antes &&
    [...b.linhas.values()].every((l) => l.status === "OPEN"));

  const inalterado = executarWorker(b, {
    mode: "INCREMENTAL",
    upserts: [
      { providerReportId: "A", reportId: "uuid-A", resultado: "INALTERADO", normalizado: N({ _id: "A", galeriaDeFotos: [] }) },
    ],
    serie: [],
  });

  check("hash inalterado nao gera nem resolve finding",
    inalterado.registrados === 0 && inalterado.resolvidos === 0 && inalterado.avaliados === 0);
}

// --- 9.2 Dois candidatos, so um reavaliado ---
{
  const b = comRelatorios(criarBanco(), ["A", "B"]);

  executarWorker(b, {
    mode: "INCREMENTAL",
    upserts: [
      { providerReportId: "A", reportId: "uuid-A", resultado: "CRIADO", normalizado: N({ _id: "A", galeriaDeFotos: [] }) },
      { providerReportId: "B", reportId: "uuid-B", resultado: "CRIADO", normalizado: N({ _id: "B", galeriaDeFotos: [] }) },
    ],
    serie: [
      { providerReportId: "A", reportNumber: 1, referenceDate: "2026-09-01" },
      { providerReportId: "B", reportNumber: 2, referenceDate: "2026-09-02" },
    ],
  });

  check("dois RDOs geram dois achados", b.linhas.size === 2);

  const r = executarWorker(b, {
    mode: "INCREMENTAL",
    upserts: [
      { providerReportId: "A", reportId: "uuid-A", resultado: "ALTERADO", normalizado: N({ _id: "A" }) },
    ],
    serie: [
      { providerReportId: "A", reportNumber: 1, referenceDate: "2026-09-01" },
      { providerReportId: "B", reportNumber: 2, referenceDate: "2026-09-02" },
    ],
  });

  check("o RDO reavaliado tem seu achado resolvido", r.resolvidos === 1);
  check(
    "o achado do RDO NAO reavaliado permanece intacto",
    b.linhas.get(`${PRJ}|RDO_SEM_FOTO|B`).status === "OPEN" &&
      b.linhas.get(`${PRJ}|RDO_SEM_FOTO|B`).resolvedAt === null
  );
}

// --- 9.3 Duas regras no mesmo RDO, ACKNOWLEDGED e reabertura ---
{
  const b = comRelatorios(criarBanco(), ["C"]);
  const climaRuim = { manha: "Impraticável", tarde: "Impraticável", noite: "Bom" };

  executarWorker(b, {
    mode: "INCREMENTAL",
    upserts: [
      { providerReportId: "C", reportId: "uuid-C", resultado: "CRIADO", normalizado: N({ _id: "C", galeriaDeFotos: [], clima: climaRuim }) },
    ],
    serie: [{ providerReportId: "C", reportNumber: 1, referenceDate: "2026-09-01" }],
  });

  check("duas regras coexistem no mesmo RDO", b.linhas.size === 2);

  b.linhas.get(`${PRJ}|CLIMA_IMPRATICAVEL_2_TURNOS|C`).status = "ACKNOWLEDGED";

  const r = executarWorker(b, {
    mode: "INCREMENTAL",
    upserts: [
      { providerReportId: "C", reportId: "uuid-C", resultado: "ALTERADO", normalizado: N({ _id: "C", clima: climaRuim }) },
    ],
    serie: [{ providerReportId: "C", reportNumber: 1, referenceDate: "2026-09-01" }],
  });

  check("so a regra que deixou de valer e' resolvida", r.resolvidos === 1);
  check("RDO_SEM_FOTO virou RESOLVED", b.linhas.get(`${PRJ}|RDO_SEM_FOTO|C`).status === "RESOLVED");
  check(
    "ACKNOWLEDGED sobrevive enquanto a condicao existir",
    b.linhas.get(`${PRJ}|CLIMA_IMPRATICAVEL_2_TURNOS|C`).status === "ACKNOWLEDGED"
  );

  const r2 = executarWorker(b, {
    mode: "INCREMENTAL",
    upserts: [
      { providerReportId: "C", reportId: "uuid-C", resultado: "ALTERADO", normalizado: N({ _id: "C", galeriaDeFotos: [], clima: climaRuim }) },
    ],
    serie: [{ providerReportId: "C", reportNumber: 1, referenceDate: "2026-09-01" }],
  });

  check(
    "condicao que reapareceu reabre em OPEN",
    b.linhas.get(`${PRJ}|RDO_SEM_FOTO|C`).status === "OPEN" &&
      b.linhas.get(`${PRJ}|RDO_SEM_FOTO|C`).resolvedAt === null
  );
  check("reabrir nao cria linha nova", b.linhas.size === 2);
  check("nenhuma resolucao indevida na reabertura", r2.resolvidos === 0);
}

// --- 9.4 Baseline e primeira observacao do reconcile ---
{
  const b = criarBanco();

  const historico = Array.from({ length: 146 }, (_, i) => {
    b.registrarRelatorio(`uuid-H${i}`, PRJ);
    return {
      providerReportId: `H${i}`,
      reportId: `uuid-H${i}`,
      resultado: "CRIADO",
      baselineImported: true,
      normalizado: N({
        _id: `H${i}`,
        galeriaDeFotos: [],
        clima: { manha: "Impraticável", tarde: "Impraticável" },
        ocorrencias: [{ tipo: { descricao: "Dia parado" } }],
      }),
    };
  });

  const rBase = executarWorker(b, { mode: "BASELINE", upserts: historico, serie: [] });

  check("BASELINE com 146 RDOs registra ZERO achado", rBase.registrados === 0);
  check("o banco continua vazio apos o baseline", b.linhas.size === 0);

  b.registrarRelatorio("uuid-R1", PRJ);

  const rRec = executarWorker(b, {
    mode: "RECONCILE",
    upserts: [
      { providerReportId: "R1", reportId: "uuid-R1", resultado: "CRIADO", normalizado: N({ _id: "R1", galeriaDeFotos: [] }) },
    ],
    serie: [],
  });

  check("RECONCILE de primeira observacao nao cria achado", rRec.registrados === 0);

  const rRec2 = executarWorker(b, {
    mode: "RECONCILE",
    upserts: [
      {
        providerReportId: "R1",
        reportId: "uuid-R1",
        resultado: "ALTERADO",
        baselineImported: true,
        normalizado: N({ _id: "R1", galeriaDeFotos: [] }),
      },
    ],
    serie: [{ providerReportId: "R1", reportNumber: 1, referenceDate: "2024-01-01" }],
  });

  check("RECONCILE com ALTERADO avalia", rRec2.registrados > 0);
  check("e marca hash alterado pos-baseline", b.linhas.has(`${PRJ}|HASH_ALTERADO_POS_BASELINE|R1`));
}

// --- 9.5 Integridade recusada pelo banco simulado ---
{
  const b = comRelatorios(criarBanco(), ["X"]);
  const semFoto = avaliar(N({ _id: "X", galeriaDeFotos: [] }))[0];

  const tentar = (fn) => {
    try {
      fn();
      return null;
    } catch (erro) {
      return erro.message;
    }
  };

  check(
    "severidade incompativel e' recusada",
    tentar(() =>
      b.registrar({
        mode: "INCREMENTAL",
        projectId: PRJ,
        reportId: "uuid-X",
        syncRunId: "r",
        achado: { ...semFoto, severity: "ALTO" },
      })
    ) === "severidade incompativel"
  );

  check(
    "modo invalido e' recusado",
    tentar(() =>
      b.registrar({ mode: "INCREMENTALL", projectId: PRJ, reportId: "uuid-X", syncRunId: "r", achado: semFoto })
    ) === "modo invalido"
  );

  check(
    "BASELINE e' recusado",
    tentar(() =>
      b.registrar({ mode: "BASELINE", projectId: PRJ, reportId: "uuid-X", syncRunId: "r", achado: semFoto })
    ) === "BASELINE recusado"
  );

  check(
    "RDO de outro projeto e' recusado",
    tentar(() =>
      b.registrar({ mode: "INCREMENTAL", projectId: "outro", reportId: "uuid-X", syncRunId: "r", achado: semFoto })
    ) === "RDO ancora inexistente ou de outro projeto"
  );

  check(
    "evidencia fora do schema e' recusada",
    tentar(() =>
      b.registrar({
        mode: "INCREMENTAL",
        projectId: PRJ,
        reportId: "uuid-X",
        syncRunId: "r",
        achado: { ...semFoto, structuredEvidence: { descricao: "x" } },
      })
    ) === "evidencia recusada"
  );
}

// E a migration precisa dizer o mesmo.
check(
  "a migration valida o modo em INCREMENTAL/RECONCILE",
  MIGRATION.includes("p_mode not in ('INCREMENTAL', 'RECONCILE')")
);
check(
  "a migration deriva a severidade",
  MIGRATION.includes("v_severidade := public.diario_de_obra_severidade_esperada(p_rule_code, p_category_code);")
);
check(
  "a migration recusa severidade divergente",
  MIGRATION.includes("Severidade incompativel com a regra")
);
check(
  "categoria fora da taxonomia e' recusada pelo CHECK",
  MIGRATION.includes(
    "check (public.diario_de_obra_severidade_esperada(rule_code, category_code) is not null)"
  )
);
check(
  "a severidade e' travada por CHECK, nao so pela RPC",
  MIGRATION.includes(
    "check (severity = public.diario_de_obra_severidade_esperada(rule_code, category_code))"
  )
);
check(
  "a FK composta amarra report_id ao project_id",
  MIGRATION.includes("foreign key (report_id, project_id)") &&
    MIGRATION.includes("references public.diario_de_obra_reports (id, project_id)")
);
check(
  "a chave alvo da FK composta e' criada",
  MIGRATION.includes("add constraint diario_de_obra_reports_id_project_key unique (id, project_id)")
);
check(
  "sync_run_id e' nullable com SET NULL — excluir projeto nao conflita",
  MIGRATION.includes("references public.diario_de_obra_sync_runs (id) on delete set null") &&
    !MIGRATION.includes("public.diario_de_obra_sync_runs (id) on delete restrict")
);
check(
  "a resolucao por RDO ignora as regras de serie",
  MIGRATION.includes("and not (rule_code = any (public.diario_de_obra_regras_de_serie()))")
);
check(
  "a resolucao de serie so alcanca regras de serie",
  MIGRATION.includes("and rule_code = any (public.diario_de_obra_regras_de_serie())")
);
check(
  "a identidade nao inclui a execucao",
  MIGRATION.includes("unique (project_id, rule_code, evidence_key)")
);
check("a migration reabre RESOLVED", MIGRATION.includes("return 'REABERTO';"));
check(
  "a migration exige data em RESOLVED",
  MIGRATION.includes("(status = 'RESOLVED' and resolved_at is not null)")
);
check(
  "category_code existe se e so se a regra for de ocorrencia",
  MIGRATION.includes("(rule_code = 'OCORRENCIA_REGISTRADA' and category_code is not null)")
);

console.log("");


// ============================================================
console.log("-- 10. Lifecycle dos achados de SERIE --");
// ============================================================

// Um fato = um achado, mesmo com varios RDOs envolvidos.
const trioDuplicado = avaliarRegrasDaSerie([
  { providerReportId: "a1", reportNumber: 11, referenceDate: "2026-09-01" },
  { providerReportId: "a2", reportNumber: 11, referenceDate: "2026-09-02" },
  { providerReportId: "a3", reportNumber: 11, referenceDate: "2026-09-03" },
]).filter((a) => a.ruleCode === "NUMERO_DUPLICADO");

check("tres RDOs com o mesmo numero geram UM achado", trioDuplicado.length === 1);
check("a identidade e' o NUMERO, nao o RDO", trioDuplicado[0].evidenceKey === "NUM-11");
check("a evidencia conta quantos sao", trioDuplicado[0].structuredEvidence.ocorrencias === 3);
check("a ancora e' deterministica", trioDuplicado[0].ancoraProviderReportId === "a1");

const datasDuplicadas = avaliarRegrasDaSerie([
  { providerReportId: "b1", reportNumber: 1, referenceDate: "2026-09-02" },
  { providerReportId: "b2", reportNumber: 2, referenceDate: "2026-09-02" },
]).filter((a) => a.ruleCode === "DATA_DUPLICADA");

check("data duplicada gera UM achado", datasDuplicadas.length === 1);
check("identificado pela DATA", datasDuplicadas[0].evidenceKey === "DATA-2026-09-02");

const lacuna = avaliarRegrasDaSerie([
  { providerReportId: "c1", reportNumber: 11, referenceDate: "2026-09-01" },
  { providerReportId: "c2", reportNumber: 14, referenceDate: "2026-09-05" },
]).filter((a) => a.ruleCode === "SALTO_DE_NUMERACAO");

check("lacuna gera UM achado por intervalo", lacuna.length === 1);
check("identificado pelo INTERVALO ausente", lacuna[0].evidenceKey === "SALTO-12-13");
check("a evidencia diz quantos faltam", lacuna[0].structuredEvidence.faltando === 2);
check("ancorado no RDO depois da lacuna", lacuna[0].ancoraProviderReportId === "c2");
check("severidade ALTO", lacuna[0].severity === "ALTO");

check("serie integra nao gera achado", avaliarRegrasDaSerie([
  { providerReportId: "d1", reportNumber: 1, referenceDate: "2026-01-01" },
  { providerReportId: "d2", reportNumber: 2, referenceDate: "2026-01-02" },
]).length === 0);

// Duplicidade CORRIGIDA resolve o achado — o defeito M3 da auditoria.
{
  const b = comRelatorios(criarBanco(), ["a1", "a2"]);

  const serieComDuplicidade = [
    { providerReportId: "a1", reportNumber: 11, referenceDate: "2026-09-01" },
    { providerReportId: "a2", reportNumber: 11, referenceDate: "2026-09-02" },
  ];

  executarWorker(b, {
    mode: "INCREMENTAL",
    upserts: [
      { providerReportId: "a2", reportId: "uuid-a2", resultado: "CRIADO", normalizado: N({ _id: "a2" }) },
    ],
    serie: serieComDuplicidade,
  });

  check("a duplicidade vira um unico achado no banco", b.linhas.size === 1);
  check("aberto", b.linhas.get(`${PRJ}|NUMERO_DUPLICADO|NUM-11`).status === "OPEN");

  // Na origem, a2 foi renumerado. So a2 volta a ser sincronizado.
  const r = executarWorker(b, {
    mode: "INCREMENTAL",
    upserts: [
      { providerReportId: "a2", reportId: "uuid-a2", resultado: "ALTERADO", normalizado: N({ _id: "a2" }) },
    ],
    serie: [
      { providerReportId: "a1", reportNumber: 11, referenceDate: "2026-09-01" },
      { providerReportId: "a2", reportNumber: 12, referenceDate: "2026-09-02" },
    ],
  });

  check("duplicidade corrigida resolve o achado", r.resolvidos === 1);
  check(
    "mesmo sem o outro RDO ter sido reavaliado",
    b.linhas.get(`${PRJ}|NUMERO_DUPLICADO|NUM-11`).status === "RESOLVED"
  );
}

// Lacuna preenchida resolve o achado.
{
  const b = comRelatorios(criarBanco(), ["c1", "c2", "c3"]);

  executarWorker(b, {
    mode: "INCREMENTAL",
    upserts: [
      { providerReportId: "c2", reportId: "uuid-c2", resultado: "CRIADO", normalizado: N({ _id: "c2" }) },
    ],
    serie: [
      { providerReportId: "c1", reportNumber: 11, referenceDate: "2026-09-01" },
      { providerReportId: "c2", reportNumber: 13, referenceDate: "2026-09-03" },
    ],
  });

  check("a lacuna vira achado", b.linhas.get(`${PRJ}|SALTO_DE_NUMERACAO|SALTO-12-12`)?.status === "OPEN");

  const r = executarWorker(b, {
    mode: "INCREMENTAL",
    upserts: [
      { providerReportId: "c3", reportId: "uuid-c3", resultado: "CRIADO", normalizado: N({ _id: "c3" }) },
    ],
    serie: [
      { providerReportId: "c1", reportNumber: 11, referenceDate: "2026-09-01" },
      { providerReportId: "c3", reportNumber: 12, referenceDate: "2026-09-02" },
      { providerReportId: "c2", reportNumber: 13, referenceDate: "2026-09-03" },
    ],
  });

  check("lacuna preenchida resolve o achado", r.resolvidos === 1);
  check(
    "e o achado fica RESOLVED",
    b.linhas.get(`${PRJ}|SALTO_DE_NUMERACAO|SALTO-12-12`).status === "RESOLVED"
  );
}

// Resolver a serie NAO pode encerrar achado comum de RDO nao reavaliado.
{
  const b = comRelatorios(criarBanco(), ["e1", "e2"]);

  executarWorker(b, {
    mode: "INCREMENTAL",
    upserts: [
      { providerReportId: "e1", reportId: "uuid-e1", resultado: "CRIADO", normalizado: N({ _id: "e1", galeriaDeFotos: [] }) },
    ],
    serie: [{ providerReportId: "e1", reportNumber: 1, referenceDate: "2026-09-01" }],
  });

  executarWorker(b, {
    mode: "INCREMENTAL",
    upserts: [
      { providerReportId: "e2", reportId: "uuid-e2", resultado: "CRIADO", normalizado: N({ _id: "e2" }) },
    ],
    serie: [
      { providerReportId: "e1", reportNumber: 1, referenceDate: "2026-09-01" },
      { providerReportId: "e2", reportNumber: 2, referenceDate: "2026-09-02" },
    ],
  });

  check(
    "achado comum de RDO nao reavaliado sobrevive a resolucao de serie",
    b.linhas.get(`${PRJ}|RDO_SEM_FOTO|e1`).status === "OPEN"
  );
}

console.log("");


// ============================================================
console.log("-- 11. Leitura da serie: completa ou nada --");
// ============================================================

const ACERVO = Array.from({ length: 146 }, (_, i) => ({
  providerReportId: `S${String(i + 1).padStart(3, "0")}`,
  reportNumber: i + 1,
  referenceDate: "2026-01-01",
}));

check(
  "acervo contiguo nao produz SALTO_DE_NUMERACAO",
  avaliarRegrasDaSerie(ACERVO).every((a) => a.ruleCode !== "SALTO_DE_NUMERACAO")
);

// Prova negativa: uma leitura TRUNCADA pelo PostgREST inventaria lacuna.
const TRUNCADO = ACERVO.slice(0, 2).concat(ACERVO.slice(140));

check(
  "uma serie truncada INVENTARIA lacunas",
  avaliarRegrasDaSerie(TRUNCADO).some((a) => a.ruleCode === "SALTO_DE_NUMERACAO")
);

// E por isso o worker nao avalia quando a leitura nao e' completa.
{
  const b = comRelatorios(criarBanco(), ["S001"]);

  const r = executarWorker(b, {
    mode: "INCREMENTAL",
    upserts: [
      { providerReportId: "S001", reportId: "uuid-S001", resultado: "CRIADO", normalizado: N({ _id: "S001" }) },
    ],
    serie: TRUNCADO,
    serieCompleta: false,
  });

  check("serie incompleta nao abre nenhum achado de serie", b.linhas.size === 0);
  check("serie incompleta nao resolve nada", r.resolvidos === 0);
  check("PostgREST truncado nao produz falso ALTO",
    ![...b.linhas.values()].some((l) => l.severity === "ALTO"));
}

// Um achado de serie ja aberto sobrevive a uma execucao com serie
// incompleta: nao avaliar nao e' o mesmo que estar resolvido.
{
  const b = comRelatorios(criarBanco(), ["f1", "f2"]);

  executarWorker(b, {
    mode: "INCREMENTAL",
    upserts: [
      { providerReportId: "f2", reportId: "uuid-f2", resultado: "CRIADO", normalizado: N({ _id: "f2" }) },
    ],
    serie: [
      { providerReportId: "f1", reportNumber: 5, referenceDate: "2026-09-01" },
      { providerReportId: "f2", reportNumber: 5, referenceDate: "2026-09-02" },
    ],
  });

  check("achado de serie aberto", b.linhas.get(`${PRJ}|NUMERO_DUPLICADO|NUM-5`).status === "OPEN");

  executarWorker(b, {
    mode: "INCREMENTAL",
    upserts: [
      { providerReportId: "f2", reportId: "uuid-f2", resultado: "ALTERADO", normalizado: N({ _id: "f2" }) },
    ],
    serie: [],
    serieCompleta: false,
  });

  check(
    "serie incompleta nao encerra achado de serie existente",
    b.linhas.get(`${PRJ}|NUMERO_DUPLICADO|NUM-5`).status === "OPEN"
  );
}

// O worker precisa de fato paginar e conferir o total.
check("o worker pagina a leitura da serie", WORKER.includes(".range(inicio, inicio + PAGINA_DA_SERIE - 1)"));
check("com ordenacao estavel por chave unica", WORKER.includes('.order("provider_report_id", { ascending: true })'));
check("e count exact", WORKER.includes('{ count: "exact" }'));
check(
  "compara o total esperado com o lido",
  WORKER.includes("const completa = total !== null && serie.length === total;")
);
check(
  "so avalia a serie quando a leitura foi completa",
  WORKER.includes("const achadosDaSerie = leitura.completa ? avaliarRegrasDaSerie(leitura.serie) : [];")
);
check(
  "so resolve a serie quando a leitura foi completa",
  WORKER.includes("if (leitura.completa) {")
);
check(
  "registra telemetria sanitizada de cobertura incompleta",
  WORKER.includes("Serie incompleta: ") && WORKER.includes("checkpoint.serieCompleta = serieCompleta;")
);
check(
  "cobertura incompleta torna a execucao PARCIAL",
  WORKER.includes("coberturaDaSerie !== null || erros > 0")
);

console.log("");


// ============================================================
console.log("-- 12. RLS e superficie de escrita --");
// ============================================================

check(
  "RLS habilitada",
  MIGRATION.includes("alter table public.diario_de_obra_findings enable row level security;")
);

check(
  "leitura restrita a membro do projeto",
  MIGRATION.includes("using (public.is_project_member(project_id))")
);

const politicas = [...MIGRATION.matchAll(/create policy[\s\S]*?for (\w+)/g)].map((m) => m[1]);
check("nao existe politica de escrita", politicas.length === 1 && politicas[0] === "select");

check(
  "as tres funcoes de escrita sao SECURITY DEFINER com search_path fechado",
  (MIGRATION.match(/security definer\s+set search_path = ''/g) ?? []).length === 3
);

for (const papel of ["public", "anon", "authenticated"]) {
  check(`execucao revogada de ${papel}`, MIGRATION.includes(`revoke all on function %s from ${papel}`));
}

check(
  "so service_role executa as funcoes de escrita",
  MIGRATION.includes("grant execute on function %s to service_role")
);

check(
  "as tres funcoes de escrita estao na lista de grants",
  [
    "public.register_diario_de_obra_finding(uuid, uuid, uuid, text, text, text, text, text, jsonb, boolean, text)",
    "public.resolve_diario_de_obra_findings(uuid, uuid, text[])",
    "public.resolve_diario_de_obra_series_findings(uuid, text[])",
  ].every((fn) => MIGRATION.includes(fn))
);

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
console.log("-- 13. Painel: so agregados --");
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
    impracticableShifts: 0,
    laborTotal: 10,
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
    impracticableShifts: 2,
    laborTotal: 20,
  },
  {
    reportId: "r3",
    reportNumber: 4,
    referenceDate: "2026-09-05",
    sourceCreatedAt: "2026-09-30",
    sourceModifiedAt: "2026-09-30",
    baselineImported: false,
    photoCount: 5,
    occurrenceCount: 0,
    activityCount: 2,
    impracticableShifts: 0,
    laborTotal: 30,
  },
];

const AG = calcularAgregados(LINHAS);

check("total de RDOs", AG.totalDeRdos === 3);
check("faixa historica", AG.primeiraData === "2026-09-01" && AG.ultimaData === "2026-09-05");
check("ultimo RDO", AG.ultimoRdoNumero === 4 && AG.ultimoRdoData === "2026-09-05");
check("ocorrencias somadas", AG.ocorrenciasRegistradas === 3 && AG.rdosComOcorrencia === 2);
check("clima impraticavel", AG.rdosComClimaImpraticavel === 1 && AG.turnosImpraticaveis === 2);
check("efetivo mediano", AG.efetivoMediano === 20 && AG.rdosComEfetivoLegivel === 3);
check("RDOs sem foto", AG.rdosSemFoto === 1);
check("edicoes tardias", AG.edicoesTardias === 1);
check("integridade: salto", AG.integridade.saltosDeNumeracao === 1);
check("integridade: dias sem RDO", AG.integridade.diasSemRdo === 2);
check("integridade: criacao retroativa e' metrica", AG.integridade.criacoesRetroativas === 1);

check("mediana de conjunto vazio e' nula", mediana([]) === null);
check("mediana de conjunto par", mediana([10, 20]) === 15);
check(
  "efetivo ilegivel fica fora da mediana",
  calcularAgregados([{ ...LINHAS[0], laborTotal: null }]).efetivoMediano === null
);

const duplicados = calcularIntegridade([
  { ...LINHAS[0], reportNumber: 7, referenceDate: "2026-09-01" },
  { ...LINHAS[1], reportNumber: 7, referenceDate: "2026-09-01" },
]);
check(
  "integridade detecta numero e data duplicados",
  duplicados.numerosDuplicados === 1 && duplicados.datasDuplicadas === 1
);

function valoresDe(objeto) {
  return Object.values(objeto).flatMap((v) =>
    v !== null && typeof v === "object" ? valoresDe(v) : [v]
  );
}

check(
  "todo agregado e' numero, nulo ou data ISO",
  valoresDe(AG).every(
    (v) => v === null || typeof v === "number" || /^\d{4}-\d{2}-\d{2}$/.test(String(v))
  )
);

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

check(
  "o painel mostra as tres severidades",
  ["ALTO", "MEDIO", "BAIXO"].every((s) => PAINEL.includes(`abertosPorSeveridade.${s}`))
);

// A VIEW nao pode mais exportar documento nenhum.
check(
  "a view converte ocorrencias e atividades em contagem",
  MIGRATION.includes("as occurrence_count") && MIGRATION.includes("as activity_count")
);
check(
  "a view converte clima em numero de turnos",
  MIGRATION.includes("public.diario_de_obra_turnos_impraticaveis(r.weather) as impracticable_shifts")
);
check(
  "a view converte mao de obra em total",
  MIGRATION.includes("public.diario_de_obra_efetivo_total(r.labor) as labor_total")
);

const VIEW = MIGRATION.slice(MIGRATION.indexOf("create view public.diario_de_obra_report_metrics"));

check(
  "a view NAO exporta nenhum jsonb cru",
  !/^\s+r\.(weather|labor|occurrences|activities|comments|checklist|materials|equipment|work_hours),?\s*$/m.test(
    VIEW
  )
);

check(
  "o leitor do painel nao pede mais weather nem labor",
  !ler("apps/web/lib/integrations/diario-de-obra/get-monitoring-overview.ts").includes(
    "weather, labor"
  )
);

console.log("");


// ============================================================
console.log("-- 14. RECONCILE --");
// ============================================================

const HOJE = "2026-09-07";
const PISO = "2026-01-01";

check("RECONCILE e' um modo aceito", resolveModo("reconcile") === "RECONCILE");
check("o teto do reconcile e' modesto", maxDetalhesPara("RECONCILE") === MAX_DETALHES_RECONCILE);

const primeira = janelaReconcile(HOJE, null, PISO);
check("sem checkpoint, parte de hoje", primeira.fim === HOJE);
check("a janela tem o tamanho configurado", primeira.inicio === "2026-06-10" && RECONCILE_JANELA_DIAS === 90);

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

check(
  "candidatos pendentes mantem a janela",
  montarCheckpointReconcile({
    janela: primeira,
    candidatesRemaining: 7,
    coverageGuaranteed: true,
    piso: PISO,
    totalNaOrigem: 146,
    ciclosConcluidos: 0,
  }).resumeWindowEnd === primeira.fim
);

check(
  "cobertura incerta mantem a janela",
  montarCheckpointReconcile({
    janela: primeira,
    candidatesRemaining: 0,
    coverageGuaranteed: false,
    piso: PISO,
    totalNaOrigem: 146,
    ciclosConcluidos: 0,
  }).resumeWindowEnd === primeira.fim
);

check(
  "o processo seguinte retoma onde o anterior parou",
  lerRetomadaReconcile(ck1).resumeWindowEnd === "2026-06-09"
);

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

  janela = janelaReconcile(HOJE, lerRetomadaReconcile(checkpoint).resumeWindowEnd, PISO);
  voltas += 1;
}

check("o ciclo fecha ao alcancar o piso", checkpoint.cicloCompleto === true);
check("o ciclo concluido e' contado", checkpoint.ciclosConcluidos === 1);
check("ciclo fechado zera a retomada", lerRetomadaReconcile(checkpoint).resumeWindowEnd === null);
check(
  "o ciclo seguinte recomeca de hoje",
  janelaReconcile(HOJE, lerRetomadaReconcile(checkpoint).resumeWindowEnd, PISO).fim === HOJE
);
check("checkpoint com data invalida nao e' aceito", lerRetomadaReconcile({ resumeWindowEnd: "ontem" }).resumeWindowEnd === null);

check("o worker le o checkpoint do proprio modo", WORKER.includes('.eq("mode", MODO)'));
check("o worker executa RECONCILE", WORKER.includes("janelaReconcile"));
check(
  "o detalhe so e' buscado para candidato",
  WORKER.includes("const candidatos = ids.filter((id) => ehCandidato(") &&
    WORKER.includes("candidatos.slice(0, teto)")
);

console.log("");


// ============================================================
console.log("-- 15. Zero IA, zero midia, zero rede --");
// ============================================================

const MODULOS = [
  "apps/web/lib/integrations/diario-de-obra/finding-rules.ts",
  "apps/web/lib/integrations/diario-de-obra/finding-evidence.ts",
  "apps/web/lib/integrations/diario-de-obra/occurrence-taxonomy.ts",
  "apps/web/lib/integrations/diario-de-obra/report-readers.ts",
  "apps/web/lib/integrations/diario-de-obra/report-metrics.ts",
  "apps/web/lib/integrations/diario-de-obra/get-monitoring-overview.ts",
  "apps/web/components/integrations/diario-de-obra-monitoring-panel.tsx",
];

const TERMOS_DE_IA = ["anthropic", "openai", "claude", "gpt-", "llm", "prompt", "completion", "embedding", "expert"];

for (const modulo of MODULOS) {
  const fonte = ler(modulo).toLowerCase();

  check(
    `${path.basename(modulo)} nao importa IA`,
    !TERMOS_DE_IA.some((t) => new RegExp(`(import|require)[^\\n]*${t}`).test(fonte))
  );
}

const TERMOS_DE_MIDIA = ["galeriadefotos", "linkpdf", "urlfoto", "urlminiatura", "assinatura"];

for (const modulo of MODULOS) {
  const codigo = ler(modulo)
    .toLowerCase()
    .split("\n")
    .filter((linha) => !linha.trim().startsWith("//") && !linha.trim().startsWith("*"))
    .join("\n");

  check(`${path.basename(modulo)} nao manipula midia`, !TERMOS_DE_MIDIA.some((t) => codigo.includes(t)));
}

for (const modulo of MODULOS.filter((m) => !m.includes("get-monitoring-overview") && !m.endsWith(".tsx"))) {
  const fonte = ler(modulo);

  check(`${path.basename(modulo)} nao faz rede`, !/\bfetch\s*\(/.test(fonte) && !fonte.includes("node:http"));
  check(
    `${path.basename(modulo)} nao fala com o banco`,
    !fonte.includes("createClient") && !/from\s*\(\s*["']/.test(fonte)
  );
}

check(
  "a migration nao guarda URL nem midia no achado",
  (() => {
    const colunas = [
      ...MIGRATION.slice(
        MIGRATION.indexOf("create table if not exists public.diario_de_obra_findings"),
        MIGRATION.indexOf("create index if not exists diario_de_obra_findings_project_status_idx")
      ).matchAll(/^\s{2}([a-z_]+)\s+(uuid|text|jsonb|boolean|timestamptz)/gm),
    ].map((m) => m[1]);

    return (
      colunas.includes("category_code") &&
      !colunas.some((c) =>
        ["url", "photo", "foto", "video", "anexo", "midia", "pdf", "descricao", "texto"].some((p) =>
          c.includes(p)
        )
      )
    );
  })()
);

check("sincronizacao desligada sem a variable", resolveDiarioSyncEnabled({}).enabled === false);
check(
  'valor diferente de "true" nao liga',
  resolveDiarioSyncEnabled({ DIARIO_DE_OBRA_SYNC_ENABLED: "TRUE " }).enabled === false
);

const WORKFLOW = ler(".github/workflows/diario-de-obra-sync.yml");
check("o workflow nao tem schedule", !/^\s*schedule:/m.test(WORKFLOW));
check("o workflow oferece o modo reconcile", WORKFLOW.includes("- reconcile"));

console.log("");
console.log("=====================================================================");
console.log(`RESULTADO: ${passaram} passaram | ${falharam} falharam`);
console.log("=====================================================================");

process.exit(falharam === 0 ? 0 : 1);
