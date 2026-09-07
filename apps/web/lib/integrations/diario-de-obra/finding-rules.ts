// Regras DETERMINISTICAS do Diario de Obra.
//
// Modulo puro: sem rede, sem banco, sem Supabase, sem IA. Recebe um RDO
// ja normalizado e devolve os achados. As mesmas entradas produzem
// sempre os mesmos achados — e' isso que permite que um humano confira
// a conclusao em vez de acreditar nela.
//
// ZERO TOKEN DE LLM. Nao ha import de IA, nao ha analise semantica, nao
// ha classificacao por lexico. Toda decisao aqui e' comparacao de
// numero, contagem de item ou correspondencia de enum fechado.
//
// ZERO CONTEUDO NA EVIDENCIA. Nenhuma regra copia descricao, nome,
// endereco, URL ou midia. `finding-evidence` so aceita os campos que
// cada regra declara, e o banco recusa de novo.
//
// O HISTORICO NAO VIRA ALERTA
//
// As regras de RDO sao avaliadas sobre RDO NOVO ou REALMENTE ALTERADO
// fora do modo BASELINE. Os 146 relatorios da carga historica alimentam
// estatistica.
//
// As regras de SERIE sao diferentes por natureza — ver a secao delas.

import {
  calcularHashDeEvidencia,
  type EvidenciaEstruturada,
} from "./finding-evidence";
import type { RelatorioNormalizado } from "./normalize-report";
import {
  comoLista,
  contarAtividades100SemConclusao,
  contarTurnosImpraticaveis,
  diasAteEdicao,
  DIAS_PARA_EDICAO_TARDIA,
  totalDeEfetivo,
} from "./report-readers";
import {
  agruparOcorrenciasPorCategoria,
  CATEGORIA_DESCONHECIDA,
  type SeveridadeDeCategoria,
} from "./occurrence-taxonomy";

export type SeveridadeDeAchado = SeveridadeDeCategoria;
export type StatusDeAchado = "OPEN" | "ACKNOWLEDGED" | "RESOLVED";

export const STATUS_DE_ACHADO: readonly StatusDeAchado[] = Object.freeze([
  "OPEN",
  "ACKNOWLEDGED",
  "RESOLVED",
]);

export type CodigoDeRegra =
  | "CLIMA_IMPRATICAVEL_1_TURNO"
  | "CLIMA_IMPRATICAVEL_2_TURNOS"
  | "EFETIVO_ZERO_COM_ATIVIDADE"
  | "ATIVIDADE_100_SEM_CONCLUSAO"
  | "OCORRENCIA_REGISTRADA"
  | "EDICAO_TARDIA"
  | "RDO_SEM_FOTO"
  | "NUMERO_DUPLICADO"
  | "DATA_DUPLICADA"
  | "SALTO_DE_NUMERACAO"
  | "HASH_ALTERADO_POS_BASELINE";

export interface DefinicaoDeRegra {
  /**
   * Severidade fixa da regra. `null` significa DERIVADA — hoje so em
   * OCORRENCIA_REGISTRADA, onde ela vem da categoria estruturada. O
   * banco aplica a mesma tabela e recusa divergencia.
   */
  severity: SeveridadeDeAchado | null;
  requiresHumanReview: boolean;
  /** A regra depende da serie inteira, e nao de um RDO isolado. */
  daSerie: boolean;
  /** Por que a regra existe, em uma linha. Nao vai para o banco. */
  motivo: string;
}

export const REGRAS_ATIVAS: Readonly<Record<CodigoDeRegra, DefinicaoDeRegra>> = Object.freeze({
  CLIMA_IMPRATICAVEL_1_TURNO: {
    severity: "MEDIO",
    requiresHumanReview: false,
    daSerie: false,
    motivo: "Um turno impraticavel — base factual de pleito de prazo.",
  },
  CLIMA_IMPRATICAVEL_2_TURNOS: {
    severity: "ALTO",
    requiresHumanReview: false,
    daSerie: false,
    motivo: "Dois ou mais turnos impraticaveis no mesmo dia.",
  },
  EFETIVO_ZERO_COM_ATIVIDADE: {
    severity: "MEDIO",
    requiresHumanReview: false,
    daSerie: false,
    motivo: "Atividade registrada sem nenhum efetivo: um dos dois esta errado.",
  },
  ATIVIDADE_100_SEM_CONCLUSAO: {
    severity: "MEDIO",
    requiresHumanReview: false,
    daSerie: false,
    motivo: "Atividade em 100% que o status nao acompanha.",
  },
  OCORRENCIA_REGISTRADA: {
    severity: null,
    requiresHumanReview: false,
    daSerie: false,
    motivo: "Ocorrencia estruturada: a severidade vem da CATEGORIA escolhida na obra.",
  },
  EDICAO_TARDIA: {
    severity: "MEDIO",
    requiresHumanReview: false,
    daSerie: false,
    motivo: "RDO editado mais de 30 dias apos a data de referencia.",
  },
  RDO_SEM_FOTO: {
    severity: "BAIXO",
    requiresHumanReview: false,
    daSerie: false,
    motivo: "RDO sem nenhuma foto — lacuna de evidencia, nao irregularidade.",
  },
  NUMERO_DUPLICADO: {
    severity: "ALTO",
    requiresHumanReview: false,
    daSerie: true,
    motivo: "Dois ou mais RDOs com o mesmo numero quebram a serie.",
  },
  DATA_DUPLICADA: {
    severity: "ALTO",
    requiresHumanReview: false,
    daSerie: true,
    motivo: "Dois ou mais RDOs para a mesma data de referencia.",
  },
  SALTO_DE_NUMERACAO: {
    severity: "ALTO",
    requiresHumanReview: false,
    daSerie: true,
    motivo: "Lacuna na numeracao: existe RDO que nunca chegou.",
  },
  HASH_ALTERADO_POS_BASELINE: {
    severity: "MEDIO",
    requiresHumanReview: false,
    daSerie: false,
    motivo: "Conteudo de um RDO historico mudou depois da carga inicial.",
  },
});

export const CODIGOS_DE_REGRA = Object.freeze(
  Object.keys(REGRAS_ATIVAS) as CodigoDeRegra[]
);

/** As regras cujo escopo e' a serie inteira do projeto. */
export const REGRAS_DE_SERIE: readonly CodigoDeRegra[] = Object.freeze(
  CODIGOS_DE_REGRA.filter((c) => REGRAS_ATIVAS[c].daSerie)
);

/** As regras cujo escopo e' UM RDO. */
export const REGRAS_DE_RELATORIO: readonly CodigoDeRegra[] = Object.freeze(
  CODIGOS_DE_REGRA.filter((c) => !REGRAS_ATIVAS[c].daSerie)
);

/**
 * SO METRICA — nunca alerta.
 *
 * Cada uma destas parece um alerta e nao e'. Efetivo "anomalo" depende
 * do porte da frente e da fase da obra; atividade "estagnada" depende do
 * plano; lacuna de datas confunde-se com fim de semana e feriado;
 * criacao retroativa e' rotina em obra sem sinal na frente de servico; e
 * lexico e' leitura de texto, que este modulo nao faz. Emitir alerta com
 * qualquer uma delas produziria falso positivo em volume — o unico
 * defeito que destroi um sistema de alerta de forma permanente.
 */
export const APENAS_METRICA: readonly string[] = Object.freeze([
  "EFETIVO_ANOMALO",
  "ATIVIDADE_ESTAGNADA",
  "LACUNA_DE_DATAS",
  "CRIACAO_RETROATIVA",
  "LEXICO",
]);

/**
 * NAO SAO REGRA — em nenhuma forma.
 *
 * Status do RDO e' fluxo interno do fornecedor; horas trabalhadas e
 * materiais variam legitimamente demais; checklist nem sempre e'
 * preenchido; `dataFim` frequentemente vem vazio por modelo de
 * relatorio; e ausencia em dia util so significaria algo com um
 * calendario de obra — que nao existe no sistema. Sem o calendario, a
 * regra acusaria todo feriado.
 */
export const NAO_SAO_REGRA: readonly string[] = Object.freeze([
  "STATUS_DO_RDO",
  "HORAS_TRABALHADAS",
  "MATERIAIS",
  "CHECKLIST",
  "DATA_FIM",
  "AUSENCIA_EM_DIA_UTIL",
]);

export interface AchadoDeterministico {
  ruleCode: CodigoDeRegra;
  severity: SeveridadeDeAchado;
  /** Preenchido so em OCORRENCIA_REGISTRADA. */
  categoryCode: string | null;
  evidenceKey: string;
  evidenceHash: string;
  structuredEvidence: EvidenciaEstruturada;
  requiresHumanReview: boolean;
}

function montar(entrada: {
  ruleCode: CodigoDeRegra;
  evidenceKey: string;
  structuredEvidence: EvidenciaEstruturada;
  severity?: SeveridadeDeAchado;
  categoryCode?: string | null;
  requiresHumanReview?: boolean;
}): AchadoDeterministico {
  const definicao = REGRAS_ATIVAS[entrada.ruleCode];
  const severity = entrada.severity ?? definicao.severity;

  if (severity === null || severity === undefined) {
    throw new Error(`Regra ${entrada.ruleCode} exige severidade derivada e nenhuma foi dada.`);
  }

  return {
    ruleCode: entrada.ruleCode,
    severity,
    categoryCode: entrada.categoryCode ?? null,
    evidenceKey: entrada.evidenceKey,
    evidenceHash: calcularHashDeEvidencia(entrada.ruleCode, entrada.structuredEvidence),
    structuredEvidence: entrada.structuredEvidence,
    requiresHumanReview: entrada.requiresHumanReview ?? definicao.requiresHumanReview,
  };
}


// ============================================================
// Quem entra na avaliacao
// ============================================================

export type ResultadoDoUpsert = "CRIADO" | "ALTERADO" | "INALTERADO";

/**
 * Decide se um RDO recem-persistido deve passar pelas regras.
 *
 * BASELINE     nunca. Carga historica alimenta estatistica; alerta
 *              retroativo sobre 146 registros seria uma caixa de
 *              entrada que ninguem pode mais atender.
 * INCREMENTAL  novo OU realmente alterado. A janela movel tem 14 dias,
 *              entao "novo" ali significa recem-chegado.
 * RECONCILE    SO alterado. A reconciliacao varre historico: um RDO
 *              visto ali pela primeira vez e' backfill, nao novidade.
 *
 * INALTERADO nunca entra: hash igual significa que nada mudou.
 */
export function deveAvaliarAchados(
  modo: string,
  resultado: ResultadoDoUpsert
): boolean {
  if (modo === "BASELINE") return false;
  if (modo === "RECONCILE") return resultado === "ALTERADO";
  return resultado === "CRIADO" || resultado === "ALTERADO";
}


// ============================================================
// Regras de UM RDO
// ============================================================

export interface ContextoDoRelatorio {
  /** O registro ja existia e veio da carga historica. */
  baselineImported: boolean;
  /** O upsert desta execucao devolveu ALTERADO. */
  conteudoAlterado: boolean;
}

/**
 * Avalia as regras que dependem so deste RDO.
 *
 * `evidenceKey` e' o `providerReportId` nas regras de um-por-RDO. Em
 * OCORRENCIA_REGISTRADA a chave inclui a CATEGORIA e, quando existe, o
 * identificador estruturado do tipo — sem isso, duas categorias no mesmo
 * dia colidiriam na mesma identidade e uma delas sumiria.
 */
export function avaliarRegrasDoRelatorio(
  relatorio: RelatorioNormalizado,
  contexto: ContextoDoRelatorio
): AchadoDeterministico[] {
  const achados: AchadoDeterministico[] = [];
  const chave = relatorio.providerReportId;

  // 1. Clima impraticavel — um turno MEDIO, dois ou mais ALTO.
  //    So um dos dois codigos dispara: sao a mesma condicao em
  //    intensidades diferentes, e emitir os dois contaria duas vezes.
  const turnos = contarTurnosImpraticaveis(relatorio.weather);

  if (turnos >= 2) {
    achados.push(
      montar({
        ruleCode: "CLIMA_IMPRATICAVEL_2_TURNOS",
        evidenceKey: chave,
        structuredEvidence: { turnosImpraticaveis: turnos },
      })
    );
  } else if (turnos === 1) {
    achados.push(
      montar({
        ruleCode: "CLIMA_IMPRATICAVEL_1_TURNO",
        evidenceKey: chave,
        structuredEvidence: { turnosImpraticaveis: 1 },
      })
    );
  }

  // 2. Efetivo zero com atividade registrada.
  //    Efetivo ilegivel (`null`) nao dispara: sem leitura nao ha fato.
  const efetivo = totalDeEfetivo(relatorio.labor);
  const atividades = comoLista(relatorio.activities).length;

  if (efetivo === 0 && atividades > 0) {
    achados.push(
      montar({
        ruleCode: "EFETIVO_ZERO_COM_ATIVIDADE",
        evidenceKey: chave,
        structuredEvidence: { efetivo: 0, atividades },
      })
    );
  }

  // 3. Atividade em 100% sem status de conclusao.
  const em100 = contarAtividades100SemConclusao(relatorio.activities);

  if (em100 > 0) {
    achados.push(
      montar({
        ruleCode: "ATIVIDADE_100_SEM_CONCLUSAO",
        evidenceKey: chave,
        structuredEvidence: { atividades: em100 },
      })
    );
  }

  // 4. Ocorrencias — UM achado por CATEGORIA distinta.
  //
  //    A severidade vem da categoria estruturada que o apontador
  //    escolheu, nunca da descricao. Duas categorias diferentes no mesmo
  //    dia sao dois problemas com donos diferentes, e colapsa-las na
  //    maior severidade esconderia um deles. Duas ocorrencias da MESMA
  //    categoria sao um achado com contagem.
  for (const categoria of agruparOcorrenciasPorCategoria(relatorio.occurrences)) {
    const evidencia: EvidenciaEstruturada = {
      categoria: categoria.code,
      ocorrencias: categoria.ocorrencias,
    };

    // Identificador estruturado, quando a API o devolve. Nunca o rotulo.
    if (categoria.tipoId !== null) evidencia.tipoId = categoria.tipoId;
    if (categoria.tipoRef !== null) evidencia.tipoRef = categoria.tipoRef;

    const sufixo = [categoria.code, categoria.tipoId ?? categoria.tipoRef ?? null]
      .filter((parte) => parte !== null)
      .join(":");

    achados.push(
      montar({
        ruleCode: "OCORRENCIA_REGISTRADA",
        evidenceKey: `${chave}:${sufixo}`,
        structuredEvidence: evidencia,
        severity: categoria.severity,
        categoryCode: categoria.code,
        // Categoria fora da tabela: o sistema nao sabe o que aquilo
        // significa, e dizer que sabe seria pior que admitir que nao.
        requiresHumanReview: categoria.code === CATEGORIA_DESCONHECIDA,
      })
    );
  }

  // 5. Edicao mais de 30 dias depois da data de referencia.
  const dias = diasAteEdicao(relatorio.referenceDate, relatorio.sourceModifiedAt);

  if (
    dias !== null &&
    dias > DIAS_PARA_EDICAO_TARDIA &&
    relatorio.referenceDate &&
    relatorio.sourceModifiedAt
  ) {
    achados.push(
      montar({
        ruleCode: "EDICAO_TARDIA",
        evidenceKey: chave,
        structuredEvidence: {
          diasApos: dias,
          dataReferencia: relatorio.referenceDate,
          dataEdicao: relatorio.sourceModifiedAt.slice(0, 10),
        },
      })
    );
  }

  // 6. RDO sem foto. BAIXO porque e' lacuna de evidencia, nao
  //    irregularidade: ha dia de obra que legitimamente nao rende foto.
  if (relatorio.photoCount === 0) {
    achados.push(
      montar({ ruleCode: "RDO_SEM_FOTO", evidenceKey: chave, structuredEvidence: { fotos: 0 } })
    );
  }

  // 7. Conteudo de um RDO historico mudou depois da carga inicial.
  //    O prefixo do hash entra na evidencia para que uma SEGUNDA edicao
  //    seja distinguivel da primeira. Doze hexadecimais sao
  //    identificador, nao conteudo.
  if (contexto.baselineImported && contexto.conteudoAlterado) {
    achados.push(
      montar({
        ruleCode: "HASH_ALTERADO_POS_BASELINE",
        evidenceKey: chave,
        structuredEvidence: {
          baselineImportado: true,
          hashPrefixo: relatorio.contentHash.slice(0, 12),
        },
      })
    );
  }

  return achados;
}


// ============================================================
// Regras da SERIE
//
// POR QUE O ESCOPO E' O PROJETO, E NAO O RDO
//
// A versao anterior ancorava a duplicidade em CADA RDO do grupo. Isso
// produzia dois defeitos. O primeiro: dois achados para um unico fato
// ("o numero 11 esta duplicado"), e o painel contava duas vezes. O
// segundo, pior: se A e B duplicavam e depois so B era reavaliado, o
// achado de A ficava OPEN para sempre — A nunca mais mudava, entao nunca
// mais era reavaliado, e a resolucao e' escoposada por RDO.
//
// Agora um fato = um achado. `NUMERO_DUPLICADO` e' identificado pelo
// NUMERO, `DATA_DUPLICADA` pela DATA e `SALTO_DE_NUMERACAO` pelo
// INTERVALO ausente. O conjunto esperado e' recalculado inteiro a cada
// execucao que mexa na numeracao, e o que saiu do conjunto e' resolvido.
//
// O `report_id` continua existindo porque todo achado precisa de uma
// ancora auditavel — mas ele e' escolhido DETERMINISTICAMENTE (menor
// providerReportId do grupo; o RDO logo depois da lacuna) e nao faz
// parte da identidade.
// ============================================================

export interface RelatorioDaSerie {
  providerReportId: string;
  reportNumber: number | null;
  referenceDate: string | null;
}

export interface AchadoDeSerie extends AchadoDeterministico {
  /** RDO ao qual o achado fica ancorado. Deterministico, nao identitario. */
  ancoraProviderReportId: string;
}

/**
 * Maior salto de numeracao que ainda vira achado.
 *
 * Sem teto, uma obra que comeca a numerar em 900 acusaria 899 faltantes
 * na primeira leitura. O teto transforma isso em um achado com o numero
 * de faltantes, e nao numa avalanche.
 */
export const MAX_FALTANTES_POR_SALTO = 500;

function menorId(grupo: readonly RelatorioDaSerie[]): string {
  return [...grupo].map((r) => r.providerReportId).sort()[0];
}

/**
 * Conjunto COMPLETO de achados de serie para a serie dada.
 *
 * A serie precisa estar completa — quem chama e' responsavel por
 * garantir isso antes, porque uma serie truncada inventaria lacunas que
 * nao existem.
 *
 * A ordenacao numerica e' feita aqui, em memoria, e nao delegada ao
 * banco: a leitura e' paginada por chave unica estavel, e ordenar por
 * numero no banco tornaria a paginacao fragil a numero nulo e repetido.
 */
export function avaliarRegrasDaSerie(serie: readonly RelatorioDaSerie[]): AchadoDeSerie[] {
  const achados: AchadoDeSerie[] = [];

  // 1. Numero duplicado — um achado por NUMERO.
  const porNumero = new Map<number, RelatorioDaSerie[]>();

  for (const rdo of serie) {
    if (rdo.reportNumber === null) continue;
    porNumero.set(rdo.reportNumber, [...(porNumero.get(rdo.reportNumber) ?? []), rdo]);
  }

  for (const [numero, grupo] of [...porNumero.entries()].sort((a, b) => a[0] - b[0])) {
    if (grupo.length < 2) continue;

    achados.push({
      ...montar({
        ruleCode: "NUMERO_DUPLICADO",
        evidenceKey: `NUM-${numero}`,
        structuredEvidence: { numero, ocorrencias: grupo.length },
      }),
      ancoraProviderReportId: menorId(grupo),
    });
  }

  // 2. Data de referencia duplicada — um achado por DATA.
  const porData = new Map<string, RelatorioDaSerie[]>();

  for (const rdo of serie) {
    if (!rdo.referenceDate) continue;
    porData.set(rdo.referenceDate, [...(porData.get(rdo.referenceDate) ?? []), rdo]);
  }

  for (const [data, grupo] of [...porData.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (grupo.length < 2) continue;

    achados.push({
      ...montar({
        ruleCode: "DATA_DUPLICADA",
        evidenceKey: `DATA-${data}`,
        structuredEvidence: { data, ocorrencias: grupo.length },
      }),
      ancoraProviderReportId: menorId(grupo),
    });
  }

  // 3. Salto de numeracao — um achado por INTERVALO ausente, ancorado no
  //    RDO logo depois da lacuna: e' a partir dele que se pergunta pelo
  //    que faltou.
  const numerados = serie
    .filter((r): r is RelatorioDaSerie & { reportNumber: number } => r.reportNumber !== null)
    .sort((a, b) =>
      a.reportNumber === b.reportNumber
        ? a.providerReportId < b.providerReportId
          ? -1
          : 1
        : a.reportNumber - b.reportNumber
    );

  for (let i = 1; i < numerados.length; i += 1) {
    const anterior = numerados[i - 1].reportNumber;
    const atual = numerados[i].reportNumber;
    const faltando = atual - anterior - 1;

    if (faltando <= 0 || faltando > MAX_FALTANTES_POR_SALTO) continue;

    achados.push({
      ...montar({
        ruleCode: "SALTO_DE_NUMERACAO",
        evidenceKey: `SALTO-${anterior + 1}-${atual - 1}`,
        structuredEvidence: { numeroAnterior: anterior, numero: atual, faltando },
      }),
      ancoraProviderReportId: numerados[i].providerReportId,
    });
  }

  return achados;
}

/** Chave de reconciliacao usada pelas funcoes de resolucao do banco. */
export function chaveDeResolucao(achado: {
  ruleCode: string;
  evidenceKey: string;
}): string {
  return `${achado.ruleCode}|${achado.evidenceKey}`;
}
