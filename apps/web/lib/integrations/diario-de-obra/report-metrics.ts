// Agregados do Diario de Obra para o painel.
//
// Modulo puro: sem rede, sem banco, sem IA. Recebe as linhas ja lidas e
// devolve NUMERO e DATA — nunca uma descricao, um nome, um endereco,
// uma URL ou uma referencia de midia. Tudo que sai daqui e' contagem,
// mediana, minimo, maximo ou diferenca de datas.
//
// AQUI MORA O QUE NAO PODE VIRAR ALERTA
//
// Efetivo anomalo, atividade estagnada, lacuna de datas, criacao
// retroativa e lexico ficam DESTE lado da fronteira, como estatistica.
// Cada um deles depende de contexto que o sistema nao tem — porte da
// frente, plano de ataque, calendario de obra — e viraria falso
// positivo em volume. Aqui eles informam; nao acusam ninguem.
//
// A REGRA DE OURO DESTE ARQUIVO
//
// Se um valor nao e' legivel, ele nao entra na conta. Uma mediana
// calculada sobre leituras falhadas seria pior que a ausencia dela:
// pareceria um fato.

import { diasAteEdicao, DIAS_PARA_EDICAO_TARDIA } from "./report-readers";

/**
 * Uma linha da view `diario_de_obra_report_metrics`.
 *
 * TUDO ja chega como NUMERO. A view converte, dentro do banco,
 * ocorrencias e atividades em contagem, o clima em quantidade de turnos
 * impraticaveis e a mao de obra em total. Nenhum documento cru
 * atravessa a fronteira — nem o `clima`, nem o `maoDeObra`, que podia
 * trazer funcao e nome de quem esteve na obra.
 *
 * `laborTotal` e' `null` quando a forma nao foi legivel, e um RDO assim
 * fica de fora da mediana em vez de entrar como zero.
 */
export interface LinhaDeMetricaDoRdo {
  reportId: string;
  reportNumber: number | null;
  referenceDate: string | null;
  sourceCreatedAt: string | null;
  sourceModifiedAt: string | null;
  baselineImported: boolean;
  photoCount: number;
  occurrenceCount: number;
  activityCount: number;
  impracticableShifts: number;
  laborTotal: number | null;
}

export interface IntegridadeDaSerie {
  /** Numeros de RDO que aparecem em mais de um registro. */
  numerosDuplicados: number;
  /** Datas de referencia com mais de um RDO. */
  datasDuplicadas: number;
  /** Quantas lacunas existem na numeracao. */
  saltosDeNumeracao: number;
  /** Quantos numeros faltam somando todas as lacunas. */
  numerosFaltantes: number;
  /**
   * Dias sem RDO dentro da faixa historica. METRICA, nunca alerta: sem
   * calendario de obra, todo sabado, domingo e feriado apareceria aqui
   * como se fosse falta.
   */
  diasSemRdo: number;
  /** RDOs cuja criacao na origem e' posterior a data de referencia. */
  criacoesRetroativas: number;
  /** RDOs sem data de referencia legivel. */
  semDataDeReferencia: number;
}

export interface AgregadosDoDiario {
  totalDeRdos: number;

  /** Faixa historica coberta pelos RDOs conhecidos. */
  primeiraData: string | null;
  ultimaData: string | null;

  /** O RDO mais recente por data de referencia. */
  ultimoRdoNumero: number | null;
  ultimoRdoData: string | null;

  /** Soma das ocorrencias estruturadas e quantos RDOs as trazem. */
  ocorrenciasRegistradas: number;
  rdosComOcorrencia: number;

  /** RDOs com pelo menos um turno impraticavel. */
  rdosComClimaImpraticavel: number;
  /** Soma dos turnos impraticaveis. */
  turnosImpraticaveis: number;

  /** Mediana do efetivo diario. `null` quando nenhuma leitura foi possivel. */
  efetivoMediano: number | null;
  /** Quantos RDOs tiveram o efetivo efetivamente lido. */
  rdosComEfetivoLegivel: number;

  rdosSemFoto: number;
  edicoesTardias: number;

  integridade: IntegridadeDaSerie;
}

/** Mediana classica; `null` para conjunto vazio. */
export function mediana(valores: readonly number[]): number | null {
  if (valores.length === 0) return null;

  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);

  if (ordenados.length % 2 === 1) return ordenados[meio];

  return (ordenados[meio - 1] + ordenados[meio]) / 2;
}

function diasEntreDatas(inicio: string, fim: string): number {
  const a = Date.parse(`${inicio}T00:00:00Z`);
  const b = Date.parse(`${fim}T00:00:00Z`);

  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;

  return Math.round((b - a) / 86_400_000);
}

/**
 * Integridade da serie: duplicidade, salto, lacuna de datas e criacao
 * retroativa.
 *
 * Duplicidade e salto TAMBEM sao regra de alerta (severidade ALTO). A
 * diferenca e' o proposito: la o achado e' uma pendencia com ciclo de
 * vida, que alguem reconhece e resolve; aqui e' o retrato numerico da
 * serie, que o painel mostra ao lado dos demais agregados. Contam a
 * mesma coisa e respondem perguntas diferentes.
 */
export function calcularIntegridade(linhas: readonly LinhaDeMetricaDoRdo[]): IntegridadeDaSerie {
  const porNumero = new Map<number, number>();
  const porData = new Map<string, number>();

  let semDataDeReferencia = 0;
  let criacoesRetroativas = 0;

  for (const linha of linhas) {
    if (linha.reportNumber !== null) {
      porNumero.set(linha.reportNumber, (porNumero.get(linha.reportNumber) ?? 0) + 1);
    }

    if (linha.referenceDate) {
      porData.set(linha.referenceDate, (porData.get(linha.referenceDate) ?? 0) + 1);
    } else {
      semDataDeReferencia += 1;
    }

    const atraso = diasAteEdicao(linha.referenceDate, linha.sourceCreatedAt);
    if (atraso !== null && atraso > 0) criacoesRetroativas += 1;
  }

  const numeros = [...porNumero.keys()].sort((a, b) => a - b);

  let saltosDeNumeracao = 0;
  let numerosFaltantes = 0;

  for (let i = 1; i < numeros.length; i += 1) {
    const faltando = numeros[i] - numeros[i - 1] - 1;

    if (faltando > 0) {
      saltosDeNumeracao += 1;
      numerosFaltantes += faltando;
    }
  }

  const datas = [...porData.keys()].sort();

  const diasSemRdo =
    datas.length > 1
      ? Math.max(0, diasEntreDatas(datas[0], datas[datas.length - 1]) + 1 - datas.length)
      : 0;

  return {
    numerosDuplicados: [...porNumero.values()].filter((n) => n > 1).length,
    datasDuplicadas: [...porData.values()].filter((n) => n > 1).length,
    saltosDeNumeracao,
    numerosFaltantes,
    diasSemRdo,
    criacoesRetroativas,
    semDataDeReferencia,
  };
}

/**
 * Todos os agregados do painel, em uma passada.
 *
 * A saida e' inteiramente numerica e datada. Nao existe caminho por
 * onde uma descricao de ocorrencia, um nome ou uma URL chegue aqui: a
 * view ja entrega tudo como numero, e a entrada deste modulo nao tem
 * sequer um campo capaz de carregar documento.
 */
export function calcularAgregados(linhas: readonly LinhaDeMetricaDoRdo[]): AgregadosDoDiario {
  let ocorrenciasRegistradas = 0;
  let rdosComOcorrencia = 0;
  let rdosComClimaImpraticavel = 0;
  let turnosImpraticaveis = 0;
  let rdosSemFoto = 0;
  let edicoesTardias = 0;

  const efetivos: number[] = [];
  const datas: string[] = [];

  let ultimo: LinhaDeMetricaDoRdo | null = null;

  for (const linha of linhas) {
    ocorrenciasRegistradas += linha.occurrenceCount;
    if (linha.occurrenceCount > 0) rdosComOcorrencia += 1;

    if (linha.impracticableShifts > 0) {
      rdosComClimaImpraticavel += 1;
      turnosImpraticaveis += linha.impracticableShifts;
    }

    if (linha.laborTotal !== null) efetivos.push(linha.laborTotal);

    if (linha.photoCount === 0) rdosSemFoto += 1;

    const dias = diasAteEdicao(linha.referenceDate, linha.sourceModifiedAt);
    if (dias !== null && dias > DIAS_PARA_EDICAO_TARDIA) edicoesTardias += 1;

    if (linha.referenceDate) {
      datas.push(linha.referenceDate);

      if (!ultimo || !ultimo.referenceDate || linha.referenceDate > ultimo.referenceDate) {
        ultimo = linha;
      }
    }
  }

  datas.sort();

  return {
    totalDeRdos: linhas.length,

    primeiraData: datas[0] ?? null,
    ultimaData: datas[datas.length - 1] ?? null,

    ultimoRdoNumero: ultimo?.reportNumber ?? null,
    ultimoRdoData: ultimo?.referenceDate ?? null,

    ocorrenciasRegistradas,
    rdosComOcorrencia,

    rdosComClimaImpraticavel,
    turnosImpraticaveis,

    efetivoMediano: mediana(efetivos),
    rdosComEfetivoLegivel: efetivos.length,

    rdosSemFoto,
    edicoesTardias,

    integridade: calcularIntegridade(linhas),
  };
}
