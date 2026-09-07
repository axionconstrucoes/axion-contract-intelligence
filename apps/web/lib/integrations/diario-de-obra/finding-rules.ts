// Regras DETERMINISTICAS do Diario de Obra.
//
// Modulo puro: sem rede, sem banco, sem Supabase, sem IA. Recebe um RDO
// ja normalizado e devolve os achados. As mesmas entradas produzem
// sempre os mesmos achados — e' isso que permite que um humano confira
// a conclusao em vez de acreditar nela.
//
// ZERO TOKEN DE LLM. Nao ha import de IA, nao ha analise semantica, nao
// ha classificacao por lexico. Toda decisao aqui e' comparacao de
// numero, contagem de item ou correspondencia de enum.
//
// ZERO CONTEUDO NA EVIDENCIA. Nenhuma regra copia descricao, nome,
// endereco, URL ou midia. `finding-evidence` recusa isso, e o banco
// recusa de novo.
//
// O HISTORICO NAO VIRA ALERTA
//
// As regras sao avaliadas sobre RDO NOVO ou REALMENTE ALTERADO fora do
// modo BASELINE. Os 146 relatorios da carga historica alimentam
// estatistica; transforma-los em alerta encheria a tela de avisos sobre
// os quais ninguem pode mais agir, e isso ensina a ignorar alertas.

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

export type SeveridadeDeAchado = "BAIXO" | "MEDIO" | "ALTO";
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
  severity: SeveridadeDeAchado;
  requiresHumanReview: boolean;
  /** Por que a regra existe, em uma linha. Nao vai para o banco. */
  motivo: string;
}

/**
 * As regras ATIVAS, e so elas. O CHECK da migration repete esta lista:
 * uma regra nova exige migration, e portanto revisao humana.
 */
export const REGRAS_ATIVAS: Readonly<Record<CodigoDeRegra, DefinicaoDeRegra>> = Object.freeze({
  CLIMA_IMPRATICAVEL_1_TURNO: {
    severity: "MEDIO",
    requiresHumanReview: false,
    motivo: "Um turno impraticavel — base factual de pleito de prazo.",
  },
  CLIMA_IMPRATICAVEL_2_TURNOS: {
    severity: "ALTO",
    requiresHumanReview: false,
    motivo: "Dois ou mais turnos impraticaveis no mesmo dia.",
  },
  EFETIVO_ZERO_COM_ATIVIDADE: {
    severity: "MEDIO",
    requiresHumanReview: false,
    motivo: "Atividade registrada sem nenhum efetivo: um dos dois esta errado.",
  },
  ATIVIDADE_100_SEM_CONCLUSAO: {
    severity: "MEDIO",
    requiresHumanReview: false,
    motivo: "Atividade em 100% que o status nao acompanha.",
  },
  OCORRENCIA_REGISTRADA: {
    severity: "MEDIO",
    requiresHumanReview: true,
    motivo: "Ocorrencia estruturada existe — o que ela significa e' leitura humana.",
  },
  EDICAO_TARDIA: {
    severity: "MEDIO",
    requiresHumanReview: false,
    motivo: "RDO editado mais de 30 dias apos a data de referencia.",
  },
  RDO_SEM_FOTO: {
    severity: "BAIXO",
    requiresHumanReview: false,
    motivo: "RDO sem nenhuma foto — lacuna de evidencia, nao irregularidade.",
  },
  NUMERO_DUPLICADO: {
    severity: "ALTO",
    requiresHumanReview: false,
    motivo: "Dois RDOs com o mesmo numero quebram a serie.",
  },
  DATA_DUPLICADA: {
    severity: "ALTO",
    requiresHumanReview: false,
    motivo: "Dois RDOs para a mesma data de referencia.",
  },
  SALTO_DE_NUMERACAO: {
    severity: "ALTO",
    requiresHumanReview: false,
    motivo: "Lacuna na numeracao: existe RDO que nunca chegou.",
  },
  HASH_ALTERADO_POS_BASELINE: {
    severity: "MEDIO",
    requiresHumanReview: false,
    motivo: "Conteudo de um RDO historico mudou depois da carga inicial.",
  },
});

export const CODIGOS_DE_REGRA = Object.freeze(
  Object.keys(REGRAS_ATIVAS) as CodigoDeRegra[]
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
 *
 * Elas alimentam o painel como AGREGADO, e nada mais.
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
  evidenceKey: string;
  evidenceHash: string;
  structuredEvidence: EvidenciaEstruturada;
  requiresHumanReview: boolean;
}

function montar(
  ruleCode: CodigoDeRegra,
  evidenceKey: string,
  structuredEvidence: EvidenciaEstruturada
): AchadoDeterministico {
  const definicao = REGRAS_ATIVAS[ruleCode];

  return {
    ruleCode,
    severity: definicao.severity,
    evidenceKey,
    evidenceHash: calcularHashDeEvidencia(structuredEvidence),
    structuredEvidence,
    requiresHumanReview: definicao.requiresHumanReview,
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
 *              entao "novo" ali significa recem-chegado — nao um RDO de
 *              2025 aparecendo pela primeira vez.
 * RECONCILE    SO alterado. A reconciliacao varre historico: um RDO
 *              visto ali pela primeira vez e' backfill, nao novidade, e
 *              alerta-lo seria justamente o alerta retroativo que o
 *              BASELINE evita.
 *
 * INALTERADO nunca entra: hash igual significa que nada mudou, e
 *            reavaliar produziria o mesmo achado ja registrado.
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
 * `evidenceKey` e' o proprio `providerReportId` em todas elas: a
 * identidade do achado e' (regra, RDO). Uma chave por item da colecao
 * pareceria mais precisa e seria pior — o indice de um item nao e'
 * estavel entre leituras, e cada reordenacao viraria "achado novo".
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
    achados.push(montar("CLIMA_IMPRATICAVEL_2_TURNOS", chave, { turnosImpraticaveis: turnos }));
  } else if (turnos === 1) {
    achados.push(montar("CLIMA_IMPRATICAVEL_1_TURNO", chave, { turnosImpraticaveis: 1 }));
  }

  // 2. Efetivo zero com atividade registrada.
  //    Efetivo ilegivel (`null`) nao dispara: sem leitura nao ha fato.
  const efetivo = totalDeEfetivo(relatorio.labor);
  const atividades = comoLista(relatorio.activities).length;

  if (efetivo === 0 && atividades > 0) {
    achados.push(
      montar("EFETIVO_ZERO_COM_ATIVIDADE", chave, { efetivo: 0, atividades })
    );
  }

  // 3. Atividade em 100% sem status de conclusao.
  const em100 = contarAtividades100SemConclusao(relatorio.activities);

  if (em100 > 0) {
    achados.push(montar("ATIVIDADE_100_SEM_CONCLUSAO", chave, { atividades: em100 }));
  }

  // 4. Ocorrencia estruturada. So a CONTAGEM: a descricao fica no
  //    Diario de Obra, onde ja esta, e quem precisa dela abre o RDO.
  const ocorrencias = comoLista(relatorio.occurrences).length;

  if (ocorrencias > 0) {
    achados.push(montar("OCORRENCIA_REGISTRADA", chave, { ocorrencias }));
  }

  // 5. Edicao mais de 30 dias depois da data de referencia.
  const dias = diasAteEdicao(relatorio.referenceDate, relatorio.sourceModifiedAt);

  if (dias !== null && dias > DIAS_PARA_EDICAO_TARDIA) {
    achados.push(
      montar("EDICAO_TARDIA", chave, {
        diasApos: dias,
        dataReferencia: relatorio.referenceDate ?? null,
        dataEdicao: relatorio.sourceModifiedAt?.slice(0, 10) ?? null,
      })
    );
  }

  // 6. RDO sem foto. BAIXO porque e' lacuna de evidencia, nao
  //    irregularidade: ha dia de obra que legitimamente nao rende foto.
  if (relatorio.photoCount === 0) {
    achados.push(montar("RDO_SEM_FOTO", chave, { fotos: 0 }));
  }

  // 7. Conteudo de um RDO historico mudou depois da carga inicial.
  //    O prefixo do hash entra na evidencia para que uma SEGUNDA edicao
  //    reabra o achado em vez de passar por repeticao da primeira. Doze
  //    hexadecimais sao identificador, nao conteudo.
  if (contexto.baselineImported && contexto.conteudoAlterado) {
    achados.push(
      montar("HASH_ALTERADO_POS_BASELINE", chave, {
        baselineImportado: true,
        hashPrefixo: relatorio.contentHash.slice(0, 12),
      })
    );
  }

  return achados;
}


// ============================================================
// Regras da SERIE
//
// Duplicidade e salto so existem entre RDOs. A serie inteira entra na
// avaliacao — inclusive os historicos —, mas o achado e' ancorado no
// RDO avaliado nesta execucao. Um RDO novo que duplica o numero de um
// de 2025 gera achado no NOVO: e' ele que chegou, e e' sobre ele que se
// pode agir.
// ============================================================

export interface RelatorioDaSerie {
  providerReportId: string;
  reportNumber: number | null;
  referenceDate: string | null;
}

/**
 * Maior salto de numeracao que ainda vira achado.
 *
 * Sem teto, a primeira sincronizacao de uma obra que comeca a numerar em
 * 900 acusaria 899 faltantes. O teto transforma isso em um achado com o
 * numero de faltantes, e nao em uma avalanche.
 */
export const MAX_FALTANTES_POR_SALTO = 500;

export function avaliarRegrasDaSerie(
  serie: readonly RelatorioDaSerie[],
  ancoras: readonly string[]
): Map<string, AchadoDeterministico[]> {
  const porAncora = new Map<string, AchadoDeterministico[]>();
  const ancorado = new Set(ancoras);

  const adicionar = (providerReportId: string, achado: AchadoDeterministico) => {
    if (!ancorado.has(providerReportId)) return;

    const lista = porAncora.get(providerReportId) ?? [];
    lista.push(achado);
    porAncora.set(providerReportId, lista);
  };

  // 1. Numero duplicado.
  const porNumero = new Map<number, RelatorioDaSerie[]>();

  for (const rdo of serie) {
    if (rdo.reportNumber === null) continue;
    porNumero.set(rdo.reportNumber, [...(porNumero.get(rdo.reportNumber) ?? []), rdo]);
  }

  for (const [numero, grupo] of porNumero) {
    if (grupo.length < 2) continue;

    for (const rdo of grupo) {
      adicionar(
        rdo.providerReportId,
        montar("NUMERO_DUPLICADO", rdo.providerReportId, {
          numero,
          ocorrencias: grupo.length,
        })
      );
    }
  }

  // 2. Data de referencia duplicada.
  const porData = new Map<string, RelatorioDaSerie[]>();

  for (const rdo of serie) {
    if (!rdo.referenceDate) continue;
    porData.set(rdo.referenceDate, [...(porData.get(rdo.referenceDate) ?? []), rdo]);
  }

  for (const [data, grupo] of porData) {
    if (grupo.length < 2) continue;

    for (const rdo of grupo) {
      adicionar(
        rdo.providerReportId,
        montar("DATA_DUPLICADA", rdo.providerReportId, {
          data,
          ocorrencias: grupo.length,
        })
      );
    }
  }

  // 3. Salto de numeracao. Ancorado no RDO DEPOIS da lacuna: e' o que
  //    chegou, e e' a partir dele que se pergunta pelo que faltou.
  const numerados = serie
    .filter((rdo): rdo is RelatorioDaSerie & { reportNumber: number } => rdo.reportNumber !== null)
    .sort((a, b) => a.reportNumber - b.reportNumber);

  for (let i = 1; i < numerados.length; i += 1) {
    const anterior = numerados[i - 1].reportNumber;
    const atual = numerados[i].reportNumber;
    const faltando = atual - anterior - 1;

    if (faltando <= 0 || faltando > MAX_FALTANTES_POR_SALTO) continue;

    adicionar(
      numerados[i].providerReportId,
      montar("SALTO_DE_NUMERACAO", numerados[i].providerReportId, {
        numero: atual,
        numeroAnterior: anterior,
        faltando,
      })
    );
  }

  return porAncora;
}
