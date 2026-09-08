// KPI: Disponibilidade operacional por clima e catastrofes.
//
// Modulo puro: sem rede, sem banco, sem IA. Recebe linhas ja resolvidas
// pela view `diario_de_obra_climate_metrics` (numero, booleano, data) e
// devolve o agregado do periodo. As mesmas entradas produzem sempre a
// mesma saida.
//
// UNIDADE: TURNO
//
// Cada data com RDO monitora 2 turnos (manha e tarde — 0,5 dia cada).
// Um RDO pode registrar ate 3 turnos impraticaveis (a leitura do clima
// tambem cobre "noite"), mas so 2 sao MONITORADOS por dia: o excedente e'
// limitado a 2 antes de entrar em qualquer soma, para que
// `turnos_perdidos_confirmados` nunca ultrapasse `turnos_monitorados`.
//
// FORMULA CONFIRMADA — POR DIA:
//
//   turnos_chuva = clamp(impracticableShifts, 0, 2)
//
//   turnos_catastrofe =
//     se hasCatastrofe e hasDiaParado: 2
//     senao, se hasCatastrofe e turnos_chuva > 0: turnos_chuva
//     senao: 0
//
//   turnos_perdidos_confirmados_no_dia = max(turnos_chuva, turnos_catastrofe)
//
// ATRIBUICAO EXCLUSIVA — o painel mostra "perda por chuva direta" e
// "perda por catastrofe" como duas linhas separadas; sem exclusividade,
// um dia com as duas causas apareceria contado nas duas linhas ao mesmo
// tempo, ainda que a disponibilidade em si nao dobrasse:
//
//   se turnos_catastrofe > 0:
//     perda_catastrofe_no_dia = turnos_perdidos_confirmados_no_dia
//     perda_chuva_direta_no_dia = 0
//   senao:
//     perda_catastrofe_no_dia = 0
//     perda_chuva_direta_no_dia = turnos_chuva
//
// FORMULA CONFIRMADA — DO PERIODO:
//
//   turnos_monitorados = 2 x quantidade de datas com RDO
//   turnos_perdidos_confirmados = soma, por dia, de turnos_perdidos_confirmados_no_dia
//   disponibilidade_confirmada =
//     100 x (turnos_monitorados - turnos_perdidos_confirmados) / turnos_monitorados
//
// "Dia Chuvoso" sozinho, "Dia parado" sozinho (sem catastrofe) e
// catastrofe sozinha (sem "Dia parado" nem turno impraticavel) NUNCA
// reduzem a disponibilidade. Catastrofe + "Dia parado" reduz mesmo SEM
// turno climatico marcado como impraticavel — e' o unico caso em que
// "Dia parado" participa da conta, e so por causa da catastrofe.
//
// AUSENCIA DE RDO NUNCA ENTRA NA CONTA. A base historica e' feita das
// DATAS QUE TEM RDO; um dia sem RDO nao e' presumido parado nem
// monitorado, e nao aparece em nenhuma soma nem no efeito residual.

export interface LinhaDeClimaDoRdo {
  reportId: string;
  referenceDate: string | null;
  impracticableShifts: number;
  hasWeatherData: boolean;
  hasDiaChuvoso: boolean;
  hasDiaParado: boolean;
  hasTaludeDanificadoPorChuva: boolean;
  hasCatastrofe: boolean;
  activityCount: number;
  laborTotal: number | null;
}

interface DiaDoClima {
  data: string;
  turnosImpraticaveis: number;
  climaLegivel: boolean;
  diaChuvoso: boolean;
  diaParado: boolean;
  taludeDanificadoPorChuva: boolean;
  catastrofe: boolean;
  efetivoZeroComAtividade: boolean;
}

export interface ClimaKpiDoPeriodo {
  periodoInicio: string | null;
  periodoFim: string | null;

  diasMonitorados: number;
  turnosMonitorados: number;

  turnosPerdidosPorChuvaDireta: number;
  diasEquivalentesPerdidosPorChuvaDireta: number;

  turnosPerdidosPorCatastrofe: number;
  diasEquivalentesConfirmadosPorCatastrofe: number;
  ocorrenciasCatastroficasSemParalisacaoConfirmada: number;

  /** `turnosPerdidosPorChuvaDireta + turnosPerdidosPorCatastrofe` — cada turno confirmado entra em SO uma das duas parcelas (atribuicao exclusiva), entao a soma nunca duplica um turno. */
  turnosPerdidosConfirmados: number;

  candidatosEfeitoResidual: number;

  /** `null` quando `turnosMonitorados` e' 0 — sem divisao por zero. */
  disponibilidadeConfirmadaPercentual: number | null;

  diasComClimaLegivel: number;
  /** `null` quando `diasMonitorados` e' 0. */
  coberturaClimaticaPercentual: number | null;
}

/** So os 2 turnos monitorados por dia (manha + tarde). */
const TURNOS_MONITORADOS_POR_DIA = 2;

function apenasData(valor: string): string {
  return valor.slice(0, 10);
}

function diaAnteriorISO(data: string): string {
  const instante = new Date(`${data}T00:00:00Z`);
  instante.setUTCDate(instante.getUTCDate() - 1);
  return instante.toISOString().slice(0, 10);
}

/**
 * Agrupa as linhas (uma por RDO) por DATA DE REFERENCIA.
 *
 * RDO sem data legivel fica de fora: "ausencia de RDO nao entra na
 * conta" tambem vale para um RDO cuja data nao pode ser lida.
 *
 * Duas linhas na MESMA data (a serie pode ter DATA_DUPLICADA) nao
 * duplicam a data: ela conta uma vez, e cada sinal booleano vira a UNIAO
 * do que qualquer uma das linhas registrou. Os turnos impraticaveis usam
 * o MAIOR valor visto, nao a soma — somar dois RDOs da mesma data
 * poderia inventar um terceiro turno perdido que nenhum dos dois de fato
 * descreve; o maior e' a leitura conservadora.
 */
function agruparPorDia(linhas: readonly LinhaDeClimaDoRdo[]): Map<string, DiaDoClima> {
  const porDia = new Map<string, DiaDoClima>();

  for (const linha of linhas) {
    if (!linha.referenceDate) continue;

    const data = apenasData(linha.referenceDate);
    const turnos = Math.min(
      TURNOS_MONITORADOS_POR_DIA,
      Math.max(0, linha.impracticableShifts)
    );
    const efetivoZeroComAtividade = linha.laborTotal === 0 && linha.activityCount > 0;

    const existente = porDia.get(data);

    if (!existente) {
      porDia.set(data, {
        data,
        turnosImpraticaveis: turnos,
        climaLegivel: linha.hasWeatherData,
        diaChuvoso: linha.hasDiaChuvoso,
        diaParado: linha.hasDiaParado,
        taludeDanificadoPorChuva: linha.hasTaludeDanificadoPorChuva,
        catastrofe: linha.hasCatastrofe,
        efetivoZeroComAtividade,
      });
      continue;
    }

    existente.turnosImpraticaveis = Math.max(existente.turnosImpraticaveis, turnos);
    existente.climaLegivel = existente.climaLegivel || linha.hasWeatherData;
    existente.diaChuvoso = existente.diaChuvoso || linha.hasDiaChuvoso;
    existente.diaParado = existente.diaParado || linha.hasDiaParado;
    existente.taludeDanificadoPorChuva =
      existente.taludeDanificadoPorChuva || linha.hasTaludeDanificadoPorChuva;
    existente.catastrofe = existente.catastrofe || linha.hasCatastrofe;
    existente.efetivoZeroComAtividade =
      existente.efetivoZeroComAtividade || efetivoZeroComAtividade;
  }

  return porDia;
}

/**
 * "Possivel efeito residual — requer confirmacao humana."
 *
 * Candidato quando, no dia D:
 *
 *   1. D-1 EXATO (nao "algum dia antes") tem RDO com turno impraticavel,
 *      "Dia Chuvoso" ou "Taludes danificado devido fortes chuvas";
 *   2. D tem "Dia parado" OU atividade declarada com efetivo zero;
 *   3. D NAO tem turno impraticavel — senao duplicaria a chuva direta,
 *      que ja teve o dia inteiro contado.
 *
 * Um candidato NUNCA reduz `disponibilidadeConfirmadaPercentual`: ele so
 * entra na contagem separada, para confirmacao humana.
 */
function contarCandidatosEfeitoResidual(dias: readonly DiaDoClima[]): number {
  const porData = new Map(dias.map((dia) => [dia.data, dia]));
  let total = 0;

  for (const dia of dias) {
    const anterior = porData.get(diaAnteriorISO(dia.data));
    if (!anterior) continue;

    const sinalDeChuvaEmDMenos1 =
      anterior.turnosImpraticaveis > 0 || anterior.diaChuvoso || anterior.taludeDanificadoPorChuva;
    if (!sinalDeChuvaEmDMenos1) continue;

    const efeitoHoje = dia.diaParado || dia.efetivoZeroComAtividade;
    if (!efeitoHoje) continue;

    if (dia.turnosImpraticaveis > 0) continue;

    total += 1;
  }

  return total;
}

export function calcularClimaKpi(linhas: readonly LinhaDeClimaDoRdo[]): ClimaKpiDoPeriodo {
  const porDia = agruparPorDia(linhas);
  const dias = [...porDia.values()].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));

  const diasMonitorados = dias.length;
  const turnosMonitorados = diasMonitorados * TURNOS_MONITORADOS_POR_DIA;

  let turnosPerdidosPorChuvaDireta = 0;
  let turnosPerdidosPorCatastrofe = 0;
  let ocorrenciasCatastroficasSemParalisacaoConfirmada = 0;
  let diasComClimaLegivel = 0;

  for (const dia of dias) {
    if (dia.climaLegivel) diasComClimaLegivel += 1;

    // Catastrofe + "Dia parado" perde o dia inteiro mesmo sem turno
    // climatico marcado como impraticavel; catastrofe + turno
    // impraticavel nao soma nada alem do que o turno ja perdeu; e
    // catastrofe sem nenhum dos dois e' so ocorrencia registrada.
    const turnosCatastrofeNoDia = !dia.catastrofe
      ? 0
      : dia.diaParado
        ? TURNOS_MONITORADOS_POR_DIA
        : dia.turnosImpraticaveis > 0
          ? dia.turnosImpraticaveis
          : 0;

    if (dia.catastrofe && turnosCatastrofeNoDia === 0) {
      ocorrenciasCatastroficasSemParalisacaoConfirmada += 1;
    }

    const turnosPerdidosConfirmadosNoDia = Math.max(dia.turnosImpraticaveis, turnosCatastrofeNoDia);

    // Atribuicao exclusiva: o mesmo turno confirmado nunca aparece nas
    // duas parcelas do painel ao mesmo tempo.
    if (turnosCatastrofeNoDia > 0) {
      turnosPerdidosPorCatastrofe += turnosPerdidosConfirmadosNoDia;
    } else {
      turnosPerdidosPorChuvaDireta += dia.turnosImpraticaveis;
    }
  }

  const turnosPerdidosConfirmados = turnosPerdidosPorChuvaDireta + turnosPerdidosPorCatastrofe;

  const disponibilidadeConfirmadaPercentual =
    turnosMonitorados > 0
      ? (100 * (turnosMonitorados - turnosPerdidosConfirmados)) / turnosMonitorados
      : null;

  const coberturaClimaticaPercentual =
    diasMonitorados > 0 ? (100 * diasComClimaLegivel) / diasMonitorados : null;

  return {
    periodoInicio: dias[0]?.data ?? null,
    periodoFim: dias[dias.length - 1]?.data ?? null,

    diasMonitorados,
    turnosMonitorados,

    turnosPerdidosPorChuvaDireta,
    diasEquivalentesPerdidosPorChuvaDireta: turnosPerdidosPorChuvaDireta / TURNOS_MONITORADOS_POR_DIA,

    turnosPerdidosPorCatastrofe,
    diasEquivalentesConfirmadosPorCatastrofe: turnosPerdidosPorCatastrofe / TURNOS_MONITORADOS_POR_DIA,
    ocorrenciasCatastroficasSemParalisacaoConfirmada,

    turnosPerdidosConfirmados,

    candidatosEfeitoResidual: contarCandidatosEfeitoResidual(dias),

    disponibilidadeConfirmadaPercentual,

    diasComClimaLegivel,
    coberturaClimaticaPercentual,
  };
}
